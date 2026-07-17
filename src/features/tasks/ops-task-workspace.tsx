"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { memo, useCallback, useDeferredValue, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type TouchEvent, type WheelEvent } from "react"
import { ArrowDown, ArrowUp, Bell, BookOpenCheck, CalendarDays, Check, ChevronLeft, ChevronRight, ChevronsUpDown, CircleHelp, Copy, FileText, Filter, Inbox, MessageSquareText, Plus, RefreshCw, Search, Send, Trash2, UserRound, X } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Empty,
  EmptyContent,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { DatePickerControl } from "@/components/ui/date-time-picker"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Textarea } from "@/components/ui/textarea"
import { NotificationControlPanel, useNotificationControlPlaneAvailability } from "@/features/notifications/notification-control-panel"
import type { NotificationWorkflowKey } from "@/features/notifications/notification-control-plane-types"
import { useAuth } from "@/providers/auth-provider"

import {
  OPS_TASK_STATUSES,
  OPS_TASK_PRIORITIES,
  REGISTRATION_PIPELINE_STATUSES,
  WORD_RETEST_STATUSES,
  groupOpsTasksByAssignee,
  groupOpsTasksByStatus,
  getOpsTaskCalendarItems,
  getTaskPriorityLabel,
  getTaskStatusLabel,
  getTaskTypeLabel,
  getWordRetestWorkspaceRole,
  hasOpsTaskCalendarDate,
  hasOpsTaskOverdueCalendarDate,
  isClosedOpsTask,
  isOpsTaskInUserInbox,
  isOpsTaskInUserSent,
  isOpsTaskAssignedToUser,
  isWordRetestInAssistantQueue,
  isWordRetestInTeacherQueue,
  sortOpsTasksByPriority,
  sortOpsTasksByWorkflowStatus,
  sortOpsTasksByWorkDate,
  toDateKey,
} from "./ops-task-model"
import {
  addOpsTaskAttachment,
  addOpsTaskComment,
  createOpsTask,
  deleteOpsTask,
  emptyOpsTaskWorkspaceData,
  getCachedOpsTaskWorkspaceData,
  getPersistedOpsTaskWorkspaceData,
  loadOpsRegistrationCaseDetail,
  loadOpsTaskById,
  loadOpsRegistrationClassDetail,
  loadOpsTaskWorkspaceData,
  loadOpsTaskWorkspaceOptionData,
  summarizeOpsTasks,
  updateOpsTask,
  updateOpsTaskStatus,
  type OpsTaskAttachment,
  type OpsTaskEvent,
  type OpsClassOption,
  type OpsRegistrationClassDetail,
  type OpsLinkedOption,
  type OpsTaskComment,
  type OpsProfileOption,
  type OpsStudentOption,
  type OpsTeacherOption,
  type OpsTextbookOption,
  type OpsTaskPriority,
  type OpsTask,
  type OpsTaskInput,
  type OpsTaskStatus,
  type OpsTaskType,
  type OpsTaskWorkspaceData,
  type OpsTaskWorkspaceOptionData,
} from "./ops-task-service"
import {
  canEditRegistrationTask,
  canSendRegistrationAdmissionMessage,
  getRegistrationBlockerFocusKey,
  getRegistrationBranchActions,
  getRegistrationChecklistAvailability,
  getRegistrationCreateBlockers,
  getRegistrationCreateDefaults,
  getRegistrationCreateErrorMessage,
  getRegistrationGradeOptions,
  getSelectableRegistrationScheduleSessions,
  getRegistrationMobileSections,
  getManualAdmissionCompletionStatus,
  getRegistrationPersistenceErrorMessage,
  getRegistrationPipelinePrefix,
  getRegistrationPrefillPipelineStatus,
  getRegistrationReopenStatus,
  getRegistrationTaskStatusForPipeline,
  getRegistrationTransitionBlockers,
  getRegistrationWorkflowStages,
  isValidRegistrationMobilePhone,
  isRegistrationCompletionImmutable,
  normalizeRegistrationPhone,
  normalizeRegistrationCampus,
  parseRegistrationSubjects,
  prepareRegistrationLevelTestRetry,
  prepareRegistrationPipelineTransition,
  resolveRegistrationLinkedTextbookDefault,
  serializeRegistrationSubjects,
  shouldShowRegistrationCompletionBlockers,
} from "./registration-workflow"
import {
  resolveRegistrationDirectorDefault,
} from "./registration-director-default.js"
import {
  RegistrationTrackList,
  buildRegistrationTrackListItems,
  filterRegistrationTrackListItems,
  type RegistrationTrackListAction,
} from "./registration-track-list"
import { RegistrationTrackEditor } from "./registration-track-editor"
import { RegistrationAdmissionPanel } from "./registration-enrollment-editor"
import {
  createRegistrationCase,
  createRegistrationCaseWithInitialWorkflow,
  createRegistrationMutationRequestKey,
  probeRegistrationIntakeWorkflowRuntime,
  probeRegistrationSubjectTrackRuntime,
  updateRegistrationCaseCommon,
  type OpsRegistrationCaseDetail,
  type RegistrationSubject,
} from "./registration-track-service"
import { RegistrationInitialPlanControl } from "./registration-initial-plan-control"
import {
  assertRegistrationCreateAttemptPersistenceMode,
  createRegistrationCreateAttempt,
  createRegistrationInitialWorkflowDraft,
  getRegistrationInitialWorkflowBlockers,
  markRegistrationLegacyCreateStarted,
  normalizeRegistrationInitialWorkflow,
  probeRegistrationInitialPersistence,
  reconcileRegistrationInitialWorkflowDraft,
  type RegistrationCreateAttempt,
  type RegistrationInitialPersistenceProbeResult,
  type RegistrationInitialWorkflowDraft,
} from "./registration-intake-workflow"
import {
  dispatchRegistrationVisitNotificationTargets,
  mergeRegistrationVisitNotificationTargets,
  reconcileRegistrationVisitNotificationRetryTargets,
  sendRegistrationVisitNotificationTarget,
} from "./registration-consultation-notification.js"
import {
  getRegistrationActionPermissions,
  getRegistrationTrackTabCounts,
} from "./registration-track-model.js"
import {
  executeRegistrationSubjectTrackFixtureAction,
  installRegistrationSubjectTrackFixtureRuntime,
  shouldEnableRegistrationSubjectTrackFixture,
} from "./registration-track-fixture-runtime"
import type { RegistrationSubjectTrackFixtureState } from "./registration-track-fixtures"

type RegistrationSubjectTrackFixtureModule = typeof import("./registration-track-fixtures")

type RegistrationVisitNotificationTarget = { appointmentId: string; notificationRevision: number }

type WorkspaceKey = "todo" | "registration" | "transfer" | "withdrawal" | "word_retest"
const WORKSPACE_NOTIFICATION_WORKFLOW_KEY = {
  todo: "tasks",
  word_retest: "word_retests",
  registration: "registration",
  transfer: "transfer",
  withdrawal: "withdrawal",
} as const satisfies Record<WorkspaceKey, NotificationWorkflowKey>
type ViewKey = "all" | "status" | "assignee" | "calendar"
type TodoViewKey = "inbox" | "sent" | "completed"
type TodoSortKey = "status" | "priority" | "due"
type TodoDueFilterKey = "all" | "overdue" | "today" | "upcoming" | "unscheduled"
type TodoSelectFilterKey = "all" | string
type WithdrawalViewKey = "applicant" | "operations" | "closed"
type RegistrationViewKey = "inquiry" | "level_test" | "consulting" | "waiting" | "enrollment" | "closed"
type WithdrawalPeriodFilter = "all" | "today" | "week" | "month" | "custom"
type GoogleChatChannel = "executive" | "admin" | "math" | "english"
type WithdrawalNotificationChannelKey = "applicant" | "operations" | "google_chat_admin"
type WithdrawalNotificationTriggerKey = "submitted" | "processing" | "completed"
type WithdrawalNotificationSetting = {
  triggerKey: WithdrawalNotificationTriggerKey
  channelKey: WithdrawalNotificationChannelKey
  enabled: boolean
}
type WithdrawalNotificationTemplate = {
  titleTemplate: string
  bodyTemplate: string
}
type WithdrawalGoogleChatWebhookInfo = {
  channelKey: WithdrawalNotificationChannelKey
  channelLabel: string
  envName: string
  configured: boolean
  maskedUrl: string
}
type WithdrawalGoogleChatWebhookInfoResponse = {
  ok?: boolean
  envName?: string
  configured?: boolean
  maskedUrl?: string
  error?: string
}
type RegistrationCustomerMessageHistory = {
  id: string
  status: "pending" | "accepted" | "failed" | "unknown"
  recipient_last4?: string
  provider_status_code?: string
  provider_status_message?: string
  created_at?: string
}
type RegistrationCustomerMessageStatus = {
  configured: boolean
  missing: string[]
  studentName: string
  recipientLast4: string
  admissionNoticeSent: boolean
  pipelineStatus: string
  history: RegistrationCustomerMessageHistory[]
}

type WordRetestMode = "assistant" | "teacher"
type WordRetestBranchFilter = "all" | "본관" | "별관"
type WordRetestPeriodFilter = "all" | "today" | "week" | "month" | "custom"
type WordRetestSelectFilterKey = "all" | string
type WordRetestScoreDraft = {
  firstScore: string
  secondScore: string
  thirdScore: string
}
type WordRetestClassScheduleItem = {
  dateKey: string
  label: string
  state: string
}
type WithdrawalClassScheduleItem = WordRetestClassScheduleItem & {
  sessionNumber: number
  lessonHours: number
  stateLabel: string
  billingLabel: string
  billingColor: string
}
type TransferTuitionSettlementType = "not_ready" | "balanced" | "refund_or_carry" | "additional_payment" | "month_mismatch"
type TransferTuitionAdjustment = {
  settlementType: TransferTuitionSettlementType
  settlementLabel: string
  message: string
  detail: string
  fromSessionLabel: string
  fromProgressLabel: string
  fromTuitionLabel: string
  toSessionLabel: string
  toProgressLabel: string
  toTuitionLabel: string
  amountLabel: string
}
type WithdrawalTableColumnKey =
  | "status"
  | "subject"
  | "teacher"
  | "className"
  | "student"
  | "withdrawalDate"
  | "withdrawalSession"
  | "completedLessonHours"
  | "fourWeekLessonHours"
  | "progress"
  | "customerReason"
  | "teacherOpinion"
  | "undistributedTextbooks"
  | "operationsChecklist"
  | "action"
type WithdrawalTableSort = {
  columnKey: WithdrawalTableColumnKey
  direction: "asc" | "desc"
} | null
type TransferTableColumnKey =
  | "status"
  | "subject"
  | "fromTeacher"
  | "fromClassName"
  | "student"
  | "transferReason"
  | "fromUndistributedTextbooks"
  | "fromClassEndDate"
  | "fromClassEndSession"
  | "toTeacher"
  | "toClassName"
  | "toClassStartDate"
  | "toClassStartSession"
  | "toUndistributedTextbooks"
  | "operationsChecklist"
  | "action"
type TransferTableSort = {
  columnKey: TransferTableColumnKey
  direction: "asc" | "desc"
} | null
type WordRetestTableColumnKey = "select" | "status" | "testAt" | "teacher" | "class" | "student" | "textbook" | "unit" | "total" | "cutoff" | "score" | "result" | "action"
type TaskFocus = "none" | "today" | "overdue" | "mine" | "unassigned" | "confirmation"
type FormCompletionIntent = {
  kind?: "word_retest_retry"
  retryReason?: "failed"
  status?: OpsTaskStatus
  registrationPipelineStatus?: string
  wordRetestStatus?: string
}
type StatusUndoState = {
  taskId: string
  title: string
  previousStatus: OpsTaskStatus
  nextStatus: OpsTaskStatus
}
type TaskScheduleItem = {
  label: string
  value: string
  date: string
}
type QuickAddPreviewItem = { key: string; label: string }
type WordRetestPrimaryAction =
  | { kind: "status"; status: OpsTaskStatus; label: string }
  | { kind: "word_retest_complete"; label: string }
  | { kind: "word_retest_retry"; label: string }
  | { kind: "edit"; label: string; blockers?: string[] }
type OpsTaskOptionIndexes = {
  studentsById: Map<string, OpsStudentOption>
  classesById: Map<string, OpsClassOption>
  textbooksById: Map<string, OpsTextbookOption>
  teachersById: Map<string, OpsTeacherOption>
}
type OperationCompletionBlockerMap = Map<string, string[]>
type OperationConfirmationMap = Map<string, boolean>
type RegistrationChecklistField = "admissionNoticeSent" | "makeeduRegistered" | "makeeduInvoiceSent" | "paymentChecked"
type WithdrawalChecklistField = "makeeduWithdrawalDone" | "feeProcessed" | "textbookFeeProcessed"
type TransferChecklistField = "makeeduTransferDone" | "feeProcessed" | "textbookFeeProcessed"
type FormDetailStepKey =
  | "registration_contact"
  | "registration_test"
  | "registration_start"
  | "registration_checks"
  | "withdrawal_basic"
  | "withdrawal_reason"
  | "withdrawal_checks"
  | "transfer_basic"
  | "transfer_schedule"
  | "transfer_checks"
  | "word_retest_basic"
  | "word_retest_scope"
  | "word_retest_scores"
type RegistrationFormSectionKey = "inquiry" | "level_test" | "consultation" | "placement" | "admission"

const EMPTY_TASKS: OpsTask[] = []
const EMPTY_PROFILE_OPTIONS: OpsProfileOption[] = []
const EMPTY_STUDENT_OPTIONS: OpsStudentOption[] = []
const EMPTY_CLASS_OPTIONS: OpsClassOption[] = []
const EMPTY_TEACHER_OPTIONS: OpsTeacherOption[] = []
const EMPTY_TEXTBOOK_OPTIONS: OpsTextbookOption[] = []
const EMPTY_OPS_TASK_OPTION_INDEXES: OpsTaskOptionIndexes = {
  studentsById: new Map(),
  classesById: new Map(),
  textbooksById: new Map(),
  teachersById: new Map(),
}
const EMPTY_COMPLETION_BLOCKERS: string[] = []
const EMPTY_COMPLETION_BLOCKERS_BY_TASK_ID: OperationCompletionBlockerMap = new Map()
const WITHDRAWAL_PERIOD_FILTERS: Array<{ key: WithdrawalPeriodFilter; label: string }> = [
  { key: "all", label: "전체 기간" },
  { key: "today", label: "오늘" },
  { key: "week", label: "이번주" },
  { key: "month", label: "이번달" },
  { key: "custom", label: "직접입력" },
]
const WITHDRAWAL_TABLE_COLUMNS: Array<{
  columnKey: WithdrawalTableColumnKey
  label: string
  width: number
  minWidth: number
  align?: "left" | "right"
}> = [
  { columnKey: "status", label: "상태", width: 104, minWidth: 88 },
  { columnKey: "subject", label: "과목", width: 88, minWidth: 72 },
  { columnKey: "teacher", label: "선생님", width: 116, minWidth: 96 },
  { columnKey: "className", label: "수업", width: 170, minWidth: 130 },
  { columnKey: "student", label: "학생", width: 118, minWidth: 96 },
  { columnKey: "customerReason", label: "고객 퇴원사유", width: 210, minWidth: 150 },
  { columnKey: "teacherOpinion", label: "선생님 의견", width: 190, minWidth: 140 },
  { columnKey: "undistributedTextbooks", label: "미배부 교재", width: 170, minWidth: 130 },
  { columnKey: "withdrawalDate", label: "퇴원일", width: 118, minWidth: 104 },
  { columnKey: "withdrawalSession", label: "퇴원회차", width: 110, minWidth: 96 },
  { columnKey: "completedLessonHours", label: "진행 수업시수", width: 120, minWidth: 104, align: "right" },
  { columnKey: "fourWeekLessonHours", label: "4주 기준 수업시수", width: 138, minWidth: 120, align: "right" },
  { columnKey: "progress", label: "수업진행률", width: 108, minWidth: 96, align: "right" },
  { columnKey: "operationsChecklist", label: "처리 확인", width: 218, minWidth: 180 },
  { columnKey: "action", label: "액션", width: 246, minWidth: 210, align: "right" },
]
const WITHDRAWAL_TABLE_COLUMN_WIDTHS = WITHDRAWAL_TABLE_COLUMNS.reduce((widths, column) => {
  widths[column.columnKey] = column.width
  return widths
}, {} as Record<WithdrawalTableColumnKey, number>)
const WITHDRAWAL_TABLE_COLUMN_MIN_WIDTHS = WITHDRAWAL_TABLE_COLUMNS.reduce((widths, column) => {
  widths[column.columnKey] = column.minWidth
  return widths
}, {} as Record<WithdrawalTableColumnKey, number>)
const TRANSFER_TABLE_COLUMNS: Array<{
  columnKey: TransferTableColumnKey
  label: string
  width: number
  minWidth: number
  align?: "left" | "right"
}> = [
  { columnKey: "status", label: "상태", width: 104, minWidth: 88 },
  { columnKey: "subject", label: "과목", width: 88, minWidth: 72 },
  { columnKey: "fromTeacher", label: "전 선생님", width: 116, minWidth: 96 },
  { columnKey: "fromClassName", label: "전 수업", width: 170, minWidth: 130 },
  { columnKey: "student", label: "학생", width: 118, minWidth: 96 },
  { columnKey: "transferReason", label: "전반사유", width: 190, minWidth: 140 },
  { columnKey: "fromUndistributedTextbooks", label: "전 미배부 교재", width: 160, minWidth: 128 },
  { columnKey: "fromClassEndDate", label: "전 수업 종료일", width: 122, minWidth: 108 },
  { columnKey: "fromClassEndSession", label: "전 종료회차", width: 112, minWidth: 96 },
  { columnKey: "toTeacher", label: "후 선생님", width: 116, minWidth: 96 },
  { columnKey: "toClassName", label: "후 수업", width: 170, minWidth: 130 },
  { columnKey: "toClassStartDate", label: "후 수업 시작일", width: 122, minWidth: 108 },
  { columnKey: "toClassStartSession", label: "후 시작회차", width: 112, minWidth: 96 },
  { columnKey: "toUndistributedTextbooks", label: "후 미배부 교재", width: 160, minWidth: 128 },
  { columnKey: "operationsChecklist", label: "처리 확인", width: 218, minWidth: 180 },
  { columnKey: "action", label: "액션", width: 188, minWidth: 160, align: "right" },
]
const TRANSFER_TABLE_COLUMN_WIDTHS = TRANSFER_TABLE_COLUMNS.reduce((widths, column) => {
  widths[column.columnKey] = column.width
  return widths
}, {} as Record<TransferTableColumnKey, number>)
const TRANSFER_TABLE_COLUMN_MIN_WIDTHS = TRANSFER_TABLE_COLUMNS.reduce((widths, column) => {
  widths[column.columnKey] = column.minWidth
  return widths
}, {} as Record<TransferTableColumnKey, number>)
const WORD_RETEST_TABLE_COLUMN_WIDTHS: Record<WordRetestTableColumnKey, number> = {
  select: 40,
  status: 102,
  testAt: 132,
  teacher: 112,
  class: 128,
  student: 108,
  textbook: 220,
  unit: 108,
  total: 96,
  cutoff: 86,
  score: 248,
  result: 132,
  action: 108,
}
const WORD_RETEST_TABLE_COLUMN_MIN_WIDTHS: Record<WordRetestTableColumnKey, number> = {
  select: 40,
  status: 88,
  testAt: 112,
  teacher: 96,
  class: 108,
  student: 88,
  textbook: 150,
  unit: 88,
  total: 88,
  cutoff: 78,
  score: 210,
  result: 116,
  action: 92,
}
function useStableEvent<T extends (...args: never[]) => unknown>(handler: T): T {
  const handlerRef = useRef(handler)

  useEffect(() => {
    handlerRef.current = handler
  }, [handler])

  const stableHandler = useCallback((...args: Parameters<T>) => handlerRef.current(...args), [])

  return stableHandler as T
}
const LINKED_SELECT_SEARCH_THRESHOLD = 12
const LINKED_SELECT_QUERY_OPTION_LIMIT = 50
const LINKED_SELECT_MANUAL_VALUE = "__manual__"
const HORIZONTAL_CHIP_BAR_CLASS = "flex gap-1.5 overflow-x-auto rounded-md border bg-background p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
const HORIZONTAL_MUTED_CHIP_BAR_CLASS = "flex gap-1.5 overflow-x-auto rounded-md bg-muted/45 p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
const HORIZONTAL_TAB_BAR_CLASS = "flex min-w-0 flex-wrap gap-1 overflow-visible sm:flex-nowrap sm:overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
const TOUCH_SCROLL_AREA_STYLE = {
  WebkitOverflowScrolling: "touch",
  overscrollBehavior: "contain",
  touchAction: "pan-y",
} as CSSProperties
const TODO_TEAM_FILTER_UNASSIGNED = "__unassigned__"
const TODO_TEAM_OPTIONS = ["영어팀", "수학팀", "관리팀", "조교팀"] as const
const TODO_FORM_PRIORITY_ORDER: OpsTaskPriority[] = ["urgent", "high", "normal", "low"]
const TODO_FORM_PRIORITY_OPTIONS = TODO_FORM_PRIORITY_ORDER
  .map((value) => OPS_TASK_PRIORITIES.find((priority) => priority.value === value))
  .filter((priority): priority is (typeof OPS_TASK_PRIORITIES)[number] => Boolean(priority))

function stopTouchScrollPropagation(event: TouchEvent<HTMLElement>) {
  event.stopPropagation()
}

const TODO_QUICK_ADD_PRIORITY_ALIASES: Partial<Record<string, OpsTaskPriority>> = {
  p1: "urgent",
  "!!": "urgent",
  "!1": "urgent",
  긴급: "urgent",
  급함: "urgent",
  최우선: "urgent",
  p2: "high",
  "!2": "high",
  높음: "high",
  중요: "high",
  p3: "normal",
  "!3": "normal",
  보통: "normal",
  p4: "low",
  "!4": "low",
  낮음: "low",
}
const TODO_TEAM_ALIASES: Record<string, (typeof TODO_TEAM_OPTIONS)[number]> = {
  english: "영어팀",
  영어: "영어팀",
  영어팀: "영어팀",
  math: "수학팀",
  mathematics: "수학팀",
  수학: "수학팀",
  수학팀: "수학팀",
  admin: "관리팀",
  operation: "관리팀",
  operations: "관리팀",
  관리: "관리팀",
  관리팀: "관리팀",
  assistant: "조교팀",
  assistants: "조교팀",
  조교: "조교팀",
  조교팀: "조교팀",
}

const TODO_VIEW_TABS: Array<{ key: TodoViewKey; label: string }> = [
  { key: "inbox", label: "받은함" },
  { key: "sent", label: "보낸함" },
  { key: "completed", label: "완료" },
]

const WORD_RETEST_ROLE_TABS: Array<{ key: WordRetestMode; label: string }> = [
  { key: "assistant", label: "조교선생님" },
  { key: "teacher", label: "담당선생님" },
]

const WORD_RETEST_BRANCH_FILTERS: Array<{ key: WordRetestBranchFilter; label: string }> = [
  { key: "all", label: "전체" },
  { key: "본관", label: "본관" },
  { key: "별관", label: "별관" },
]

const WORD_RETEST_PERIOD_FILTERS: Array<{ key: WordRetestPeriodFilter; label: string }> = [
  { key: "all", label: "전체 기간" },
  { key: "today", label: "오늘" },
  { key: "week", label: "이번주" },
  { key: "month", label: "이번달" },
  { key: "custom", label: "직접입력" },
]

const TODO_TABLE_SORT_COLUMNS: Array<{ key: TodoSortKey; label: string }> = [
  { key: "status", label: "상태" },
  { key: "priority", label: "우선순위" },
  { key: "due", label: "시작/마감" },
]

const TODO_DUE_FILTER_KEYS = new Set<TodoDueFilterKey>(["all", "overdue", "today", "upcoming", "unscheduled"])

const LEGACY_TODO_VIEW_ROUTES: Record<string, { list: TodoViewKey; sort?: TodoSortKey; due?: TodoDueFilterKey; status?: OpsTaskStatus }> = {
  all: { list: "inbox" },
  inbox: { list: "inbox" },
  today: { list: "inbox", sort: "due" },
  upcoming: { list: "inbox", sort: "due" },
  mine: { list: "inbox" },
  board: { list: "inbox", sort: "status" },
  calendar: { list: "inbox", sort: "due" },
  completed: { list: "completed" },
  sent: { list: "sent" },
  overdue: { list: "inbox", due: "overdue" },
  priority: { list: "inbox" },
  unassigned: { list: "inbox" },
  confirmation: { list: "inbox", status: "review_requested" },
}

const OPERATION_VIEW_TABS: Array<{ key: ViewKey; label: string }> = [
  { key: "all", label: "전체" },
  { key: "status", label: "상태별" },
  { key: "assignee", label: "담당자별" },
  { key: "calendar", label: "일정" },
]

const WITHDRAWAL_VIEW_TABS: Array<{ key: WithdrawalViewKey; label: string }> = [
  { key: "applicant", label: "신청" },
  { key: "operations", label: "처리 중" },
  { key: "closed", label: "완료" },
]

const REGISTRATION_VIEW_TABS: Array<{ key: RegistrationViewKey; label: string }> = [
  { key: "inquiry", label: "문의" },
  { key: "level_test", label: "레벨테스트" },
  { key: "consulting", label: "상담" },
  { key: "waiting", label: "대기" },
  { key: "enrollment", label: "등록" },
  { key: "closed", label: "완료" },
]

const REGISTRATION_GRADE_OPTIONS = getRegistrationGradeOptions()

const REGISTRATION_SUBJECT_OPTIONS = [
  { value: "", label: "미지정" },
  { value: "영어", label: "영어" },
  { value: "수학", label: "수학" },
] as const

const WITHDRAWAL_NOTIFICATION_CHANNELS: Array<{ key: WithdrawalNotificationChannelKey; label: string }> = [
  { key: "applicant", label: "담당선생님" },
  { key: "operations", label: "관리팀" },
  { key: "google_chat_admin", label: "구글챗 · 관리팀" },
]

const WITHDRAWAL_GOOGLE_CHAT_CHANNEL_MAP: Partial<Record<WithdrawalNotificationChannelKey, GoogleChatChannel>> = {
  google_chat_admin: "admin",
}

const WITHDRAWAL_NOTIFICATION_TRIGGERS: Array<{ key: WithdrawalNotificationTriggerKey; label: string; detail: string }> = [
  { key: "submitted", label: "신청 접수", detail: "담당선생님이 퇴원을 신청하면 관리팀에 알림" },
  { key: "processing", label: "처리 시작", detail: "관리팀이 확인하거나 처리 중으로 이동하면 담당선생님에 알림" },
  { key: "completed", label: "처리 완료", detail: "관리팀이 완료 처리하면 담당선생님과 관리팀에 알림" },
]

const REGISTRATION_NOTIFICATION_TRIGGERS: Array<{ key: WithdrawalNotificationTriggerKey; label: string; detail: string }> = [
  { key: "submitted", label: "문의 접수", detail: "등록 문의가 새로 들어오면 관리팀에 알림" },
  { key: "processing", label: "등록 진행", detail: "레벨테스트, 상담, 대기, 수납 단계로 이동하면 담당자에게 알림" },
  { key: "completed", label: "등록 종료", detail: "등록 완료, 미등록, 문의만으로 닫히면 담당자와 관리팀에 알림" },
]

const WITHDRAWAL_NOTIFICATION_TEMPLATE_VARIABLES = [
  ...WITHDRAWAL_TABLE_COLUMNS
    .map((column) => column.label)
    .filter((label) => label !== "액션"),
  "신청자",
  "신청일시",
  "담당선생님",
  "관리팀",
  "프로세스",
] as const

const WITHDRAWAL_NOTIFICATION_TEMPLATE_PREVIEW_CONTEXT: Record<string, string> = {
  상태: "처리 중",
  과목: "영어",
  선생님: "정보영",
  학생: "최소윤",
  수업: "제주여고2A",
  퇴원일: "2026-06-29",
  퇴원회차: "8회차",
  "진행 수업시수": "16",
  "4주 기준 수업시수": "16",
  수업진행률: "100%",
  "고객 퇴원사유": "타 학원 이동",
  "선생님 의견": "동일",
  "미배부 교재": "매3영",
  신청자: "정보영",
  신청일시: "2026-07-08 20:27",
  담당선생님: "정보영",
  관리팀: "관리팀",
  프로세스: "처리 완료",
}

const TRANSFER_NOTIFICATION_TEMPLATE_VARIABLES = [
  ...TRANSFER_TABLE_COLUMNS
    .map((column) => column.label)
    .filter((label) => label !== "액션"),
  "신청자",
  "신청일시",
  "담당선생님",
  "관리팀",
  "프로세스",
] as const

const REGISTRATION_NOTIFICATION_TEMPLATE_VARIABLES = [
  "진행상태",
  "과목",
  "학년",
  "학교",
  "학생",
  "학부모 전화",
  "문의일시",
  "레벨테스트",
  "전화상담",
  "방문상담",
  "수업",
  "수업시작일",
  "수업시작회차",
  "요청 사항",
  "등록 확인",
  "신청자",
  "신청일시",
  "상담 책임자",
  "관리팀",
  "프로세스",
] as const

const DEFAULT_WITHDRAWAL_NOTIFICATION_TEMPLATES: Record<WithdrawalNotificationTriggerKey, WithdrawalNotificationTemplate> = {
  submitted: {
    titleTemplate: "퇴원 신청 접수 · {학생}",
    bodyTemplate: "{담당선생님} 선생님이 {학생} 학생의 퇴원을 신청했습니다.\n수업: {수업}",
  },
  processing: {
    titleTemplate: "퇴원 처리 시작 · {학생}",
    bodyTemplate: "{학생} 학생 퇴원 신청이 관리팀 처리 중으로 이동했습니다.\n퇴원일: {퇴원일}",
  },
  completed: {
    titleTemplate: "퇴원 처리 완료 · {학생}",
    bodyTemplate: "{학생} 학생 퇴원 처리가 완료되었습니다.\n퇴원일: {퇴원일}\n퇴원회차: {퇴원회차}",
  },
}

const DEFAULT_TRANSFER_NOTIFICATION_TEMPLATES: Record<WithdrawalNotificationTriggerKey, WithdrawalNotificationTemplate> = {
  submitted: {
    titleTemplate: "전반 신청 접수 · {학생}",
    bodyTemplate: "{담당선생님} 선생님이 {학생} 학생의 전반을 신청했습니다.\n전 수업: {전 수업}\n후 수업: {후 수업}",
  },
  processing: {
    titleTemplate: "전반 처리 시작 · {학생}",
    bodyTemplate: "{학생} 학생 전반 신청이 관리팀 처리 중으로 이동했습니다.\n전 수업 종료일: {전 수업 종료일}",
  },
  completed: {
    titleTemplate: "전반 처리 완료 · {학생}",
    bodyTemplate: "{학생} 학생 전반 처리가 완료되었습니다.\n전 수업 종료일: {전 수업 종료일}\n후 수업 시작일: {후 수업 시작일}",
  },
}

const DEFAULT_REGISTRATION_NOTIFICATION_TEMPLATES: Record<WithdrawalNotificationTriggerKey, WithdrawalNotificationTemplate> = {
  submitted: {
    titleTemplate: "등록 문의 접수 · {학생}",
    bodyTemplate: "{학생} 학생 등록 문의가 접수되었습니다.\n학년: {학년}\n문의일시: {문의일시}",
  },
  processing: {
    titleTemplate: "등록 진행 · {학생}",
    bodyTemplate: "{학생} 학생 등록 단계가 {진행상태}(으)로 이동했습니다.\n상담 책임자: {상담 책임자}",
  },
  completed: {
    titleTemplate: "등록 종료 · {학생}",
    bodyTemplate: "{학생} 학생 등록 프로세스가 {진행상태}(으)로 닫혔습니다.\n수업: {수업}\n등록 확인: {등록 확인}",
  },
}

const REGISTRATION_ADMISSION_FORM_URL = "https://bit.ly/3rurm5t"
const REGISTRATION_MAKEEDU_APP_URL = "http://www.makeedu.co.kr/app.html"

function getRegistrationAdmissionSolapiMessage(studentName: string) {
  const studentLabel = studentName
    ? studentName.endsWith("학생") ? studentName : `${studentName} 학생`
    : "학생"
  return `[팁스영어수학학원] 입학신청서 작성 안내

안녕하세요. ${studentLabel}의 입학 절차를 안내드립니다.

최종 원생 등록 및 교육비 납부 안내를 위해 입학신청서를 제출해 주세요.

입학신청서에는 원내 수강 규정, 원생의 건강·정서 상태 고지 의무, CCTV 활용 등 학원 생활에 필요한 중요 약관이 포함되어 있습니다. 내용을 확인하신 후 서명을 완료해 주세요.

아래 버튼에서 입학신청서를 작성할 수 있습니다.`
}

function getRegistrationMakeEduAdmissionMessage(studentName: string) {
  const greeting = studentName ? `${studentName} 학생의 입학을` : "입학을"
  return `[팁스영어수학학원] 입학 환영 및 신청서 작성 안내

안녕하세요! 팁스영어수학학원 ${greeting} 진심으로 환영합니다. ^^

안전하고 철저한 학사 관리를 위해 [입학신청서]를 먼저 제출해 주셔야 최종 원생 등록 및 교육비 납부 안내가 진행됩니다.

하단 링크의 입학신청서에는 '원내 수강 규정', '원생의 건강/정서 상태 고지 의무', 'CCTV 활용' 등 학원 생활에 필요한 중요 약관이 포함되어 있습니다. 내용을 꼼꼼히 확인하신 후 서명을 완료해 주시기 바랍니다.

▶ 1단계: 모바일 입학신청서 작성하기 (${REGISTRATION_ADMISSION_FORM_URL})
▶ 2단계: 메이크에듀 앱 설치 (출결 확인용) (${REGISTRATION_MAKEEDU_APP_URL})

🔗 팁스학원 공식 홈페이지: https://tipsedu.co.kr/

목표 달성까지 팁스가 가장 확실한 페이스메이커가 되겠습니다. 감사합니다.`
}

function buildDefaultWithdrawalNotificationSettings(): WithdrawalNotificationSetting[] {
  return WITHDRAWAL_NOTIFICATION_TRIGGERS.flatMap((trigger) => (
    WITHDRAWAL_NOTIFICATION_CHANNELS.map((channel) => ({
      triggerKey: trigger.key,
      channelKey: channel.key,
      enabled: (
        (trigger.key === "submitted" && channel.key === "operations") ||
        (trigger.key === "submitted" && channel.key === "google_chat_admin") ||
        (trigger.key === "processing" && channel.key === "applicant") ||
        trigger.key === "completed"
      ),
    }))
  ))
}

const WORKSPACE_TASK_TYPE: Record<WorkspaceKey, OpsTaskType> = {
  todo: "general",
  registration: "registration",
  transfer: "transfer",
  withdrawal: "withdrawal",
  word_retest: "word_retest",
}

const WORKSPACE_LABELS: Record<WorkspaceKey, string> = {
  todo: "할 일",
  registration: "등록",
  transfer: "전반",
  withdrawal: "퇴원",
  word_retest: "영어 단어 재시험",
}

const WORKSPACE_SEARCH_PLACEHOLDERS: Record<WorkspaceKey, string> = {
  todo: "할 일 검색",
  registration: "등록 검색",
  transfer: "전반 검색",
  withdrawal: "퇴원 검색",
  word_retest: "단어 재시험 검색",
}

function getWorkspaceCreateActionLabel(workspace: WorkspaceKey, workspaceLabel: string) {
  if (workspace === "withdrawal") return "퇴원 신청"
  if (workspace === "transfer") return "전반 신청"
  if (workspace === "word_retest") return "추가"
  if (workspace === "todo") return "할 일 추가"
  return `${workspaceLabel} 추가`
}

const REGISTRATION_PIPELINE_NEXT_PREFIXES: Record<string, string> = {
  "1.": "1-1.",
  "1-1.": "2.",
  "2.": "3.",
  "5-1.": "6.",
  "6.": "7.",
}

const REGISTRATION_PIPELINE_NEXT_LABELS: Record<string, string> = {
  "1.": "진행 후 결과 입력",
  "1-1.": "상담 예약",
  "2.": "진행 후 상담 결과 입력",
  "5-1.": "수납·운영 확인",
  "6.": "등록 완료",
}

const TASK_FOCUS_LABELS: Record<Exclude<TaskFocus, "none">, string> = {
  today: "오늘 예정",
  overdue: "지연",
  mine: "내 담당",
  unassigned: "미정리",
  confirmation: "확인 필요",
}

const VALID_TASK_FOCUSES = new Set<TaskFocus>(["none", "today", "overdue", "mine", "unassigned", "confirmation"])
const WORD_RETEST_DIAGRAM_MAIN_NODES = [
  { key: "start", label: "시작 전", detail: "본시험일 기준" },
  { key: "exam_start", label: "시험 시작", detail: "조교선생님" },
  { key: "in_progress", label: "시험 진행", detail: "점수 입력 및 저장" },
  { key: "decision", label: "결과 판정", detail: "자동" },
] as const
const WORD_RETEST_DIAGRAM_ABSENT_NODES = [
  { key: "absent_deadline", label: "본시험일 + 7일", detail: "자동" },
  { key: "absent", label: "미응시 보고", detail: "자동" },
  { key: "absent_confirm", label: "미응시 확인", detail: "담당선생님" },
] as const
const WORD_RETEST_DIAGRAM_RESULT_BRANCHES = [
  {
    key: "failed",
    label: "불합격",
    tone: "warning",
    result: { key: "failed_result", label: "결과: 불합격", detail: "커트라인 미만" },
    nodes: [
      { key: "failed_report", label: "불합격 보고", detail: "조교선생님" },
      { key: "failed_confirm", label: "불합격 확인", detail: "담당선생님" },
      { key: "retry_create", label: "재시험 추가", detail: "담당선생님", returnToStart: true },
    ],
  },
  {
    key: "passed",
    label: "합격",
    tone: "primary",
    result: { key: "passed_result", label: "결과: 합격", detail: "커트라인 이상" },
    nodes: [
      { key: "passed_report", label: "합격 보고", detail: "조교선생님" },
      { key: "passed_confirm", label: "합격 확인", detail: "담당선생님" },
    ],
  },
] as const

function RegistrationFocusTarget({ focusKey, children }: { focusKey: string; children: ReactNode }) {
  return <div className="min-w-0" data-registration-focus={focusKey}>{children}</div>
}

function RegistrationFieldLabel({
  label,
  requirement,
}: {
  label: string
  requirement: "required" | "optional"
}) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span>{label}</span>
      <span
        aria-hidden="true"
        className={[
          "rounded px-1.5 py-0.5 text-[10px] font-semibold leading-none",
          requirement === "required"
            ? "bg-primary/10 text-primary"
            : "bg-muted text-muted-foreground",
        ].join(" ")}
      >
        {requirement === "required" ? "필수" : "선택"}
      </span>
    </span>
  )
}

function RegistrationSubjectField({
  label,
  values,
  onChange,
  required = false,
}: {
  label: ReactNode
  values: string[]
  onChange: (values: string[]) => void
  required?: boolean
}) {
  const fieldId = useId()
  const requiredDescriptionId = useId()
  const valueSet = new Set(values)
  const options = REGISTRATION_SUBJECT_OPTIONS.filter((option) => option.value)

  return (
    <div className="grid min-w-0 gap-1.5 text-sm font-medium">
      <span id={fieldId}>{label}</span>
      {required && (
        <span id={requiredDescriptionId} className="sr-only">
          하나 이상 선택해야 하는 필수 항목입니다.
        </span>
      )}
      <div
        className="grid grid-cols-2 gap-1.5"
        role="group"
        aria-labelledby={fieldId}
        aria-describedby={required ? requiredDescriptionId : undefined}
      >
        {options.map((option) => {
          const selected = valueSet.has(option.value)
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(selected
                ? values.filter((value) => value !== option.value)
                : [...values, option.value])}
              className={[
                "inline-flex h-9 items-center justify-center gap-1.5 rounded-md border px-3 text-sm font-medium shadow-xs outline-none transition focus-visible:ring-2 focus-visible:ring-ring/40",
                selected
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "bg-background text-muted-foreground hover:border-foreground/30 hover:text-foreground",
              ].join(" ")}
            >
              {selected && <Check className="size-3.5" aria-hidden="true" />}
              {option.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function RegistrationFormSection({
  sectionKey,
  title,
  active,
  enabled,
  children,
}: {
  sectionKey: RegistrationFormSectionKey
  title: string
  active: boolean
  enabled: boolean
  children: ReactNode
}) {
  const headingId = useId()

  return (
    <section
      id={`registration-form-${sectionKey}`}
      aria-labelledby={headingId}
      data-registration-current={active ? "true" : "false"}
      className={[
        "grid min-w-0 gap-3 border-t py-4 first:border-t-0 first:pt-0",
        active ? "-mx-3 border-l-2 border-l-primary bg-primary/5 px-3" : "",
      ].join(" ")}
    >
      <div className="flex min-w-0 items-center gap-2">
        <h3
          id={headingId}
          className={[
            "min-w-0 text-sm font-semibold transition-colors",
            active ? "text-primary" : !enabled ? "text-muted-foreground" : "",
          ].join(" ")}
        >
          {title}
        </h3>
      </div>
      <fieldset disabled={!enabled} className={[
        "grid min-w-0 gap-3",
        active ? "[&_button[aria-haspopup]]:border-primary/45 [&_input]:border-primary/45 [&_select]:border-primary/45" : "",
        !enabled ? "cursor-not-allowed opacity-45" : "",
      ].join(" ")}>
        <legend className="sr-only">{title}</legend>
        {children}
      </fieldset>
    </section>
  )
}

function getFormDetailTabs(type: OpsTaskType): Array<{ key: FormDetailStepKey; label: string }> {
  if (type === "registration") {
    return [
      { key: "registration_contact", label: "문의" },
      { key: "registration_test", label: "평가/상담" },
      { key: "registration_start", label: "등록 결정" },
      { key: "registration_checks", label: "입학 처리" },
    ]
  }

  if (type === "withdrawal") {
    return [
      { key: "withdrawal_basic", label: "신청" },
      { key: "withdrawal_reason", label: "처리" },
      { key: "withdrawal_checks", label: "완료" },
    ]
  }

  if (type === "transfer") {
    return [
      { key: "transfer_basic", label: "전반" },
      { key: "transfer_schedule", label: "일정" },
      { key: "transfer_checks", label: "체크" },
    ]
  }

  if (type === "word_retest") {
    return [
      { key: "word_retest_basic", label: "응시" },
      { key: "word_retest_scope", label: "범위" },
      { key: "word_retest_scores", label: "점수" },
    ]
  }

  return []
}

function getDefaultFormDetailStep(type: OpsTaskType): FormDetailStepKey {
  return getFormDetailTabs(type)[0]?.key || "registration_contact"
}

function isViewKey(value: string): value is ViewKey {
  return OPERATION_VIEW_TABS.some((tab) => tab.key === value)
}

function isWithdrawalViewKey(value: string): value is WithdrawalViewKey {
  return WITHDRAWAL_VIEW_TABS.some((tab) => tab.key === value)
}

function isTodoViewKey(value: string): value is TodoViewKey {
  return TODO_VIEW_TABS.some((tab) => tab.key === value)
}

function isTodoSortKey(value: string): value is TodoSortKey {
  return TODO_TABLE_SORT_COLUMNS.some((column) => column.key === value)
}

function isTodoDueFilterKey(value: string): value is TodoDueFilterKey {
  return TODO_DUE_FILTER_KEYS.has(value as TodoDueFilterKey)
}

function isWordRetestModeKey(value: string): value is WordRetestMode {
  return WORD_RETEST_ROLE_TABS.some((tab) => tab.key === value)
}

function isWordRetestBranchFilterKey(value: string): value is WordRetestBranchFilter {
  return WORD_RETEST_BRANCH_FILTERS.some((filter) => filter.key === value)
}

function isWordRetestPeriodFilterKey(value: string): value is WordRetestPeriodFilter {
  return WORD_RETEST_PERIOD_FILTERS.some((filter) => filter.key === value)
}

function getTodoRouteState(searchParams: URLSearchParams): { list: TodoViewKey; sort?: TodoSortKey; due?: TodoDueFilterKey; status?: OpsTaskStatus } | null {
  const nextList = searchParams.get("list") || ""
  const nextFilter = searchParams.get("filter") || ""
  const nextSort = searchParams.get("sort") || ""
  const nextDue = searchParams.get("due") || ""
  const nextStatus = searchParams.get("status") || ""
  const routeStatus = OPS_TASK_STATUSES.some((status) => status.value === nextStatus) ? nextStatus as OpsTaskStatus : undefined
  if (isTodoViewKey(nextList)) {
    return {
      list: nextList,
      sort: isTodoSortKey(nextSort) ? nextSort : undefined,
      due: isTodoDueFilterKey(nextDue) ? nextDue : undefined,
      status: routeStatus,
    }
  }
  if (nextFilter === "overdue") return { list: "inbox", due: "overdue" }
  if (nextFilter === "priority") return { list: "inbox" }
  if (nextFilter === "unassigned") return { list: "inbox", due: "unscheduled" }
  if (nextFilter === "mine") return { list: "inbox" }
  if (nextFilter === "confirmation") return { list: "inbox", status: "review_requested" }
  if (LEGACY_TODO_VIEW_ROUTES[nextList]) return LEGACY_TODO_VIEW_ROUTES[nextList]

  const legacyView = searchParams.get("view") || ""
  return LEGACY_TODO_VIEW_ROUTES[legacyView] || null
}

function getTodoEmptyLabel(view: TodoViewKey, isFilteredEmpty: boolean) {
  if (isFilteredEmpty) return "조건에 맞는 할 일 없음"
  if (view === "inbox") return "받은함 비어 있음"
  if (view === "sent") return "보낸함 비어 있음"
  if (view === "completed") return "완료한 할 일 없음"
  return "할 일 없음"
}

function isTaskFocus(value: string): value is TaskFocus {
  return VALID_TASK_FOCUSES.has(value as TaskFocus)
}

function isEnglishOperationOption(value: string) {
  const normalized = value.replace(/\s+/g, "").toLowerCase()
  return normalized.includes("영어") || normalized.includes("english")
}

function normalizeTaskTeamValue(value?: string | string[]) {
  const values = Array.isArray(value)
    ? value
    : String(value || "").split(/[,\s/|]+/)

  for (const rawValue of values) {
    const normalized = String(rawValue || "").replace(/\s+/g, "").toLowerCase()
    if (!normalized) continue
    const aliasedTeam = TODO_TEAM_ALIASES[normalized]
    if (aliasedTeam) return aliasedTeam
    const matchingTeam = TODO_TEAM_OPTIONS.find((team) => team.replace(/\s+/g, "").toLowerCase() === normalized)
    if (matchingTeam) return matchingTeam
  }

  return ""
}

function buildTaskProfileTeamLookup(profiles: OpsProfileOption[], teachers: OpsTeacherOption[]) {
  const profilesByContact = new Map<string, OpsProfileOption>()
  profiles.forEach((profile) => {
    [profile.email, profile.loginId].forEach((value) => {
      const key = String(value || "").trim().toLowerCase()
      if (key) profilesByContact.set(key, profile)
    })
  })

  const profileTeamById = new Map<string, string>()
  teachers.forEach((teacher) => {
    const team = normalizeTaskTeamValue(teacher.subjects)
    if (!team) return
    const contactKey = String(teacher.accountEmail || "").trim().toLowerCase()
    const profileId = teacher.profileId || profilesByContact.get(contactKey)?.id || ""
    if (profileId) profileTeamById.set(profileId, team)
  })

  return profileTeamById
}

function getProfilesForTeam(
  profiles: OpsProfileOption[],
  team: string,
  profileTeamById: Map<string, string>,
  selectedProfileId = "",
) {
  const normalizedTeam = normalizeTaskTeamValue(team)
  if (!normalizedTeam) return profiles

  return profiles.filter((profile) => (
    profileTeamById.get(profile.id) === normalizedTeam || profile.id === selectedProfileId
  ))
}

function shouldClearProfileForTeam(profileId: string | undefined, team: string, profileTeamById: Map<string, string>) {
  const normalizedTeam = normalizeTaskTeamValue(team)
  if (!profileId || !normalizedTeam) return false
  return profileTeamById.get(profileId) !== normalizedTeam
}

function isWordRetestClassOption(classItem?: OpsClassOption) {
  if (!classItem) return false
  return isEnglishOperationOption([classItem.subject, classItem.meta, classItem.label].filter(Boolean).join(" "))
}

function getStudentRosterClassIds(student: OpsStudentOption | undefined, classes: OpsClassOption[]) {
  if (!student) return []
  const linkedIds = new Set(student.classIds)
  classes.forEach((classItem) => {
    if (classItem.studentIds.includes(student.id)) linkedIds.add(classItem.id)
  })
  return [...linkedIds]
}

function buildWithdrawalCreatePrefill(
  studentId: string,
  students: OpsStudentOption[],
  classes: OpsClassOption[],
): Partial<OpsTaskInput> {
  const student = students.find((item) => item.id === studentId)
  if (!student) return {}

  const classIds = getStudentRosterClassIds(student, classes)
  const classItem = classIds.length === 1
    ? classes.find((item) => item.id === classIds[0])
    : undefined

  return {
    title: `${student.label} 퇴원`,
    studentId: student.id,
    studentName: student.label,
    classId: classItem?.id || "",
    className: classItem?.label || "",
    subject: classItem?.subject || "",
    withdrawal: {
      schoolGrade: student.grade,
      teacherName: classItem?.teacher || "",
    },
  }
}

function uniqueClassOptions(classes: OpsClassOption[]) {
  const seenIds = new Set<string>()
  return classes.filter((classItem) => {
    if (seenIds.has(classItem.id)) return false
    seenIds.add(classItem.id)
    return true
  })
}

function uniqueStudentOptions(students: OpsStudentOption[]) {
  const seenIds = new Set<string>()
  return students.filter((student) => {
    if (seenIds.has(student.id)) return false
    seenIds.add(student.id)
    return true
  })
}

function getWordRetestStudentOptions(students: OpsStudentOption[], classItem?: OpsClassOption, selectedStudentId = "") {
  const selectedStudent = students.find((student) => student.id === selectedStudentId)
  if (!classItem) return uniqueStudentOptions([selectedStudent, ...students].filter(Boolean) as OpsStudentOption[])

  const classStudentIds = new Set([...classItem.studentIds, ...classItem.waitlistIds])
  const rosterStudents = students.filter((student) => (
    classStudentIds.has(student.id) ||
    student.classIds.includes(classItem.id) ||
    student.waitlistClassIds.includes(classItem.id)
  ))

  return uniqueStudentOptions([selectedStudent, ...(rosterStudents.length > 0 ? rosterStudents : students)].filter(Boolean) as OpsStudentOption[])
}

function getWordRetestClassOptions(classes: OpsClassOption[], student?: OpsStudentOption, selectedClassId = "", teacher?: OpsTeacherOption) {
  const englishClasses = classes.filter(isWordRetestClassOption)
  const baseClasses = englishClasses.length > 0 ? englishClasses : classes
  const teacherName = normalizeLookupValue(teacher?.label)
  const teacherClasses = teacherName ? baseClasses.filter((classItem) => normalizeLookupValue(classItem.teacher) === teacherName) : []
  const teacherScopedClasses = teacherClasses.length > 0 ? teacherClasses : baseClasses
  const studentClassIds = getStudentRosterClassIds(student, classes)
  const studentClasses = teacherScopedClasses.filter((classItem) => studentClassIds.includes(classItem.id))
  const selectedClass = classes.find((classItem) => classItem.id === selectedClassId)
  return uniqueClassOptions([selectedClass, ...(studentClasses.length > 0 ? studentClasses : teacherScopedClasses)].filter(Boolean) as OpsClassOption[])
}

function isWordRetestTeacherOption(teacher?: OpsTeacherOption) {
  if (!teacher) return false
  const meta = teacher.meta || teacher.label || ""
  return teacher.subjects.some((subject) => isEnglishOperationOption(subject)) || isEnglishOperationOption(meta)
}

function uniqueTeacherOptions(teachers: OpsTeacherOption[]) {
  const seenIds = new Set<string>()
  return teachers.filter((teacher) => {
    if (seenIds.has(teacher.id)) return false
    seenIds.add(teacher.id)
    return true
  })
}

function getWordRetestTeacherOptions(teachers: OpsTeacherOption[], selectedTeacherId = "") {
  const englishTeachers = teachers.filter(isWordRetestTeacherOption)
  const baseTeachers = englishTeachers.length > 0 ? englishTeachers : teachers
  const selectedTeacher = teachers.find((teacher) => teacher.id === selectedTeacherId)
  return uniqueTeacherOptions([selectedTeacher, ...baseTeachers].filter(Boolean) as OpsTeacherOption[])
}

function matchesWithdrawalSubject(value: string | undefined, selectedSubject: string) {
  const normalizedValue = normalizeLookupValue(value)
  const normalizedSubject = normalizeLookupValue(selectedSubject)
  if (!normalizedSubject) return true
  if (!normalizedValue) return false
  return normalizedValue === normalizedSubject ||
    normalizedValue.includes(normalizedSubject) ||
    normalizedSubject.includes(normalizedValue)
}

function getWithdrawalSubjectOptions(classes: OpsClassOption[], selectedSubject = ""): TaskListboxOption[] {
  const subjects = classes
    .map((classItem) => classItem.subject.trim())
    .filter(Boolean)
  const selected = selectedSubject.trim()
  return [
    { value: "", label: "과목 선택" },
    ...Array.from(new Set([selected, ...subjects].filter(Boolean))).map((subject) => ({
      value: subject,
      label: subject,
    })),
  ]
}

function getWithdrawalTeacherOptions(
  teachers: OpsTeacherOption[],
  classes: OpsClassOption[],
  selectedSubject = "",
  selectedTeacherName = "",
): LinkedSelectOption[] {
  const subjectClasses = classes.filter((classItem) => matchesWithdrawalSubject(classItem.subject, selectedSubject))
  const subjectClassTeacherNames = new Map<string, string>()
  subjectClasses.forEach((classItem) => {
    const teacherName = classItem.teacher.trim()
    const normalizedTeacherName = normalizeLookupValue(teacherName)
    if (teacherName && normalizedTeacherName) subjectClassTeacherNames.set(normalizedTeacherName, teacherName)
  })

  const selectedTeacher = selectedTeacherName.trim()
  const matchingTeachers = teachers.filter((teacher) => (
    matchesWithdrawalSubject(teacher.subjects.join(" "), selectedSubject) ||
    subjectClassTeacherNames.has(normalizeLookupValue(teacher.label)) ||
    normalizeLookupValue(teacher.label) === normalizeLookupValue(selectedTeacher)
  ))
  const realTeacherOptions = matchingTeachers.map((teacher) => ({
    id: teacher.id,
    label: teacher.label,
    meta: teacher.subjects.join(" · "),
    searchText: [teacher.accountEmail, teacher.meta].filter(Boolean).join(" "),
  }))
  const realTeacherNames = new Set(realTeacherOptions.map((teacher) => normalizeLookupValue(teacher.label)))
  const syntheticTeacherOptions = [...subjectClassTeacherNames.entries()]
    .filter(([normalizedTeacherName]) => !realTeacherNames.has(normalizedTeacherName))
    .map(([normalizedTeacherName, teacherName]) => ({
      id: `withdrawal-teacher:${normalizedTeacherName}`,
      label: teacherName,
      meta: selectedSubject,
    }))
  const selectedTeacherOption = selectedTeacher && ![...realTeacherNames, ...syntheticTeacherOptions.map((teacher) => normalizeLookupValue(teacher.label))].includes(normalizeLookupValue(selectedTeacher))
    ? [{ id: `withdrawal-teacher:${normalizeLookupValue(selectedTeacher)}`, label: selectedTeacher, meta: selectedSubject }]
    : []
  const seenLabels = new Set<string>()
  return [...selectedTeacherOption, ...realTeacherOptions, ...syntheticTeacherOptions].filter((teacher) => {
    const key = normalizeLookupValue(teacher.label)
    if (!key || seenLabels.has(key)) return false
    seenLabels.add(key)
    return true
  })
}

function getWithdrawalClassOptions(
  classes: OpsClassOption[],
  selectedSubject = "",
  selectedTeacherName = "",
  selectedClassId = "",
) {
  const normalizedTeacherName = normalizeLookupValue(selectedTeacherName)
  const selectedClass = classes.find((classItem) => classItem.id === selectedClassId)
  const filteredClasses = classes.filter((classItem) => (
    matchesWithdrawalSubject(classItem.subject, selectedSubject) &&
    (!normalizedTeacherName || normalizeLookupValue(classItem.teacher) === normalizedTeacherName)
  ))
  return uniqueClassOptions([selectedClass, ...filteredClasses].filter(Boolean) as OpsClassOption[])
}

function getWithdrawalStudentOptions(
  students: OpsStudentOption[],
  classes: OpsClassOption[],
  classOptions: OpsClassOption[],
  selectedClassId = "",
  selectedStudentId = "",
) {
  const selectedStudent = students.find((student) => student.id === selectedStudentId)
  const candidateClassIds = selectedClassId
    ? new Set([selectedClassId])
    : new Set(classOptions.map((classItem) => classItem.id))
  const filteredStudents = candidateClassIds.size > 0
    ? students.filter((student) => getStudentRosterClassIds(student, classes).some((classId) => candidateClassIds.has(classId)))
    : students
  return uniqueStudentOptions([selectedStudent, ...(filteredStudents.length > 0 ? filteredStudents : students)].filter(Boolean) as OpsStudentOption[])
}

function findCurrentUserTeacherOption(
  teachers: OpsTeacherOption[],
  userId: string,
  ...references: unknown[]
) {
  const safeUserId = String(userId || "").trim()
  const normalizedReferences = new Set(references.map(normalizeLookupValue).filter(Boolean))
  return teachers.find((teacher) => {
    if (safeUserId && teacher.profileId === safeUserId) return true
    return [
      teacher.accountEmail,
      teacher.label,
    ].some((value) => normalizedReferences.has(normalizeLookupValue(value)))
  })
}

function normalizeWordRetestTextbookSubjectLabel(subject: string) {
  const value = subject.trim()
  const normalized = value.toLowerCase()
  if (!value || normalized === "other") return "기타"
  if (normalized === "english") return "영어"
  if (normalized === "math") return "수학"
  return value
}

function isWordRetestTextbookOption(textbook: OpsTextbookOption) {
  return inferWordRetestTextbookSubject(textbook) === "어휘"
}

function inferWordRetestTextbookSubject(textbook: OpsTextbookOption) {
  const text = normalizeLookupValue([textbook.subject, textbook.label, textbook.publisher, textbook.meta].filter(Boolean).join(" "))
  if (/(단어|어휘|보카|voca|vocab|vocabulary)/i.test(text)) return "어휘"
  if (/(문법|grammar)/i.test(text)) return "문법"
  if (/(독해|reading|read)/i.test(text)) return "독해"
  if (/(듣기|리스닝|listening)/i.test(text)) return "듣기"
  if (/(내신|학교별|school)/i.test(text)) return "내신"
  if (/(수능|모의|mock|exam)/i.test(text)) return "수능"
  if (/(영어|english)/i.test(text)) return "영어"
  return normalizeWordRetestTextbookSubjectLabel(textbook.subject || "")
}

function inferWordRetestTextbookGrade(textbook: OpsTextbookOption) {
  const text = normalizeLookupValue([textbook.label, textbook.subject, textbook.meta].filter(Boolean).join(" "))
  if (/(초[1-6]|초등|elementary)/i.test(text)) return "초등"
  if (/(중[1-3]|중등|middle)/i.test(text)) return "중등"
  if (/(고[1-3]|고등|high)/i.test(text)) return "고등"
  return ""
}

function inferWordRetestTextbookGradePill(textbook: OpsTextbookOption) {
  const text = normalizeLookupValue([textbook.label, textbook.subject, textbook.meta].filter(Boolean).join(" "))
  const exactGrade = text.match(/(초[1-6]|중[1-3]|고[1-3])/)
  if (exactGrade) return exactGrade[1]
  if (/(초등|elementary)/i.test(text)) return "초등"
  if (/(중등|middle)/i.test(text)) return "중등"
  if (/(고등|high)/i.test(text)) return "고등"
  return ""
}

function uniqueTextFilters(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function getWordRetestTextbookGradeFilters(textbooks: OpsTextbookOption[]) {
  const availableFilters = new Set(uniqueTextFilters(textbooks.filter(isWordRetestTextbookOption).map(inferWordRetestTextbookGrade)))
  return ["초등", "중등", "고등"].filter((filterValue) => availableFilters.has(filterValue))
}

function getWordRetestTextbookOptions(
  textbooks: OpsTextbookOption[],
  selectedTextbookId = "",
  gradeFilter = "all",
) {
  const eligibleTextbooks = textbooks.filter(isWordRetestTextbookOption)
  const filteredTextbooks = eligibleTextbooks.filter((textbook) => (
    gradeFilter === "all" || inferWordRetestTextbookGrade(textbook) === gradeFilter
  ))
  const selectedTextbook = eligibleTextbooks.find((textbook) => textbook.id === selectedTextbookId)
  const candidates = [selectedTextbook, ...filteredTextbooks].filter((textbook): textbook is OpsTextbookOption => Boolean(textbook))
  return candidates.filter((textbook, index, list) => list.findIndex((item) => item.id === textbook.id) === index)
}

function getUnknownErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === "object" && error) return String((error as { message?: unknown }).message || "")
  return typeof error === "string" ? error : ""
}

function getOpsTaskActionErrorMessage(error: unknown, fallback: string) {
  const message = getUnknownErrorMessage(error) || fallback
  const cleanupError = typeof error === "object" && error ? (error as { cleanupError?: unknown }).cleanupError : null
  const cleanupText = getUnknownErrorMessage(cleanupError)
  const cleanupMessage = cleanupText ? `생성 정리 확인 필요: ${cleanupText}` : ""
  return cleanupMessage ? `${message}\n${cleanupMessage}` : message
}

const EMPTY_FORM: OpsTaskInput = {
  title: "",
  type: "general",
  status: "requested",
  priority: "normal",
  requestedBy: "",
  requestedTeam: "",
  assigneeId: "",
  assigneeTeam: "",
  secondaryAssigneeId: "",
  studentId: "",
  classId: "",
  textbookId: "",
  studentName: "",
  className: "",
  textbookTitle: "",
  campus: "",
  subject: "",
  startAt: "",
  dueAt: "",
  memo: "",
  registration: {},
  withdrawal: {},
  transfer: {},
  wordRetest: { branch: "본관", retestStatus: "not_started" },
}

function cloneForm(input: OpsTaskInput = EMPTY_FORM): OpsTaskInput {
  return {
    ...EMPTY_FORM,
    ...input,
    registration: { pipelineStatus: REGISTRATION_PIPELINE_STATUSES[0]?.value || "0. 등록 문의", ...(input.registration || {}) },
    withdrawal: { ...(input.withdrawal || {}) },
    transfer: { ...(input.transfer || {}) },
    wordRetest: { branch: "본관", retestStatus: "not_started", ...(input.wordRetest || {}) },
  }
}

function serializeOpsTaskInput(input: OpsTaskInput) {
  return JSON.stringify(input)
}

function formFromTask(task: OpsTask): OpsTaskInput {
  return cloneForm({
    title: task.title,
    type: task.type,
    status: task.status,
    priority: task.priority,
    requestedBy: task.requestedBy,
    requestedTeam: task.requestedTeam,
    assigneeId: task.assigneeId,
    assigneeTeam: task.assigneeTeam,
    secondaryAssigneeId: task.secondaryAssigneeId,
    studentId: task.studentId,
    classId: task.classId,
    textbookId: task.textbookId,
    studentName: task.studentName,
    className: task.className,
    textbookTitle: task.textbookTitle,
    campus: task.campus,
    subject: task.subject,
    startAt: task.startAt,
    dueAt: task.dueAt,
    completedAt: task.completedAt,
    memo: task.memo,
    registration: task.registration,
    withdrawal: task.withdrawal,
    transfer: task.transfer,
    wordRetest: task.wordRetest,
  })
}

function inputFromTaskForPreview(task: OpsTask): OpsTaskInput {
  return formFromTask(task)
}

function inputFromTaskForCompletionCheck(task: OpsTask): OpsTaskInput {
  return { ...inputFromTaskForPreview(task), status: "done" }
}

function getCompletionIntentForBlockedEdit(task: OpsTask, blockers: string[]): FormCompletionIntent | null {
  if (blockers.length === 0 || task.type === "general") return null
  if (task.type === "registration") {
    return { registrationPipelineStatus: findRegistrationPipelineStatus("7.") || "7. 등록 완료" }
  }
  return { status: "done" }
}

function applyFormCompletionIntent(input: OpsTaskInput, intent: FormCompletionIntent | null): OpsTaskInput {
  if (!intent) return input

  if (input.type === "registration" && intent.registrationPipelineStatus) {
    return {
      ...input,
      registration: {
        ...(input.registration || {}),
        pipelineStatus: intent.registrationPipelineStatus,
      },
    }
  }

  if (input.type === "word_retest" && intent.wordRetestStatus) {
    return {
      ...input,
      status: intent.status || input.status,
      completedAt: intent.status === "requested" ? "" : input.completedAt,
      wordRetest: {
        ...(input.wordRetest || {}),
        retestStatus: intent.wordRetestStatus,
      },
    }
  }

  if (intent.status) return { ...input, status: intent.status }

  return input
}

function getFormCompletionIntentSubmitLabel(intent: FormCompletionIntent | null, taskType: OpsTaskInput["type"], isEditing: boolean) {
  if (!intent && taskType === "withdrawal" && !isEditing) return "퇴원 신청"
  if (!intent && taskType === "transfer" && !isEditing) return "전반 신청"
  if (!intent) return "저장"
  if (intent.kind === "word_retest_retry") {
    return "재시험 추가 및 불합격 확인"
  }
  if (intent.registrationPipelineStatus) return `저장 후 ${getCompactRegistrationPipelineLabel(intent.registrationPipelineStatus)}`
  if (intent.status === "done") return "저장 후 완료"
  return "저장"
}

function canSubmitOpsTaskForm(input: OpsTaskInput, isEditing: boolean) {
  if (input.type === "registration" && !isEditing) {
    return getRegistrationCreateBlockers(input).length === 0
  }
  if (input.type === "transfer" && !isEditing) {
    const transfer = input.transfer || {}
    return Boolean(
      input.subject &&
      transfer.fromTeacherName &&
      transfer.fromClassId &&
      input.studentId &&
      transfer.toTeacherName &&
      transfer.toClassId,
    )
  }
  if (input.type !== "withdrawal" || isEditing) return true
  const withdrawal = input.withdrawal || {}
  return Boolean(
    input.subject &&
    withdrawal.teacherName &&
    input.classId &&
    input.studentId,
  )
}

function isRegistrationPipelineComplete(input: OpsTaskInput) {
  return input.status === "done" || String(input.registration?.pipelineStatus || "").startsWith("7.")
}

function getMissingRegistrationCheckLabels(registration?: OpsTaskInput["registration"]) {
  return [
    { checked: Boolean(registration?.admissionNoticeSent), label: "입학신청서 발송" },
    { checked: Boolean(registration?.makeeduRegistered), label: "메이크에듀 등록(수업, 교재)" },
    { checked: Boolean(registration?.makeeduInvoiceSent), label: "청구서 발송" },
    { checked: Boolean(registration?.paymentChecked), label: "수납 완료 확인" },
  ].filter((item) => !item.checked).map((item) => item.label)
}

function getMissingWithdrawalCheckLabels(withdrawal?: OpsTaskInput["withdrawal"]) {
  return [
    { checked: Boolean(withdrawal?.makeeduWithdrawalDone), label: "메이크에듀 퇴원처리" },
    { checked: Boolean(withdrawal?.feeProcessed), label: "수업료 처리" },
    { checked: Boolean(withdrawal?.textbookFeeProcessed), label: "교재비 처리" },
  ].filter((item) => !item.checked).map((item) => item.label)
}

function getMissingTransferCheckLabels(transfer?: OpsTaskInput["transfer"]) {
  return [
    { checked: Boolean(transfer?.makeeduTransferDone), label: "메이크에듀 전반처리" },
    { checked: Boolean(transfer?.feeProcessed), label: "수업료 처리" },
    { checked: Boolean(transfer?.textbookFeeProcessed), label: "교재비 처리" },
  ].filter((item) => !item.checked).map((item) => item.label)
}

function hasLinkedRecord(value: unknown) {
  return Boolean(String(value || "").trim())
}

function hasWordRetestScore(wordRetest?: OpsTaskInput["wordRetest"]) {
  return [wordRetest?.firstScore, wordRetest?.secondScore, wordRetest?.thirdScore].some((score) =>
    Boolean(String(score || "").trim()),
  )
}

function isWordRetestAbsent(wordRetest?: OpsTaskInput["wordRetest"]) {
  return String(wordRetest?.retestStatus || "").trim() === "absent"
}

function shouldRequireWordRetestScore(wordRetest?: OpsTaskInput["wordRetest"]) {
  return !isWordRetestAbsent(wordRetest) && !hasWordRetestScore(wordRetest)
}

function parseWordRetestScoreValue(value?: string) {
  const normalized = String(value || "").trim()
  if (!normalized) return null
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function getWordRetestAttemptScoreFeedback(score?: string, totalQuestionCount?: string, cutoffQuestionCount?: string) {
  const correctCount = parseWordRetestScoreValue(score)
  const totalCount = parseWordRetestScoreValue(totalQuestionCount)
  const cutoffCount = parseWordRetestScoreValue(cutoffQuestionCount)
  const feedback: { label: string; tone: "muted" | "pass" | "retry" }[] = []

  if (correctCount === null) return feedback

  if (totalCount !== null && totalCount > 0) {
    const percent = Math.max(0, Math.min(100, Math.round((correctCount / totalCount) * 100)))
    feedback.push({ label: `${percent}점`, tone: "muted" })
  }

  if (cutoffCount !== null) {
    feedback.push({ label: correctCount >= cutoffCount ? "통과" : "재시험", tone: correctCount >= cutoffCount ? "pass" : "retry" })
  }

  return feedback
}

function getWordRetestScoreValues(wordRetest?: OpsTaskInput["wordRetest"]) {
  return [wordRetest?.firstScore, wordRetest?.secondScore, wordRetest?.thirdScore]
    .map(parseWordRetestScoreValue)
    .filter((score): score is number => score !== null)
}

function getWordRetestScoreResult(wordRetest?: OpsTaskInput["wordRetest"]) {
  const cutoff = parseWordRetestScoreValue(wordRetest?.cutoffQuestionCount)
  const scores = getWordRetestScoreValues(wordRetest)

  if (cutoff === null || scores.length === 0) return null
  return scores.some((score) => score >= cutoff) ? "passed" : "failed"
}

function getWordRetestBestScore(wordRetest?: OpsTaskInput["wordRetest"]) {
  const scores = getWordRetestScoreValues(wordRetest)
  return scores.length > 0 ? Math.max(...scores) : null
}

function getWordRetestScorePercent(wordRetest?: OpsTaskInput["wordRetest"]) {
  const bestScore = getWordRetestBestScore(wordRetest)
  const totalCount = parseWordRetestScoreValue(wordRetest?.totalQuestionCount)
  if (bestScore === null || totalCount === null || totalCount <= 0) return null
  return Math.max(0, Math.min(100, Math.round((bestScore / totalCount) * 100)))
}

function getWordRetestBranch(task: OpsTask) {
  return String(task.wordRetest?.branch || task.campus || "본관").trim() || "본관"
}

function getWordRetestTeacherLabel(task: OpsTask) {
  return task.wordRetest?.teacherName || task.assigneeLabel || task.requestedByLabel || "미지정"
}

function getWordRetestStudentLabel(task: OpsTask) {
  return task.studentName || task.wordRetest?.studentName || "미지정"
}

function getWordRetestClassLabel(task: OpsTask) {
  return task.className || task.wordRetest?.className || "미지정"
}

function getWordRetestTextbookLabel(task: OpsTask) {
  return task.textbookTitle || task.wordRetest?.textbookName || "미지정"
}

function getWordRetestUnitLabel(task: OpsTask) {
  return task.wordRetest?.unit || "미지정"
}

function getWordRetestStatusLabel(value?: string, taskStatus?: OpsTaskStatus, wordRetest?: OpsTaskInput["wordRetest"]) {
  const statusValue = String(value || "not_started").trim() || "not_started"
  if (taskStatus === "review_requested" || taskStatus === "done") {
    if (statusValue === "absent") return "미응시"
    const scoreResult = getWordRetestScoreResult(wordRetest)
    if (scoreResult === "passed") return "완료: 합격"
    if (scoreResult === "failed") return "미완료: 불합격"
    if (statusValue === "done" || statusValue === "in_progress") return "완료"
  }
  return WORD_RETEST_STATUSES.find((status) => status.value === statusValue)?.label || "시작 전"
}

function getWordRetestScoreSummary(task: OpsTask) {
  const wordRetest = task.wordRetest || {}
  if (isWordRetestAbsent(wordRetest)) return "미응시"
  const scores = [wordRetest.firstScore, wordRetest.secondScore, wordRetest.thirdScore]
    .map((score) => String(score || "").trim())
    .filter(Boolean)
  return scores.length > 0 ? scores.join(" / ") : "점수 미입력"
}

function getWordRetestScoreDraft(task: OpsTask): WordRetestScoreDraft {
  const wordRetest = task.wordRetest || {}
  return {
    firstScore: String(wordRetest.firstScore || ""),
    secondScore: String(wordRetest.secondScore || ""),
    thirdScore: String(wordRetest.thirdScore || ""),
  }
}

function isWordRetestScoreDraftDirty(task: OpsTask, draft: WordRetestScoreDraft) {
  const current = getWordRetestScoreDraft(task)
  return current.firstScore !== draft.firstScore ||
    current.secondScore !== draft.secondScore ||
    current.thirdScore !== draft.thirdScore
}

function getWordRetestDateSortValue(task: OpsTask) {
  const rawValue = task.wordRetest?.testAt || task.dueAt || task.startAt || ""
  const timestamp = Date.parse(rawValue)
  return Number.isFinite(timestamp) ? timestamp : Number.MAX_SAFE_INTEGER
}

function getDateFromKey(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number)
  if (!year || !month || !day) return null
  return new Date(year, month - 1, day)
}

function getWordRetestTestDateKey(task: OpsTask) {
  return toDateKey(task.wordRetest?.testAt || task.dueAt || task.startAt || "")
}

function getWordRetestWeekRange(todayKey: string) {
  const today = getDateFromKey(todayKey) || new Date()
  const day = today.getDay()
  const monday = new Date(today)
  monday.setDate(today.getDate() - (day === 0 ? 6 : day - 1))
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  return {
    start: toDateKey(monday),
    end: toDateKey(sunday),
  }
}

function getWordRetestMonthRange(todayKey: string) {
  const today = getDateFromKey(todayKey) || new Date()
  const start = new Date(today.getFullYear(), today.getMonth(), 1)
  const end = new Date(today.getFullYear(), today.getMonth() + 1, 0)
  return {
    start: toDateKey(start),
    end: toDateKey(end),
  }
}

function isDateKeyInRange(dateKey: string, startDateKey: string, endDateKey: string) {
  if (!dateKey) return false
  if (startDateKey && dateKey < startDateKey) return false
  if (endDateKey && dateKey > endDateKey) return false
  return true
}

function matchesWordRetestPeriodFilter(
  task: OpsTask,
  periodFilter: WordRetestPeriodFilter,
  todayKey: string,
  customStartDate: string,
  customEndDate: string,
) {
  if (periodFilter === "all") return true
  const dateKey = getWordRetestTestDateKey(task)
  if (!dateKey) return false

  if (periodFilter === "today") return dateKey === todayKey
  if (periodFilter === "week") {
    const range = getWordRetestWeekRange(todayKey)
    return isDateKeyInRange(dateKey, range.start, range.end)
  }
  if (periodFilter === "month") {
    const range = getWordRetestMonthRange(todayKey)
    return isDateKeyInRange(dateKey, range.start, range.end)
  }

  const startDateKey = toDateKey(customStartDate)
  const endDateKey = toDateKey(customEndDate)
  if (!startDateKey && !endDateKey) return true
  return isDateKeyInRange(dateKey, startDateKey, endDateKey)
}

function getWordRetestAutoAbsentDeadline(task: OpsTask) {
  const rawValue = String(task.wordRetest?.testAt || task.dueAt || task.startAt || "").trim()
  if (!rawValue) return null
  const dateKey = toDateKey(rawValue)
  if (!dateKey) return null
  const [year, month, day] = dateKey.split("-").map(Number)
  if (!year || !month || !day) return null
  const deadline = new Date(year, month - 1, day, 23, 59, 59, 999)
  deadline.setDate(deadline.getDate() + 7)
  return deadline.getTime()
}

function shouldAutoMarkWordRetestAbsent(task: OpsTask, now = new Date()) {
  const wordRetest = task.wordRetest || {}
  const retestStatus = String(wordRetest.retestStatus || "not_started").trim() || "not_started"
  const deadline = getWordRetestAutoAbsentDeadline(task)

  return task.type === "word_retest" &&
    !isClosedOpsTask(task) &&
    ["requested", "confirmed", "on_hold"].includes(task.status) &&
    retestStatus === "not_started" &&
    deadline !== null &&
    deadline < now.getTime()
}

function sortWordRetestTasksByTestAt(tasks: OpsTask[]) {
  return [...tasks].sort((left, right) => {
    const dateDiff = getWordRetestDateSortValue(left) - getWordRetestDateSortValue(right)
    if (dateDiff !== 0) return dateDiff
    return String(left.createdAt || left.updatedAt).localeCompare(String(right.createdAt || right.updatedAt))
  })
}

function getWithdrawalTableGridTemplate(widths: Record<WithdrawalTableColumnKey, number>) {
  return WITHDRAWAL_TABLE_COLUMNS.map((column) => `${widths[column.columnKey]}px`).join(" ")
}

function getTransferTableGridTemplate(widths: Record<TransferTableColumnKey, number>) {
  return TRANSFER_TABLE_COLUMNS.map((column) => `${widths[column.columnKey]}px`).join(" ")
}

function getWithdrawalOperationsChecklist(withdrawal?: OpsTask["withdrawal"]) {
  return [
    { key: "makeedu", field: "makeeduWithdrawalDone" as const, label: "메이크에듀", detail: "메이크에듀 퇴원처리", checked: Boolean(withdrawal?.makeeduWithdrawalDone) },
    { key: "fee", field: "feeProcessed" as const, label: "수업료", detail: "수업료 처리", checked: Boolean(withdrawal?.feeProcessed) },
    { key: "textbookFee", field: "textbookFeeProcessed" as const, label: "교재비", detail: "교재비 처리", checked: Boolean(withdrawal?.textbookFeeProcessed) },
  ]
}

function getWithdrawalOperationsChecklistValue(withdrawal?: OpsTask["withdrawal"]) {
  const items = getWithdrawalOperationsChecklist(withdrawal)
  const completedCount = items.filter((item) => item.checked).length
  const pendingItems = items.filter((item) => !item.checked).map((item) => item.detail)
  return pendingItems.length > 0 ? `${completedCount}/3 · ${pendingItems.join(", ")}` : "3/3 · 처리 확인 완료"
}

function getTransferOperationsChecklist(transfer?: OpsTask["transfer"]) {
  return [
    { key: "makeedu", field: "makeeduTransferDone" as const, label: "메이크에듀", detail: "메이크에듀 전반처리", checked: Boolean(transfer?.makeeduTransferDone) },
    { key: "fee", field: "feeProcessed" as const, label: "수업료", detail: "수업료 처리", checked: Boolean(transfer?.feeProcessed) },
    { key: "textbookFee", field: "textbookFeeProcessed" as const, label: "교재비", detail: "교재비 처리", checked: Boolean(transfer?.textbookFeeProcessed) },
  ]
}

function getTransferOperationsChecklistValue(transfer?: OpsTask["transfer"]) {
  const items = getTransferOperationsChecklist(transfer)
  const completedCount = items.filter((item) => item.checked).length
  const pendingItems = items.filter((item) => !item.checked).map((item) => item.detail)
  return pendingItems.length > 0 ? `${completedCount}/3 · ${pendingItems.join(", ")}` : "3/3 · 처리 확인 완료"
}

function getRegistrationOperationsChecklist(
  registration?: OpsTask["registration"],
): Array<{
  key: string
  field?: RegistrationChecklistField
  label: string
  detail: string
  checked: boolean
  editable: boolean
  available: boolean
  unavailableReason: string
}> {
  const availability = getRegistrationChecklistAvailability({
    pipelineStatus: registration?.pipelineStatus,
    registration,
  })
  return [
    { key: "admission", field: "admissionNoticeSent" as const, label: "입학신청서 발송", detail: "입학신청서 발송", checked: Boolean(registration?.admissionNoticeSent), editable: true, available: availability.admissionNoticeSent.enabled, unavailableReason: availability.admissionNoticeSent.reason },
    { key: "makeedu", field: "makeeduRegistered" as const, label: "메이크에듀 등록(수업, 교재)", detail: "메이크에듀 등록(수업, 교재)", checked: Boolean(registration?.makeeduRegistered), editable: true, available: availability.makeeduRegistered.enabled, unavailableReason: availability.makeeduRegistered.reason },
    { key: "invoice", field: "makeeduInvoiceSent" as const, label: "청구서 발송", detail: "청구서 발송", checked: Boolean(registration?.makeeduInvoiceSent), editable: true, available: availability.makeeduInvoiceSent.enabled, unavailableReason: availability.makeeduInvoiceSent.reason },
    { key: "payment", field: "paymentChecked" as const, label: "수납 완료 확인", detail: "수납 완료 확인", checked: Boolean(registration?.paymentChecked), editable: true, available: availability.paymentChecked.enabled, unavailableReason: availability.paymentChecked.reason },
    { key: "complete", label: "등록 완료", detail: "등록 완료", checked: getRegistrationPipelinePrefix(registration?.pipelineStatus) === "7.", editable: false, available: getRegistrationPipelinePrefix(registration?.pipelineStatus) === "7.", unavailableReason: "네 단계와 등록 정보를 모두 확인한 뒤 등록 완료로 이동합니다." },
  ]
}

function getRegistrationOperationsChecklistValue(registration?: OpsTask["registration"]) {
  const items = getRegistrationOperationsChecklist(registration)
  const completedCount = items.filter((item) => item.checked).length
  const pendingItems = items.filter((item) => !item.checked).map((item) => item.detail)
  return pendingItems.length > 0 ? `${completedCount}/${items.length} · ${pendingItems.join(", ")}` : `${items.length}/${items.length} · 등록 확인 완료`
}

function WithdrawalOperationsChecklistChips({
  withdrawal,
  editable = false,
  disabled = false,
  onChange,
}: {
  withdrawal?: OpsTask["withdrawal"]
  editable?: boolean
  disabled?: boolean
  onChange?: (field: WithdrawalChecklistField, checked: boolean) => void
}) {
  return (
    <div className="flex min-w-0 flex-wrap gap-1">
      {getWithdrawalOperationsChecklist(withdrawal).map((item) => {
        const className = [
          "inline-flex h-6 max-w-full items-center gap-1 rounded-md border px-2 text-xs font-medium",
          item.checked
            ? "border-primary/20 bg-primary/10 text-primary"
            : "border-amber-300 bg-amber-50 text-amber-800",
          editable ? "transition hover:border-primary/40 hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-70" : "",
        ].join(" ")

        if (!editable || !onChange) {
          return (
            <span key={item.key} className={className} title={item.detail}>
              {item.checked ? <Check className="size-3 shrink-0" aria-hidden="true" /> : null}
              <span className="truncate">{item.label}</span>
            </span>
          )
        }

        return (
          <button
            key={item.key}
            type="button"
            aria-pressed={item.checked}
            aria-label={`${item.detail} ${item.checked ? "완료 취소" : "완료 체크"}`}
            className={className}
            title={item.detail}
            disabled={disabled}
            onClick={() => {
              if (item.field && onChange) onChange(item.field, !item.checked)
            }}
          >
            {item.checked ? <Check className="size-3 shrink-0" aria-hidden="true" /> : null}
            <span className="truncate">{item.label}</span>
          </button>
        )
      })}
    </div>
  )
}

function TransferOperationsChecklistChips({
  transfer,
  editable = false,
  disabled = false,
  onChange,
}: {
  transfer?: OpsTask["transfer"]
  editable?: boolean
  disabled?: boolean
  onChange?: (field: TransferChecklistField, checked: boolean) => void
}) {
  return (
    <div className="flex min-w-0 flex-wrap gap-1">
      {getTransferOperationsChecklist(transfer).map((item) => {
        const className = [
          "inline-flex h-6 max-w-full items-center gap-1 rounded-md border px-2 text-xs font-medium",
          item.checked
            ? "border-primary/20 bg-primary/10 text-primary"
            : "border-amber-300 bg-amber-50 text-amber-800",
          editable ? "transition hover:border-primary/40 hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-70" : "",
        ].join(" ")

        if (!editable || !onChange) {
          return (
            <span key={item.key} className={className} title={item.detail}>
              {item.checked ? <Check className="size-3 shrink-0" aria-hidden="true" /> : null}
              <span className="truncate">{item.label}</span>
            </span>
          )
        }

        return (
          <button
            key={item.key}
            type="button"
            aria-pressed={item.checked}
            aria-label={`${item.detail} ${item.checked ? "완료 취소" : "완료 체크"}`}
            className={className}
            title={item.detail}
            disabled={disabled}
            onClick={() => {
              if (item.field && onChange) onChange(item.field, !item.checked)
            }}
          >
            {item.checked ? <Check className="size-3 shrink-0" aria-hidden="true" /> : null}
            <span className="truncate">{item.label}</span>
          </button>
        )
      })}
    </div>
  )
}

function RegistrationOperationsChecklistChips({
  registration,
  editable = false,
  disabled = false,
  onChange,
}: {
  registration?: OpsTask["registration"]
  editable?: boolean
  disabled?: boolean
  onChange?: (field: RegistrationChecklistField, checked: boolean) => void
}) {
  return (
    <div className="flex min-w-0 flex-wrap gap-1">
      {getRegistrationOperationsChecklist(registration).map((item) => {
        const canToggle = Boolean(item.editable && item.available && item.field && editable && onChange)
        const className = [
          "inline-flex h-6 max-w-full items-center gap-1 rounded-md border px-2 text-xs font-medium",
          item.checked
            ? "border-primary/20 bg-primary/10 text-primary"
            : item.editable && item.available
              ? "border-amber-300 bg-amber-50 text-amber-800"
              : "border-muted bg-muted/45 text-muted-foreground",
          canToggle ? "transition hover:border-primary/40 hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-70" : "",
        ].join(" ")

        if (!canToggle) {
          return (
            <span key={item.key} className={className} title={item.available ? item.detail : item.unavailableReason || item.detail}>
              {item.checked ? <Check className="size-3 shrink-0" aria-hidden="true" /> : null}
              <span className="truncate">{item.label}</span>
            </span>
          )
        }

        return (
          <button
            key={item.key}
            type="button"
            aria-pressed={item.checked}
            aria-label={`${item.detail} ${item.checked ? "완료 취소" : "완료 체크"}`}
            className={className}
            title={item.detail}
            disabled={disabled}
            onClick={() => {
              if (item.field && onChange) onChange(item.field, !item.checked)
            }}
          >
            {item.checked ? <Check className="size-3 shrink-0" aria-hidden="true" /> : null}
            <span className="truncate">{item.label}</span>
          </button>
        )
      })}
    </div>
  )
}

function getWordRetestTableGridTemplate(widths: Record<WordRetestTableColumnKey, number>) {
  return [
    widths.select,
    widths.status,
    widths.testAt,
    widths.teacher,
    widths.class,
    widths.student,
    widths.textbook,
    widths.unit,
    widths.total,
    widths.cutoff,
    widths.score,
    widths.result,
    widths.action,
  ].map((width) => `${width}px`).join(" ")
}

function getWordRetestRequestDefaults(type: OpsTaskType, currentUserId: string, currentUserTaskTeam: string, teacher?: OpsTeacherOption): Partial<OpsTaskInput> {
  if (type !== "word_retest") return {}
  return {
    requestedBy: currentUserId,
    requestedTeam: currentUserTaskTeam,
    assigneeId: "",
    assigneeTeam: "조교팀",
    wordRetest: {
      branch: "본관",
      retestStatus: "not_started",
      teacherId: teacher?.id || "",
      teacherName: teacher?.label || "",
    },
  }
}

function isSameLinkedRecord(first: unknown, second: unknown) {
  const firstValue = String(first || "").trim()
  const secondValue = String(second || "").trim()
  return firstValue !== "" && firstValue === secondValue
}

function hasNewRegistrationStudent(input: OpsTaskInput) {
  return hasLinkedRecord(input.studentId) || Boolean(String(input.studentName || "").trim())
}

function normalizeLookupValue(value: unknown) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, "")
}

function buildOpsTaskOptionIndexes(
  students: OpsStudentOption[] = EMPTY_STUDENT_OPTIONS,
  classes: OpsClassOption[] = EMPTY_CLASS_OPTIONS,
  textbooks: OpsTextbookOption[] = EMPTY_TEXTBOOK_OPTIONS,
  teachers: OpsTeacherOption[] = EMPTY_TEACHER_OPTIONS,
): OpsTaskOptionIndexes {
  return {
    studentsById: new Map(students.map((student) => [student.id, student])),
    classesById: new Map(classes.map((classItem) => [classItem.id, classItem])),
    textbooksById: new Map(textbooks.map((textbook) => [textbook.id, textbook])),
    teachersById: new Map(teachers.map((teacher) => [teacher.id, teacher])),
  }
}

function findStudentOption(students: OpsStudentOption[], studentId: unknown, indexes: OpsTaskOptionIndexes = EMPTY_OPS_TASK_OPTION_INDEXES) {
  const safeStudentId = String(studentId || "").trim()
  return safeStudentId ? indexes.studentsById.get(safeStudentId) || students.find((student) => student.id === safeStudentId) : undefined
}

function findClassOption(classes: OpsClassOption[], classId: unknown, indexes: OpsTaskOptionIndexes = EMPTY_OPS_TASK_OPTION_INDEXES) {
  const safeClassId = String(classId || "").trim()
  return safeClassId ? indexes.classesById.get(safeClassId) || classes.find((classItem) => classItem.id === safeClassId) : undefined
}

function findTextbookOption(textbooks: OpsTextbookOption[], textbookId: unknown, indexes: OpsTaskOptionIndexes = EMPTY_OPS_TASK_OPTION_INDEXES) {
  const safeTextbookId = String(textbookId || "").trim()
  return safeTextbookId ? indexes.textbooksById.get(safeTextbookId) || textbooks.find((textbook) => textbook.id === safeTextbookId) : undefined
}

function findTeacherOption(teachers: OpsTeacherOption[], teacherId: unknown, indexes: OpsTaskOptionIndexes = EMPTY_OPS_TASK_OPTION_INDEXES) {
  const safeTeacherId = String(teacherId || "").trim()
  return safeTeacherId ? indexes.teachersById.get(safeTeacherId) || teachers.find((teacher) => teacher.id === safeTeacherId) : undefined
}

function findLinkedOptionByReference<Option extends OpsLinkedOption>(
  options: Option[],
  idFinder: (id: unknown) => Option | undefined,
  ...references: unknown[]
) {
  for (const reference of references) {
    const safeReference = String(reference || "").trim()
    if (!safeReference) continue

    const byId = idFinder(safeReference)
    if (byId) return byId

    const lookup = normalizeLookupValue(safeReference)
    const byLabel = options.find((option) => (
      normalizeLookupValue(option.label) === lookup ||
      normalizeLookupValue(option.meta).includes(lookup)
    ))
    if (byLabel) return byLabel
  }

  return undefined
}

function findStudentOptionByReference(students: OpsStudentOption[], indexes: OpsTaskOptionIndexes, ...references: unknown[]) {
  return findLinkedOptionByReference(students, (id) => findStudentOption(students, id, indexes), ...references)
}

function findClassOptionByReference(classes: OpsClassOption[], indexes: OpsTaskOptionIndexes, ...references: unknown[]) {
  return findLinkedOptionByReference(classes, (id) => findClassOption(classes, id, indexes), ...references)
}

function hasRosterLink(student: OpsStudentOption | undefined, classItem: OpsClassOption | undefined) {
  if (!student || !classItem) return false
  return (
    student.classIds.includes(classItem.id) ||
    student.waitlistClassIds.includes(classItem.id) ||
    classItem.studentIds.includes(student.id) ||
    classItem.waitlistIds.includes(student.id)
  )
}

function getRosterCompletionBlockers(
  input: OpsTaskInput,
  students: OpsStudentOption[],
  classes: OpsClassOption[],
  indexes: OpsTaskOptionIndexes = EMPTY_OPS_TASK_OPTION_INDEXES,
) {
  const blockers: string[] = []

  if (input.type === "withdrawal" && input.status === "done" && hasLinkedRecord(input.studentId || input.studentName) && hasLinkedRecord(input.classId || input.className)) {
    const student = findStudentOptionByReference(students, indexes, input.studentId, input.studentName)
    const classItem = findClassOptionByReference(classes, indexes, input.classId, input.className)
    if (student && classItem && !hasRosterLink(student, classItem)) blockers.push("수업 명단")
  }

  if (input.type === "transfer" && input.status === "done") {
    const transfer = input.transfer || {}
    if (hasLinkedRecord(input.studentId || input.studentName) && hasLinkedRecord(transfer.fromClassId || transfer.fromClassName)) {
      const student = findStudentOptionByReference(students, indexes, input.studentId, input.studentName)
      const fromClass = findClassOptionByReference(classes, indexes, transfer.fromClassId, transfer.fromClassName)
      if (student && fromClass && !hasRosterLink(student, fromClass)) blockers.push("전 수업 명단")
    }
  }

  if (input.type === "word_retest" && input.status === "done" && hasLinkedRecord(input.studentId || input.studentName || input.wordRetest?.studentName) && hasLinkedRecord(input.classId || input.className || input.wordRetest?.className)) {
    const student = findStudentOptionByReference(students, indexes, input.studentId, input.studentName, input.wordRetest?.studentName)
    const classItem = findClassOptionByReference(classes, indexes, input.classId, input.className, input.wordRetest?.className)
    if (student && classItem && !hasRosterLink(student, classItem)) blockers.push("수업 명단")
  }

  return blockers
}

function getOperationCompletionBlockers(
  input: OpsTaskInput,
  students: OpsStudentOption[] = EMPTY_STUDENT_OPTIONS,
  classes: OpsClassOption[] = EMPTY_CLASS_OPTIONS,
  textbooks: OpsTextbookOption[] = EMPTY_TEXTBOOK_OPTIONS,
  teachers: OpsTeacherOption[] = EMPTY_TEACHER_OPTIONS,
  indexes: OpsTaskOptionIndexes = EMPTY_OPS_TASK_OPTION_INDEXES,
) {
  const blockers: string[] = []

  if (input.type === "registration" && isRegistrationPipelineComplete(input)) {
    if (!String(input.registration?.classStartDate || "").trim()) blockers.push("수업시작일")
    if (!String(input.registration?.classStartSession || "").trim()) blockers.push("수업시작일")
    if (!hasNewRegistrationStudent(input)) blockers.push("학생")
    if (hasLinkedRecord(input.studentId) && !findStudentOption(students, input.studentId, indexes)) blockers.push("학생")
    if (!hasLinkedRecord(input.classId)) blockers.push("수업")
    if (hasLinkedRecord(input.classId) && !findClassOption(classes, input.classId, indexes)) blockers.push("수업")
    if (hasLinkedRecord(input.textbookId) && !findTextbookOption(textbooks, input.textbookId, indexes)) blockers.push("교재")
    getMissingRegistrationCheckLabels(input.registration).forEach((label) => blockers.push(label))
  }

  if (input.type === "withdrawal" && input.status === "done") {
    if (!String(input.withdrawal?.withdrawalDate || "").trim()) blockers.push("퇴원일")
    if (!hasLinkedRecord(input.studentId)) blockers.push("학생")
    if (hasLinkedRecord(input.studentId) && !findStudentOption(students, input.studentId, indexes)) blockers.push("학생")
    if (!hasLinkedRecord(input.classId)) blockers.push("수업")
    if (hasLinkedRecord(input.classId) && !findClassOption(classes, input.classId, indexes)) blockers.push("수업")
    getMissingWithdrawalCheckLabels(input.withdrawal).forEach((label) => blockers.push(label))
  }

  if (input.type === "transfer" && input.status === "done") {
    const transfer = input.transfer || {}
    const student = findStudentOption(students, input.studentId, indexes)
    const fromClass = findClassOption(classes, transfer.fromClassId, indexes)
    const toClass = findClassOption(classes, transfer.toClassId || input.classId, indexes)

    if (!String(transfer.fromClassEndDate || "").trim()) blockers.push("전 수업 종료일")
    if (!String(transfer.toClassStartDate || "").trim()) blockers.push("후 수업 시작일")
    if (!hasLinkedRecord(input.studentId)) blockers.push("학생")
    if (hasLinkedRecord(input.studentId) && !student) blockers.push("학생")
    if (!hasLinkedRecord(transfer.fromClassId)) blockers.push("전 수업")
    if (hasLinkedRecord(transfer.fromClassId) && !fromClass) blockers.push("전 수업")
    if (!hasLinkedRecord(transfer.toClassId || input.classId)) blockers.push("후 수업")
    if (hasLinkedRecord(transfer.toClassId || input.classId) && !toClass) blockers.push("후 수업")
    if ((fromClass && toClass && fromClass.id === toClass.id) || isSameLinkedRecord(transfer.fromClassId, transfer.toClassId || input.classId)) blockers.push("다른 수업")
    getMissingTransferCheckLabels(input.transfer).forEach((label) => blockers.push(label))
  }

  if (input.type === "word_retest" && input.status === "done") {
    const wordRetest = input.wordRetest || {}
    const textbookName = String(wordRetest.textbookName || input.textbookTitle || "").trim()
    const hasTextbook = hasLinkedRecord(input.textbookId)
      ? Boolean(findTextbookOption(textbooks, input.textbookId, indexes))
      : Boolean(textbookName)
    if (!hasLinkedRecord(input.studentId)) blockers.push("학생")
    if (hasLinkedRecord(input.studentId) && !findStudentOption(students, input.studentId, indexes)) blockers.push("학생")
    if (!hasLinkedRecord(input.classId)) blockers.push("수업")
    if (hasLinkedRecord(input.classId) && !findClassOption(classes, input.classId, indexes)) blockers.push("수업")
    if (!hasLinkedRecord(wordRetest.teacherId)) blockers.push("선생님")
    if (hasLinkedRecord(wordRetest.teacherId) && !findTeacherOption(teachers, wordRetest.teacherId, indexes)) blockers.push("선생님")
    if (!String(wordRetest.branch || "").trim()) blockers.push("지점")
    if (!hasTextbook) blockers.push("교재")
    if (!String(wordRetest.testAt || "").trim()) blockers.push("본시험일")
    if (!String(wordRetest.unit || "").trim()) blockers.push("시험범위")
    if (shouldRequireWordRetestScore(wordRetest)) blockers.push("점수")
  }

  const rosterBlockers = getRosterCompletionBlockers(input, students, classes, indexes)
  return prioritizeCompletionBlockers([...blockers, ...rosterBlockers])
}

function getWordRetestRequiredInputBlockers(
  input: OpsTaskInput,
  textbooks: OpsTextbookOption[] = EMPTY_TEXTBOOK_OPTIONS,
  indexes: OpsTaskOptionIndexes = EMPTY_OPS_TASK_OPTION_INDEXES,
) {
  if (input.type !== "word_retest") return []

  const blockers: string[] = []
  const wordRetest = input.wordRetest || {}
  const textbookName = String(wordRetest.textbookName || input.textbookTitle || "").trim()
  const hasTextbook = hasLinkedRecord(input.textbookId)
    ? Boolean(findTextbookOption(textbooks, input.textbookId, indexes))
    : Boolean(textbookName)

  if (!hasTextbook) blockers.push("교재")
  if (!String(wordRetest.unit || "").trim()) blockers.push("시험범위")
  if (!String(wordRetest.testAt || "").trim()) blockers.push("본시험일")
  if (!String(wordRetest.cutoffQuestionCount || "").trim()) blockers.push("커트라인")
  if (!String(wordRetest.totalQuestionCount || "").trim()) blockers.push("출제 개수")

  return blockers
}

function buildOperationCompletionBlockerMap(
  tasks: OpsTask[],
  students: OpsStudentOption[] = EMPTY_STUDENT_OPTIONS,
  classes: OpsClassOption[] = EMPTY_CLASS_OPTIONS,
  textbooks: OpsTextbookOption[] = EMPTY_TEXTBOOK_OPTIONS,
  teachers: OpsTeacherOption[] = EMPTY_TEACHER_OPTIONS,
  indexes: OpsTaskOptionIndexes = EMPTY_OPS_TASK_OPTION_INDEXES,
): OperationCompletionBlockerMap {
  const blockersByTaskId: OperationCompletionBlockerMap = new Map()

  for (const task of tasks) {
    if (task.type === "general") continue
    blockersByTaskId.set(
      task.id,
      getOperationCompletionBlockers(inputFromTaskForCompletionCheck(task), students, classes, textbooks, teachers, indexes),
    )
  }

  return blockersByTaskId
}

const BLOCKER_ACTION_LABELS: Record<string, string> = {
  "학생": "학생 연결",
  "학생명": "학생명 입력",
  "학부모 전화": "학부모 전화 입력",
  "과목": "과목 선택",
  "수업": "수업 연결",
  "교재": "교재 연결",
  "전 수업": "전 수업 연결",
  "후 수업": "후 수업 연결",
  "다른 수업": "다른 수업 선택",
  "수업 명단": "수업 명단 확인",
  "전 수업 명단": "전 수업 명단 확인",
  "선생님": "선생님 연결",
  "레벨테스트 예약일시": "레벨테스트 일정 입력",
  "레벨테스트 장소": "레벨테스트 장소 선택",
  "레벨테스트 완료일시": "레벨테스트 완료 입력",
  "레벨테스트 결과": "레벨테스트 결과 입력",
  "상담 예약일시": "상담 일정 입력",
  "방문상담실": "방문상담실 선택",
  "상담 완료일시": "상담 완료 입력",
  "상담 책임자": "상담 책임자 입력",
  "수업시작일": "수업시작일 지정",
  "퇴원일": "퇴원일 지정",
  "전 수업 종료일": "전 수업 종료일 지정",
  "후 수업 시작일": "후 수업 시작일 지정",
  "입학신청서 발송": "입학신청서 발송",
  "메이크에듀 등록(수업, 교재)": "메이크에듀 등록(수업, 교재)",
  "청구서 발송": "청구서 발송",
  "수납 완료 확인": "수납 완료 확인",
  "메이크에듀 퇴원처리": "메이크에듀 퇴원처리",
  "메이크에듀 전반처리": "메이크에듀 전반처리",
  "수업료 처리": "수업료 처리",
  "교재비 처리": "교재비 처리",
  "본시험일": "본시험일 지정",
  "시험범위": "시험범위 입력",
  "커트라인": "커트라인 입력",
  "출제 개수": "출제 개수 입력",
  "점수": "점수 입력",
}

const COMPLETION_BLOCKER_PRIORITY = [
  ...Object.keys(BLOCKER_ACTION_LABELS),
]

function prioritizeCompletionBlockers(blockers: string[]) {
  const uniqueBlockers = [...new Set(blockers)]
  return uniqueBlockers.sort((first, second) => getCompletionBlockerPriority(first) - getCompletionBlockerPriority(second))
}

function getCompletionBlockerPriority(blocker: string) {
  const priority = COMPLETION_BLOCKER_PRIORITY.indexOf(blocker)
  return priority === -1 ? COMPLETION_BLOCKER_PRIORITY.length : priority
}

const CHECK_COMPLETION_BLOCKERS = new Set([
  "수업 명단",
  "전 수업 명단",
  "입학신청서 발송",
  "메이크에듀 등록(수업, 교재)",
  "청구서 발송",
  "수납 완료 확인",
  "메이크에듀 퇴원처리",
  "메이크에듀 전반처리",
  "수업료 처리",
  "교재비 처리",
])

const INPUT_COMPLETION_BLOCKERS = new Set([
  "학생명",
  "학부모 전화",
  "레벨테스트 예약일시",
  "레벨테스트 완료일시",
  "레벨테스트 결과",
  "상담 예약일시",
  "상담 완료일시",
  "상담 책임자",
  "수업시작일",
  "퇴원일",
  "전 수업 종료일",
  "후 수업 시작일",
  "본시험일",
  "시험범위",
  "커트라인",
  "출제 개수",
  "점수",
])

const CHOICE_COMPLETION_BLOCKERS = new Set(["다른 수업", "과목", "레벨테스트 장소", "방문상담실"])

function getCompletionBlockerNeedLabel(blocker: string) {
  if (INPUT_COMPLETION_BLOCKERS.has(blocker)) return "입력 필요"
  if (CHOICE_COMPLETION_BLOCKERS.has(blocker)) return "선택 필요"
  return CHECK_COMPLETION_BLOCKERS.has(blocker) ? "확인 필요" : "연결 필요"
}

function getCompletionBlockerActionLabel(blockers: string[]) {
  const firstBlocker = blockers[0] || ""
  const firstLabel = BLOCKER_ACTION_LABELS[firstBlocker] || `${firstBlocker} 확인`
  if (blockers.length <= 1) return firstLabel
  return `${firstLabel} 외 ${blockers.length - 1}개`
}

function getCompletionBlockerFormStep(type: OpsTaskType, blockers: string[]): FormDetailStepKey | null {
  if (type === "registration") {
    if (blockers.some((blocker) => ["학생", "학생명", "학부모 전화", "과목"].includes(blocker))) return "registration_contact"
    if (blockers.some((blocker) => ["레벨테스트 예약일시", "레벨테스트 장소", "레벨테스트 완료일시", "레벨테스트 결과", "상담 예약일시", "방문상담실", "상담 완료일시", "상담 책임자"].includes(blocker))) return "registration_test"
    if (blockers.some((blocker) => ["수업", "교재", "수업시작일"].includes(blocker))) return "registration_start"
    if (blockers.some((blocker) => ["입학신청서 발송", "메이크에듀 등록(수업, 교재)", "청구서 발송", "수납 완료 확인"].includes(blocker))) return "registration_checks"
  }

  if (type === "withdrawal") {
    if (blockers.some((blocker) => ["학생", "수업", "수업 명단", "퇴원일"].includes(blocker))) return "withdrawal_basic"
    if (blockers.some((blocker) => ["메이크에듀 퇴원처리", "수업료 처리", "교재비 처리"].includes(blocker))) return "withdrawal_checks"
  }

  if (type === "transfer") {
    if (blockers.some((blocker) => ["학생"].includes(blocker))) return "transfer_basic"
    if (blockers.some((blocker) => ["전 수업", "후 수업", "다른 수업", "전 수업 명단", "전 수업 종료일", "후 수업 시작일"].includes(blocker))) return "transfer_schedule"
    if (blockers.some((blocker) => ["메이크에듀 전반처리", "수업료 처리", "교재비 처리"].includes(blocker))) return "transfer_checks"
  }

  if (type === "word_retest") {
    if (blockers.some((blocker) => ["학생", "수업", "선생님", "본시험일", "수업 명단"].includes(blocker))) return "word_retest_basic"
    if (blockers.some((blocker) => ["교재", "시험범위", "커트라인", "출제 개수"].includes(blocker))) return "word_retest_scope"
    if (blockers.some((blocker) => ["점수"].includes(blocker))) return "word_retest_scores"
  }

  return null
}

function getRegistrationFormSectionForBlocker(blocker: string): RegistrationFormSectionKey {
  if (["학생", "학생명", "학부모 전화", "과목"].includes(blocker)) return "inquiry"
  if (["레벨테스트 예약일시", "레벨테스트 장소", "레벨테스트 완료일시", "레벨테스트 결과"].includes(blocker)) return "level_test"
  if (["상담 예약일시", "방문상담실", "상담 완료일시", "상담 책임자"].includes(blocker)) return "consultation"
  if (["수업", "교재", "수업시작일"].includes(blocker)) return "placement"
  return "admission"
}

function dateLabel(value: string) {
  const date = toDateKey(value)
  if (!date) return "-"

  const time = timeLabel(value)
  return time ? `${date} ${time}` : date
}

function getDueAtDisplayLabel(type: OpsTaskType) {
  return type === "general" ? "마감일" : "다음 처리일"
}

function getQuickAddDuePreviewLabel(value: string, todayKey: string, tomorrowKey: string) {
  const date = toDateKey(value)
  if (!date) return ""

  const dateText = date === todayKey ? "오늘" : date === tomorrowKey ? "내일" : date
  const time = timeLabel(value)
  return time ? `${dateText} ${time}` : dateText
}

function addTaskScheduleItem(items: TaskScheduleItem[], label: string, value?: string) {
  const date = toDateKey(value)
  if (!date || !value) return
  items.push({ label, value, date })
}

function getTaskScheduleItems(task: OpsTask) {
  const items: TaskScheduleItem[] = []

  if (task.type === "general") {
    addTaskScheduleItem(items, "시작", task.startAt)
    addTaskScheduleItem(items, "마감", task.dueAt)
  } else {
    addTaskScheduleItem(items, getDueAtDisplayLabel(task.type), task.dueAt)
  }

  if (task.type === "registration") {
    addTaskScheduleItem(items, "문의", task.registration?.inquiryAt)
    addTaskScheduleItem(items, "상담", task.registration?.consultationAt)
    addTaskScheduleItem(items, "레벨테스트", task.registration?.levelTestAt)
    addTaskScheduleItem(items, "수업 시작", task.registration?.classStartDate)
  }

  if (task.type === "withdrawal") {
    addTaskScheduleItem(items, "퇴원", task.withdrawal?.withdrawalDate)
  }

  if (task.type === "transfer") {
    addTaskScheduleItem(items, "전 수업 종료", task.transfer?.fromClassEndDate)
    addTaskScheduleItem(items, "새 수업 시작", task.transfer?.toClassStartDate)
  }

  if (task.type === "word_retest") {
    addTaskScheduleItem(items, "본시험", task.wordRetest?.testAt)
  }

  return items.sort((left, right) => (
    left.date.localeCompare(right.date) ||
    left.label.localeCompare(right.label, "ko")
  ))
}

function hasTaskSchedule(task: OpsTask) {
  return getTaskScheduleItems(task).length > 0
}

function getPrimaryTaskScheduleItem(task: OpsTask, todayKey: string) {
  const items = getTaskScheduleItems(task)
  if (items.length === 0) return null

  const todayItem = items.find((item) => item.date === todayKey)
  if (todayItem) return todayItem

  const futureItem = items.find((item) => item.date > todayKey)
  if (futureItem) return futureItem

  return [...items].reverse()[0] || null
}

function getOpsTaskEventTypeLabel(eventType: string) {
  switch (eventType) {
    case "auto_synced":
      return "자동 반영"
    case "auto_checked":
      return "자동 확인"
    case "manual_checked":
      return "수동 확인"
    case "manual_unchecked":
      return "확인 해제"
    case "status_changed":
      return "진행상태 변경"
    case "created":
      return "생성"
    case "updated":
      return "수정"
    case "revision_requested":
      return "수정 요청"
    default:
      return eventType || "이력"
  }
}

function getOpsTaskEventLabel(event: OpsTaskEvent) {
  const parts = [getOpsTaskEventTypeLabel(event.eventType), event.fieldName].filter(Boolean)
  const changedTo = event.afterValue ? `: ${event.afterValue}` : ""
  return `${parts.join(" · ")}${changedTo}`
}

function getAutoSyncedEvents(task: OpsTask) {
  return task.events.filter((event) => event.eventType === "auto_synced")
}

function getTaskOrganizationFixes(task: OpsTask) {
  if (isClosedOpsTask(task)) return []

  return [
    !task.assigneeId ? "담당 지정" : "",
    !hasTaskSchedule(task) ? "예정 지정" : "",
  ].filter(Boolean)
}

function timeLabel(value: string) {
  const raw = String(value || "").trim()
  if (!raw || !raw.includes("T")) return ""

  const localTimeMatch = raw.match(/^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2})(?!.*(?:Z|[+-]\d{2}:?\d{2}$))/)
  const localTime = localTimeMatch ? `${localTimeMatch[1]}:${localTimeMatch[2]}` : ""
  if (localTime) return localTime === "09:00" ? "" : localTime

  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return ""

  const parsedTime = `${String(parsed.getHours()).padStart(2, "0")}:${String(parsed.getMinutes()).padStart(2, "0")}`
  return parsedTime === "09:00" ? "" : parsedTime
}

function dateTimeInputValue(value?: string) {
  const raw = String(value || "")
  if (!raw) return ""
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw) && /(Z|[+-]\d{2}:?\d{2})$/i.test(raw)) {
    const date = new Date(raw)
    if (Number.isNaN(date.getTime())) return ""
    return dateTimeInputValueFromDate(date)
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw)) return raw.slice(0, 16)
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${raw}T09:00`
  return ""
}

function dateTimeInputValueFromDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  const hour = String(date.getHours()).padStart(2, "0")
  const minute = String(date.getMinutes()).padStart(2, "0")
  return `${year}-${month}-${day}T${hour}:${minute}`
}

function quickDateTimeInputValue(dayOffset: number) {
  const date = new Date()
  date.setDate(date.getDate() + dayOffset)
  date.setHours(9, 0, 0, 0)
  return quickDateTimeFromDate(date)
}

function quickDateTimeFromDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")

  return `${year}-${month}-${day}T09:00`
}

function dateOnlyLabel(value?: string) {
  return dateInputValue(value) || "-"
}

function quickDateTimeForNextWeekday(targetDay: number, forceNextWeek = false) {
  const date = new Date()
  const currentDay = date.getDay()
  let offset = (targetDay - currentDay + 7) % 7
  if (offset === 0 || forceNextWeek) offset += 7
  date.setDate(date.getDate() + offset)
  date.setHours(9, 0, 0, 0)
  return quickDateTimeFromDate(date)
}

function quickDateTimeForWeekdayInCalendarWeek(targetDay: number, weekOffset: number) {
  const date = new Date()
  const currentDay = date.getDay()
  const mondayOffset = currentDay === 0 ? -6 : 1 - currentDay
  const targetOffset = targetDay === 0 ? 6 : targetDay - 1
  date.setDate(date.getDate() + mondayOffset + (weekOffset * 7) + targetOffset)
  date.setHours(9, 0, 0, 0)
  return quickDateTimeFromDate(date)
}

function quickDateTimeForThisWeekday(targetDay: number) {
  return quickDateTimeForWeekdayInCalendarWeek(targetDay, 0)
}

function quickDateTimeForNextCalendarWeekday(targetDay: number) {
  return quickDateTimeForWeekdayInCalendarWeek(targetDay, 1)
}

function quickDateTimeForNextWeekStart() {
  return quickDateTimeForNextCalendarWeekday(1)
}

function quickDateTimeForMonthDay(month: number, day: number) {
  const now = new Date()
  const date = new Date(now.getFullYear(), month - 1, day)
  if (date.getMonth() !== month - 1 || date.getDate() !== day) return ""
  if (toDateKey(date) < toDateKey(now)) date.setFullYear(date.getFullYear() + 1)
  date.setHours(9, 0, 0, 0)
  return quickDateTimeFromDate(date)
}

type QuickAddMeridiem = "am" | "pm"
type QuickAddWeekdayModifier = "" | "this" | "next"

function applyQuickAddMeridiem(hour: number, meridiem?: QuickAddMeridiem) {
  if (meridiem === "pm" && hour < 12) return hour + 12
  if (meridiem === "am" && hour === 12) return 0
  return hour
}

function normalizeQuickAddTimeToken(token: string, meridiem?: QuickAddMeridiem) {
  const normalized = token.trim().toLowerCase().replace(/까지$/, "")
  let hourText = ""
  let minuteText = "00"
  let matchedMeridiem = meridiem

  const compactMeridiemTime = normalized.match(/^(\d{1,2})(?::([0-5]\d))?(am|pm)$/)
  if (compactMeridiemTime) {
    hourText = compactMeridiemTime[1]
    minuteText = compactMeridiemTime[2] || "00"
    matchedMeridiem = compactMeridiemTime[3] as QuickAddMeridiem
  }

  const exactTime = normalized.match(/^([01]?\d|2[0-3]):([0-5]\d)$/)
  if (!hourText && exactTime) {
    hourText = exactTime[1]
    minuteText = exactTime[2]
  }

  const koreanMeridiemTime = normalized.match(/^(오전|오후)(\d{1,2})(?::([0-5]\d))?$/)
  if (!hourText && koreanMeridiemTime) {
    matchedMeridiem = koreanMeridiemTime[1] === "오전" ? "am" : "pm"
    hourText = koreanMeridiemTime[2]
    minuteText = koreanMeridiemTime[3] || "00"
  }

  const koreanHourTime = normalized.match(/^(\d{1,2})시(?:(\d{1,2})분?)?$/)
  if (!hourText && koreanHourTime) {
    hourText = koreanHourTime[1]
    minuteText = koreanHourTime[2] || "00"
  }

  const meridiemSeparatedTime = matchedMeridiem ? normalized.match(/^(\d{1,2})(?::([0-5]\d))?$/) : null
  if (!hourText && meridiemSeparatedTime) {
    hourText = meridiemSeparatedTime[1]
    minuteText = meridiemSeparatedTime[2] || "00"
  }

  if (!hourText) return ""

  const hour = applyQuickAddMeridiem(Number(hourText), matchedMeridiem)
  const minute = Number(minuteText)
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return ""
  }

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
}

function withTime(dueAt: string, token: string) {
  const time = normalizeQuickAddTimeToken(token)
  if (!time) return dueAt
  const datePart = toDateKey(dueAt) || toDateKey(new Date())
  return `${datePart}T${time}`
}

function getCompactQuickAddTimeToken(meridiem: string | undefined, timeText: string | undefined) {
  const time = String(timeText || "").trim()
  if (!time) return ""
  if (meridiem === "오전" || meridiem === "오후") return `${meridiem}${time}`
  if (meridiem === "am" || meridiem === "pm") return `${time}${meridiem}`
  return time
}

function parseCompactQuickAddDateToken(
  token: string,
  {
    dueTodayValue,
    dueTomorrowValue,
  }: {
    dueTodayValue: string
    dueTomorrowValue: string
  },
) {
  const normalized = token.trim().toLowerCase()
  const relative = normalized.match(/^(오늘|내일|모레)(오전|오후|am|pm)?(\d{1,2}(?::[0-5]\d)?(?:시(?:\d{1,2}분?)?)?)?$/)
  if (relative) {
    const date = relative[1] === "오늘"
      ? dueTodayValue
      : relative[1] === "내일"
        ? dueTomorrowValue
        : quickDateTimeInputValue(2)
    const time = normalizeQuickAddTimeToken(getCompactQuickAddTimeToken(relative[2], relative[3]))
    return { date, time }
  }

  const monthDay = normalized.match(/^(\d{1,2})(?:\/|\.|월)(\d{1,2})(?:일)?(?:(오전|오후|am|pm)?(\d{1,2}(?::[0-5]\d)?(?:시(?:\d{1,2}분?)?)?))?$/)
  if (monthDay) {
    const date = quickDateTimeForMonthDay(Number(monthDay[1]), Number(monthDay[2]))
    if (!date) return null
    const time = normalizeQuickAddTimeToken(getCompactQuickAddTimeToken(monthDay[3], monthDay[4]))
    return { date, time }
  }

  return null
}

function dateInputValue(value?: string) {
  return toDateKey(value) || ""
}

function compareDateToToday(value?: string) {
  const date = toDateKey(value)
  if (!date) return "none"
  const today = toDateKey(new Date())
  if (date < today) return "overdue"
  if (date === today) return "today"
  return "upcoming"
}

function DueDateLabel({ value, status }: { value: string; status: OpsTaskStatus }) {
  const date = dateLabel(value)

  if (date === "-") {
    return <span className="text-muted-foreground">미정</span>
  }

  if (isClosedOpsTask({ status })) {
    return <span className="text-muted-foreground">{date}</span>
  }

  const dateState = compareDateToToday(value)

  if (dateState === "overdue") {
    return (
      <span className="inline-flex w-fit rounded-md bg-destructive/10 px-2 py-1 text-xs font-medium text-destructive">
        지연 · {date}
      </span>
    )
  }

  if (dateState === "today") {
    return (
      <span className="inline-flex w-fit rounded-md bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
        오늘 · {date}
      </span>
    )
  }

  return <span>{date}</span>
}

function TaskScheduleLabel({ task, todayKey }: { task: OpsTask; todayKey: string }) {
  const schedule = getPrimaryTaskScheduleItem(task, todayKey)

  if (!schedule) {
    return <span className="text-muted-foreground">미정</span>
  }

  if (task.type === "general" && schedule.label === "마감") {
    return <DueDateLabel value={schedule.value} status={task.status} />
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
        {schedule.label}
      </span>
      <DueDateLabel value={schedule.value} status={task.status} />
    </span>
  )
}

function TodoDateSummary({ task }: { task: OpsTask }) {
  const startLabel = dateLabel(task.startAt)

  return (
    <span className="inline-grid min-w-0 gap-1 text-xs leading-5 md:text-sm">
      <span className="min-w-0 truncate">
        <span className="mr-1 text-muted-foreground">시작</span>
        <span>{startLabel === "-" ? "미정" : startLabel}</span>
      </span>
      <span className="min-w-0">
        <span className="mr-1 text-muted-foreground">마감</span>
        <DueDateLabel value={task.dueAt} status={task.status} />
      </span>
    </span>
  )
}

function isOpenTask(task: OpsTask) {
  return task.status !== "done" && task.status !== "canceled"
}

function getWithdrawalViewTasks(tasks: OpsTask[], view: WithdrawalViewKey) {
  if (view === "applicant") {
    return tasks.filter((task) => task.status === "requested")
  }
  if (view === "operations") {
    return tasks.filter((task) => ["confirmed", "in_progress", "on_hold", "review_requested"].includes(task.status))
  }
  return tasks.filter((task) => isClosedOpsTask(task))
}

function isRegistrationViewKey(value: string): value is RegistrationViewKey {
  return REGISTRATION_VIEW_TABS.some((tab) => tab.key === value)
}

function isLegacyRegistrationTrackId(trackId: string) {
  return trackId.startsWith("legacy:")
}

function RegistrationProcessManualDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const stages = getRegistrationWorkflowStages()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="z-[80] max-h-[calc(100dvh-1rem)] overflow-y-auto sm:max-h-[90vh] sm:max-w-4xl" closeButtonLabel="닫기">
        <DialogHeader className="-mx-6 -mt-6 border-b px-6 pb-4 pt-4">
          <DialogTitle>등록 프로세스 &amp; 매뉴얼</DialogTitle>
          <DialogDescription>
            상단 탭 순서에 맞춘 단계별 처리, 입력, 자동화와 완료 기준입니다.
          </DialogDescription>
        </DialogHeader>
        <ol className="grid gap-3 md:grid-cols-2" aria-label="등록 프로세스 6단계">
          {stages.map((stage, index) => (
            <li key={stage.key} className="grid content-start gap-3 rounded-lg border bg-muted/15 p-4">
              <div className="flex items-start gap-2">
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">{index + 1}</span>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold">{stage.label}</h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">{stage.summary}</p>
                </div>
              </div>
              <ul className="grid gap-1.5 text-xs leading-5 text-muted-foreground">
                {stage.details.map((detail) => (
                  <li key={detail} className="pl-3 before:-ml-3 before:mr-1.5 before:text-primary before:content-['•']">{detail}</li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </DialogContent>
    </Dialog>
  )
}

function matchesSearch(task: OpsTask, query: string) {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return true
  return [
    task.title,
    task.studentName,
    task.className,
    task.textbookTitle,
    task.subject,
    task.campus,
    task.assigneeLabel,
    task.assigneeTeam,
    task.secondaryAssigneeLabel,
    task.requestedByLabel,
    task.requestedTeam,
    task.memo,
    task.registration?.pipelineStatus,
    task.registration?.parentPhone,
    task.registration?.studentPhone,
    task.registration?.counselor,
    task.withdrawal?.customerReason,
    task.withdrawal?.teacherOpinion,
    task.transfer?.transferReason,
    task.wordRetest?.teacherName,
    task.wordRetest?.unit,
    task.wordRetest?.requestNote,
  ].some((value) => String(value || "").toLowerCase().includes(normalized))
}

function sortCompletedTodoTasks(tasks: OpsTask[]) {
  return [...tasks].sort((left, right) => (
    String(right.completedAt || right.updatedAt || right.createdAt)
      .localeCompare(String(left.completedAt || left.updatedAt || left.createdAt))
  ))
}

function sortWorkspaceTasks(tasks: OpsTask[]) {
  return [...tasks].sort((left, right) => (
    String(right.updatedAt || right.createdAt)
      .localeCompare(String(left.updatedAt || left.createdAt))
  ))
}

type TodoFilterOption = {
  value: string
  label: string
  count: number
}

type TodoFilterOptions = {
  requestedBy: TodoFilterOption[]
  requestedTeam: TodoFilterOption[]
  assignee: TodoFilterOption[]
  assigneeTeam: TodoFilterOption[]
}

type WordRetestFilterOptions = {
  teacher: TodoFilterOption[]
  class: TodoFilterOption[]
}

function selectFilterValue(value: unknown) {
  const textValue = String(value || "").trim()
  return textValue || TODO_TEAM_FILTER_UNASSIGNED
}

function selectFilterLabel(value: string) {
  return value === TODO_TEAM_FILTER_UNASSIGNED ? "미지정" : value
}

function addTodoFilterOptionCount(options: Map<string, TodoFilterOption>, value: unknown, label?: string) {
  const optionValue = selectFilterValue(value)
  const optionLabel = String(label || "").trim() || selectFilterLabel(optionValue)
  const current = options.get(optionValue)
  options.set(optionValue, {
    value: optionValue,
    label: current?.label || optionLabel,
    count: (current?.count || 0) + 1,
  })
}

function sortedTodoFilterOptions(options: Map<string, TodoFilterOption>) {
  return Array.from(options.values()).sort((left, right) => (
    left.value === TODO_TEAM_FILTER_UNASSIGNED ? 1 :
      right.value === TODO_TEAM_FILTER_UNASSIGNED ? -1 :
        left.label.localeCompare(right.label, "ko")
  ))
}

function buildTodoFilterOptions(tasks: OpsTask[]): TodoFilterOptions {
  const requestedBy = new Map<string, TodoFilterOption>()
  const requestedTeam = new Map<string, TodoFilterOption>()
  const assignee = new Map<string, TodoFilterOption>()
  const assigneeTeam = new Map<string, TodoFilterOption>()

  tasks.forEach((task) => {
    addTodoFilterOptionCount(requestedBy, task.requestedBy || task.requestedByLabel, task.requestedByLabel || task.requestedBy)
    addTodoFilterOptionCount(requestedTeam, task.requestedTeam)
    addTodoFilterOptionCount(assignee, task.assigneeId || task.assigneeLabel, task.assigneeLabel || task.assigneeId)
    addTodoFilterOptionCount(assigneeTeam, task.assigneeTeam)
  })

  return {
    requestedBy: sortedTodoFilterOptions(requestedBy),
    requestedTeam: sortedTodoFilterOptions(requestedTeam),
    assignee: sortedTodoFilterOptions(assignee),
    assigneeTeam: sortedTodoFilterOptions(assigneeTeam),
  }
}

function addWordRetestFilterOptionCount(options: Map<string, TodoFilterOption>, value: unknown, label?: string) {
  const optionValue = selectFilterValue(value)
  const optionLabel = String(label || "").trim() || selectFilterLabel(optionValue)
  const current = options.get(optionValue)
  options.set(optionValue, {
    value: optionValue,
    label: current?.label || optionLabel,
    count: (current?.count || 0) + 1,
  })
}

function getWordRetestTeacherFilterValue(task: OpsTask) {
  return task.wordRetest?.teacherId || task.wordRetest?.teacherName || getWordRetestTeacherLabel(task)
}

function getWordRetestClassFilterValue(task: OpsTask) {
  return task.classId || task.wordRetest?.className || task.className
}

function buildWordRetestFilterOptions(tasks: OpsTask[]): WordRetestFilterOptions {
  const teacher = new Map<string, TodoFilterOption>()
  const classOptions = new Map<string, TodoFilterOption>()

  tasks.forEach((task) => {
    addWordRetestFilterOptionCount(teacher, getWordRetestTeacherFilterValue(task), getWordRetestTeacherLabel(task))
    addWordRetestFilterOptionCount(classOptions, getWordRetestClassFilterValue(task), getWordRetestClassLabel(task))
  })

  return {
    teacher: sortedTodoFilterOptions(teacher),
    class: sortedTodoFilterOptions(classOptions),
  }
}

function matchesWordRetestFilter(value: unknown, filter: WordRetestSelectFilterKey) {
  return matchesSelectFilter([value], filter)
}

function matchesSelectFilter(values: unknown[], filter: TodoSelectFilterKey) {
  if (filter === "all") return true
  const normalizedValues = values.map((value) => String(value || "").trim()).filter(Boolean)
  if (filter === TODO_TEAM_FILTER_UNASSIGNED) return normalizedValues.length === 0
  return normalizedValues.some((value) => selectFilterValue(value) === filter)
}

function matchesTodoTeamFilters(
  task: OpsTask,
  filters: {
    requestedByFilter: TodoSelectFilterKey
    requestedTeamFilter: TodoSelectFilterKey
    assigneeFilter: TodoSelectFilterKey
    assigneeTeamFilter: TodoSelectFilterKey
  },
) {
  if (!matchesSelectFilter([task.requestedBy, task.requestedByLabel], filters.requestedByFilter)) return false
  if (!matchesSelectFilter([task.requestedTeam], filters.requestedTeamFilter)) return false
  if (!matchesSelectFilter([task.assigneeId, task.assigneeLabel, task.secondaryAssigneeId, task.secondaryAssigneeLabel], filters.assigneeFilter)) return false
  if (!matchesSelectFilter([task.assigneeTeam], filters.assigneeTeamFilter)) return false
  return true
}

function getTodoActionLabel(task: OpsTask) {
  if (task.status === "done") return "완료됨"
  if (task.status === "canceled") return "취소됨"
  return getNextTaskStatusAction(task)?.label || "확인"
}

function normalizeQuickAddLookup(value: string) {
  return value.trim().replace(/\s+/g, "").toLowerCase()
}

function normalizeQuickAddMemoToken(value: string) {
  if ((value.startsWith("@") || value.startsWith("#")) && value.length > 1) return value.slice(1)
  return value
}

function normalizeQuickAddToken(value: string) {
  return value.trim().toLowerCase().replace(/^[.,。]+/, "").replace(/[.,。]+$/, "")
}

function cleanQuickAddToken(value: string) {
  return value.trim().replace(/^[.,。]+/, "").replace(/[.,。]+$/, "")
}

function getQuickAddMemoDirective(token: string) {
  const match = token.match(/^(메모|memo|note)[:：](.*)$/i)
  if (!match) return null
  return { value: match[2].trim() }
}

function getQuickAddAssigneeDirective(token: string) {
  const match = token.match(/^(담당|담당자|assignee|assign)[:：](.*)$/i)
  if (!match) return null
  return { value: match[2].trim() }
}

function getQuickAddDueDirective(token: string) {
  const match = token.match(/^(마감|마감일|예정|예정일|기한|일정|due)[:：](.*)$/i)
  if (!match) return null
  return { value: match[2].trim() }
}

function resolveQuickAddAssigneeId(
  value: string,
  profiles: OpsProfileOption[],
  currentUserId: string,
  currentUserLabel: string,
) {
  const assigneeName = value.trim()
  if (!assigneeName) return ""
  if ((assigneeName === "나" || assigneeName === "나에게" || assigneeName.toLowerCase() === "me") && currentUserId) {
    return currentUserId
  }
  const assigneeQuery = normalizeQuickAddLookup(assigneeName)
  if (currentUserId && normalizeQuickAddLookup(currentUserLabel).includes(assigneeQuery)) {
    return currentUserId
  }
  return profiles.find((profile) => (
    normalizeQuickAddLookup(profile.label).includes(assigneeQuery) ||
    normalizeQuickAddLookup(profile.email).includes(assigneeQuery) ||
    normalizeQuickAddLookup(profile.loginId).includes(assigneeQuery)
  ))?.id || ""
}

function isOperationConfirmationTask(
  task: OpsTask,
  indexes: OpsTaskOptionIndexes = EMPTY_OPS_TASK_OPTION_INDEXES,
  students: OpsStudentOption[] = EMPTY_STUDENT_OPTIONS,
  classes: OpsClassOption[] = EMPTY_CLASS_OPTIONS,
  textbooks: OpsTextbookOption[] = EMPTY_TEXTBOOK_OPTIONS,
  teachers: OpsTeacherOption[] = EMPTY_TEACHER_OPTIONS,
) {
  if (task.status === "requested") return true

  const nextRegistrationAction = getNextRegistrationPipelineAction(task)
  if (nextRegistrationAction) {
    return nextRegistrationAction.pipelineStatus.startsWith("7.") && getOperationCompletionBlockers({
      ...inputFromTaskForCompletionCheck(task),
      registration: {
        ...(task.registration || {}),
        pipelineStatus: nextRegistrationAction.pipelineStatus,
      },
    }, students, classes, textbooks, teachers, indexes).length > 0
  }

  const nextAction = getNextTaskStatusAction(task)
  return nextAction?.status === "done" && getOperationCompletionBlockers(inputFromTaskForCompletionCheck(task), students, classes, textbooks, teachers, indexes).length > 0
}

function buildOperationConfirmationMap(
  tasks: OpsTask[],
  indexes: OpsTaskOptionIndexes = EMPTY_OPS_TASK_OPTION_INDEXES,
  students: OpsStudentOption[] = EMPTY_STUDENT_OPTIONS,
  classes: OpsClassOption[] = EMPTY_CLASS_OPTIONS,
  textbooks: OpsTextbookOption[] = EMPTY_TEXTBOOK_OPTIONS,
  teachers: OpsTeacherOption[] = EMPTY_TEACHER_OPTIONS,
): OperationConfirmationMap {
  const confirmationByTaskId: OperationConfirmationMap = new Map()

  for (const task of tasks) {
    if (task.type === "general") continue
    confirmationByTaskId.set(
      task.id,
      isOperationConfirmationTask(task, indexes, students, classes, textbooks, teachers),
    )
  }

  return confirmationByTaskId
}

type TaskListboxOption = {
  value: string
  label: string
}

const WORD_RETEST_BRANCH_OPTIONS: readonly TaskListboxOption[] = [
  { value: "본관", label: "본관" },
  { value: "별관", label: "별관" },
]

const WITHDRAWAL_UNDISTRIBUTED_TEXTBOOK_HELP = [
  "관리팀으로부터 수령한 교재 중 위 학생에게 아직 배부되지 않은 교재가 있다면 입력하고, 퇴원신청서를 제출하는 즉시 해당 교재를 관리팀에게 반납해 주세요.",
  "",
  "교재비는 담당선생님들의 교재 수령 전에 학생들에게 미리 청구됩니다.",
  "[ 교재비 청구 ⇒ 담당선생님이 관리팀으로부터 교재 수령 ⇒ 담당선생님이 학생에게 교재 배부 ]",
  "",
  "배부되지 않은 교재에 대한 교재비 청구취소나 환불 처리는 교재 반납 이후에 진행됩니다.",
  "[ 교재비 청구 ⇒ 담당선생님이 관리팀으로부터 교재 수령 ⇒ 담당선생님이 관리팀에게 교재 반납 ⇒ 교재비 청구취소나 환불 ]",
].join("\n")

const TRANSFER_FROM_UNDISTRIBUTED_TEXTBOOK_HELP = [
  "관리팀으로부터 수령한 교재 중 위 학생에게 아직 배부되지 않은 교재가 있다면 입력하고, 전반신청서를 제출하는 즉시 해당 교재를 관리팀에게 반납해 주세요.",
  "",
  "교재비는 담당선생님들의 교재 수령 전에 학생들에게 미리 청구됩니다.",
  "[ 교재비 청구 ⇒ 담당선생님이 관리팀으로부터 교재 수령 ⇒ 담당선생님이 학생에게 교재 배부 ]",
  "",
  "배부되지 않은 교재에 대한 교재비 청구취소나 환불 처리는 교재 반납 이후에 진행됩니다.",
  "[ 교재비 청구 ⇒ 담당선생님이 관리팀으로부터 교재 수령 ⇒ 담당선생님이 관리팀에게 교재 반납 ⇒ 교재비 청구취소나 환불 ]",
].join("\n")

const TRANSFER_TO_UNDISTRIBUTED_TEXTBOOK_HELP = [
  "청구 예정 교재 중(전반 후 수업의 현재 진행 교재) 위 학생에게 배부하지 않을 교재가 있다면 입력해 주세요.",
  "[ 미배부 교재 내용 입력 및 제출 ⇒ 해당 교재는 교재비 청구하지 않음 ]",
].join("\n")

const WITHDRAWAL_DATE_HELP = "당월 출석부를 보고 학생이 마지막으로 수업 받은 날짜를 선택해 주세요. 퇴원요청이 있는 날로부터 거슬러 올라가서 최종 출석한 날이 퇴원일입니다. 퇴원일 이후의 결석에는 수강료가 청구되지 않습니다.\n\n수업 일정에서 마지막으로 출석한 날짜를 선택하면 퇴원회차와 수업진행률이 자동 계산됩니다."

function TaskListboxField({
  label,
  value,
  options,
  onChange,
  emptyClassName = "text-muted-foreground",
  placeholder,
  attention = false,
  required = false,
  disabled = false,
}: {
  label: ReactNode
  value: string
  options: readonly TaskListboxOption[]
  onChange: (value: string) => void
  emptyClassName?: string
  placeholder?: string
  attention?: boolean
  required?: boolean
  disabled?: boolean
}) {
  const fieldId = useId()
  const listId = useId()
  const requiredDescriptionId = useId()
  const [listboxOpen, setListboxOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listboxRef = useRef<HTMLDivElement>(null)
  const selectedOption = options.find((option) => option.value === value)
  const selectedOptionIndex = options.findIndex((option) => option.value === value)
  const selectedLabel = selectedOption?.label || placeholder || options[0]?.label || "선택"

  function handleListboxSelect(nextValue: string) {
    onChange(nextValue)
    setListboxOpen(false)
    window.requestAnimationFrame(() => triggerRef.current?.focus())
  }

  function focusListboxOption(index: number) {
    const optionElements = listboxRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]')
    if (!optionElements?.length) return
    const normalizedIndex = (index + optionElements.length) % optionElements.length
    optionElements[normalizedIndex]?.focus()
  }

  function openListboxAndFocus(index: number) {
    setListboxOpen(true)
    window.requestAnimationFrame(() => focusListboxOption(index))
  }

  function handleListboxTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return
    event.preventDefault()
    if (event.key === "ArrowUp" || event.key === "End") {
      openListboxAndFocus(options.length - 1)
      return
    }
    openListboxAndFocus(selectedOptionIndex >= 0 && event.key === "ArrowDown" ? selectedOptionIndex : 0)
  }

  function handleListboxOptionKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === "Escape") {
      event.preventDefault()
      setListboxOpen(false)
      window.requestAnimationFrame(() => triggerRef.current?.focus())
      return
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return
    event.preventDefault()
    if (event.key === "Home") focusListboxOption(0)
    else if (event.key === "End") focusListboxOption(options.length - 1)
    else focusListboxOption(index + (event.key === "ArrowDown" ? 1 : -1))
  }

  return (
    <div
      className="relative grid min-w-0 gap-1.5 text-sm font-medium"
      onBlur={(event) => {
        const nextTarget = event.relatedTarget
        if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return
        setListboxOpen(false)
      }}
    >
      <span id={fieldId}>{label}</span>
      {required ? <span id={requiredDescriptionId} className="sr-only">필수 입력</span> : null}
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-labelledby={fieldId}
        aria-describedby={required ? requiredDescriptionId : undefined}
        aria-required={required || undefined}
        aria-haspopup="listbox"
        aria-expanded={listboxOpen}
        aria-controls={listId}
        disabled={disabled}
        onClick={() => {
          if (disabled) return
          if (listboxOpen) {
            setListboxOpen(false)
            return
          }
          openListboxAndFocus(selectedOptionIndex >= 0 ? selectedOptionIndex : 0)
        }}
        onKeyDown={handleListboxTriggerKeyDown}
        className={[
          "flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-md border bg-background px-3 text-left text-sm shadow-xs outline-none transition focus-visible:ring-2 focus-visible:ring-ring/40",
          attention ? "border-primary/60 bg-primary/5 ring-2 ring-primary/15 hover:border-primary/70" : "",
          listboxOpen ? "border-ring ring-2 ring-ring/40" : "hover:border-foreground/30",
          disabled ? "cursor-not-allowed bg-muted/30 text-muted-foreground opacity-75 hover:border-border" : "",
        ].join(" ")}
      >
        <span className={value ? "truncate text-foreground" : `truncate ${emptyClassName}`}>{selectedLabel}</span>
        <ChevronRight className={["size-4 shrink-0 text-muted-foreground transition-transform", listboxOpen ? "rotate-90" : ""].join(" ")} />
      </button>
      {listboxOpen && (
        <div
          ref={listboxRef}
          id={listId}
          role="listbox"
          aria-labelledby={fieldId}
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-56 overflow-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-lg"
          style={TOUCH_SCROLL_AREA_STYLE}
          onTouchMove={stopTouchScrollPropagation}
        >
          {options.map((option, index) => {
            const selected = option.value === value
            return (
              <button
                key={option.value || "__empty_listbox_value__"}
                type="button"
                role="option"
                aria-selected={selected}
                tabIndex={selected || (!selectedOption && index === 0) ? 0 : -1}
                onClick={() => handleListboxSelect(option.value)}
                onKeyDown={(event) => handleListboxOptionKeyDown(event, index)}
                className={[
                  "flex w-full items-center justify-between gap-2 rounded px-2.5 py-2 text-left text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40",
                  selected ? "bg-primary/10 text-primary" : "hover:bg-muted",
                ].join(" ")}
              >
                <span className="truncate">{option.label}</span>
                {selected && <Check className="size-4 shrink-0" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function PrioritySelectField({
  value,
  onChange,
}: {
  value: OpsTaskPriority
  onChange: (value: OpsTaskPriority) => void
}) {
  return (
    <TaskListboxField
      label="우선순위"
      value={value}
      options={TODO_FORM_PRIORITY_OPTIONS.map((priority) => ({ value: priority.value, label: priority.label }))}
      onChange={(nextValue) => onChange(nextValue as OpsTaskPriority)}
      emptyClassName="text-foreground"
    />
  )
}

function TeamSelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: readonly string[]
  onChange: (value: string) => void
}) {
  return (
    <TaskListboxField
      label={label}
      value={value}
      options={[{ value: "", label: "미지정" }, ...options.map((team) => ({ value: team, label: team }))]}
      onChange={onChange}
    />
  )
}

type LinkedSelectOption = {
  id: string
  label: string
  meta?: string
  searchText?: string
}

function optionSearchText(option: LinkedSelectOption) {
  return `${option.label} ${option.meta || ""} ${option.searchText || ""}`.toLowerCase()
}

function optionExactSearchParts(option: LinkedSelectOption) {
  return [option.label, option.meta || "", ...(option.searchText || "").split(/\s+/)]
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
}

function SelectedValuePill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex max-w-[9rem] shrink-0 items-center rounded-full border bg-muted/45 px-2 py-0.5 text-[11px] font-medium leading-4 text-muted-foreground">
      <span className="truncate">{children}</span>
    </span>
  )
}

function LinkedSelectedValue({ label, pills = [] }: { label: string; pills?: Array<string | undefined> }) {
  const visiblePills = pills.map((pill) => String(pill || "").trim()).filter(Boolean)
  return (
    <span className="flex min-w-0 items-center gap-1.5 overflow-hidden">
      <span className="min-w-0 truncate">{label}</span>
      {visiblePills.map((pill) => (
        <SelectedValuePill key={pill}>{pill}</SelectedValuePill>
      ))}
    </span>
  )
}

function LinkedSelect({
  label,
  value,
  options,
  onChange,
  disabled = false,
  disabledPlaceholder,
  placeholder = "선택",
  attention = false,
  manualLabel,
  onManualSelect,
  renderSelected,
  renderOption,
  listHeader,
  allowDeselect = false,
  onDeselect,
}: {
  label: string
  value: string
  options: LinkedSelectOption[]
  onChange: (value: string) => void
  disabled?: boolean
  disabledPlaceholder?: string
  placeholder?: string
  attention?: boolean
  manualLabel?: string
  onManualSelect?: () => void
  renderSelected?: (option: LinkedSelectOption) => ReactNode
  renderOption?: (option: LinkedSelectOption) => ReactNode
  listHeader?: ReactNode
  allowDeselect?: boolean
  onDeselect?: () => void
}) {
  const fieldId = useId()
  const queryId = useId()
  const listId = useId()
  const [linkedQuery, setLinkedQuery] = useState("")
  const [isLinkedSearchOpen, setIsLinkedSearchOpen] = useState(false)
  const shouldShowLinkedSearch = !disabled && options.length > LINKED_SELECT_SEARCH_THRESHOLD
  const normalizedLinkedQuery = linkedQuery.trim().toLowerCase()
  const selectedOption = options.find((option) => option.id === value)
  const matchedOptions = useMemo(() => {
    if (!shouldShowLinkedSearch || !normalizedLinkedQuery) return []
    return options.filter((option) => optionSearchText(option).includes(normalizedLinkedQuery))
  }, [normalizedLinkedQuery, options, shouldShowLinkedSearch])
  const quickSelectOption = useMemo(() => {
    if (!shouldShowLinkedSearch || !normalizedLinkedQuery) return undefined
    const exactOption = matchedOptions.find((option) => optionExactSearchParts(option).includes(normalizedLinkedQuery))
    return exactOption || (matchedOptions.length === 1 ? matchedOptions[0] : undefined)
  }, [matchedOptions, normalizedLinkedQuery, shouldShowLinkedSearch])
  const searchOptions = useMemo(() => {
    const nextOptions = normalizedLinkedQuery ? matchedOptions : options
    const limitedOptions = nextOptions.slice(0, LINKED_SELECT_QUERY_OPTION_LIMIT)
    if (!selectedOption || limitedOptions.some((option) => option.id === selectedOption.id)) return limitedOptions
    return [selectedOption, ...limitedOptions]
  }, [matchedOptions, normalizedLinkedQuery, options, selectedOption])
  const selectedLabel = selectedOption
    ? selectedOption.meta ? `${selectedOption.label} · ${selectedOption.meta}` : selectedOption.label
    : `${label} 검색 후 선택`
  const emptySelectedLabel = disabled && disabledPlaceholder ? disabledPlaceholder : placeholder
  const emptySearchResultLabel = "검색 결과 없음"
  const isLinkedSelectOpen = !disabled && isLinkedSearchOpen
  const dependencyAttention = disabled && Boolean(disabledPlaceholder)

  function openLinkedSearch() {
    if (disabled) return
    setIsLinkedSearchOpen(true)
  }

  function toggleLinkedSearch() {
    if (disabled) return
    setIsLinkedSearchOpen((open) => !open)
  }

  function handleLinkedChange(nextValue: string) {
    if (nextValue === LINKED_SELECT_MANUAL_VALUE) {
      onManualSelect?.()
      onChange("")
      setLinkedQuery("")
      setIsLinkedSearchOpen(false)
      return
    }
    onChange(nextValue)
    setLinkedQuery("")
    setIsLinkedSearchOpen(false)
  }

  function handleLinkedQueryKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault()
      setLinkedQuery("")
      setIsLinkedSearchOpen(false)
      return
    }
    if (event.key !== "Enter" || !quickSelectOption) return
    event.preventDefault()
    handleLinkedChange(quickSelectOption.id)
  }

  function handleLinkedListWheel(event: WheelEvent<HTMLDivElement>) {
    const target = event.currentTarget
    if (target.scrollHeight <= target.clientHeight) return
    const previousScrollTop = target.scrollTop
    target.scrollTop += event.deltaY
    if (target.scrollTop === previousScrollTop) return
    event.preventDefault()
    event.stopPropagation()
  }

  const linkedSelectControl = shouldShowLinkedSearch && isLinkedSearchOpen ? (
    <span className="relative block min-w-0">
      <Input
        id={queryId}
        type="search"
        value={linkedQuery}
        placeholder={`${label} 검색`}
        aria-labelledby={fieldId}
        aria-controls={listId}
        autoComplete="off"
        autoFocus
        className="h-9 min-w-0 pr-9"
        onFocus={openLinkedSearch}
        onClick={openLinkedSearch}
        onChange={(event) => setLinkedQuery(event.target.value)}
        onKeyDown={handleLinkedQueryKeyDown}
      />
      <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
    </span>
  ) : (
    <button
      type="button"
      aria-labelledby={fieldId}
      aria-haspopup="listbox"
      aria-expanded={isLinkedSelectOpen}
      aria-controls={listId}
      disabled={disabled}
      onClick={shouldShowLinkedSearch ? openLinkedSearch : toggleLinkedSearch}
      className={[
        "flex min-h-9 w-full min-w-0 items-center justify-between gap-2 rounded-md border bg-background px-3 py-1.5 text-left text-sm shadow-xs outline-none transition hover:border-foreground/30 focus:border-ring focus:ring-ring/40 focus:ring-2",
        attention ? "border-primary/60 bg-primary/5 ring-2 ring-primary/15 hover:border-primary/70" : "",
        dependencyAttention ? "border-amber-300 bg-amber-50 text-amber-950 opacity-100 hover:border-amber-400 dark:border-amber-800/70 dark:bg-amber-950/30 dark:text-amber-100" : "",
        isLinkedSelectOpen ? "border-ring ring-2 ring-ring/40" : "",
        disabled && !dependencyAttention ? "cursor-not-allowed bg-muted/30 text-muted-foreground opacity-75 hover:border-border" : "",
      ].join(" ")}
    >
      {selectedOption ? (
        <span className="min-w-0 flex-1 overflow-hidden text-foreground">
          {renderSelected ? renderSelected(selectedOption) : <span className="block truncate">{selectedLabel}</span>}
        </span>
      ) : (
        <span className={["min-w-0 flex-1 truncate", dependencyAttention ? "text-amber-900 dark:text-amber-100" : "text-muted-foreground"].join(" ")}>{emptySelectedLabel}</span>
      )}
      {shouldShowLinkedSearch ? (
        <Search className="size-4 shrink-0 text-muted-foreground" />
      ) : (
        <ChevronRight className={["size-4 shrink-0 text-muted-foreground transition-transform", isLinkedSelectOpen ? "rotate-90" : ""].join(" ")} />
      )}
    </button>
  )

  return (
    <Popover open={isLinkedSelectOpen} onOpenChange={(open) => setIsLinkedSearchOpen(disabled ? false : open)}>
      <div className="relative grid min-w-0 gap-1.5 text-sm font-medium">
        <label id={fieldId}>{label}</label>
        <PopoverAnchor asChild>{linkedSelectControl}</PopoverAnchor>
      </div>
      {isLinkedSelectOpen && (
        <PopoverContent
          id={listId}
          role="listbox"
          aria-labelledby={fieldId}
          align="start"
          side="bottom"
          sideOffset={4}
          collisionPadding={12}
          disablePortal
          onOpenAutoFocus={(event) => event.preventDefault()}
          className="z-[120] w-[var(--radix-popper-anchor-width)] min-w-72 max-w-[calc(100vw-1rem)] overflow-hidden p-0"
        >
          {listHeader && (
            <div className="grid gap-2 border-b bg-background p-2">
              {listHeader}
            </div>
          )}
          <div
            className="max-h-72 overflow-y-auto overscroll-contain p-1"
            style={TOUCH_SCROLL_AREA_STYLE}
            onWheel={handleLinkedListWheel}
            onTouchMove={stopTouchScrollPropagation}
          >
            {allowDeselect && (
              <button
                type="button"
                role="option"
                aria-selected={!value}
                onClick={() => {
                  onDeselect?.()
                  if (!onDeselect) onChange("")
                  setLinkedQuery("")
                  setIsLinkedSearchOpen(false)
                }}
                className="flex w-full items-center rounded px-2.5 py-2 text-left text-sm hover:bg-muted"
              >
                선택 안 함 · 이미 보유
              </button>
            )}
            {onManualSelect && (
              <button
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => handleLinkedChange(LINKED_SELECT_MANUAL_VALUE)}
                className="flex w-full items-center rounded px-2.5 py-2 text-left text-sm hover:bg-muted"
              >
                {manualLabel || "직접 입력"}
              </button>
            )}
            {searchOptions.map((option) => {
              const selected = option.id === value
              return (
                <button
                  key={option.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => handleLinkedChange(option.id)}
                  className={[
                    "flex w-full items-center justify-between gap-2 rounded px-2.5 py-2 text-left text-sm outline-none transition-colors",
                    selected ? "bg-primary/10 text-primary" : "hover:bg-muted",
                  ].join(" ")}
                >
                  <span className="min-w-0 overflow-hidden">
                    {renderOption ? renderOption(option) : <span className="block truncate">{option.meta ? `${option.label} · ${option.meta}` : option.label}</span>}
                  </span>
                  {selected && <Check className="size-4 shrink-0" />}
                </button>
              )
            })}
            {searchOptions.length === 0 && (
              <div className="px-2.5 py-3 text-sm text-muted-foreground" role="status">
                {emptySearchResultLabel}
              </div>
            )}
          </div>
        </PopoverContent>
      )}
    </Popover>
  )
}

function LinkedMultiSelect({
  label,
  values,
  options,
  onChange,
  onManualSelect,
  manualLabel,
  renderSelected,
  renderOption,
}: {
  label: string
  values: string[]
  options: LinkedSelectOption[]
  onChange: (values: string[]) => void
  onManualSelect?: () => void
  manualLabel?: string
  renderSelected?: (option: LinkedSelectOption) => ReactNode
  renderOption?: (option: LinkedSelectOption) => ReactNode
}) {
  const fieldId = useId()
  const queryId = useId()
  const listId = useId()
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState(false)
  const valueSet = useMemo(() => new Set(values), [values])
  const selectedOptions = values.map((value) => options.find((option) => option.id === value)).filter((option): option is LinkedSelectOption => Boolean(option))
  const normalizedQuery = query.trim().toLowerCase()
  const searchOptions = useMemo(() => {
    const nextOptions = normalizedQuery ? options.filter((option) => optionSearchText(option).includes(normalizedQuery)) : options
    return nextOptions.slice(0, LINKED_SELECT_QUERY_OPTION_LIMIT)
  }, [normalizedQuery, options])
  const selectedLabel = selectedOptions.length === 0
    ? "선택"
    : selectedOptions.length === 1
      ? selectedOptions[0]?.label || "1명 선택"
      : selectedOptions.map((option) => option.label).join(", ")

  function toggleValue(value: string) {
    const nextValues = valueSet.has(value)
      ? values.filter((currentValue) => currentValue !== value)
      : [...values, value]
    onChange(nextValues)
  }

  function handleManualSelect() {
    onManualSelect?.()
    onChange([])
    setQuery("")
    setOpen(false)
  }

  function handleWheel(event: WheelEvent<HTMLDivElement>) {
    const target = event.currentTarget
    if (target.scrollHeight <= target.clientHeight) return
    const previousScrollTop = target.scrollTop
    target.scrollTop += event.deltaY
    if (target.scrollTop === previousScrollTop) return
    event.preventDefault()
    event.stopPropagation()
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className="relative grid min-w-0 gap-1.5 text-sm font-medium">
        <label id={fieldId}>{label}</label>
        <PopoverAnchor asChild>
          <button
            type="button"
            aria-labelledby={fieldId}
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-controls={listId}
            onClick={() => setOpen((current) => !current)}
            className={[
              "flex min-h-9 w-full min-w-0 items-center justify-between gap-2 rounded-md border bg-background px-3 py-1.5 text-left text-sm shadow-xs outline-none transition hover:border-foreground/30 focus:border-ring focus:ring-2 focus:ring-ring/40",
              open ? "border-ring ring-2 ring-ring/40" : "",
            ].join(" ")}
          >
            <span className={selectedOptions.length > 0 ? "min-w-0 flex-1 overflow-hidden text-foreground" : "min-w-0 flex-1 truncate text-muted-foreground"}>
              {selectedOptions.length === 1 && renderSelected ? renderSelected(selectedOptions[0]!) : <span className="block truncate">{selectedLabel}</span>}
            </span>
            <Search className="size-4 shrink-0 text-muted-foreground" />
          </button>
        </PopoverAnchor>
      </div>
      {open && (
        <PopoverContent
          id={listId}
          role="listbox"
          aria-labelledby={fieldId}
          align="start"
          side="bottom"
          sideOffset={4}
          collisionPadding={12}
          disablePortal
          onOpenAutoFocus={(event) => event.preventDefault()}
          className="z-[120] w-[var(--radix-popper-anchor-width)] min-w-72 max-w-[calc(100vw-1rem)] overflow-hidden p-0"
        >
          <div className="border-b bg-background p-2">
            <span className="relative block min-w-0">
              <Input
                id={queryId}
                type="search"
                value={query}
                placeholder={`${label} 검색`}
                aria-labelledby={fieldId}
                aria-controls={listId}
                autoComplete="off"
                autoFocus
                className="h-9 min-w-0 pr-9"
                onChange={(event) => setQuery(event.target.value)}
              />
              <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            </span>
          </div>
          <div
            className="max-h-72 overflow-y-auto overscroll-contain p-1"
            style={TOUCH_SCROLL_AREA_STYLE}
            onWheel={handleWheel}
            onTouchMove={stopTouchScrollPropagation}
          >
            {onManualSelect && (
              <button
                type="button"
                role="option"
                aria-selected={false}
                onClick={handleManualSelect}
                className="flex w-full items-center rounded px-2.5 py-2 text-left text-sm hover:bg-muted"
              >
                {manualLabel || "직접 입력"}
              </button>
            )}
            {searchOptions.map((option) => {
              const selected = valueSet.has(option.id)
              return (
                <button
                  key={option.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => toggleValue(option.id)}
                  className={[
                    "flex w-full items-center justify-between gap-2 rounded px-2.5 py-2 text-left text-sm outline-none transition-colors",
                    selected ? "bg-primary/10 text-primary" : "hover:bg-muted",
                  ].join(" ")}
                >
                  <span className="min-w-0 overflow-hidden">
                    {renderOption ? renderOption(option) : <span className="block truncate">{option.meta ? `${option.label} · ${option.meta}` : option.label}</span>}
                  </span>
                  {selected && <Check className="size-4 shrink-0" />}
                </button>
              )
            })}
            {searchOptions.length === 0 && (
              <div className="px-2.5 py-3 text-sm text-muted-foreground" role="status">
                검색 결과 없음
              </div>
            )}
          </div>
        </PopoverContent>
      )}
    </Popover>
  )
}

function ProfileSelect({
  label = "담당자",
  value,
  profiles,
  onChange,
}: {
  label?: string
  value: string
  profiles: OpsProfileOption[]
  onChange: (value: string) => void
}) {
  const options = useMemo<LinkedSelectOption[]>(() => (
    profiles.map((profile) => ({
      id: profile.id,
      label: profile.label,
      searchText: [profile.email, profile.loginId, profile.role].filter(Boolean).join(" "),
    }))
  ), [profiles])

  return (
    <LinkedSelect
      label={label}
      value={value}
      options={options}
      onChange={onChange}
    />
  )
}

function TextField({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  inputMode,
  autoFocus,
  required = false,
  error,
}: {
  label: ReactNode
  value: string
  onChange: (value: string) => void
  type?: string
  placeholder?: string
  inputMode?: "none" | "text" | "tel" | "url" | "email" | "numeric" | "decimal" | "search"
  autoFocus?: boolean
  required?: boolean
  error?: string
}) {
  const fieldId = useId()
  const errorId = useId()
  const handleInputChange = (value: string) => onChange(value)

  return (
    <label htmlFor={fieldId} className="grid min-w-0 gap-1.5 text-sm font-medium">
      <span>{label}</span>
      <Input
        id={fieldId}
        type={type}
        value={value}
        className="min-w-0"
        placeholder={placeholder}
        inputMode={inputMode}
        autoFocus={autoFocus}
        aria-required={required || undefined}
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => handleInputChange(event.target.value)}
      />
      {error && (
        <span id={errorId} className="text-xs font-normal text-destructive" aria-live="polite">
          {error}
        </span>
      )}
    </label>
  )
}

function TextareaField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
}) {
  const fieldId = useId()
  const handleInputChange = (value: string) => onChange(value)

  return (
    <label htmlFor={fieldId} className="grid min-w-0 gap-1.5 text-sm font-medium">
      <span>{label}</span>
      <Textarea
        id={fieldId}
        value={value}
        className="min-h-20 min-w-0 resize-y"
        placeholder={placeholder}
        onChange={(event) => handleInputChange(event.target.value)}
        onInput={(event) => handleInputChange(event.currentTarget.value)}
      />
    </label>
  )
}

function FieldHelpLabel({ label, help }: { label: string; help: ReactNode }) {
  const [helpOpen, setHelpOpen] = useState(false)

  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span>{label}</span>
      <Popover open={helpOpen} onOpenChange={setHelpOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`${label} 도움말`}
            aria-expanded={helpOpen}
            className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
            onClick={(event) => {
              event.stopPropagation()
            }}
          >
            <CircleHelp className="size-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          role="dialog"
          aria-label={`${label} 도움말`}
          side="top"
          align="start"
          className="z-[160] w-[min(34rem,calc(100vw-2rem))] whitespace-pre-line p-3 text-left text-xs leading-relaxed"
        >
          {help}
        </PopoverContent>
      </Popover>
    </span>
  )
}

function UndistributedTextbookListField({
  label,
  help,
  value,
  onChange,
}: {
  label: string
  help: ReactNode
  value: string
  onChange: (value: string) => void
}) {
  const labelId = useId()
  const rawItems = useMemo(() => value.split("\n").filter((item) => item.trim()), [value])
  const [extraRowCount, setExtraRowCount] = useState(0)
  const visibleRowCount = Math.max(1, rawItems.length) + extraRowCount
  const items = Array.from({ length: visibleRowCount }, (_, index) => rawItems[index] || "")

  function emitItems(nextItems: string[]) {
    onChange(nextItems.map((item) => item.trim()).filter(Boolean).join("\n"))
  }

  function updateItem(index: number, nextValue: string) {
    const nextItems = [...items]
    nextItems[index] = nextValue
    if (index >= rawItems.length && nextValue.trim()) {
      setExtraRowCount((count) => Math.max(0, count - 1))
    }
    emitItems(nextItems)
  }

  function addItem() {
    setExtraRowCount((count) => count + 1)
  }

  function removeItem(index: number) {
    const nextItems = items.filter((_, itemIndex) => itemIndex !== index)
    if (index >= rawItems.length) {
      setExtraRowCount((count) => Math.max(0, count - 1))
    }
    emitItems(nextItems)
  }

  return (
    <div className="grid min-w-0 gap-1.5 text-sm font-medium">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span id={labelId}>
          <FieldHelpLabel label={label} help={help} />
        </span>
        <button
          type="button"
          aria-label={`${label} 항목 추가`}
          onClick={addItem}
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border px-2 text-xs font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          <Plus className="size-3.5" />
          <span>교재 추가</span>
        </button>
      </div>
      <div className="grid gap-2">
        {items.map((item, index) => (
          <div key={index} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
            <Input
              type="text"
              aria-labelledby={labelId}
              aria-label={`${label} ${index + 1}`}
              value={item}
              className="min-w-0"
              placeholder={`${index + 1}번 교재`}
              onChange={(event) => updateItem(index, event.target.value)}
              onInput={(event) => updateItem(index, event.currentTarget.value)}
            />
            <button
              type="button"
              aria-label={`${index + 1}번 미배부 교재 삭제`}
              disabled={visibleRowCount <= 1}
              onClick={() => removeItem(index)}
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-md border text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <X className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

function WordRetestAttemptScoreField({
  label,
  value,
  totalQuestionCount,
  cutoffQuestionCount,
  onChange,
}: {
  label: string
  value: string
  totalQuestionCount?: string
  cutoffQuestionCount?: string
  onChange: (value: string) => void
}) {
  const fieldId = useId()
  const feedback = getWordRetestAttemptScoreFeedback(value, totalQuestionCount, cutoffQuestionCount)
  const handleInputChange = (nextValue: string) => onChange(nextValue)

  return (
    <label htmlFor={fieldId} className="grid min-w-0 gap-1.5 text-sm font-medium">
      <span>{label}</span>
      <span className="grid min-h-9 min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
        <Input
          id={fieldId}
          type="text"
          value={value}
          className="min-w-0"
          inputMode="numeric"
          onChange={(event) => handleInputChange(event.target.value)}
          onInput={(event) => handleInputChange(event.currentTarget.value)}
        />
        <span className="flex h-9 min-w-[8.5rem] items-center justify-start gap-1">
          {feedback.map((item) => {
            const toneClass = item.tone === "pass"
              ? "border-primary/25 bg-primary/10 text-primary"
              : item.tone === "retry"
                ? "border-amber-200 bg-amber-50 text-amber-700"
                : "border-muted-foreground/20 bg-muted/40 text-muted-foreground"

            return (
              <span key={item.label} className={["inline-flex h-5 items-center rounded-full border px-2 text-xs font-semibold", toneClass].join(" ")}>
                {item.label}
              </span>
            )
          })}
        </span>
      </span>
    </label>
  )
}

const CALENDAR_WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"]

function getCalendarMonthDate(value: string) {
  const dateKey = toDateKey(value) || toDateKey(new Date())
  const [year, month] = dateKey.split("-").map(Number)
  return new Date(year, month - 1, 1)
}

function addCalendarMonths(value: Date, amount: number) {
  return new Date(value.getFullYear(), value.getMonth() + amount, 1)
}

function getCalendarMonthLabel(value: Date) {
  return `${value.getFullYear()}년 ${value.getMonth() + 1}월`
}

function buildCalendarDateCells(calendarMonth: Date) {
  const todayKey = toDateKey(new Date())
  const monthStart = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1)
  const gridStart = new Date(monthStart)
  gridStart.setDate(monthStart.getDate() - monthStart.getDay())

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart)
    date.setDate(gridStart.getDate() + index)
    const dateKey = toDateKey(date)
    return {
      dateKey,
      dayLabel: String(date.getDate()),
      isCurrentMonth: date.getMonth() === calendarMonth.getMonth(),
      isToday: dateKey === todayKey,
    }
  })
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function stringValue(value: unknown) {
  return String(value || "").trim()
}

function getSchedulePlanSessions(classItem?: OpsClassOption) {
  const plan = classItem?.schedulePlan || null
  if (!plan) return []
  if (Array.isArray(plan.sessions)) return plan.sessions
  if (Array.isArray(plan.session_list)) return plan.session_list
  return []
}

function getWordRetestClassScheduleItems(classItem?: OpsClassOption): WordRetestClassScheduleItem[] {
  return getSelectableRegistrationScheduleSessions(classItem?.schedulePlan).map((session) => ({
    dateKey: session.dateKey,
    label: session.sessionLabel,
    state: session.state,
  }))
}

const WITHDRAWAL_WEEKDAY_ENTRIES: Array<[string, number]> = [
  ["일", 0],
  ["월", 1],
  ["화", 2],
  ["수", 3],
  ["목", 4],
  ["금", 5],
  ["토", 6],
]

function getWithdrawalScheduleWeekdayIndexes(schedule: string) {
  const normalized = schedule.replace(/\s+/g, "")
  return WITHDRAWAL_WEEKDAY_ENTRIES
    .filter(([label]) => normalized.includes(label))
    .map(([, weekday]) => weekday)
}

function getWithdrawalScheduleStateLabel(scheduleState: string) {
  const state = stringValue(scheduleState)
  if (state === "makeup") return "보강"
  if (["exception", "canceled", "cancelled"].includes(state)) return "휴강"
  if (state === "tbd") return "미정"
  return "정상"
}

function isWithdrawalScheduleSelectable(item?: { state?: string }) {
  const state = stringValue(item?.state) || "active"
  return !["exception", "tbd", "canceled", "cancelled"].includes(state)
}

function getWithdrawalNumberValue(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function getWithdrawalTimeMinutes(value: unknown) {
  const match = stringValue(value).match(/^(\d{1,2})(?::(\d{2}))?$/)
  if (!match) return 0
  const hour = Number(match[1])
  const minute = Number(match[2] || 0)
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return 0
  return hour * 60 + minute
}

function getWithdrawalDateWeekday(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number)
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null
  return new Date(year, month - 1, day).getDay()
}

function formatWithdrawalLessonHours(value: number) {
  const rounded = Math.round(Math.max(0, value) * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

function getWithdrawalCalendarCellDateLabel(dateKey: string) {
  const [, month, day] = dateKey.split("-").map(Number)
  return Number.isFinite(month) && Number.isFinite(day) ? `${month}/${day}` : dateKey
}

function getWithdrawalCalendarSessionLabel(dateKey: string, label: string) {
  const [, month] = dateKey.split("-").map(Number)
  return Number.isFinite(month) ? `${month}월 ${label}` : label
}

function getWithdrawalCalendarMonthLabel(dateKey: string) {
  const [, month] = dateKey.split("-").map(Number)
  return Number.isFinite(month) ? `${month}월` : ""
}

function getWithdrawalScheduleMonthKey(dateKey: string) {
  return dateKey.slice(0, 7)
}

function getWithdrawalScheduleDisplayMonthLabel(item?: WithdrawalClassScheduleItem) {
  const billingLabel = stringValue(item?.billingLabel)
  return billingLabel || (item ? getWithdrawalCalendarMonthLabel(item.dateKey) : "")
}

function getWithdrawalScheduleBillingMonthKey(item?: WithdrawalClassScheduleItem) {
  if (!item) return ""
  const billingLabel = getWithdrawalScheduleDisplayMonthLabel(item)
  return billingLabel ? `billing:${billingLabel}` : getWithdrawalScheduleMonthKey(item.dateKey)
}

function getWithdrawalScheduleBillingMonthNumber(item?: WithdrawalClassScheduleItem) {
  const billingLabel = getWithdrawalScheduleDisplayMonthLabel(item)
  const labelMonth = billingLabel.match(/(\d{1,2})\s*월/)
  if (labelMonth) {
    const month = Number(labelMonth[1])
    if (Number.isFinite(month) && month >= 1 && month <= 12) return month
  }

  const [, month] = String(item?.dateKey || "").split("-").map(Number)
  return Number.isFinite(month) ? month : 1
}

function getWithdrawalScheduleSessionLabel(item?: WithdrawalClassScheduleItem) {
  if (!item || !isWithdrawalScheduleSelectable(item)) return ""
  const displayMonthLabel = getWithdrawalScheduleDisplayMonthLabel(item)
  return displayMonthLabel ? `${displayMonthLabel} ${item.label}` : getWithdrawalCalendarSessionLabel(item.dateKey, item.label)
}

function getWithdrawalCalendarDisplaySessionLabel(
  item: WithdrawalClassScheduleItem | undefined,
  options: { includeMonth?: boolean } = {},
) {
  if (!item || !isWithdrawalScheduleSelectable(item)) return ""
  return options.includeMonth ? getWithdrawalScheduleSessionLabel(item) : item.label
}

function getWithdrawalCalendarCellTitle(dateKey: string, item: WithdrawalClassScheduleItem | undefined) {
  if (!item) return `${dateKey} 수업 없음`
  const sessionLabel = getWithdrawalCalendarDisplaySessionLabel(item, { includeMonth: true })
  return [dateKey, sessionLabel, item.stateLabel].filter(Boolean).join(" ")
}

const WITHDRAWAL_CALENDAR_MONTH_TONE_CLASSES = [
  {
    selected: "bg-sky-600 text-white shadow-xs dark:bg-sky-500 dark:text-sky-950",
    idle: "border border-sky-200 bg-sky-50 text-sky-950 hover:bg-sky-100 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-100",
  },
  {
    selected: "bg-emerald-600 text-white shadow-xs dark:bg-emerald-500 dark:text-emerald-950",
    idle: "border border-emerald-200 bg-emerald-50 text-emerald-950 hover:bg-emerald-100 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-100",
  },
  {
    selected: "bg-amber-500 text-white shadow-xs dark:bg-amber-400 dark:text-amber-950",
    idle: "border border-amber-200 bg-amber-50 text-amber-950 hover:bg-amber-100 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100",
  },
  {
    selected: "bg-rose-600 text-white shadow-xs dark:bg-rose-500 dark:text-rose-950",
    idle: "border border-rose-200 bg-rose-50 text-rose-950 hover:bg-rose-100 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-100",
  },
] as const

function getWithdrawalCalendarCellToneClass(dateKey: string, selected: boolean, selectable: boolean, item?: WithdrawalClassScheduleItem) {
  if (!selectable && !selected) return ""
  const month = getWithdrawalScheduleBillingMonthNumber(item || ({ dateKey } as WithdrawalClassScheduleItem))
  const toneIndex = Number.isFinite(month) ? (month - 1) % 4 : 0
  const tone = WITHDRAWAL_CALENDAR_MONTH_TONE_CLASSES[toneIndex] || WITHDRAWAL_CALENDAR_MONTH_TONE_CLASSES[0]
  return selected ? tone.selected : tone.idle
}

function parseWithdrawalScheduleHoursByWeekday(schedule: string) {
  const hoursByWeekday = new Map<number, number>()
  const pattern = /([월화수목금토일]+)\s*(\d{1,2})(?::(\d{2}))?\s*[~\-–—]\s*(\d{1,2})(?::(\d{2}))?/g
  let match = pattern.exec(schedule)

  while (match) {
    const [, days, startHour, startMinute, endHour, endMinute] = match
    const startMinutes = getWithdrawalTimeMinutes(`${startHour}:${startMinute || "00"}`)
    const endMinutes = getWithdrawalTimeMinutes(`${endHour}:${endMinute || "00"}`)
    const durationHours = endMinutes > startMinutes ? (endMinutes - startMinutes) / 60 : 0

    if (durationHours > 0) {
      for (const dayLabel of days) {
        const weekday = WITHDRAWAL_WEEKDAY_ENTRIES.find(([label]) => label === dayLabel)?.[1]
        if (weekday == null) continue
        hoursByWeekday.set(weekday, (hoursByWeekday.get(weekday) || 0) + durationHours)
      }
    }

    match = pattern.exec(schedule)
  }

  return hoursByWeekday
}

function getWithdrawalSessionDateKey(session: Record<string, unknown>, fallbackDateKey = "") {
  return toDateKey(
    stringValue(session.date || session.session_date || session.dateValue || session.date_value || fallbackDateKey),
  )
}

function getWithdrawalSessionBillingLabel(session: Record<string, unknown>) {
  return stringValue(session.billingLabel || session.billing_label || session.periodLabel || session.period_label)
}

function getWithdrawalSessionBillingColor(session: Record<string, unknown>) {
  return stringValue(session.billingColor || session.billing_color || session.periodColor || session.period_color)
}

function getWithdrawalSessionHours(
  session: Record<string, unknown> | null,
  classItem?: OpsClassOption,
  fallbackDateKey = "",
) {
  const explicitHours = getWithdrawalNumberValue(
    session?.lessonHours ||
      session?.lesson_hours ||
      session?.durationHours ||
      session?.duration_hours ||
      session?.sessionHours ||
      session?.session_hours ||
      session?.hours,
  )
  if (explicitHours > 0) return explicitHours

  const explicitMinutes = getWithdrawalNumberValue(
    session?.lessonMinutes ||
      session?.lesson_minutes ||
      session?.durationMinutes ||
      session?.duration_minutes ||
      session?.minutes,
  )
  if (explicitMinutes > 0) return explicitMinutes / 60

  const startMinutes = getWithdrawalTimeMinutes(session?.startTime || session?.start_time)
  const endMinutes = getWithdrawalTimeMinutes(session?.endTime || session?.end_time)
  if (endMinutes > startMinutes) return (endMinutes - startMinutes) / 60

  const hoursByWeekday = parseWithdrawalScheduleHoursByWeekday(classItem?.schedule || "")
  const dateKey = session ? getWithdrawalSessionDateKey(session, fallbackDateKey) : toDateKey(fallbackDateKey)
  const weekday = dateKey ? getWithdrawalDateWeekday(dateKey) : null
  if (weekday != null && (hoursByWeekday.get(weekday) || 0) > 0) {
    return hoursByWeekday.get(weekday) || 0
  }

  return [...hoursByWeekday.values()].find((value) => value > 0) || 1
}

function getWithdrawalSelectedWeekdays(classItem?: OpsClassOption) {
  const plan = classItem?.schedulePlan || null
  const planDays = Array.isArray(plan?.selectedDays)
    ? plan.selectedDays
    : Array.isArray(plan?.selected_days)
      ? plan.selected_days
      : []

  const normalizedPlanDays = planDays
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value >= 0 && value <= 6)

  return normalizedPlanDays.length > 0
    ? normalizedPlanDays
    : getWithdrawalScheduleWeekdayIndexes(classItem?.schedule || "")
}

function getWithdrawalWeeklyLessonHours(items: WithdrawalClassScheduleItem[], classItem?: OpsClassOption) {
  const hoursByWeekday = parseWithdrawalScheduleHoursByWeekday(classItem?.schedule || "")
  const weekdays = new Set<number>(getWithdrawalSelectedWeekdays(classItem))
  if (weekdays.size === 0) {
    items.forEach((item) => {
      if (!isWithdrawalScheduleSelectable(item)) return
      const weekday = getWithdrawalDateWeekday(item.dateKey)
      if (weekday != null) weekdays.add(weekday)
    })
  }

  let weeklyLessonHours = 0
  weekdays.forEach((weekday) => {
    const scheduleHours = hoursByWeekday.get(weekday) || 0
    if (scheduleHours > 0) {
      weeklyLessonHours += scheduleHours
      return
    }

    const matchingItem = items.find((item) => (
      isWithdrawalScheduleSelectable(item) &&
      getWithdrawalDateWeekday(item.dateKey) === weekday &&
      item.lessonHours > 0
    ))
    weeklyLessonHours += matchingItem?.lessonHours || 0
  })

  return weeklyLessonHours
}

function getFallbackWithdrawalClassScheduleItems(classItem?: OpsClassOption): WithdrawalClassScheduleItem[] {
  const weekdays = getWithdrawalScheduleWeekdayIndexes(classItem?.schedule || "")
  if (weekdays.length === 0) return []

  const uniqueWeekdays = [...new Set(weekdays)]
  const hoursByWeekday = parseWithdrawalScheduleHoursByWeekday(classItem?.schedule || "")
  const todayKey = toDateKey(new Date())
  const [year, month] = todayKey.split("-").map(Number)
  const cursor = new Date(year, month - 1, 1)
  const items: WithdrawalClassScheduleItem[] = []

  while (items.length < 12) {
    if (uniqueWeekdays.includes(cursor.getDay())) {
      const sessionNumber = items.length + 1
      items.push({
        dateKey: toDateKey(cursor),
        label: `${sessionNumber}회차`,
        state: "active",
        stateLabel: getWithdrawalScheduleStateLabel("active"),
        sessionNumber,
        lessonHours: hoursByWeekday.get(cursor.getDay()) || 1,
        billingLabel: getWithdrawalCalendarMonthLabel(toDateKey(cursor)),
        billingColor: "",
      })
    }
    cursor.setDate(cursor.getDate() + 1)
  }

  return items
}

function getWithdrawalClassScheduleItems(classItem?: OpsClassOption): WithdrawalClassScheduleItem[] {
  const seen = new Set<string>()

  const plannedItems = getSchedulePlanSessions(classItem).flatMap((entry, index) => {
    const session = recordValue(entry)
    if (!session) return []

    const state = stringValue(session.scheduleState || session.schedule_state || session.state) || "active"

    const dateKey = getWithdrawalSessionDateKey(session)
    if (!dateKey) return []

    const sessionNumber = Number(session.sessionNumber || session.session_number || index + 1)
    const normalizedSessionNumber = Number.isFinite(sessionNumber) && sessionNumber > 0 ? sessionNumber : index + 1
    const label = `${normalizedSessionNumber}회차`
    const billingLabel = getWithdrawalSessionBillingLabel(session)
    const uniqueKey = `${dateKey}:${label}:${state}`
    if (seen.has(uniqueKey)) return []
    seen.add(uniqueKey)

    return [{
      dateKey,
      label,
      state,
      stateLabel: getWithdrawalScheduleStateLabel(state),
      sessionNumber: normalizedSessionNumber,
      lessonHours: getWithdrawalSessionHours(session, classItem, dateKey),
      billingLabel,
      billingColor: getWithdrawalSessionBillingColor(session),
    }]
  }).sort((left, right) => left.dateKey.localeCompare(right.dateKey) || left.sessionNumber - right.sessionNumber)

  return plannedItems.length > 0 ? plannedItems : getFallbackWithdrawalClassScheduleItems(classItem)
}

function getWithdrawalBillingCycleItems(items: WithdrawalClassScheduleItem[], selectedItem?: WithdrawalClassScheduleItem) {
  if (!selectedItem) return []

  const selectableItems = items.filter((item) => isWithdrawalScheduleSelectable(item))
  const selectedIndex = selectableItems.findIndex((item) => (
    item.dateKey === selectedItem.dateKey &&
    item.sessionNumber === selectedItem.sessionNumber &&
    item.label === selectedItem.label
  ))
  if (selectedIndex < 0) return []

  let cycleStartIndex = 0
  for (let index = selectedIndex; index >= 0; index -= 1) {
    const item = selectableItems[index]
    const previous = selectableItems[index - 1]
    if (item.sessionNumber === 1) {
      cycleStartIndex = index
      break
    }
    if (previous && previous.sessionNumber > item.sessionNumber) {
      cycleStartIndex = index
      break
    }
  }

  return selectableItems.slice(cycleStartIndex, selectedIndex + 1)
}

function getWithdrawalScheduleMetrics(items: WithdrawalClassScheduleItem[], selectedDate: string, classItem?: OpsClassOption) {
  const selectedDateKey = toDateKey(selectedDate)
  const selectedItem = selectedDateKey
    ? items.find((item) => item.dateKey === selectedDateKey && isWithdrawalScheduleSelectable(item)) ||
      items.find((item) => item.dateKey === selectedDateKey)
    : undefined
  const completedCycleItems = getWithdrawalBillingCycleItems(items, selectedItem)
  const completedMinutes = selectedItem && selectedDateKey
    ? completedCycleItems
        .reduce((sum, item) => sum + item.lessonHours * 60, 0)
    : 0
  const completedLessonHours = completedMinutes / 60
  const weeklyLessonHours = getWithdrawalWeeklyLessonHours(items, classItem)
  const fourWeekLessonHours = weeklyLessonHours * 4
  const progressPercent = fourWeekLessonHours > 0
    ? Math.min(100, Math.round((completedLessonHours / fourWeekLessonHours) * 100))
    : 0

  return {
    selectedItem,
    withdrawalDate: selectedItem?.dateKey || "",
    withdrawalSession: getWithdrawalScheduleSessionLabel(selectedItem),
    completedLessonHours: completedLessonHours ? formatWithdrawalLessonHours(completedLessonHours) : "",
    fourWeekLessonHours: fourWeekLessonHours ? formatWithdrawalLessonHours(fourWeekLessonHours) : "",
    progressPercent,
  }
}

function getTransferClassScheduleMetrics(items: WithdrawalClassScheduleItem[], selectedDate: string, classItem?: OpsClassOption) {
  const metrics = getWithdrawalScheduleMetrics(items, selectedDate, classItem)
  return {
    selectedItem: metrics.selectedItem,
    transferDate: metrics.withdrawalDate,
    transferSession: metrics.withdrawalSession,
  }
}

function getTransferClassTuition(classItem?: OpsClassOption) {
  return getWithdrawalNumberValue(classItem?.fee)
}

function getTransferBillingCycleItems(items: WithdrawalClassScheduleItem[], selectedItem?: WithdrawalClassScheduleItem) {
  if (!selectedItem || !isWithdrawalScheduleSelectable(selectedItem)) return []
  const selectedMonthKey = getWithdrawalScheduleBillingMonthKey(selectedItem)
  if (!selectedMonthKey) return []

  return items.filter((item) => (
    isWithdrawalScheduleSelectable(item) &&
    getWithdrawalScheduleBillingMonthKey(item) === selectedMonthKey
  ))
}

function getTransferBillingSessionCount(
  items: WithdrawalClassScheduleItem[],
  classItem?: OpsClassOption,
  selectedItem?: WithdrawalClassScheduleItem,
) {
  const selectedWeekdayCount = new Set(getWithdrawalSelectedWeekdays(classItem)).size
  if (selectedWeekdayCount > 0) return selectedWeekdayCount * 4

  const selectableItems = items.filter((item) => isWithdrawalScheduleSelectable(item))
  const maxSessionNumber = Math.max(
    0,
    selectedItem?.sessionNumber || 0,
    ...selectableItems.map((item) => item.sessionNumber).filter((value) => Number.isFinite(value) && value > 0),
  )
  return maxSessionNumber
}

function formatTransferTuitionCurrency(value: number) {
  const rounded = Math.round(Math.abs(value))
  return `${new Intl.NumberFormat("ko-KR").format(rounded)}원`
}

function formatTransferProgressLabel(sessionCount: number, cycleSessionCount: number) {
  if (!sessionCount || !cycleSessionCount) return "자동 계산"
  const percent = Math.round((sessionCount / cycleSessionCount) * 100)
  return `${sessionCount}/${cycleSessionCount}회 (${percent}%)`
}

function getTransferMonthlyCycleContext(
  items: WithdrawalClassScheduleItem[],
  classItem: OpsClassOption | undefined,
  selectedItem: WithdrawalClassScheduleItem | undefined,
) {
  if (!selectedItem || !isWithdrawalScheduleSelectable(selectedItem)) {
    return {
      monthKey: "",
      monthLabel: "",
      sessionNumber: 0,
      cycleSessionCount: 0,
      remainingSessionCount: 0,
      servedSessionCount: 0,
    }
  }

  const sessionNumber = selectedItem.sessionNumber
  const fallbackCycleSessionCount = getTransferBillingSessionCount(items, classItem, selectedItem)
  const sameMonthItems = getTransferBillingCycleItems(items, selectedItem)
  const cycleSessionCount = Math.max(sameMonthItems.length, fallbackCycleSessionCount, sessionNumber)
  const remainingSessionCount = sessionNumber && cycleSessionCount
    ? Math.max(0, cycleSessionCount - sessionNumber + 1)
    : 0

  return {
    monthKey: getWithdrawalScheduleBillingMonthKey(selectedItem),
    monthLabel: getWithdrawalScheduleDisplayMonthLabel(selectedItem),
    sessionNumber,
    cycleSessionCount,
    remainingSessionCount,
    servedSessionCount: sessionNumber,
  }
}

function getTransferTuitionAdjustment({
  fromClass,
  toClass,
  fromDate,
  toDate,
}: {
  fromClass?: OpsClassOption
  toClass?: OpsClassOption
  fromDate: string
  toDate: string
}): TransferTuitionAdjustment {
  const fromItems = getWithdrawalClassScheduleItems(fromClass)
  const toItems = getWithdrawalClassScheduleItems(toClass)
  const fromMetrics = getTransferClassScheduleMetrics(fromItems, fromDate, fromClass)
  const toMetrics = getTransferClassScheduleMetrics(toItems, toDate, toClass)
  const fromCycle = getTransferMonthlyCycleContext(fromItems, fromClass, fromMetrics.selectedItem)
  const toCycle = getTransferMonthlyCycleContext(toItems, toClass, toMetrics.selectedItem)
  const fromTuition = getTransferClassTuition(fromClass)
  const toTuition = getTransferClassTuition(toClass)
  const fromTuitionLabel = fromTuition ? formatTransferTuitionCurrency(fromTuition) : "수업료 미등록"
  const toTuitionLabel = toTuition ? formatTransferTuitionCurrency(toTuition) : "수업료 미등록"
  const fromSessionLabel = fromMetrics.transferSession || "종료일 선택"
  const toSessionLabel = toMetrics.transferSession || "시작일 선택"
  const fromProgressLabel = formatTransferProgressLabel(fromCycle.servedSessionCount, fromCycle.cycleSessionCount)
  const toProgressLabel = formatTransferProgressLabel(toCycle.remainingSessionCount, toCycle.cycleSessionCount)
  const baseAdjustment: TransferTuitionAdjustment = {
    settlementType: "not_ready",
    settlementLabel: "자동 계산",
    message: "전/후 수업과 날짜를 선택하면 정산액이 자동 계산됩니다.",
    detail: "수업료가 등록된 수업만 추가 납부 또는 환불/이월 금액을 계산할 수 있습니다.",
    fromSessionLabel,
    fromProgressLabel,
    fromTuitionLabel,
    toSessionLabel,
    toProgressLabel,
    toTuitionLabel,
    amountLabel: "자동 계산",
  }

  if (!fromMetrics.selectedItem || !toMetrics.selectedItem || !fromCycle.cycleSessionCount || !toCycle.cycleSessionCount || !fromTuition || !toTuition) {
    return baseAdjustment
  }

  const fromUnitTuition = fromTuition / fromCycle.cycleSessionCount
  const toUnitTuition = toTuition / toCycle.cycleSessionCount
  const fromServedValue = fromCycle.servedSessionCount * fromUnitTuition
  const toRemainingValue = toCycle.remainingSessionCount * toUnitTuition
  const fromRemainingSessionCount = Math.max(0, fromCycle.cycleSessionCount - fromCycle.servedSessionCount)
  const fromRemainingValue = fromRemainingSessionCount * fromUnitTuition
  const toSkippedSessionCount = Math.max(0, toCycle.sessionNumber - 1)
  const toSkippedValue = toSkippedSessionCount * toUnitTuition

  if (fromCycle.monthKey && toCycle.monthKey && fromCycle.monthKey !== toCycle.monthKey) {
    return {
      ...baseAdjustment,
      settlementType: "month_mismatch",
      settlementLabel: "월별 확인",
      message: "전/후 수업월이 달라 연속 회차로 계산하지 않습니다.",
      detail: `전 수업 ${fromSessionLabel} 이후 잔여 ${fromRemainingSessionCount}회(${formatTransferTuitionCurrency(fromRemainingValue)})와 후 수업 ${toSessionLabel} 이전 미수강 ${toSkippedSessionCount}회(${formatTransferTuitionCurrency(toSkippedValue)})를 월별로 확인하세요.`,
      amountLabel: "월별 확인",
    }
  }

  const paidValue = fromTuition
  const servedValue = fromServedValue + toRemainingValue
  const difference = servedValue - paidValue
  const amountLabel = formatTransferTuitionCurrency(difference)

  if (Math.abs(Math.round(difference)) < 1) {
    return {
      ...baseAdjustment,
      settlementType: "balanced",
      settlementLabel: "정산 없음",
      message: "추가 납부나 환불/이월 없이 맞습니다.",
      detail: `전 수업 ${fromSessionLabel}까지 + 후 수업 ${toSessionLabel}부터 잔여 ${toCycle.remainingSessionCount}회 기준으로 납부 수업료와 일치합니다.`,
      amountLabel: "0원",
    }
  }

  if (difference < 0) {
    return {
      ...baseAdjustment,
      settlementType: "refund_or_carry",
      settlementLabel: "환불/이월",
      message: `${amountLabel} 환불/이월 필요`,
      detail: `전 수업 ${fromSessionLabel}까지 + 후 수업 ${toSessionLabel}부터 잔여 ${toCycle.remainingSessionCount}회 기준으로 납부 수업료보다 적게 수강합니다.`,
      amountLabel,
    }
  }

  return {
    ...baseAdjustment,
    settlementType: "additional_payment",
    settlementLabel: "추가 납부",
    message: `${amountLabel} 추가 납부 필요`,
    detail: `전 수업 ${fromSessionLabel}까지 + 후 수업 ${toSessionLabel}부터 잔여 ${toCycle.remainingSessionCount}회 기준으로 납부 수업료보다 많이 수강합니다.`,
    amountLabel,
  }
}

function getCalendarMonthKey(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}`
}

function DateField({
  label,
  value,
  onChange,
  onClear,
  clearLabel,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  onClear: () => void
  clearLabel: string
}) {
  const fieldId = useId()
  const calendarId = useId()
  const manualInputId = useId()
  const [calendarDateOpen, setCalendarDateOpen] = useState(false)
  const [calendarMonth, setCalendarMonth] = useState(() => getCalendarMonthDate(value))
  const [manualDate, setManualDate] = useState(value)
  const selectedDateLabel = value ? dateLabel(value) : "연도. 월. 일."
  const calendarCells = useMemo(() => buildCalendarDateCells(calendarMonth), [calendarMonth])

  function handleDateSelect(nextValue: string) {
    onChange(nextValue)
    setManualDate(nextValue)
    setCalendarMonth(getCalendarMonthDate(nextValue))
    setCalendarDateOpen(false)
  }

  function applyManualDate() {
    const nextValue = manualDate.trim()
    if (!nextValue) {
      onClear()
      setCalendarDateOpen(false)
      return
    }
    onChange(nextValue)
    setCalendarMonth(getCalendarMonthDate(nextValue))
    setCalendarDateOpen(false)
  }

  function handleManualDateKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault()
      setCalendarDateOpen(false)
      setManualDate(value)
      return
    }
    if (event.key !== "Enter") return
    event.preventDefault()
    applyManualDate()
  }

  return (
    <Popover open={calendarDateOpen} onOpenChange={setCalendarDateOpen}>
      <div className="relative grid min-w-0 gap-1.5 text-sm font-medium">
        <label id={fieldId}>{label}</label>
        <span className="relative block min-w-0">
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-labelledby={fieldId}
              aria-haspopup="dialog"
              aria-expanded={calendarDateOpen}
              aria-controls={calendarId}
              onClick={() => {
                setCalendarMonth(getCalendarMonthDate(value))
                setManualDate(value)
              }}
              className={[
                "flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-md border bg-background px-3 text-left text-sm shadow-xs outline-none transition hover:border-foreground/30 focus:border-ring focus:ring-ring/40 focus:ring-2",
                value ? "pr-10" : "",
                calendarDateOpen ? "border-ring ring-2 ring-ring/40" : "",
              ].filter(Boolean).join(" ")}
            >
              <span className={value ? "truncate text-foreground" : "truncate text-muted-foreground"}>{selectedDateLabel}</span>
              <CalendarDays className="size-4 shrink-0 text-muted-foreground" />
            </button>
          </PopoverTrigger>
          {value && (
            <button
              type="button"
              aria-label={clearLabel}
              onClick={(event) => {
                event.stopPropagation()
                onClear()
                setManualDate("")
              }}
              className="absolute right-2 top-1/2 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          )}
        </span>
      </div>
      {calendarDateOpen && (
        <PopoverContent
          id={calendarId}
          role="dialog"
          aria-labelledby={fieldId}
          align="start"
          sideOffset={6}
          collisionPadding={12}
          className="w-[min(21rem,calc(100vw-1.5rem))] overflow-hidden p-0"
        >
          <div className="flex items-center justify-between border-b px-2 py-1.5">
            <button
              type="button"
              aria-label="이전 달"
              onClick={() => setCalendarMonth((month) => addCalendarMonths(month, -1))}
              className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              <ChevronLeft className="size-4" />
            </button>
            <span className="text-sm font-semibold">{getCalendarMonthLabel(calendarMonth)}</span>
            <button
              type="button"
              aria-label="다음 달"
              onClick={() => setCalendarMonth((month) => addCalendarMonths(month, 1))}
              className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
          <div role="grid" aria-label={`${label} 달력`} className="grid grid-cols-7 gap-1 p-2">
            {CALENDAR_WEEKDAY_LABELS.map((weekday) => (
              <div key={weekday} role="columnheader" className="grid h-6 place-items-center text-[11px] font-medium text-muted-foreground">
                {weekday}
              </div>
            ))}
            {calendarCells.map((cell) => {
              const selected = cell.dateKey === value
              return (
                <button
                  key={cell.dateKey}
                  type="button"
                  role="gridcell"
                  aria-selected={selected}
                  aria-label={`${cell.dateKey} 선택`}
                  onClick={() => handleDateSelect(cell.dateKey)}
                  className={[
                    "grid h-8 min-w-0 place-items-center rounded-md text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring/40",
                    selected ? "bg-primary text-primary-foreground shadow-xs" : "",
                    !selected && cell.isToday ? "border border-primary/50 text-primary" : "",
                    !selected && !cell.isToday && cell.isCurrentMonth ? "text-foreground hover:bg-muted" : "",
                    !selected && !cell.isToday && !cell.isCurrentMonth ? "text-muted-foreground/45 hover:bg-muted/60" : "",
                  ].join(" ")}
                >
                  {cell.dayLabel}
                </button>
              )
            })}
          </div>
          <div className="grid gap-2 border-t bg-muted/30 px-2.5 py-2">
            <label htmlFor={manualInputId} className="text-xs font-medium text-muted-foreground">직접 날짜 입력</label>
            <div className="flex gap-2">
              <Input
                id={manualInputId}
                type="text"
                inputMode="numeric"
                value={manualDate}
                placeholder="YYYY-MM-DD"
                className="h-8 min-w-0"
                onChange={(event) => setManualDate(event.target.value)}
                onKeyDown={handleManualDateKeyDown}
              />
              <Button type="button" variant="outline" size="sm" onClick={applyManualDate} className="h-8 shrink-0 px-2.5">
                적용
              </Button>
            </div>
          </div>
        </PopoverContent>
      )}
    </Popover>
  )
}

function ScheduleSelectionDependencyState({ fieldId }: { fieldId: string }) {
  return (
    <div
      role="note"
      aria-labelledby={fieldId}
      className="rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm font-medium text-amber-950 dark:border-amber-800/70 dark:bg-amber-950/30 dark:text-amber-100"
    >
      수업을 먼저 선택하면 등록된 수업일정이 표시됩니다.
    </div>
  )
}

function WithdrawalScheduleCalendarField({
  classItem,
  withdrawal,
  onScheduleSelect,
}: {
  classItem?: OpsClassOption
  withdrawal: NonNullable<OpsTaskInput["withdrawal"]>
  onScheduleSelect: (metrics: ReturnType<typeof getWithdrawalScheduleMetrics>) => void
}) {
  const fieldId = useId()
  const selectedDateKey = dateInputValue(withdrawal.withdrawalDate)
  const scheduleItems = useMemo(() => getWithdrawalClassScheduleItems(classItem), [classItem])
  const [calendarMonth, setCalendarMonth] = useState(() => getCalendarMonthDate(selectedDateKey))
  const calendarCells = useMemo(() => buildCalendarDateCells(calendarMonth), [calendarMonth])
  const itemsByDate = useMemo(() => {
    const items = new Map<string, WithdrawalClassScheduleItem>()
    scheduleItems.forEach((item) => {
      const current = items.get(item.dateKey)
      if (!current || (!isWithdrawalScheduleSelectable(current) && isWithdrawalScheduleSelectable(item))) {
        items.set(item.dateKey, item)
      }
    })
    return items
  }, [scheduleItems])
  const metrics = getWithdrawalScheduleMetrics(scheduleItems, selectedDateKey, classItem)
  const progressLabel = metrics.fourWeekLessonHours
    ? `${metrics.progressPercent}%`
    : "자동 계산"

  if (!classItem) {
    return (
      <section className="grid gap-3 md:col-span-2">
        <div className="flex items-center gap-2">
          <span id={fieldId} className="text-sm font-medium">
            <FieldHelpLabel label="퇴원일" help={WITHDRAWAL_DATE_HELP} />
          </span>
        </div>
        <ScheduleSelectionDependencyState fieldId={fieldId} />
        <div className="grid gap-2 md:grid-cols-4">
          <ReadonlyInfoField label="퇴원회차" value={withdrawal.withdrawalSession || "자동 계산"} />
          <ReadonlyInfoField label="진행 수업시수" value={withdrawal.completedLessonHours || "자동 계산"} />
          <ReadonlyInfoField label="4주 기준 수업시수" value={withdrawal.fourWeekLessonHours || "자동 계산"} />
          <ReadonlyInfoField label="수업진행률" value={progressLabel} />
        </div>
      </section>
    )
  }

  function handleScheduleSelect(item: WithdrawalClassScheduleItem) {
    if (!isWithdrawalScheduleSelectable(item)) return
    setCalendarMonth(getCalendarMonthDate(item.dateKey))
    onScheduleSelect(getWithdrawalScheduleMetrics(scheduleItems, item.dateKey, classItem))
  }

  return (
    <section className="grid gap-3 md:col-span-2">
      <div className="flex items-center gap-2">
        <span id={fieldId} className="text-sm font-medium">
          <FieldHelpLabel label="퇴원일" help={WITHDRAWAL_DATE_HELP} />
        </span>
      </div>
      <div className="rounded-lg border bg-background">
        <div className="flex items-center justify-between border-b px-2 py-1.5">
          <button
            type="button"
            aria-label="이전 달"
            onClick={() => setCalendarMonth((month) => addCalendarMonths(month, -1))}
            className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            <ChevronLeft className="size-4" />
          </button>
          <span className="text-sm font-semibold">{getCalendarMonthLabel(calendarMonth)}</span>
          <button
            type="button"
            aria-label="다음 달"
            onClick={() => setCalendarMonth((month) => addCalendarMonths(month, 1))}
            className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
        <div role="grid" aria-labelledby={fieldId} className="grid grid-cols-7 gap-1 p-2">
          {CALENDAR_WEEKDAY_LABELS.map((weekday) => (
            <div key={weekday} role="columnheader" className="grid h-6 place-items-center text-[11px] font-medium text-muted-foreground">
              {weekday}
            </div>
          ))}
          {calendarCells.map((cell) => {
            const scheduleItem = itemsByDate.get(cell.dateKey)
            const selectable = Boolean(scheduleItem && isWithdrawalScheduleSelectable(scheduleItem))
            const selected = cell.dateKey === selectedDateKey
            const dateLabel = getWithdrawalCalendarCellDateLabel(cell.dateKey)
            const sessionLabel = getWithdrawalCalendarDisplaySessionLabel(scheduleItem, { includeMonth: true })
            const calendarCellTitle = getWithdrawalCalendarCellTitle(cell.dateKey, scheduleItem)
            const toneClass = getWithdrawalCalendarCellToneClass(cell.dateKey, selected, selectable, scheduleItem)
            return (
              <button
                key={cell.dateKey}
                type="button"
                role="gridcell"
                aria-selected={selected}
                aria-label={calendarCellTitle}
                title={calendarCellTitle}
                onClick={() => scheduleItem && handleScheduleSelect(scheduleItem)}
                disabled={!selectable}
                className={[
                  "grid min-h-16 min-w-0 place-items-center content-center gap-0.5 rounded-md px-1.5 py-1 text-center text-xs outline-none transition focus-visible:ring-2 focus-visible:ring-ring/40",
                  toneClass,
                  !selected && scheduleItem && !selectable ? "border border-dashed border-muted bg-muted/30 text-muted-foreground" : "",
                  !selected && !selectable && cell.isCurrentMonth ? "text-muted-foreground/55" : "",
                  !selected && !selectable && !cell.isCurrentMonth ? "text-muted-foreground/25" : "",
                ].join(" ")}
              >
                <span className="text-[11px] font-medium">{scheduleItem ? dateLabel : cell.dayLabel}</span>
                {scheduleItem && (
                  <>
                    {sessionLabel && <span className="w-full whitespace-normal break-keep font-semibold leading-tight">{sessionLabel}</span>}
                    <span className="w-full whitespace-normal break-keep text-[10px] font-medium leading-tight opacity-80">{scheduleItem.stateLabel}</span>
                  </>
                )}
              </button>
            )
          })}
        </div>
        {scheduleItems.length === 0 && (
          <p className="border-t px-3 py-2 text-sm text-muted-foreground">
            수업을 선택하면 등록된 수업일정이 표시됩니다.
          </p>
        )}
      </div>
      <div className="grid gap-2 md:grid-cols-4">
        <ReadonlyInfoField label="퇴원회차" value={metrics.withdrawalSession || withdrawal.withdrawalSession || "자동 계산"} />
        <ReadonlyInfoField label="진행 수업시수" value={metrics.completedLessonHours || withdrawal.completedLessonHours || "자동 계산"} />
        <ReadonlyInfoField label="4주 기준 수업시수" value={metrics.fourWeekLessonHours || withdrawal.fourWeekLessonHours || "자동 계산"} />
        <ReadonlyInfoField label="수업진행률" value={progressLabel} />
      </div>
    </section>
  )
}

function TransferScheduleCalendarField({
  label,
  classItem,
  dateValue,
  sessionValue,
  onScheduleSelect,
}: {
  label: string
  classItem?: OpsClassOption
  dateValue: string
  sessionValue: string
  onScheduleSelect: (metrics: ReturnType<typeof getTransferClassScheduleMetrics>) => void
}) {
  const fieldId = useId()
  const selectedDateKey = dateInputValue(dateValue)
  const scheduleItems = useMemo(() => getWithdrawalClassScheduleItems(classItem), [classItem])
  const [calendarMonth, setCalendarMonth] = useState(() => getCalendarMonthDate(selectedDateKey))
  const calendarCells = useMemo(() => buildCalendarDateCells(calendarMonth), [calendarMonth])
  const itemsByDate = useMemo(() => {
    const items = new Map<string, WithdrawalClassScheduleItem>()
    scheduleItems.forEach((item) => {
      const current = items.get(item.dateKey)
      if (!current || (!isWithdrawalScheduleSelectable(current) && isWithdrawalScheduleSelectable(item))) {
        items.set(item.dateKey, item)
      }
    })
    return items
  }, [scheduleItems])

  if (!classItem) {
    return (
      <section className="grid gap-3">
        <div className="flex items-center gap-2">
          <span id={fieldId} className="text-sm font-medium">
            {label}
          </span>
        </div>
        <ScheduleSelectionDependencyState fieldId={fieldId} />
        <ReadonlyInfoField label={`${label} 회차`} value={sessionValue || "자동 계산"} />
      </section>
    )
  }

  function handleScheduleSelect(item: WithdrawalClassScheduleItem) {
    if (!isWithdrawalScheduleSelectable(item)) return
    setCalendarMonth(getCalendarMonthDate(item.dateKey))
    onScheduleSelect(getTransferClassScheduleMetrics(scheduleItems, item.dateKey, classItem))
  }

  return (
    <section className="grid gap-3">
      <div className="flex items-center gap-2">
        <span id={fieldId} className="text-sm font-medium">
          {label}
        </span>
      </div>
      <div className="rounded-lg border bg-background">
        <div className="flex items-center justify-between border-b px-2 py-1.5">
          <button
            type="button"
            aria-label="이전 달"
            onClick={() => setCalendarMonth((month) => addCalendarMonths(month, -1))}
            className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            <ChevronLeft className="size-4" />
          </button>
          <span className="text-sm font-semibold">{getCalendarMonthLabel(calendarMonth)}</span>
          <button
            type="button"
            aria-label="다음 달"
            onClick={() => setCalendarMonth((month) => addCalendarMonths(month, 1))}
            className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
        <div role="grid" aria-labelledby={fieldId} className="grid grid-cols-7 gap-1 p-2">
          {CALENDAR_WEEKDAY_LABELS.map((weekday) => (
            <div key={weekday} role="columnheader" className="grid h-6 place-items-center text-[11px] font-medium text-muted-foreground">
              {weekday}
            </div>
          ))}
          {calendarCells.map((cell) => {
            const scheduleItem = itemsByDate.get(cell.dateKey)
            const selectable = Boolean(scheduleItem && isWithdrawalScheduleSelectable(scheduleItem))
            const selected = cell.dateKey === selectedDateKey
            const dateLabel = getWithdrawalCalendarCellDateLabel(cell.dateKey)
            const sessionLabel = getWithdrawalCalendarDisplaySessionLabel(scheduleItem, { includeMonth: true })
            const calendarCellTitle = getWithdrawalCalendarCellTitle(cell.dateKey, scheduleItem)
            const toneClass = getWithdrawalCalendarCellToneClass(cell.dateKey, selected, selectable, scheduleItem)
            return (
              <button
                key={cell.dateKey}
                type="button"
                role="gridcell"
                aria-selected={selected}
                aria-label={calendarCellTitle}
                title={calendarCellTitle}
                onClick={() => scheduleItem && handleScheduleSelect(scheduleItem)}
                disabled={!selectable}
                className={[
                  "grid min-h-16 min-w-0 place-items-center content-center gap-0.5 rounded-md px-1.5 py-1 text-center text-xs outline-none transition focus-visible:ring-2 focus-visible:ring-ring/40",
                  toneClass,
                  !selected && scheduleItem && !selectable ? "border border-dashed border-muted bg-muted/30 text-muted-foreground" : "",
                  !selected && !selectable && cell.isCurrentMonth ? "text-muted-foreground/55" : "",
                  !selected && !selectable && !cell.isCurrentMonth ? "text-muted-foreground/25" : "",
                ].join(" ")}
              >
                <span className="text-[11px] font-medium">{scheduleItem ? dateLabel : cell.dayLabel}</span>
                {scheduleItem && (
                  <>
                    {sessionLabel && <span className="w-full whitespace-normal break-keep font-semibold leading-tight">{sessionLabel}</span>}
                    <span className="w-full whitespace-normal break-keep text-[10px] font-medium leading-tight opacity-80">{scheduleItem.stateLabel}</span>
                  </>
                )}
              </button>
            )
          })}
        </div>
        {scheduleItems.length === 0 && (
          <p className="border-t px-3 py-2 text-sm text-muted-foreground">
            수업을 선택하면 등록된 수업일정이 표시됩니다.
          </p>
        )}
      </div>
      <ReadonlyInfoField label={`${label} 회차`} value={sessionValue || "자동 계산"} />
    </section>
  )
}

function TransferAdjustmentMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid min-w-0 gap-1 rounded-md border bg-background px-3 py-2">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm font-semibold text-foreground">{value || "-"}</dd>
    </div>
  )
}

function TransferTuitionAdjustmentPanel({ adjustment }: { adjustment: TransferTuitionAdjustment }) {
  const toneClass = adjustment.settlementType === "additional_payment"
    ? "border-amber-300/60 bg-amber-50 text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100"
    : adjustment.settlementType === "refund_or_carry"
      ? "border-blue-300/60 bg-blue-50 text-blue-950 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-100"
      : adjustment.settlementType === "balanced"
        ? "border-emerald-300/60 bg-emerald-50 text-emerald-950 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-100"
        : adjustment.settlementType === "month_mismatch"
          ? "border-orange-300/60 bg-orange-50 text-orange-950 dark:border-orange-900/50 dark:bg-orange-950/30 dark:text-orange-100"
          : "border-muted bg-muted/35 text-muted-foreground"

  return (
    <section aria-label="수업료 정산" className="grid gap-3 rounded-md border bg-muted/20 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">수업료 정산</h3>
        <Badge variant="outline">{adjustment.settlementLabel}</Badge>
      </div>
      <dl className="grid gap-2 md:grid-cols-3">
        <TransferAdjustmentMetric label="전 종료회차" value={adjustment.fromSessionLabel} />
        <TransferAdjustmentMetric label="전 진행률" value={adjustment.fromProgressLabel} />
        <TransferAdjustmentMetric label="전 수업료" value={adjustment.fromTuitionLabel} />
        <TransferAdjustmentMetric label="후 시작회차" value={adjustment.toSessionLabel} />
        <TransferAdjustmentMetric label="후 잔여진행률" value={adjustment.toProgressLabel} />
        <TransferAdjustmentMetric label="후 수업료" value={adjustment.toTuitionLabel} />
      </dl>
      <div role="status" aria-live="polite" className={["rounded-md border px-3 py-2 text-sm", toneClass].join(" ")}>
        <p className="font-semibold">{adjustment.message}</p>
        <p className="mt-1 text-xs opacity-85">{adjustment.detail}</p>
      </div>
    </section>
  )
}

const TRANSFER_WORKFLOW_LANES = [
  {
    title: "담당선생님 요청",
    steps: [
      "전/후 선생님 타당성 논의",
      "타당하면 입학상담 책임자와 논의",
      "입학상담 책임자 승인",
      "전/후 선생님 공동 제출",
      "관리팀 전반 처리",
    ],
  },
  {
    title: "고객 요청",
    steps: [
      "입학상담 책임자와 전/후 선생님 타당성 논의",
      "전/후 선생님 공동 제출",
      "관리팀 전반 처리",
    ],
  },
] as const

const TRANSFER_VALIDATION_ITEMS = [
  "현재 실력: 객관적인 시험 점수",
  "학습태도 및 성장가능성: 선생님 의견",
  "승급 수업: 난이도 적합성",
  "동급 수업: 수업계획표 상의 진도",
  "시간표 변동 이슈",
] as const

const TRANSFER_COUNSELOR_GROUPS = [
  { label: "영어", value: "강부희, 김민경, 정보영" },
  { label: "수학 고등부", value: "양소윤" },
  { label: "수학 초중등부", value: "강정은" },
] as const

function TransferWorkflowChart() {
  const [open, setOpen] = useState(false)
  const contentId = useId()

  return (
    <section data-testid="transfer-workflow-chart" data-state={open ? "open" : "closed"} className="overflow-hidden rounded-md border bg-muted/20">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        <span className="min-w-0">
          <span className="block text-sm font-semibold">전반 업무 흐름</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">타당성 검토, 공동 제출, 관리팀 처리</span>
        </span>
        <ChevronRight className={["size-4 shrink-0 text-muted-foreground transition-transform", open ? "rotate-90" : ""].join(" ")} aria-hidden="true" />
      </button>
      {open && (
        <div id={contentId} className="grid gap-3 border-t bg-background px-3 py-3">
          <div className="grid gap-3 lg:grid-cols-2">
            {TRANSFER_WORKFLOW_LANES.map((lane) => (
              <section key={lane.title} className="grid gap-2 rounded-md border bg-muted/15 p-3">
                <h4 className="text-sm font-semibold">{lane.title}</h4>
                <ol className="grid gap-1.5">
                  {lane.steps.map((step, index) => (
                    <li key={step} className="flex min-w-0 items-center gap-2 text-sm">
                      <span className="grid size-6 shrink-0 place-items-center rounded-full border bg-background text-xs font-semibold text-muted-foreground">{index + 1}</span>
                      <span className="min-w-0 flex-1 break-keep">{step}</span>
                    </li>
                  ))}
                </ol>
              </section>
            ))}
          </div>
          <div className="grid gap-3 lg:grid-cols-[1.35fr_1fr]">
            <section className="grid gap-2 rounded-md border bg-muted/15 p-3">
              <h4 className="text-sm font-semibold">전반 타당성 검토 사항</h4>
              <div className="flex flex-wrap gap-1.5">
                {TRANSFER_VALIDATION_ITEMS.map((item) => (
                  <Badge key={item} variant="outline" className="rounded-md bg-background">
                    {item}
                  </Badge>
                ))}
              </div>
            </section>
            <section className="grid gap-2 rounded-md border bg-muted/15 p-3">
              <h4 className="text-sm font-semibold">입학상담 책임자</h4>
              <dl className="grid gap-1.5 text-sm">
                {TRANSFER_COUNSELOR_GROUPS.map((group) => (
                  <div key={group.label} className="grid grid-cols-[5rem_1fr] gap-2">
                    <dt className="text-muted-foreground">{group.label}</dt>
                    <dd className="font-medium">{group.value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          </div>
        </div>
      )}
    </section>
  )
}

function WordRetestMainExamDateField({
  label,
  value,
  onChange,
  onClear,
  classScheduleItems,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  onClear: () => void
  classScheduleItems: WordRetestClassScheduleItem[]
}) {
  const fieldId = useId()
  const calendarId = useId()
  const dateValue = dateInputValue(value)
  const [calendarDateOpen, setCalendarDateOpen] = useState(false)
  const [calendarMonth, setCalendarMonth] = useState(() => getCalendarMonthDate(dateValue))
  const calendarCells = useMemo(() => buildCalendarDateCells(calendarMonth), [calendarMonth])
  const selectedDateLabel = dateValue ? dateOnlyLabel(dateValue) : "연도. 월. 일."
  const classScheduleItemsByDate = useMemo(() => {
    const itemsByDate = new Map<string, WordRetestClassScheduleItem[]>()
    classScheduleItems.forEach((item) => {
      const items = itemsByDate.get(item.dateKey) || []
      items.push(item)
      itemsByDate.set(item.dateKey, items)
    })
    return itemsByDate
  }, [classScheduleItems])
  const shouldRestrictToClassSchedule = classScheduleItems.length > 0
  const monthKey = getCalendarMonthKey(calendarMonth)
  const visibleClassScheduleItems = classScheduleItems
    .filter((item) => item.dateKey.startsWith(monthKey))
    .slice(0, 12)

  function handleMainExamDateSelect(nextDate: string) {
    onChange(nextDate)
    setCalendarMonth(getCalendarMonthDate(nextDate))
    setCalendarDateOpen(false)
  }

  return (
    <Popover open={calendarDateOpen} onOpenChange={(open) => {
      setCalendarDateOpen(open)
      if (open) setCalendarMonth(getCalendarMonthDate(dateValue))
    }}>
      <div className="grid min-w-0 gap-1.5 text-sm font-medium">
        <label id={fieldId}>{label}</label>
        <span className="relative block min-w-0">
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-labelledby={fieldId}
              aria-haspopup="dialog"
              aria-expanded={calendarDateOpen}
              aria-controls={calendarId}
              className={[
                "flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-md border bg-background px-3 text-left text-sm shadow-xs outline-none transition hover:border-foreground/30 focus:border-ring focus:ring-ring/40 focus:ring-2",
                value ? "pr-10" : "",
                calendarDateOpen ? "border-ring ring-2 ring-ring/40" : "",
              ].filter(Boolean).join(" ")}
            >
              <span className={value ? "min-w-0 flex-1 truncate text-foreground" : "min-w-0 flex-1 truncate text-muted-foreground"}>{selectedDateLabel}</span>
              <CalendarDays className="size-4 shrink-0 text-muted-foreground" />
            </button>
          </PopoverTrigger>
          {value && (
            <button
              type="button"
              aria-label={`${label} 지우기`}
              onClick={(event) => {
                event.stopPropagation()
                onClear()
              }}
              className="absolute right-2 top-1/2 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          )}
        </span>
      </div>
      {calendarDateOpen && (
        <PopoverContent
          id={calendarId}
          role="dialog"
          aria-labelledby={fieldId}
          align="start"
          side="bottom"
          sideOffset={6}
          collisionPadding={12}
          disablePortal
          style={TOUCH_SCROLL_AREA_STYLE}
          onTouchMove={stopTouchScrollPropagation}
          className="z-[120] w-[min(23rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] overflow-hidden p-0"
        >
          <div className="flex items-center justify-between border-b px-2 py-1.5">
            <button
              type="button"
              aria-label="이전 달"
              onClick={() => setCalendarMonth((month) => addCalendarMonths(month, -1))}
              className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              <ChevronLeft className="size-4" />
            </button>
            <span className="text-sm font-semibold">{getCalendarMonthLabel(calendarMonth)}</span>
            <button
              type="button"
              aria-label="다음 달"
              onClick={() => setCalendarMonth((month) => addCalendarMonths(month, 1))}
              className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
          <div role="grid" aria-label={`${label} 달력`} className="grid grid-cols-7 gap-1 p-2">
            {CALENDAR_WEEKDAY_LABELS.map((weekday) => (
              <div key={weekday} role="columnheader" className="grid h-6 place-items-center text-[11px] font-medium text-muted-foreground">
                {weekday}
              </div>
            ))}
	            {calendarCells.map((cell) => {
	              const selected = cell.dateKey === dateValue
	              const dayScheduleItems = classScheduleItemsByDate.get(cell.dateKey) || []
	              const isClassScheduleDate = dayScheduleItems.length > 0
	              const selectable = !shouldRestrictToClassSchedule || isClassScheduleDate
	              const scheduleLabel = dayScheduleItems.map((item) => item.label).join(", ")
	              return (
	                <button
                  key={cell.dateKey}
                  type="button"
                  role="gridcell"
                  aria-selected={selected}
	                  aria-label={isClassScheduleDate ? `${cell.dateKey} ${scheduleLabel} 선택` : shouldRestrictToClassSchedule ? `${cell.dateKey} 수업일정 없음` : `${cell.dateKey} 선택`}
	                  data-word-retest-class-date={isClassScheduleDate ? "true" : undefined}
	                  title={isClassScheduleDate ? `${cell.dateKey} ${scheduleLabel}` : cell.dateKey}
	                  onClick={() => selectable && handleMainExamDateSelect(cell.dateKey)}
	                  disabled={!selectable}
	                  className={[
	                    "grid h-10 min-w-0 place-items-center rounded-md text-xs leading-none outline-none transition focus-visible:ring-2 focus-visible:ring-ring/40",
	                    selected ? "bg-primary text-primary-foreground shadow-xs" : "",
	                    !selected && isClassScheduleDate ? "border border-primary/35 bg-primary/[0.06] text-primary" : "",
	                    !selected && !isClassScheduleDate && !shouldRestrictToClassSchedule && cell.isToday ? "border border-primary/50 text-primary" : "",
	                    !selected && !isClassScheduleDate && !shouldRestrictToClassSchedule && !cell.isToday && cell.isCurrentMonth ? "text-foreground hover:bg-muted" : "",
	                    !selected && !isClassScheduleDate && !shouldRestrictToClassSchedule && !cell.isToday && !cell.isCurrentMonth ? "text-muted-foreground/45 hover:bg-muted/60" : "",
	                    !selected && !isClassScheduleDate && shouldRestrictToClassSchedule ? "cursor-not-allowed text-muted-foreground/35" : "",
	                  ].join(" ")}
	                >
                  <span className="font-semibold">{cell.dayLabel}</span>
                  {isClassScheduleDate && <span className="mt-0.5 text-[9px] font-bold">수업</span>}
                </button>
              )
            })}
          </div>
          {visibleClassScheduleItems.length > 0 && (
            <div className="grid gap-1.5 border-t bg-muted/30 px-2.5 py-2">
              <span className="text-xs font-semibold text-muted-foreground">수업일정</span>
              <div className="flex flex-wrap gap-1">
                {visibleClassScheduleItems.map((item) => (
                  <button
                    key={`${item.dateKey}-${item.label}`}
                    type="button"
                    onClick={() => handleMainExamDateSelect(item.dateKey)}
                    className={[
                      "rounded border px-2 py-1 text-xs font-semibold transition",
                      item.dateKey === dateValue ? "border-primary bg-primary text-primary-foreground" : "border-primary/25 bg-background text-primary hover:bg-primary/10",
                    ].join(" ")}
                  >
                    {item.dateKey.slice(5)} {item.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </PopoverContent>
      )}
    </Popover>
  )
}

function ReadonlyInfoField({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid min-w-0 gap-1.5 text-sm font-medium">
      <span>{label}</span>
      <div className="flex h-9 min-w-0 items-center rounded-md border bg-muted/35 px-3 text-sm text-muted-foreground">
        <span className="truncate">{value || "-"}</span>
      </div>
    </div>
  )
}

function CheckField({
  label,
  checked,
  onChange,
  disabled = false,
  title,
}: {
  label: string
  checked: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
  title?: string
}) {
  return (
    <label
      title={title}
      className={[
        "flex min-w-0 items-start gap-2 rounded-md border px-3 py-2 text-sm font-medium",
        disabled ? "cursor-not-allowed bg-muted/30 text-muted-foreground" : "",
      ].join(" ")}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 size-4 shrink-0 accent-primary"
      />
      <span className="min-w-0 whitespace-normal leading-5">{label}</span>
    </label>
  )
}

type ChecklistStatusItem = {
  label: string
  checked: boolean
}

function ChecklistStatusPill({ item, mode }: { item: ChecklistStatusItem; mode: "auto" | "manual" }) {
  return (
    <span
      className={[
        "inline-flex min-w-0 items-center gap-1.5 rounded-md border px-2 py-1",
        item.checked
          ? "border-primary/30 bg-primary/5 text-primary"
          : mode === "auto"
            ? "border-muted bg-muted/40 text-muted-foreground"
            : "border-amber-300 bg-amber-50 text-amber-800",
      ].join(" ")}
    >
      <span className="grid size-4 shrink-0 place-items-center rounded-full border bg-background">
        {item.checked ? <Check className="size-3" /> : null}
      </span>
      <span className="min-w-0 truncate">{item.label}</span>
      <span className="shrink-0 text-xs">{item.checked ? "완료" : mode === "auto" ? "대기" : "필요"}</span>
    </span>
  )
}

function OperationChecklistSummary({
  autoItems = [],
  manualItems,
}: {
  autoItems?: ChecklistStatusItem[]
  manualItems: ChecklistStatusItem[]
}) {
  const items = [
    ...autoItems.map((item) => ({ item, mode: "auto" as const })),
    ...manualItems.map((item) => ({ item, mode: "manual" as const })),
  ]

  return (
    <section className="rounded-md border bg-background p-2.5 text-sm">
      <div className="flex flex-wrap gap-1.5">
        {items.map(({ item, mode }) => <ChecklistStatusPill key={`${mode}-${item.label}`} item={item} mode={mode} />)}
      </div>
    </section>
  )
}

function getWithdrawalWeekRange(todayKey: string) {
  return getWordRetestWeekRange(todayKey)
}

function getWithdrawalMonthRange(todayKey: string) {
  return getWordRetestMonthRange(todayKey)
}

function getWithdrawalTeacherLabel(task: OpsTask) {
  return task.withdrawal?.teacherName || "미지정"
}

function getTransferFromTeacherLabel(task: OpsTask) {
  return task.transfer?.fromTeacherName || "미지정"
}

function getTransferToTeacherLabel(task: OpsTask) {
  return task.transfer?.toTeacherName || "미지정"
}

function getWithdrawalProgressLabel(task: OpsTask) {
  const completed = Number(task.withdrawal?.completedLessonHours || 0)
  const total = Number(task.withdrawal?.fourWeekLessonHours || 0)
  if (!Number.isFinite(completed) || !Number.isFinite(total) || total <= 0) return "-"
  return `${Math.min(100, Math.round((completed / total) * 100))}%`
}

function getWithdrawalPeriodDateKeys(task: OpsTask) {
  return [
    toDateKey(task.withdrawal?.withdrawalDate),
    toDateKey(task.dueAt),
    toDateKey(task.startAt),
    toDateKey(task.createdAt),
  ].filter(Boolean)
}

function matchesWithdrawalPeriodFilter(
  task: OpsTask,
  periodFilter: WithdrawalPeriodFilter,
  todayKey: string,
  customStartDate: string,
  customEndDate: string,
) {
  if (periodFilter === "all") return true
  const dateKeys = getWithdrawalPeriodDateKeys(task)
  if (dateKeys.length === 0) return false

  if (periodFilter === "today") return dateKeys.some((dateKey) => dateKey === todayKey)
  if (periodFilter === "week") {
    const range = getWithdrawalWeekRange(todayKey)
    return dateKeys.some((dateKey) => isDateKeyInRange(dateKey, range.start, range.end))
  }
  if (periodFilter === "month") {
    const range = getWithdrawalMonthRange(todayKey)
    return dateKeys.some((dateKey) => isDateKeyInRange(dateKey, range.start, range.end))
  }

  const startDateKey = toDateKey(customStartDate)
  const endDateKey = toDateKey(customEndDate)
  if (!startDateKey && !endDateKey) return true
  return dateKeys.some((dateKey) => isDateKeyInRange(dateKey, startDateKey, endDateKey))
}

function getTransferPeriodDateKeys(task: OpsTask) {
  return [
    toDateKey(task.transfer?.fromClassEndDate),
    toDateKey(task.transfer?.toClassStartDate),
    toDateKey(task.dueAt),
    toDateKey(task.startAt),
    toDateKey(task.createdAt),
  ].filter(Boolean)
}

function matchesTransferPeriodFilter(
  task: OpsTask,
  periodFilter: WithdrawalPeriodFilter,
  todayKey: string,
  customStartDate: string,
  customEndDate: string,
) {
  if (periodFilter === "all") return true
  const dateKeys = getTransferPeriodDateKeys(task)
  if (dateKeys.length === 0) return false

  if (periodFilter === "today") return dateKeys.some((dateKey) => dateKey === todayKey)
  if (periodFilter === "week") {
    const range = getWithdrawalWeekRange(todayKey)
    return dateKeys.some((dateKey) => isDateKeyInRange(dateKey, range.start, range.end))
  }
  if (periodFilter === "month") {
    const range = getWithdrawalMonthRange(todayKey)
    return dateKeys.some((dateKey) => isDateKeyInRange(dateKey, range.start, range.end))
  }

  const startDateKey = toDateKey(customStartDate)
  const endDateKey = toDateKey(customEndDate)
  if (!startDateKey && !endDateKey) return true
  return dateKeys.some((dateKey) => isDateKeyInRange(dateKey, startDateKey, endDateKey))
}


function getWithdrawalTableValue(task: OpsTask, columnKey: WithdrawalTableColumnKey) {
  const withdrawal = task.withdrawal || {}
  switch (columnKey) {
    case "status":
      return getWithdrawalWorkflowStatusLabel(task.status)
    case "subject":
      return task.subject || "-"
    case "teacher":
      return getWithdrawalTeacherLabel(task)
    case "className":
      return task.className || "-"
    case "student":
      return task.studentName || "-"
    case "withdrawalDate":
      return dateOnlyLabel(withdrawal.withdrawalDate)
    case "withdrawalSession":
      return withdrawal.withdrawalSession || "-"
    case "completedLessonHours":
      return withdrawal.completedLessonHours || "-"
    case "fourWeekLessonHours":
      return withdrawal.fourWeekLessonHours || "-"
    case "progress":
      return getWithdrawalProgressLabel(task)
    case "customerReason":
      return withdrawal.customerReason || "-"
    case "teacherOpinion":
      return withdrawal.teacherOpinion || "-"
    case "undistributedTextbooks":
      return withdrawal.undistributedTextbooks || "-"
    case "operationsChecklist":
      return getWithdrawalOperationsChecklistValue(withdrawal)
    case "action":
      return ""
    default:
      return "-"
  }
}

function getRegistrationVisitConsultationLabel(task: OpsTask) {
  const registration = task.registration || {}
  return [
    dateLabel(registration.visitConsultationAt || ""),
    registration.visitConsultationPlace,
  ].filter((value) => value && value !== "-").join(" · ") || "-"
}


function getTransferTableValue(task: OpsTask, columnKey: TransferTableColumnKey) {
  const transfer = task.transfer || {}
  switch (columnKey) {
    case "status":
      return getWithdrawalWorkflowStatusLabel(task.status)
    case "subject":
      return task.subject || "-"
    case "fromTeacher":
      return getTransferFromTeacherLabel(task)
    case "fromClassName":
      return transfer.fromClassName || "-"
    case "student":
      return task.studentName || "-"
    case "transferReason":
      return transfer.transferReason || "-"
    case "fromUndistributedTextbooks":
      return transfer.fromUndistributedTextbooks || "-"
    case "fromClassEndDate":
      return dateOnlyLabel(transfer.fromClassEndDate)
    case "fromClassEndSession":
      return transfer.fromClassEndSession || "-"
    case "toTeacher":
      return getTransferToTeacherLabel(task)
    case "toClassName":
      return transfer.toClassName || task.className || "-"
    case "toClassStartDate":
      return dateOnlyLabel(transfer.toClassStartDate)
    case "toClassStartSession":
      return transfer.toClassStartSession || "-"
    case "toUndistributedTextbooks":
      return transfer.toUndistributedTextbooks || "-"
    case "operationsChecklist":
      return getTransferOperationsChecklistValue(transfer)
    case "action":
      return ""
    default:
      return "-"
  }
}

function getWithdrawalFilterValue(task: OpsTask, columnKey: "subject" | "teacher" | "className" | "student") {
  return getWithdrawalTableValue(task, columnKey)
}

function getTransferFilterValue(task: OpsTask, columnKey: "subject" | "fromTeacher" | "fromClassName" | "student") {
  return getTransferTableValue(task, columnKey)
}

function buildWithdrawalSelectFilterOptions(
  tasks: OpsTask[],
  resolveOption: (task: OpsTask) => { value: string; label: string },
): TaskListboxOption[] {
  const optionsByValue = new Map<string, { value: string; label: string; count: number }>()
  tasks.forEach((task) => {
    const option = resolveOption(task)
    if (!option.value || !option.label || option.label === "-") return
    const current = optionsByValue.get(option.value)
    if (current) {
      current.count += 1
      return
    }
    optionsByValue.set(option.value, { ...option, count: 1 })
  })

  return [...optionsByValue.values()]
    .sort((left, right) => left.label.localeCompare(right.label, "ko", { numeric: true }))
    .map((option) => ({ value: option.value, label: `${option.label}${option.count ? ` ${option.count}` : ""}` }))
}


function matchesWithdrawalSelectionFilters(
  task: OpsTask,
  selectedSubjectFilter: string,
  selectedTeacherFilter: string,
) {
  if (selectedSubjectFilter !== "all" && getWithdrawalFilterValue(task, "subject") !== selectedSubjectFilter) return false
  if (selectedTeacherFilter !== "all" && getWithdrawalFilterValue(task, "teacher") !== selectedTeacherFilter) return false
  return true
}


function WithdrawalFilterSelect({
  label,
  value,
  allLabel,
  options,
  onChange,
}: {
  label: string
  value: string
  allLabel: string
  options: TaskListboxOption[]
  onChange: (value: string) => void
}) {
  return (
    <div className="min-w-[8rem] flex-1 sm:max-w-[10rem]">
      <TaskListboxField
        label={<span className="sr-only">{label}</span>}
        value={value}
        options={[{ value: "all", label: allLabel }, ...options]}
        onChange={onChange}
      />
    </div>
  )
}

function WithdrawalPeriodFilterBar({
  value,
  startDate,
  endDate,
  onChange,
  onStartDateChange,
  onEndDateChange,
  labelPrefix = "퇴원",
}: {
  value: WithdrawalPeriodFilter
  startDate: string
  endDate: string
  onChange: (value: WithdrawalPeriodFilter) => void
  onStartDateChange: (value: string) => void
  onEndDateChange: (value: string) => void
  labelPrefix?: string
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2" aria-label={`${labelPrefix} 기간 필터`}>
      <div className="inline-flex max-w-full overflow-x-auto rounded-md border bg-background p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {WITHDRAWAL_PERIOD_FILTERS.map((filter) => (
          <button
            key={filter.key}
            type="button"
            aria-pressed={value === filter.key}
            aria-label={`${filter.label} ${labelPrefix} 보기`}
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
            ariaLabel={`${labelPrefix} 기간 시작일`}
          />
          <DatePickerControl
            value={endDate}
            onChange={onEndDateChange}
            placeholder="종료일"
            ariaLabel={`${labelPrefix} 기간 종료일`}
          />
        </div>
      ) : null}
    </div>
  )
}

function WithdrawalResizableHeaderCell({
  column,
  sort,
  onHeaderSelect,
  onResizeStart,
}: {
  column: (typeof WITHDRAWAL_TABLE_COLUMNS)[number]
  sort: WithdrawalTableSort
  onHeaderSelect: (columnKey: WithdrawalTableColumnKey) => void
  onResizeStart: (key: WithdrawalTableColumnKey, event: ReactPointerEvent<HTMLButtonElement>) => void
}) {
  const { columnKey, label, align } = column
  const isActiveSort = sort?.columnKey === columnKey
  const SortIcon = isActiveSort ? (sort.direction === "asc" ? ArrowUp : ArrowDown) : ChevronsUpDown
  const sortable = columnKey !== "action"
  const ariaSort = !isActiveSort ? "none" : sort.direction === "asc" ? "ascending" : "descending"

  return (
    <div
      role="columnheader"
      aria-sort={ariaSort}
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

function TransferResizableHeaderCell({
  column,
  sort,
  onHeaderSelect,
  onResizeStart,
}: {
  column: (typeof TRANSFER_TABLE_COLUMNS)[number]
  sort: TransferTableSort
  onHeaderSelect: (columnKey: TransferTableColumnKey) => void
  onResizeStart: (key: TransferTableColumnKey, event: ReactPointerEvent<HTMLButtonElement>) => void
}) {
  const { columnKey, label, align } = column
  const isActiveSort = sort?.columnKey === columnKey
  const SortIcon = isActiveSort ? (sort.direction === "asc" ? ArrowUp : ArrowDown) : ChevronsUpDown
  const sortable = columnKey !== "action"
  const ariaSort = !isActiveSort ? "none" : sort.direction === "asc" ? "ascending" : "descending"

  return (
    <div
      role="columnheader"
      aria-sort={ariaSort}
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


function WithdrawalDataCell({
  value,
  children,
  align = "left",
  onOpenDetail,
  detailAriaLabel,
  className = "",
}: {
  value: string
  children?: ReactNode
  align?: "left" | "right"
  onOpenDetail?: () => void
  detailAriaLabel?: string
  className?: string
}) {
  const content = children || <span className="block truncate" title={value}>{value}</span>
  return (
    <div role="cell" className={["min-w-0 border-r px-2 py-2 text-sm last:border-r-0", align === "right" ? "text-right" : "", className].join(" ")}>
      {onOpenDetail ? (
        <button
          type="button"
          aria-label={detailAriaLabel || `${value || "항목"} 상세 열기`}
          title={value}
          onClick={onOpenDetail}
          className={["block w-full min-w-0 text-left outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring", align === "right" ? "text-right" : ""].join(" ")}
        >
          {content}
        </button>
      ) : (
        content
      )}
    </div>
  )
}

function getWithdrawalTaskDetailAriaLabel(task: OpsTask) {
  const withdrawal = task.withdrawal || {}
  const detailContext = [
    task.title,
    task.studentName,
    task.className,
    dateOnlyLabel(withdrawal.withdrawalDate),
  ].filter((item) => item && item !== "-")
  return `${detailContext.join(" · ") || "퇴원"} 퇴원 상세 열기`
}

function getTransferTaskDetailAriaLabel(task: OpsTask) {
  const transfer = task.transfer || {}
  const classFlow = [transfer.fromClassName, transfer.toClassName || task.className].filter(Boolean).join(" → ")
  const dateFlow = [dateOnlyLabel(transfer.fromClassEndDate), dateOnlyLabel(transfer.toClassStartDate)]
    .filter((item) => item && item !== "-")
    .join(" → ")
  const detailContext = [
    task.title,
    task.studentName,
    classFlow,
    dateFlow,
  ].filter(Boolean)
  return `${detailContext.join(" · ") || "전반"} 전반 상세 열기`
}

function getWithdrawalMobileNextActionLabel(task: OpsTask, completionBlockers: string[]) {
  const nextAction = getNextTaskStatusAction(task)
  if (!nextAction) return ""
  if (nextAction.status === "done" && completionBlockers.length > 0) {
    return getCompletionBlockerActionLabel(completionBlockers)
  }
  return nextAction.label
}

function getRegistrationMobileSectionData(task: OpsTask, registration: OpsTask["registration"] = {}) {
  return {
    ...(registration || {}),
    classId: task.classId,
    className: task.className,
    textbookId: task.textbookId,
    textbookTitle: task.textbookTitle,
  }
}


function WithdrawalDataTable({
  tasks,
  todayKey,
  loading,
  onOpen,
  onEdit,
  onStatusChange,
  onChecklistChange,
  canManageWorkflow = true,
  statusActionDisabled = false,
  onCreate,
  emptyLabel = "퇴원 신청 없음",
  emptyActionLabel = "퇴원 신청",
  showEmptyAction = true,
  completionBlockersByTaskId = EMPTY_COMPLETION_BLOCKERS_BY_TASK_ID,
}: {
  tasks: OpsTask[]
  todayKey: string
  loading: boolean
  onOpen: (task: OpsTask) => void
  onEdit: (task: OpsTask, blockers?: string[]) => void
  onStatusChange: (task: OpsTask, status: OpsTaskStatus) => void
  onChecklistChange: (task: OpsTask, field: WithdrawalChecklistField, checked: boolean) => void
  canManageWorkflow?: boolean
  statusActionDisabled?: boolean
  onCreate: () => void
  emptyLabel?: string
  emptyActionLabel?: string
  showEmptyAction?: boolean
  completionBlockersByTaskId?: OperationCompletionBlockerMap
}) {
  const [columnWidths, setColumnWidths] = useState<Record<WithdrawalTableColumnKey, number>>(WITHDRAWAL_TABLE_COLUMN_WIDTHS)
  const [withdrawalTableSort, setWithdrawalTableSort] = useState<WithdrawalTableSort>(null)
  const [filterColumnKey, setFilterColumnKey] = useState<WithdrawalTableColumnKey>("className")
  const [filterValue, setFilterValue] = useState("")
  const [filterInputOpen, setFilterInputOpen] = useState(false)
  const [selectedSubjectFilter, setSelectedSubjectFilter] = useState("all")
  const [selectedTeacherFilter, setSelectedTeacherFilter] = useState("all")
  const [withdrawalPeriodFilter, setWithdrawalPeriodFilter] = useState<WithdrawalPeriodFilter>("all")
  const [withdrawalPeriodStartDate, setWithdrawalPeriodStartDate] = useState("")
  const [withdrawalPeriodEndDate, setWithdrawalPeriodEndDate] = useState("")
  const filterInputRef = useRef<HTMLInputElement>(null)
  const gridTemplateColumns = getWithdrawalTableGridTemplate(columnWidths)
  const gridTemplateStyle = { "--withdrawal-grid-template": gridTemplateColumns } as CSSProperties
  const filterColumn = WITHDRAWAL_TABLE_COLUMNS.find((column) => column.columnKey === filterColumnKey) || WITHDRAWAL_TABLE_COLUMNS[3]
  const isFilterInputExpanded = filterInputOpen || Boolean(filterValue)

  const subjectFilterOptions = useMemo(() => (
    buildWithdrawalSelectFilterOptions(tasks, (task) => ({
      value: getWithdrawalFilterValue(task, "subject"),
      label: getWithdrawalFilterValue(task, "subject"),
    }))
  ), [tasks])
  const teacherFilterSourceTasks = useMemo(() => (
    selectedSubjectFilter === "all" ? tasks : tasks.filter((task) => getWithdrawalFilterValue(task, "subject") === selectedSubjectFilter)
  ), [selectedSubjectFilter, tasks])
  const teacherFilterOptions = useMemo(() => (
    buildWithdrawalSelectFilterOptions(teacherFilterSourceTasks, (task) => ({
      value: getWithdrawalFilterValue(task, "teacher"),
      label: getWithdrawalFilterValue(task, "teacher"),
    }))
  ), [teacherFilterSourceTasks])

  const visibleWithdrawalTasks = useMemo(() => {
    const selectionFilteredTasks = tasks
      .filter((task) => matchesWithdrawalSelectionFilters(task, selectedSubjectFilter, selectedTeacherFilter))
      .filter((task) => matchesWithdrawalPeriodFilter(task, withdrawalPeriodFilter, todayKey, withdrawalPeriodStartDate, withdrawalPeriodEndDate))
    const normalizedFilter = filterValue.trim().toLocaleLowerCase("ko")
    const nextTasks = normalizedFilter
      ? selectionFilteredTasks.filter((task) => getWithdrawalTableValue(task, filterColumnKey).toLocaleLowerCase("ko").includes(normalizedFilter))
      : [...selectionFilteredTasks]

    if (withdrawalTableSort) {
      nextTasks.sort((left, right) => {
        const leftValue = getWithdrawalTableValue(left, withdrawalTableSort.columnKey)
        const rightValue = getWithdrawalTableValue(right, withdrawalTableSort.columnKey)
        const result = leftValue.localeCompare(rightValue, "ko", { numeric: true })
        return withdrawalTableSort.direction === "asc" ? result : -result
      })
    }

    return nextTasks
  }, [
    filterColumnKey,
    filterValue,
    selectedSubjectFilter,
    selectedTeacherFilter,
    tasks,
    todayKey,
    withdrawalPeriodEndDate,
    withdrawalPeriodFilter,
    withdrawalPeriodStartDate,
    withdrawalTableSort,
  ])

  function handleHeaderSelect(columnKey: WithdrawalTableColumnKey) {
    if (columnKey === "action") return
    setFilterColumnKey(columnKey)
    setWithdrawalTableSort((current) => {
      if (!current || current.columnKey !== columnKey) return { columnKey, direction: "asc" }
      if (current.direction === "asc") return { columnKey, direction: "desc" }
      return null
    })
  }

  useEffect(() => {
    if (filterInputOpen) filterInputRef.current?.focus()
  }, [filterInputOpen])

  function startColumnResize(key: WithdrawalTableColumnKey, event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = columnWidths[key]

    function handlePointerMove(moveEvent: PointerEvent) {
      const nextWidth = Math.max(WITHDRAWAL_TABLE_COLUMN_MIN_WIDTHS[key], startWidth + moveEvent.clientX - startX)
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
    <div className="overflow-hidden rounded-md border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b bg-muted/20 px-3 py-2" aria-label="퇴원 전체 필터">
        <div className="flex min-w-0 flex-wrap items-center gap-2" aria-label="퇴원 누가 필터">
          <WithdrawalFilterSelect
            label="과목 필터"
            value={selectedSubjectFilter}
            allLabel="과목 전체"
            options={subjectFilterOptions}
            onChange={(value) => {
              setSelectedSubjectFilter(value)
              setSelectedTeacherFilter("all")
            }}
          />
          <WithdrawalFilterSelect
            label="선생님 필터"
            value={selectedTeacherFilter}
            allLabel="선생님 전체"
            options={teacherFilterOptions}
            onChange={setSelectedTeacherFilter}
          />
        </div>
        <WithdrawalPeriodFilterBar
          value={withdrawalPeriodFilter}
          startDate={withdrawalPeriodStartDate}
          endDate={withdrawalPeriodEndDate}
          onChange={setWithdrawalPeriodFilter}
          onStartDateChange={setWithdrawalPeriodStartDate}
          onEndDateChange={setWithdrawalPeriodEndDate}
        />
        <div className="ml-auto flex min-w-0 items-center gap-2 text-sm font-medium" aria-label="퇴원 데이터테이블 열 필터">
          <Button
            type="button"
            variant={isFilterInputExpanded ? "secondary" : "outline"}
            size="sm"
            className="size-8 px-0"
            aria-label={isFilterInputExpanded ? `${filterColumn.label} 열 필터 접기` : `${filterColumn.label} 열 필터 펼치기`}
            aria-expanded={isFilterInputExpanded}
            onClick={() => setFilterInputOpen((current) => !current)}
          >
            <Filter className="size-4" aria-hidden="true" />
          </Button>
          {isFilterInputExpanded ? (
            <div className="flex min-w-0 items-center gap-2">
              <Input
                ref={filterInputRef}
                aria-label={`${filterColumn.label} 열 필터`}
                value={filterValue}
                onChange={(event) => setFilterValue(event.target.value)}
                placeholder={`${filterColumn.label} 값 입력`}
                className="h-8 min-w-0 flex-1 sm:w-48"
              />
              {filterValue ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setFilterValue("")
                    setFilterInputOpen(false)
                  }}
                >
                  지우기
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      <div data-testid="withdrawal-mobile-task-list" className="grid gap-2 p-3 md:hidden" aria-label="퇴원 모바일 목록">
        {loading ? (
          <div className="px-3 py-10 text-center text-sm text-muted-foreground">불러오는 중입니다.</div>
        ) : visibleWithdrawalTasks.length === 0 ? (
          <div className="grid gap-3 px-3 py-10 text-center text-sm text-muted-foreground">
            <span>{tasks.length === 0 ? emptyLabel : "표시할 퇴원 신청이 없습니다."}</span>
            {tasks.length === 0 && showEmptyAction ? (
              <span>
                <Button type="button" size="sm" onClick={onCreate}>
                  <Plus className="size-4" />
                  {emptyActionLabel}
                </Button>
              </span>
            ) : null}
          </div>
        ) : visibleWithdrawalTasks.map((task) => {
          const withdrawal = task.withdrawal || {}
          const completionBlockers = completionBlockersByTaskId.get(task.id) || EMPTY_COMPLETION_BLOCKERS
          const nextAction = getNextTaskStatusAction(task)
          const canRunStatusAction = canManageWorkflow && Boolean(nextAction)
          const nextActionBlocked = nextAction?.status === "done" && completionBlockers.length > 0
          const mobileNextActionLabel = getWithdrawalMobileNextActionLabel(task, completionBlockers)
          const canEditChecklist = canManageWorkflow && canEditTaskDetails(task)
          const progress = getWithdrawalProgressLabel(task)
          const detailAriaLabel = getWithdrawalTaskDetailAriaLabel(task)

          return (
            <article key={task.id} className="grid gap-3 rounded-md border bg-background p-3 shadow-xs" aria-label={`${task.title} 퇴원 신청`}>
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                <WithdrawalWorkflowStatusBadge status={task.status} />
                <Badge variant="outline">{task.subject || "과목 미정"}</Badge>
                <Badge variant="secondary">{withdrawal.teacherName || task.assigneeLabel || "선생님 미정"}</Badge>
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-foreground">{task.className || task.title}</div>
                <div className="truncate text-xs text-muted-foreground">{task.studentName || "학생 미정"}</div>
              </div>
              <dl className="grid gap-2 text-xs">
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-md bg-muted/35 px-2 py-1.5">
                    <dt className="text-muted-foreground">퇴원일</dt>
                    <dd className="mt-0.5 truncate font-medium">{dateOnlyLabel(withdrawal.withdrawalDate)}</dd>
                  </div>
                  <div className="rounded-md bg-muted/35 px-2 py-1.5">
                    <dt className="text-muted-foreground">퇴원회차</dt>
                    <dd className="mt-0.5 truncate font-medium">{withdrawal.withdrawalSession || "미정"}</dd>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-md bg-muted/35 px-2 py-1.5">
                    <dt className="text-muted-foreground">진행 수업시수</dt>
                    <dd className="mt-0.5 truncate font-medium">{withdrawal.completedLessonHours || "자동 계산"}</dd>
                  </div>
                  <div className="rounded-md bg-muted/35 px-2 py-1.5">
                    <dt className="text-muted-foreground">수업진행률</dt>
                    <dd className="mt-0.5 truncate font-medium">{progress === "-" ? "자동 계산" : progress}</dd>
                  </div>
                </div>
                <div className="rounded-md bg-muted/35 px-2 py-1.5">
                  <dt className="text-muted-foreground">처리 확인</dt>
                  <dd className="mt-1">
                    <WithdrawalOperationsChecklistChips
                      withdrawal={withdrawal}
                      editable={canEditChecklist}
                      disabled={statusActionDisabled}
                      onChange={(field, checked) => onChecklistChange(task, field, checked)}
                    />
                  </dd>
                </div>
                {withdrawal.customerReason || withdrawal.teacherOpinion ? (
                  <div className="rounded-md bg-muted/35 px-2 py-1.5">
                    <dt className="text-muted-foreground">퇴원 메모</dt>
                    <dd className="mt-0.5 line-clamp-2 font-medium">
                      {[withdrawal.customerReason, withdrawal.teacherOpinion].filter(Boolean).join(" · ")}
                    </dd>
                  </div>
                ) : null}
              </dl>
              <div className="flex flex-wrap justify-end gap-1.5 border-t pt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={detailAriaLabel}
                  onClick={() => onOpen(task)}
                >
                  상세
                </Button>
                {canRunStatusAction && nextAction ? (
                  <Button
                    type="button"
                    variant={nextActionBlocked ? "outline" : "default"}
                    size="sm"
                    aria-label={`${task.title}: ${mobileNextActionLabel}`}
                    title={nextActionBlocked ? `${completionBlockers.join(", ")} 연결 필요` : undefined}
                    onClick={() => {
                      if (nextActionBlocked) {
                        onEdit(task, completionBlockers)
                        return
                      }
                      onStatusChange(task, nextAction.status)
                    }}
                    disabled={statusActionDisabled}
                  >
                    {mobileNextActionLabel}
                  </Button>
                ) : null}
                {canEditTaskDetails(task) ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label={`${task.title} 수정`}
                    onClick={() => onEdit(task)}
                    disabled={statusActionDisabled}
                  >
                    수정
                  </Button>
                ) : null}
              </div>
            </article>
          )
        })}
      </div>
      <div className="hidden w-full overflow-x-auto md:block" role="table" aria-label="퇴원 신청 데이터테이블">
        <div
          role="row"
          className="grid min-w-full border-b bg-muted/45 text-xs [grid-template-columns:var(--withdrawal-grid-template)]"
          style={gridTemplateStyle}
        >
          {WITHDRAWAL_TABLE_COLUMNS.map((column) => (
            <WithdrawalResizableHeaderCell
              key={column.columnKey}
              column={column}
              sort={withdrawalTableSort}
              onHeaderSelect={handleHeaderSelect}
              onResizeStart={startColumnResize}
            />
          ))}
        </div>
        {loading ? (
          <div className="px-4 py-12 text-center text-sm text-muted-foreground">불러오는 중입니다.</div>
        ) : visibleWithdrawalTasks.length === 0 ? (
          <div className="grid gap-3 px-4 py-12 text-center text-sm text-muted-foreground">
            <span>{tasks.length === 0 ? emptyLabel : "표시할 퇴원 신청이 없습니다."}</span>
            {tasks.length === 0 && showEmptyAction ? (
              <span>
                <Button type="button" size="sm" onClick={onCreate}>
                  <Plus className="size-4" />
                  {emptyActionLabel}
                </Button>
              </span>
            ) : null}
          </div>
        ) : visibleWithdrawalTasks.map((task) => {
          const nextAction = getNextTaskStatusAction(task)
          const canRunStatusAction = canManageWorkflow && Boolean(nextAction)
          const completionBlockers = completionBlockersByTaskId.get(task.id) || EMPTY_COMPLETION_BLOCKERS
          const nextActionBlocked = nextAction?.status === "done" && completionBlockers.length > 0
          const blockedActionLabel = getCompletionBlockerActionLabel(completionBlockers)
          const canEditChecklist = canManageWorkflow && canEditTaskDetails(task)
          const detailAriaLabel = getWithdrawalTaskDetailAriaLabel(task)

          return (
            <div
              key={task.id}
              role="row"
              className="grid min-w-full border-b last:border-b-0 hover:bg-muted/30 [grid-template-columns:var(--withdrawal-grid-template)]"
              style={gridTemplateStyle}
            >
              {WITHDRAWAL_TABLE_COLUMNS.map((column) => {
                const value = getWithdrawalTableValue(task, column.columnKey)
                if (column.columnKey === "status") {
                  return (
                    <WithdrawalDataCell key={column.columnKey} value={value} onOpenDetail={() => onOpen(task)} detailAriaLabel={detailAriaLabel}>
                      <WithdrawalWorkflowStatusBadge status={task.status} />
                    </WithdrawalDataCell>
                  )
                }
                if (column.columnKey === "action") {
                  return (
                    <WithdrawalDataCell key={column.columnKey} value="" align="right">
                      <span className="flex flex-wrap justify-end gap-1.5">
                        {canRunStatusAction && nextAction && (
                          <Button
                            type="button"
                            variant={nextActionBlocked ? "outline" : "default"}
                            size="sm"
                            aria-label={`${task.title}: ${nextActionBlocked ? blockedActionLabel : nextAction.label}`}
                            title={nextActionBlocked ? `${completionBlockers.join(", ")} 연결 필요` : undefined}
                            onClick={() => {
                              if (nextActionBlocked) {
                                onEdit(task, completionBlockers)
                                return
                              }
                              onStatusChange(task, nextAction.status)
                            }}
                            disabled={statusActionDisabled}
                          >
                            {nextActionBlocked ? blockedActionLabel : nextAction.label}
                          </Button>
                        )}
                        {canEditTaskDetails(task) && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            aria-label={`${task.title} 수정`}
                            onClick={() => onEdit(task)}
                            disabled={statusActionDisabled}
                          >
                            수정
                          </Button>
                        )}
                      </span>
                    </WithdrawalDataCell>
                  )
                }
                if (column.columnKey === "operationsChecklist") {
                  return (
                    <WithdrawalDataCell key={column.columnKey} value={value}>
                      <WithdrawalOperationsChecklistChips
                        withdrawal={task.withdrawal}
                        editable={canEditChecklist}
                        disabled={statusActionDisabled}
                        onChange={(field, checked) => onChecklistChange(task, field, checked)}
                      />
                    </WithdrawalDataCell>
                  )
                }
                return (
                  <WithdrawalDataCell
                    key={column.columnKey}
                    value={value}
                    align={column.align}
                    onOpenDetail={() => onOpen(task)}
                    detailAriaLabel={detailAriaLabel}
                  />
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function TransferDataTable({
  tasks,
  todayKey,
  loading,
  onOpen,
  onEdit,
  onStatusChange,
  onChecklistChange,
  canManageWorkflow = true,
  statusActionDisabled = false,
  onCreate,
  emptyLabel = "전반 신청 없음",
  emptyActionLabel = "전반 신청",
  showEmptyAction = true,
  completionBlockersByTaskId = EMPTY_COMPLETION_BLOCKERS_BY_TASK_ID,
}: {
  tasks: OpsTask[]
  todayKey: string
  loading: boolean
  onOpen: (task: OpsTask) => void
  onEdit: (task: OpsTask, blockers?: string[]) => void
  onStatusChange: (task: OpsTask, status: OpsTaskStatus) => void
  onChecklistChange: (task: OpsTask, field: TransferChecklistField, checked: boolean) => void
  canManageWorkflow?: boolean
  statusActionDisabled?: boolean
  onCreate: () => void
  emptyLabel?: string
  emptyActionLabel?: string
  showEmptyAction?: boolean
  completionBlockersByTaskId?: OperationCompletionBlockerMap
}) {
  const [columnWidths, setColumnWidths] = useState<Record<TransferTableColumnKey, number>>(TRANSFER_TABLE_COLUMN_WIDTHS)
  const [transferTableSort, setTransferTableSort] = useState<TransferTableSort>(null)
  const [filterColumnKey, setFilterColumnKey] = useState<TransferTableColumnKey>("fromClassName")
  const [filterValue, setFilterValue] = useState("")
  const [filterInputOpen, setFilterInputOpen] = useState(false)
  const [selectedSubjectFilter, setSelectedSubjectFilter] = useState("all")
  const [selectedTeacherFilter, setSelectedTeacherFilter] = useState("all")
  const [transferPeriodFilter, setTransferPeriodFilter] = useState<WithdrawalPeriodFilter>("all")
  const [transferPeriodStartDate, setTransferPeriodStartDate] = useState("")
  const [transferPeriodEndDate, setTransferPeriodEndDate] = useState("")
  const filterInputRef = useRef<HTMLInputElement>(null)
  const gridTemplateColumns = getTransferTableGridTemplate(columnWidths)
  const gridTemplateStyle = { "--transfer-grid-template": gridTemplateColumns } as CSSProperties
  const filterColumn = TRANSFER_TABLE_COLUMNS.find((column) => column.columnKey === filterColumnKey) || TRANSFER_TABLE_COLUMNS[3]
  const isFilterInputExpanded = filterInputOpen || Boolean(filterValue)

  const subjectFilterOptions = useMemo(() => (
    buildWithdrawalSelectFilterOptions(tasks, (task) => ({
      value: getTransferFilterValue(task, "subject"),
      label: getTransferFilterValue(task, "subject"),
    }))
  ), [tasks])
  const teacherFilterSourceTasks = useMemo(() => (
    selectedSubjectFilter === "all" ? tasks : tasks.filter((task) => getTransferFilterValue(task, "subject") === selectedSubjectFilter)
  ), [selectedSubjectFilter, tasks])
  const teacherFilterOptions = useMemo(() => (
    buildWithdrawalSelectFilterOptions(teacherFilterSourceTasks, (task) => ({
      value: getTransferFilterValue(task, "fromTeacher"),
      label: getTransferFilterValue(task, "fromTeacher"),
    }))
  ), [teacherFilterSourceTasks])

  const visibleTransferTasks = useMemo(() => {
    const selectionFilteredTasks = tasks
      .filter((task) => {
        if (selectedSubjectFilter !== "all" && getTransferFilterValue(task, "subject") !== selectedSubjectFilter) return false
        if (selectedTeacherFilter !== "all" && getTransferFilterValue(task, "fromTeacher") !== selectedTeacherFilter) return false
        return true
      })
      .filter((task) => matchesTransferPeriodFilter(task, transferPeriodFilter, todayKey, transferPeriodStartDate, transferPeriodEndDate))
    const normalizedFilter = filterValue.trim().toLocaleLowerCase("ko")
    const nextTasks = normalizedFilter
      ? selectionFilteredTasks.filter((task) => getTransferTableValue(task, filterColumnKey).toLocaleLowerCase("ko").includes(normalizedFilter))
      : [...selectionFilteredTasks]

    if (transferTableSort) {
      nextTasks.sort((left, right) => {
        const leftValue = getTransferTableValue(left, transferTableSort.columnKey)
        const rightValue = getTransferTableValue(right, transferTableSort.columnKey)
        const result = leftValue.localeCompare(rightValue, "ko", { numeric: true })
        return transferTableSort.direction === "asc" ? result : -result
      })
    }

    return nextTasks
  }, [
    filterColumnKey,
    filterValue,
    selectedSubjectFilter,
    selectedTeacherFilter,
    tasks,
    todayKey,
    transferPeriodEndDate,
    transferPeriodFilter,
    transferPeriodStartDate,
    transferTableSort,
  ])

  function handleHeaderSelect(columnKey: TransferTableColumnKey) {
    if (columnKey === "action") return
    setFilterColumnKey(columnKey)
    setTransferTableSort((current) => {
      if (!current || current.columnKey !== columnKey) return { columnKey, direction: "asc" }
      if (current.direction === "asc") return { columnKey, direction: "desc" }
      return null
    })
  }

  useEffect(() => {
    if (filterInputOpen) filterInputRef.current?.focus()
  }, [filterInputOpen])

  function startColumnResize(key: TransferTableColumnKey, event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = columnWidths[key]

    function handlePointerMove(moveEvent: PointerEvent) {
      const nextWidth = Math.max(TRANSFER_TABLE_COLUMN_MIN_WIDTHS[key], startWidth + moveEvent.clientX - startX)
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
    <div className="overflow-hidden rounded-md border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b bg-muted/20 px-3 py-2" aria-label="전반 전체 필터">
        <div className="flex min-w-0 flex-wrap items-center gap-2" aria-label="전반 누가 필터">
          <WithdrawalFilterSelect
            label="과목 필터"
            value={selectedSubjectFilter}
            allLabel="과목 전체"
            options={subjectFilterOptions}
            onChange={(value) => {
              setSelectedSubjectFilter(value)
              setSelectedTeacherFilter("all")
            }}
          />
          <WithdrawalFilterSelect
            label="선생님 필터"
            value={selectedTeacherFilter}
            allLabel="선생님 전체"
            options={teacherFilterOptions}
            onChange={setSelectedTeacherFilter}
          />
        </div>
        <WithdrawalPeriodFilterBar
          labelPrefix="전반"
          value={transferPeriodFilter}
          startDate={transferPeriodStartDate}
          endDate={transferPeriodEndDate}
          onChange={setTransferPeriodFilter}
          onStartDateChange={setTransferPeriodStartDate}
          onEndDateChange={setTransferPeriodEndDate}
        />
        <div className="ml-auto flex min-w-0 items-center gap-2 text-sm font-medium" aria-label="전반 데이터테이블 열 필터">
          <Button
            type="button"
            variant={isFilterInputExpanded ? "secondary" : "outline"}
            size="sm"
            className="size-8 px-0"
            aria-label={isFilterInputExpanded ? `${filterColumn.label} 열 필터 접기` : `${filterColumn.label} 열 필터 펼치기`}
            aria-expanded={isFilterInputExpanded}
            onClick={() => setFilterInputOpen((current) => !current)}
          >
            <Filter className="size-4" aria-hidden="true" />
          </Button>
          {isFilterInputExpanded ? (
            <div className="flex min-w-0 items-center gap-2">
              <Input
                ref={filterInputRef}
                aria-label={`${filterColumn.label} 열 필터`}
                value={filterValue}
                onChange={(event) => setFilterValue(event.target.value)}
                placeholder={`${filterColumn.label} 값 입력`}
                className="h-8 min-w-0 flex-1 sm:w-48"
              />
              {filterValue ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setFilterValue("")
                    setFilterInputOpen(false)
                  }}
                >
                  지우기
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      <div data-testid="transfer-mobile-task-list" className="grid gap-2 p-3 md:hidden" aria-label="전반 모바일 목록">
        {loading ? (
          <div className="px-3 py-10 text-center text-sm text-muted-foreground">불러오는 중입니다.</div>
        ) : visibleTransferTasks.length === 0 ? (
          <div className="grid gap-3 px-3 py-10 text-center text-sm text-muted-foreground">
            <span>{tasks.length === 0 ? emptyLabel : "표시할 전반 신청이 없습니다."}</span>
            {tasks.length === 0 && showEmptyAction ? (
              <span>
                <Button type="button" size="sm" onClick={onCreate}>
                  <Plus className="size-4" />
                  {emptyActionLabel}
                </Button>
              </span>
            ) : null}
          </div>
        ) : visibleTransferTasks.map((task) => {
          const transfer = task.transfer || {}
          const completionBlockers = completionBlockersByTaskId.get(task.id) || EMPTY_COMPLETION_BLOCKERS
          const nextAction = getNextTaskStatusAction(task)
          const canRunStatusAction = canManageWorkflow && Boolean(nextAction)
          const nextActionBlocked = nextAction?.status === "done" && completionBlockers.length > 0
          const mobileNextActionLabel = getWithdrawalMobileNextActionLabel(task, completionBlockers)
          const canEditChecklist = canManageWorkflow && canEditTaskDetails(task)
          const detailAriaLabel = getTransferTaskDetailAriaLabel(task)

          return (
            <article key={task.id} className="grid gap-3 rounded-md border bg-background p-3 shadow-xs" aria-label={`${task.title} 전반 신청`}>
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                <WithdrawalWorkflowStatusBadge status={task.status} />
                <Badge variant="outline">{task.subject || "과목 미정"}</Badge>
                <Badge variant="secondary">{transfer.fromTeacherName || "전 선생님 미정"}</Badge>
                <Badge variant="secondary">{transfer.toTeacherName || "후 선생님 미정"}</Badge>
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-foreground">
                  {[transfer.fromClassName, transfer.toClassName || task.className].filter(Boolean).join(" → ") || task.title}
                </div>
                <div className="truncate text-xs text-muted-foreground">{task.studentName || "학생 미정"}</div>
              </div>
              <dl className="grid gap-2 text-xs">
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-md bg-muted/35 px-2 py-1.5">
                    <dt className="text-muted-foreground">전 수업 종료일</dt>
                    <dd className="mt-0.5 truncate font-medium">{dateOnlyLabel(transfer.fromClassEndDate)}</dd>
                  </div>
                  <div className="rounded-md bg-muted/35 px-2 py-1.5">
                    <dt className="text-muted-foreground">후 수업 시작일</dt>
                    <dd className="mt-0.5 truncate font-medium">{dateOnlyLabel(transfer.toClassStartDate)}</dd>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-md bg-muted/35 px-2 py-1.5">
                    <dt className="text-muted-foreground">전 종료회차</dt>
                    <dd className="mt-0.5 truncate font-medium">{transfer.fromClassEndSession || "미정"}</dd>
                  </div>
                  <div className="rounded-md bg-muted/35 px-2 py-1.5">
                    <dt className="text-muted-foreground">후 시작회차</dt>
                    <dd className="mt-0.5 truncate font-medium">{transfer.toClassStartSession || "미정"}</dd>
                  </div>
                </div>
                <div className="rounded-md bg-muted/35 px-2 py-1.5">
                  <dt className="text-muted-foreground">처리 확인</dt>
                  <dd className="mt-1">
                    <TransferOperationsChecklistChips
                      transfer={transfer}
                      editable={canEditChecklist}
                      disabled={statusActionDisabled}
                      onChange={(field, checked) => onChecklistChange(task, field, checked)}
                    />
                  </dd>
                </div>
                {transfer.transferReason ? (
                  <div className="rounded-md bg-muted/35 px-2 py-1.5">
                    <dt className="text-muted-foreground">전반사유</dt>
                    <dd className="mt-0.5 line-clamp-2 font-medium">{transfer.transferReason}</dd>
                  </div>
                ) : null}
              </dl>
              <div className="flex flex-wrap justify-end gap-1.5 border-t pt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={detailAriaLabel}
                  onClick={() => onOpen(task)}
                >
                  상세
                </Button>
                {canRunStatusAction && nextAction ? (
                  <Button
                    type="button"
                    variant={nextActionBlocked ? "outline" : "default"}
                    size="sm"
                    aria-label={`${task.title}: ${mobileNextActionLabel}`}
                    title={nextActionBlocked ? `${completionBlockers.join(", ")} 연결 필요` : undefined}
                    onClick={() => {
                      if (nextActionBlocked) {
                        onEdit(task, completionBlockers)
                        return
                      }
                      onStatusChange(task, nextAction.status)
                    }}
                    disabled={statusActionDisabled}
                  >
                    {mobileNextActionLabel}
                  </Button>
                ) : null}
                {canEditTaskDetails(task) ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label={`${task.title} 수정`}
                    onClick={() => onEdit(task)}
                    disabled={statusActionDisabled}
                  >
                    수정
                  </Button>
                ) : null}
              </div>
            </article>
          )
        })}
      </div>
      <div className="hidden w-full overflow-x-auto md:block" role="table" aria-label="전반 신청 데이터테이블">
        <div
          role="row"
          className="grid min-w-full border-b bg-muted/45 text-xs [grid-template-columns:var(--transfer-grid-template)]"
          style={gridTemplateStyle}
        >
          {TRANSFER_TABLE_COLUMNS.map((column) => (
            <TransferResizableHeaderCell
              key={column.columnKey}
              column={column}
              sort={transferTableSort}
              onHeaderSelect={handleHeaderSelect}
              onResizeStart={startColumnResize}
            />
          ))}
        </div>
        {loading ? (
          <div className="px-4 py-12 text-center text-sm text-muted-foreground">불러오는 중입니다.</div>
        ) : visibleTransferTasks.length === 0 ? (
          <div className="grid gap-3 px-4 py-12 text-center text-sm text-muted-foreground">
            <span>{tasks.length === 0 ? emptyLabel : "표시할 전반 신청이 없습니다."}</span>
            {tasks.length === 0 && showEmptyAction ? (
              <span>
                <Button type="button" size="sm" onClick={onCreate}>
                  <Plus className="size-4" />
                  {emptyActionLabel}
                </Button>
              </span>
            ) : null}
          </div>
        ) : visibleTransferTasks.map((task) => {
          const nextAction = getNextTaskStatusAction(task)
          const canRunStatusAction = canManageWorkflow && Boolean(nextAction)
          const completionBlockers = completionBlockersByTaskId.get(task.id) || EMPTY_COMPLETION_BLOCKERS
          const nextActionBlocked = nextAction?.status === "done" && completionBlockers.length > 0
          const blockedActionLabel = getCompletionBlockerActionLabel(completionBlockers)
          const canEditChecklist = canManageWorkflow && canEditTaskDetails(task)
          const detailAriaLabel = getTransferTaskDetailAriaLabel(task)

          return (
            <div
              key={task.id}
              role="row"
              className="grid min-w-full border-b last:border-b-0 hover:bg-muted/30 [grid-template-columns:var(--transfer-grid-template)]"
              style={gridTemplateStyle}
            >
              {TRANSFER_TABLE_COLUMNS.map((column) => {
                const value = getTransferTableValue(task, column.columnKey)
                if (column.columnKey === "status") {
                  return (
                    <WithdrawalDataCell key={column.columnKey} value={value} onOpenDetail={() => onOpen(task)} detailAriaLabel={detailAriaLabel}>
                      <WithdrawalWorkflowStatusBadge status={task.status} />
                    </WithdrawalDataCell>
                  )
                }
                if (column.columnKey === "action") {
                  return (
                    <WithdrawalDataCell key={column.columnKey} value="" align="right">
                      <span className="flex flex-wrap justify-end gap-1.5">
                        {canRunStatusAction && nextAction && (
                          <Button
                            type="button"
                            variant={nextActionBlocked ? "outline" : "default"}
                            size="sm"
                            aria-label={`${task.title}: ${nextActionBlocked ? blockedActionLabel : nextAction.label}`}
                            title={nextActionBlocked ? `${completionBlockers.join(", ")} 연결 필요` : undefined}
                            onClick={() => {
                              if (nextActionBlocked) {
                                onEdit(task, completionBlockers)
                                return
                              }
                              onStatusChange(task, nextAction.status)
                            }}
                            disabled={statusActionDisabled}
                          >
                            {nextActionBlocked ? blockedActionLabel : nextAction.label}
                          </Button>
                        )}
                        {canEditTaskDetails(task) && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            aria-label={`${task.title} 수정`}
                            onClick={() => onEdit(task)}
                            disabled={statusActionDisabled}
                          >
                            수정
                          </Button>
                        )}
                      </span>
                    </WithdrawalDataCell>
                  )
                }
                if (column.columnKey === "operationsChecklist") {
                  return (
                    <WithdrawalDataCell key={column.columnKey} value={value}>
                      <TransferOperationsChecklistChips
                        transfer={task.transfer}
                        editable={canEditChecklist}
                        disabled={statusActionDisabled}
                        onChange={(field, checked) => onChecklistChange(task, field, checked)}
                      />
                    </WithdrawalDataCell>
                  )
                }
                return (
                  <WithdrawalDataCell
                    key={column.columnKey}
                    value={value}
                    align={column.align}
                    onOpenDetail={() => onOpen(task)}
                    detailAriaLabel={detailAriaLabel}
                  />
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function getWithdrawalNotificationTriggerForStatus(status: OpsTaskStatus): WithdrawalNotificationTriggerKey | null {
  if (status === "in_progress") return "processing"
  if (status === "done") return "completed"
  return null
}

function buildWithdrawalNotificationContext(task: OpsTask, triggerKey: WithdrawalNotificationTriggerKey): Record<string, string> {
  const withdrawal = task.withdrawal || {}
  const teacherName = withdrawal.teacherName || task.assigneeLabel || ""
  const triggerLabel = WITHDRAWAL_NOTIFICATION_TRIGGERS.find((trigger) => trigger.key === triggerKey)?.label || ""
  const progress = getWithdrawalProgressLabel(task)

  return {
    상태: getTaskStatusLabel(task.status),
    과목: task.subject || "",
    선생님: teacherName,
    수업: task.className || "",
    학생: task.studentName || "",
    퇴원일: dateInputValue(withdrawal.withdrawalDate) || "",
    퇴원회차: withdrawal.withdrawalSession || "",
    "진행 수업시수": withdrawal.completedLessonHours || "",
    "4주 기준 수업시수": withdrawal.fourWeekLessonHours || "",
    수업진행률: progress === "-" ? "" : progress,
    "고객 퇴원사유": withdrawal.customerReason || "",
    "선생님 의견": withdrawal.teacherOpinion || "",
    "미배부 교재": withdrawal.undistributedTextbooks || "",
    신청자: task.requestedByLabel || "",
    신청일시: dateLabel(task.createdAt),
    담당선생님: teacherName,
    관리팀: task.assigneeTeam || task.assigneeLabel || "관리팀",
    프로세스: triggerLabel,
  }
}

function buildTransferNotificationContext(task: OpsTask, triggerKey: WithdrawalNotificationTriggerKey): Record<string, string> {
  const transfer = task.transfer || {}
  const teacherName = transfer.fromTeacherName || task.assigneeLabel || ""
  const triggerLabel = WITHDRAWAL_NOTIFICATION_TRIGGERS.find((trigger) => trigger.key === triggerKey)?.label || ""

  return {
    상태: getTaskStatusLabel(task.status),
    과목: task.subject || "",
    "전 선생님": transfer.fromTeacherName || "",
    "전 수업": transfer.fromClassName || "",
    학생: task.studentName || "",
    전반사유: transfer.transferReason || "",
    "전 미배부 교재": transfer.fromUndistributedTextbooks || "",
    "전 수업 종료일": dateInputValue(transfer.fromClassEndDate) || "",
    "전 종료회차": transfer.fromClassEndSession || "",
    "후 선생님": transfer.toTeacherName || "",
    "후 수업": transfer.toClassName || task.className || "",
    "후 수업 시작일": dateInputValue(transfer.toClassStartDate) || "",
    "후 시작회차": transfer.toClassStartSession || "",
    "후 미배부 교재": transfer.toUndistributedTextbooks || "",
    신청자: task.requestedByLabel || "",
    신청일시: dateLabel(task.createdAt),
    담당선생님: teacherName,
    관리팀: task.assigneeTeam || task.assigneeLabel || "관리팀",
    프로세스: triggerLabel,
  }
}

function getRegistrationNotificationTriggerForPipelineStatus(pipelineStatus?: string): WithdrawalNotificationTriggerKey {
  const status = String(pipelineStatus || REGISTRATION_PIPELINE_STATUSES[0]?.value || "").trim()
  if (status.startsWith("0.")) return "submitted"
  if (status.startsWith("7.") || status.startsWith("8.") || status.startsWith("9.")) return "completed"
  return "processing"
}

function buildRegistrationNotificationContext(task: OpsTask, triggerKey: WithdrawalNotificationTriggerKey): Record<string, string> {
  const registration = task.registration || {}
  const triggerLabel = REGISTRATION_NOTIFICATION_TRIGGERS.find((trigger) => trigger.key === triggerKey)?.label || ""
  const counselor = registration.counselor || task.assigneeLabel || ""

  return {
    진행상태: registration.pipelineStatus || REGISTRATION_PIPELINE_STATUSES[0]?.value || "0. 등록 문의",
    과목: task.subject || "",
    학년: registration.schoolGrade || "",
    학교: registration.schoolName || "",
    학생: task.studentName || "",
    "학부모 전화": registration.parentPhone || "",
    문의일시: dateLabel(registration.inquiryAt || ""),
    "상담 책임자": counselor,
    레벨테스트: dateLabel(registration.levelTestAt || ""),
    전화상담: dateLabel(registration.phoneConsultationAt || ""),
    방문상담: getRegistrationVisitConsultationLabel(task),
    수업: task.className || "",
    수업시작일: dateInputValue(registration.classStartDate) || "",
    수업시작회차: registration.classStartSession || "",
    "요청 사항": registration.requestNote || "",
    "등록 확인": getRegistrationOperationsChecklistValue(registration),
    신청자: task.requestedByLabel || "",
    신청일시: dateLabel(task.createdAt),
    관리팀: task.assigneeTeam || task.assigneeLabel || "관리팀",
    프로세스: triggerLabel,
  }
}

async function sendWithdrawalGoogleChatNotification({
  channel,
  title,
  body,
  sessionToken,
  task,
  triggerKey,
}: {
  channel: GoogleChatChannel
  title: string
  body: string
  sessionToken: string
  task: OpsTask
  triggerKey: WithdrawalNotificationTriggerKey
}) {
  const textBody = [title, body].map((value) => value.trim()).filter(Boolean).join("\n")
  if (!sessionToken || !textBody) return

  const response = await fetch("/api/google-chat", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${sessionToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      channel,
      text: textBody,
      metadata: {
        taskId: task.id,
        taskType: task.type,
        triggerKey,
      },
    }),
  })
  if (!response.ok) throw new Error(await response.text())
}

async function notifyWithdrawalWorkflow(
  triggerKey: WithdrawalNotificationTriggerKey | null,
  task: OpsTask,
  withdrawalNotificationSettings: WithdrawalNotificationSetting[],
  withdrawalNotificationTemplates: Record<WithdrawalNotificationTriggerKey, WithdrawalNotificationTemplate>,
  sessionToken: string,
) {
  if (!triggerKey || task.type !== "withdrawal") return

  const template = withdrawalNotificationTemplates[triggerKey]
  if (!template) return

  const context = buildWithdrawalNotificationContext(task, triggerKey)
  const title = renderWithdrawalNotificationTemplate(template.titleTemplate, context)
  const body = renderWithdrawalNotificationTemplate(template.bodyTemplate, context)
  const enabledSettings = withdrawalNotificationSettings.filter((setting) => (
    setting.triggerKey === triggerKey && setting.enabled
  ))

  await Promise.allSettled(enabledSettings.map((setting) => {
    const googleChatChannel = WITHDRAWAL_GOOGLE_CHAT_CHANNEL_MAP[setting.channelKey]
    if (!googleChatChannel) return Promise.resolve()
    return sendWithdrawalGoogleChatNotification({
      channel: googleChatChannel,
      title,
      body,
      sessionToken,
      task,
      triggerKey,
    })
  }))
}

async function notifyTransferWorkflow(
  triggerKey: WithdrawalNotificationTriggerKey | null,
  task: OpsTask,
  transferNotificationSettings: WithdrawalNotificationSetting[],
  transferNotificationTemplates: Record<WithdrawalNotificationTriggerKey, WithdrawalNotificationTemplate>,
  sessionToken: string,
) {
  if (!triggerKey || task.type !== "transfer") return

  const template = transferNotificationTemplates[triggerKey]
  if (!template) return

  const context = buildTransferNotificationContext(task, triggerKey)
  const title = renderWithdrawalNotificationTemplate(template.titleTemplate, context, TRANSFER_NOTIFICATION_TEMPLATE_VARIABLES)
  const body = renderWithdrawalNotificationTemplate(template.bodyTemplate, context, TRANSFER_NOTIFICATION_TEMPLATE_VARIABLES)
  const enabledSettings = transferNotificationSettings.filter((setting) => (
    setting.triggerKey === triggerKey && setting.enabled
  ))

  await Promise.allSettled(enabledSettings.map((setting) => {
    const googleChatChannel = WITHDRAWAL_GOOGLE_CHAT_CHANNEL_MAP[setting.channelKey]
    if (!googleChatChannel) return Promise.resolve()
    return sendWithdrawalGoogleChatNotification({
      channel: googleChatChannel,
      title,
      body,
      sessionToken,
      task,
      triggerKey,
    })
  }))
}

async function notifyRegistrationWorkflow(
  triggerKey: WithdrawalNotificationTriggerKey | null,
  task: OpsTask,
  registrationNotificationSettings: WithdrawalNotificationSetting[],
  registrationNotificationTemplates: Record<WithdrawalNotificationTriggerKey, WithdrawalNotificationTemplate>,
  sessionToken: string,
) {
  if (!triggerKey || task.type !== "registration") return
  if (getRegistrationPipelinePrefix(task.registration?.pipelineStatus) === "2.") return

  const template = registrationNotificationTemplates[triggerKey]
  if (!template) return

  const context = buildRegistrationNotificationContext(task, triggerKey)
  const title = renderWithdrawalNotificationTemplate(template.titleTemplate, context, REGISTRATION_NOTIFICATION_TEMPLATE_VARIABLES)
  const body = renderWithdrawalNotificationTemplate(template.bodyTemplate, context, REGISTRATION_NOTIFICATION_TEMPLATE_VARIABLES)
  const enabledSettings = registrationNotificationSettings.filter((setting) => (
    setting.triggerKey === triggerKey && setting.enabled
  ))

  await Promise.allSettled(enabledSettings.map((setting) => {
    const googleChatChannel = WITHDRAWAL_GOOGLE_CHAT_CHANNEL_MAP[setting.channelKey]
    if (!googleChatChannel) return Promise.resolve()
    return sendWithdrawalGoogleChatNotification({
      channel: googleChatChannel,
      title,
      body,
      sessionToken,
      task,
      triggerKey,
    })
  }))
}

function WithdrawalNotificationSettingsDialog({
  open,
  onOpenChange,
  isManager,
  sessionToken,
  workflowLabel = "퇴원",
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  isManager: boolean
  sessionToken: string
  workflowLabel?: string
}) {
  const [selectedWebhookInfo, setSelectedWebhookInfo] = useState<WithdrawalGoogleChatWebhookInfo | null>(null)
  const [webhookUrlInput, setWebhookUrlInput] = useState("")
  const [webhookInfoLoading, setWebhookInfoLoading] = useState<WithdrawalNotificationChannelKey | "">("")
  const [webhookInfoSaving, setWebhookInfoSaving] = useState(false)
  const [webhookInfoError, setWebhookInfoError] = useState("")
  const webhookInfoPanelRef = useRef<HTMLDivElement | null>(null)

  async function handleOpenWithdrawalWebhookInfo(channelKey: WithdrawalNotificationChannelKey) {
    const googleChatChannel = WITHDRAWAL_GOOGLE_CHAT_CHANNEL_MAP[channelKey]
    if (!googleChatChannel) return

    const channelLabel = WITHDRAWAL_NOTIFICATION_CHANNELS.find((channel) => channel.key === channelKey)?.label || "구글챗"
    setSelectedWebhookInfo({
      channelKey,
      channelLabel,
      envName: "",
      configured: false,
      maskedUrl: "",
    })
    setWebhookUrlInput("")
    setWebhookInfoError("")

    if (!sessionToken) {
      setWebhookInfoError("로그인 세션을 확인할 수 없습니다.")
      return
    }

    setWebhookInfoLoading(channelKey)
    try {
      const response = await fetch(`/api/google-chat?channel=${encodeURIComponent(googleChatChannel)}`, {
        headers: {
          Authorization: `Bearer ${sessionToken}`,
        },
      })
      const payload = await response.json().catch(() => ({})) as WithdrawalGoogleChatWebhookInfoResponse
      if (!response.ok || !payload.ok) {
        throw new Error(stringValue(payload.error) || "웹훅 정보를 불러오지 못했습니다.")
      }
      setSelectedWebhookInfo({
        channelKey,
        channelLabel,
        envName: stringValue(payload.envName),
        configured: Boolean(payload.configured),
        maskedUrl: stringValue(payload.maskedUrl),
      })
    } catch (error) {
      setWebhookInfoError(error instanceof Error ? error.message : "웹훅 정보를 불러오지 못했습니다.")
    } finally {
      setWebhookInfoLoading("")
    }
  }

  async function handleSaveWithdrawalWebhookInfo() {
    if (!selectedWebhookInfo) return
    if (!isManager) {
      setWebhookInfoError("관리 권한이 있는 계정만 웹훅 URL을 변경할 수 있습니다.")
      return
    }
    if (!sessionToken) {
      setWebhookInfoError("로그인 세션을 확인할 수 없습니다.")
      return
    }

    const googleChatChannel = WITHDRAWAL_GOOGLE_CHAT_CHANNEL_MAP[selectedWebhookInfo.channelKey]
    const webhookUrl = stringValue(webhookUrlInput)
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
          Authorization: `Bearer ${sessionToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          channel: googleChatChannel,
          webhookUrl,
        }),
      })
      const payload = await response.json().catch(() => ({})) as WithdrawalGoogleChatWebhookInfoResponse
      if (!response.ok || !payload.ok) {
        throw new Error(stringValue(payload.error) || "웹훅 URL을 저장하지 못했습니다.")
      }
      setSelectedWebhookInfo((current) => current ? {
        ...current,
        envName: stringValue(payload.envName),
        configured: Boolean(payload.configured),
        maskedUrl: stringValue(payload.maskedUrl),
      } : current)
      setWebhookUrlInput("")
    } catch (error) {
      setWebhookInfoError(error instanceof Error ? error.message : "웹훅 URL을 저장하지 못했습니다.")
    } finally {
      setWebhookInfoSaving(false)
    }
  }

  useEffect(() => {
    if (!selectedWebhookInfo && !webhookInfoError) return
    webhookInfoPanelRef.current?.scrollIntoView({ block: "start" })
  }, [selectedWebhookInfo, webhookInfoError])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[86vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{workflowLabel} 알림 설정</DialogTitle>
          <DialogDescription className="sr-only">
            {workflowLabel} 알림 설정의 현재 제공 범위와 저장되는 Google Chat 연결을 확인합니다.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div
            data-testid="task-notification-settings-containment"
            className="grid gap-1.5 rounded-md border bg-muted/20 p-4 text-sm"
          >
            <span className="font-medium">알림 설정 준비 중</span>
            <p className="text-muted-foreground">
              공통 알림 설정 저장 기능이 적용될 때까지 알림 켜기/끄기와 내용 편집은 사용할 수 없습니다.
            </p>
            <p className="text-xs text-muted-foreground">현재 기존 알림 발송 동작은 변경되지 않습니다.</p>
          </div>

          <div
            data-testid="task-notification-webhook-connection"
            className="grid gap-3 rounded-md border p-4"
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="grid gap-0.5">
                <span className="text-sm font-medium">Google Chat 연결</span>
                <span className="text-xs text-muted-foreground">이 연결 정보만 서버에 저장됩니다.</span>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={webhookInfoLoading === "google_chat_admin"}
                aria-label="구글챗 · 관리팀 웹훅 관리"
                onClick={() => void handleOpenWithdrawalWebhookInfo("google_chat_admin")}
              >
                {webhookInfoLoading === "google_chat_admin" ? "확인 중" : "구글챗 · 관리팀 웹훅 관리"}
              </Button>
            </div>

            {selectedWebhookInfo || webhookInfoError ? (
              <div ref={webhookInfoPanelRef} className="grid gap-2 rounded-md border bg-muted/20 p-3 text-xs">
                {selectedWebhookInfo ? (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{selectedWebhookInfo.channelLabel}</span>
                      <Badge variant={selectedWebhookInfo.configured ? "default" : "outline"}>
                        {webhookInfoLoading === selectedWebhookInfo.channelKey
                          ? "확인 중"
                          : selectedWebhookInfo.configured
                            ? "연결됨"
                            : "미설정"}
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
                    {isManager ? (
                      <div className="grid gap-1">
                        <Label htmlFor="withdrawal-google-chat-webhook-url" className="text-xs text-muted-foreground">
                          웹훅 URL 수정
                        </Label>
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <Input
                            id="withdrawal-google-chat-webhook-url"
                            type="password"
                            value={webhookUrlInput}
                            onChange={(event) => setWebhookUrlInput(event.target.value)}
                            placeholder="새 구글챗 웹훅 URL 입력"
                            disabled={webhookInfoSaving}
                          />
                          <Button
                            type="button"
                            size="sm"
                            className="shrink-0"
                            disabled={webhookInfoSaving || !webhookUrlInput.trim()}
                            onClick={() => void handleSaveWithdrawalWebhookInfo()}
                          >
                            웹훅 URL 저장
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </>
                ) : null}
                {webhookInfoError ? <div className="text-destructive">{webhookInfoError}</div> : null}
              </div>
            ) : null}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            닫기
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function TransferNotificationSettingsDialog(props: Omit<Parameters<typeof WithdrawalNotificationSettingsDialog>[0], "workflowLabel">) {
  return <WithdrawalNotificationSettingsDialog {...props} workflowLabel="전반" />
}

function RegistrationNotificationSettingsDialog(props: Omit<Parameters<typeof WithdrawalNotificationSettingsDialog>[0], "workflowLabel">) {
  return <WithdrawalNotificationSettingsDialog {...props} workflowLabel="등록" />
}

function RegistrationCustomerMessageDialog({
  open,
  onOpenChange,
  task,
  sessionToken,
  canSend,
  onSent,
  onManualSent,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  task: OpsTask | null
  sessionToken: string
  canSend: boolean
  onSent: (taskId: string) => Promise<void>
  onManualSent: (taskId: string) => Promise<void>
}) {
  const [registrationCustomerMessageStatus, setRegistrationCustomerMessageStatus] = useState<RegistrationCustomerMessageStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [message, setMessage] = useState("")
  const [notice, setNotice] = useState("")
  const latestRegistrationMessageTaskId = useRef(task?.id || "")

  useEffect(() => {
    latestRegistrationMessageTaskId.current = task?.id || ""
  }, [task?.id])

  const loadRegistrationCustomerMessageStatus = useCallback(async (signal?: AbortSignal) => {
    if (!task?.id || !sessionToken) return
    const requestTaskId = task.id
    setLoading(true)
    setMessage("")
    try {
      const response = await fetch(`/api/solapi/registration?taskId=${encodeURIComponent(task.id)}`, {
        headers: { Authorization: `Bearer ${sessionToken}` },
        signal,
      })
      const payload = await response.json().catch(() => ({})) as Partial<RegistrationCustomerMessageStatus> & { error?: string }
      if (!response.ok) throw new Error(payload.error || "메시지 연결 상태를 불러오지 못했습니다.")
      if (signal?.aborted || latestRegistrationMessageTaskId.current !== requestTaskId) return
      setRegistrationCustomerMessageStatus({
        configured: Boolean(payload.configured),
        missing: Array.isArray(payload.missing) ? payload.missing.map(String) : [],
        studentName: String(payload.studentName || task.studentName || ""),
        recipientLast4: String(payload.recipientLast4 || ""),
        admissionNoticeSent: Boolean(payload.admissionNoticeSent),
        pipelineStatus: String(payload.pipelineStatus || task.registration?.pipelineStatus || ""),
        history: Array.isArray(payload.history) ? payload.history as RegistrationCustomerMessageHistory[] : [],
      })
    } catch (error) {
      if (signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) return
      setMessage(error instanceof Error ? error.message : "메시지 연결 상태를 불러오지 못했습니다.")
    } finally {
      if (!signal?.aborted && latestRegistrationMessageTaskId.current === requestTaskId) setLoading(false)
    }
  }, [sessionToken, task])

  useEffect(() => {
    if (!open) {
      setRegistrationCustomerMessageStatus(null)
      setMessage("")
      setNotice("")
      return
    }
    const controller = new AbortController()
    void loadRegistrationCustomerMessageStatus(controller.signal)
    return () => controller.abort()
  }, [loadRegistrationCustomerMessageStatus, open])

  async function copyMakeEduAdmissionMessage() {
    if (!task) return
    setMessage("")
    setNotice("")
    try {
      await navigator.clipboard.writeText(getRegistrationMakeEduAdmissionMessage(task.studentName))
      setNotice("메이크에듀용 안내 내용을 복사했습니다.")
    } catch {
      setMessage("안내 내용을 복사하지 못했습니다.")
    }
  }

  async function completeManualRegistrationAdmissionMessage() {
    if (!task?.id || !canSend) return
    setSending(true)
    setMessage("")
    setNotice("")
    try {
      await onManualSent(task.id)
      await loadRegistrationCustomerMessageStatus()
      setNotice("메이크에듀 발송 완료를 등록 단계에 반영했습니다.")
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "메이크에듀 발송 완료를 반영하지 못했습니다.")
    } finally {
      setSending(false)
    }
  }

  async function sendRegistrationAdmissionMessage() {
    if (!task?.id || !sessionToken || !registrationCustomerMessageStatus?.configured) return
    setSending(true)
    setMessage("")
    setNotice("")
    let providerAccepted = false
    try {
      const requestKey = globalThis.crypto?.randomUUID?.() || `${task.id}-${Date.now()}`
      const response = await fetch("/api/solapi/registration", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${sessionToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ taskId: task.id, requestKey }),
      })
      const payload = await response.json().catch(() => ({})) as { error?: string; syncWarning?: string }
      if (!response.ok) throw new Error(payload.error || "알림톡을 접수하지 못했습니다.")
      providerAccepted = true
      try {
        await onSent(task.id)
        await loadRegistrationCustomerMessageStatus()
        setNotice(payload.syncWarning || "입학신청서 알림톡을 접수했습니다.")
      } catch {
        setNotice("알림톡은 접수됐지만 화면 새로고침에 실패했습니다. 잠시 후 다시 확인하세요.")
      }
    } catch (error) {
      if (providerAccepted) {
        setNotice("알림톡은 접수됐지만 화면 새로고침에 실패했습니다. 잠시 후 다시 확인하세요.")
      } else {
        setMessage(error instanceof Error ? error.message : "알림톡을 접수하지 못했습니다.")
      }
    } finally {
      setSending(false)
    }
  }

  const studentName = registrationCustomerMessageStatus?.studentName || task?.studentName || "학생"
  const recipientLast4 = registrationCustomerMessageStatus?.recipientLast4 || ""
  const history = registrationCustomerMessageStatus?.history || []

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-1rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>입학신청서 발송</DialogTitle>
          <DialogDescription className="sr-only">입학신청서 안내를 확인하고 메이크에듀용 내용을 복사하거나 알림톡으로 발송합니다.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="flex flex-wrap items-center gap-2 border-b pb-3 text-sm">
            <span className="font-medium">{studentName}</span>
            <span className="text-muted-foreground">학부모 전화 · 끝 {recipientLast4 || "미입력"}</span>
            <Badge variant={registrationCustomerMessageStatus?.configured ? "default" : "outline"} className="ml-auto">
              {loading ? "확인 중" : registrationCustomerMessageStatus?.configured ? "SOLAPI 연결됨" : "검수/설정 대기"}
            </Badge>
          </div>

          {message ? <div role="alert" className="rounded-md border border-destructive/30 px-3 py-2 text-sm text-destructive">{message}</div> : null}
          {message ? (
            <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => void loadRegistrationCustomerMessageStatus()} disabled={loading}>
              <RefreshCw className="size-4" aria-hidden="true" />
              다시 확인
            </Button>
          ) : null}
          {notice ? <div role="status" className="rounded-md border border-primary/25 bg-primary/5 px-3 py-2 text-sm text-primary">{notice}</div> : null}

          {!loading && registrationCustomerMessageStatus && !registrationCustomerMessageStatus.configured ? (
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span>연결 대기:</span>
              {registrationCustomerMessageStatus.missing.map((item) => <Badge key={item} variant="outline">{item}</Badge>)}
            </div>
          ) : null}

          <section className="grid gap-2 border-b pb-4">
            <h3 className="text-sm font-semibold">알림톡 미리보기</h3>
            <div className="whitespace-pre-wrap rounded-md bg-muted/35 px-3 py-3 text-sm leading-6">
              {getRegistrationAdmissionSolapiMessage(studentName)}
            </div>
            <a href={REGISTRATION_ADMISSION_FORM_URL} target="_blank" rel="noreferrer" className="w-fit text-sm font-medium text-primary underline-offset-4 hover:underline">
              입학신청서 열기
            </a>
          </section>

          {history.length > 0 ? (
            <section className="grid gap-2">
              <h3 className="text-sm font-semibold">최근 발송</h3>
              <div className="divide-y rounded-md border">
                {history.map((item) => (
                  <div key={item.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
                    <Badge variant={item.status === "accepted" ? "default" : item.status === "failed" ? "destructive" : "outline"}>
                      {item.status === "accepted" ? "접수" : item.status === "failed" ? "실패" : item.status === "unknown" ? "확인 필요" : "처리 중"}
                    </Badge>
                    <span>{dateLabel(item.created_at || "")}</span>
                    <span className="text-muted-foreground">끝 {item.recipient_last4 || "-"}</span>
                    <span className="ml-auto text-muted-foreground">{item.provider_status_message || item.provider_status_code || "-"}</span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="button" variant="outline" onClick={() => void copyMakeEduAdmissionMessage()}>
              <Copy className="size-4" aria-hidden="true" />
              메이크에듀용 내용 복사
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void completeManualRegistrationAdmissionMessage()}
              disabled={sending || loading || !canSend || Boolean(registrationCustomerMessageStatus?.admissionNoticeSent)}
            >
              <Check className="size-4" aria-hidden="true" />
              메이크에듀 발송 완료
            </Button>
          </div>
          <Button
            type="button"
            onClick={() => void sendRegistrationAdmissionMessage()}
            disabled={sending || loading || !canSend || !recipientLast4 || !registrationCustomerMessageStatus?.configured}
            title={!registrationCustomerMessageStatus?.configured ? "SOLAPI 승인 템플릿 연결 후 발송할 수 있습니다." : undefined}
          >
            <Send className="size-4" aria-hidden="true" />
            {sending ? "접수 중" : "알림톡 발송"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function renderWithdrawalNotificationTemplate(
  template: string,
  context: Record<string, string> = WITHDRAWAL_NOTIFICATION_TEMPLATE_PREVIEW_CONTEXT,
  variables: ReadonlyArray<string> = WITHDRAWAL_NOTIFICATION_TEMPLATE_VARIABLES,
) {
  return variables.reduce((result, variable) => (
    result.split(`{${variable}}`).join(context[variable] || "")
  ), template)
}

function DashboardMetric({
  label,
  value,
  active,
  onClick,
}: {
  label: string
  value: number
  active?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={[
        "inline-flex shrink-0 items-center gap-2 rounded-md border px-3 py-1.5 text-left text-sm transition-colors active:translate-y-px",
        active
          ? "border-primary/50 bg-primary/5 text-primary"
          : "bg-background hover:border-primary/40 hover:bg-primary/5",
      ].join(" ")}
    >
      <span className={["truncate", active ? "text-primary" : "text-muted-foreground"].join(" ")}>{label}</span>
      <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-semibold text-foreground">{value}</span>
    </button>
  )
}

function TaskStatusBadge({ status }: { status: OpsTaskStatus }) {
  const variant = status === "done" ? "secondary" : status === "canceled" ? "outline" : "default"
  return <Badge variant={variant}>{getTaskStatusLabel(status)}</Badge>
}

function getWithdrawalWorkflowStatusLabel(status: OpsTaskStatus) {
  if (status === "done") return "완료"
  if (status === "requested") return "신청"
  if (status === "canceled") return "취소"
  return "처리 중"
}

function WithdrawalWorkflowStatusBadge({ status }: { status: OpsTaskStatus }) {
  const variant = status === "done" ? "secondary" : status === "requested" ? "outline" : "default"
  return <Badge variant={variant}>{getWithdrawalWorkflowStatusLabel(status)}</Badge>
}

function RegistrationWorkflowStatusBadge({ task }: { task: OpsTask }) {
  const status = task.registration?.pipelineStatus || REGISTRATION_PIPELINE_STATUSES[0]?.value || "0. 등록 문의"
  const prefix = getRegistrationPipelinePrefix(status)
  const variant = prefix.startsWith("7.") ? "secondary" : prefix.startsWith("8.") || prefix.startsWith("9.") ? "outline" : prefix.startsWith("0.") ? "outline" : "default"
  const pipelineLabel = getCompactRegistrationPipelineLabel(status)
  const label = task.status === "on_hold" ? `보류 · ${pipelineLabel}` : pipelineLabel
  return <Badge variant={task.status === "on_hold" ? "outline" : variant}>{label}</Badge>
}

function TaskTypeBadge({ type }: { type: OpsTaskType }) {
  return <Badge variant="outline">{getTaskTypeLabel(type)}</Badge>
}

function AutoSyncInlineBadge({ task }: { task: OpsTask }) {
  const autoSyncedEvents = getAutoSyncedEvents(task)
  if (task.type === "general" || autoSyncedEvents.length === 0) return null
  const autoSyncSummary = autoSyncedEvents.map(getOpsTaskEventLabel).join(" / ")

  return (
    <span
      aria-label={`자동 반영 ${autoSyncedEvents.length}건 완료`}
      title={autoSyncSummary}
      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-primary/20 bg-primary/5 px-1.5 py-0.5 text-[11px] font-medium text-primary"
    >
      <Check className="size-3" />
      반영 완료
    </span>
  )
}

function TodoPriorityBadge({ priority, showNormal = false }: { priority: OpsTaskPriority; showNormal?: boolean }) {
  if (priority === "normal" && !showNormal) return null

  const className =
    priority === "urgent"
      ? "border-red-200 bg-red-50 text-red-700"
      : priority === "high"
        ? "border-orange-200 bg-orange-50 text-orange-700"
        : priority === "low"
          ? "border-slate-200 bg-slate-50 text-slate-600"
          : "border-primary/25 bg-primary/5 text-primary"

  return (
    <Badge variant="outline" className={className}>
      {getTaskPriorityLabel(priority)}
    </Badge>
  )
}

function getNextTaskStatusAction(task: Pick<OpsTask, "status" | "type">): { status: OpsTaskStatus; label: string } | null {
  if (task.type === "registration") return null
  if (task.type === "withdrawal" && task.status === "done") return null
  if (task.type === "transfer" && task.status === "done") return null
  if (task.type === "withdrawal" && task.status === "canceled") return null
  if (task.type === "transfer" && task.status === "canceled") return null
  if (task.type === "withdrawal" && task.status === "requested") return { status: "in_progress", label: "처리 시작" }
  if (task.type === "transfer" && task.status === "requested") return { status: "in_progress", label: "처리 시작" }
  if (task.type === "withdrawal" && task.status === "confirmed") return { status: "in_progress", label: "처리 시작" }
  if (task.type === "transfer" && task.status === "confirmed") return { status: "in_progress", label: "처리 시작" }
  if (task.status === "canceled") return { status: "requested", label: "다시 열기" }
  if (task.status === "done") return { status: "requested", label: "다시 열기" }
  if (task.status === "on_hold") return { status: "in_progress", label: "재개" }
  if (task.status === "requested") return { status: "confirmed", label: "확인" }
  if (task.status === "confirmed") return { status: "in_progress", label: "진행" }
  if (task.type === "withdrawal" && task.status === "in_progress") return { status: "done", label: "완료" }
  if (task.type === "transfer" && task.status === "in_progress") return { status: "done", label: "완료" }
  if (task.status === "in_progress") return { status: "review_requested", label: "검토 요청" }
  if (task.status === "review_requested") return { status: "done", label: "완료" }
  return null
}

function canEditTaskDetails(task: Pick<OpsTask, "type" | "status">) {
  if (task.type === "registration") return canEditRegistrationTask(task as Pick<OpsTask, "type" | "status" | "registration">)
  return task.type === "general" || task.status !== "done"
}

function findRegistrationPipelineStatus(prefix: string) {
  return REGISTRATION_PIPELINE_STATUSES.find((status) => String(status.value || "").startsWith(prefix))?.value || ""
}

function getCompactRegistrationPipelineLabel(value: string) {
  return REGISTRATION_PIPELINE_STATUSES
    .find((status) => status.value === value)
    ?.label
    .replace(/^\d(?:-\d)?\.\s*/, "") || "다음 단계"
}

function getRegistrationPipelineActionBlockers(task: Pick<OpsTask, "studentId" | "studentName" | "classId" | "className" | "registration">, pipelineStatus: string) {
  return getRegistrationTransitionBlockers(task, pipelineStatus)
}

function getRegistrationDecisionActionsForTask(task: Pick<OpsTask, "type" | "status" | "registration">) {
  if (task.type !== "registration" || task.status === "done" || task.status === "canceled" || task.status === "on_hold") return []
  return getRegistrationBranchActions(task.registration?.pipelineStatus)
}

function isRegistrationDecisionPending(task: Pick<OpsTask, "type" | "status" | "registration">) {
  return getRegistrationDecisionActionsForTask(task).length > 0
}

function canOpenRegistrationCustomerMessage(task: Pick<OpsTask, "type" | "status" | "registration">) {
  if (task.type !== "registration" || task.status === "on_hold") return false
  return canSendRegistrationAdmissionMessage(task.registration?.pipelineStatus)
}

type RegistrationBranchAction = {
  prefix: string
  label: string
  tone: "primary" | "outline"
}

function RegistrationDecisionActions({
  task,
  onSelect,
  disabled = false,
}: {
  task: OpsTask
  onSelect: (task: OpsTask, pipelineStatus: string) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [pendingTerminalAction, setPendingTerminalAction] = useState<RegistrationBranchAction | null>(null)
  const availableActions = getRegistrationDecisionActionsForTask(task) as RegistrationBranchAction[]
  const currentPrefix = getRegistrationPipelinePrefix(task.registration?.pipelineStatus)
  const triggerLabel = currentPrefix === "0."
    ? "다음 방향"
    : currentPrefix === "3."
      ? "상담 결과"
      : "등록 전환"
  if (!isRegistrationDecisionPending(task)) return null

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            size="sm"
            variant="default"
            aria-label={`${task.title} ${triggerLabel}`}
            disabled={disabled}
          >
            {triggerLabel}
            <ChevronsUpDown className="size-3.5" aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-56 p-1">
          <div className="grid gap-1" role="menu" aria-label={`${task.title} ${triggerLabel} 선택`}>
            {availableActions.map((action) => {
              const pipelineStatus = findRegistrationPipelineStatus(action.prefix)
              if (!pipelineStatus) return null
              return (
                <Button
                  key={action.prefix}
                  type="button"
                  variant={action.tone === "primary" ? "default" : "ghost"}
                  size="sm"
                  role="menuitem"
                  className="justify-start"
                  onClick={() => {
                    setOpen(false)
                    if (["8.", "9."].includes(action.prefix)) {
                      setPendingTerminalAction(action)
                      return
                    }
                    onSelect(task, pipelineStatus)
                  }}
                >
                  {action.label}
                </Button>
              )
            })}
          </div>
        </PopoverContent>
      </Popover>
      <Dialog open={Boolean(pendingTerminalAction)} onOpenChange={(nextOpen) => !nextOpen && setPendingTerminalAction(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{pendingTerminalAction?.label}으로 종료할까요?</DialogTitle>
            <DialogDescription>
              등록 흐름이 완료 탭으로 이동합니다. 잘못 종료한 경우 상세 화면에서 다시 열 수 있습니다.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPendingTerminalAction(null)}>취소</Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                const pipelineStatus = findRegistrationPipelineStatus(pendingTerminalAction?.prefix || "")
                setPendingTerminalAction(null)
                if (pipelineStatus) onSelect(task, pipelineStatus)
              }}
            >
              종료
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function getNextRegistrationPipelineAction(task: Pick<OpsTask, "type" | "status" | "registration">): { pipelineStatus: string; label: string } | null {
  if (task.type !== "registration" || task.status === "done" || task.status === "canceled" || task.status === "on_hold") return null

  const currentPipelineStatus = task.registration?.pipelineStatus || REGISTRATION_PIPELINE_STATUSES[0]?.value || ""
  const currentPrefix = getRegistrationPipelinePrefix(currentPipelineStatus) || "0."
  const nextPrefix = REGISTRATION_PIPELINE_NEXT_PREFIXES[currentPrefix]
  if (!nextPrefix) return null

  const pipelineStatus = findRegistrationPipelineStatus(nextPrefix)
  if (!pipelineStatus) return null

  return {
    pipelineStatus,
    label: REGISTRATION_PIPELINE_NEXT_LABELS[currentPrefix] || `다음: ${getCompactRegistrationPipelineLabel(pipelineStatus)}`,
  }
}

function getSecondaryTaskStatusOptions(task: Pick<OpsTask, "status" | "type">) {
  if (task.status === "done" || task.status === "canceled") return []
  if (task.type === "word_retest") return []
  if (task.type === "registration") {
    if (task.status === "on_hold") return [{ value: "in_progress", label: "다시 진행" }]
    return OPS_TASK_STATUSES.filter((status) => status.value === "on_hold" && status.value !== task.status)
  }
  if (task.type !== "general") {
    return OPS_TASK_STATUSES.filter((status) => (
      ["on_hold", "canceled"].includes(status.value) &&
      status.value !== task.status &&
      status.value !== getNextTaskStatusAction(task)?.status
    ))
  }
  if (task.status === "review_requested") return [{ value: "in_progress", label: "수정 요청" }]
  return []
}

function getWordRetestPrimaryActions(task: OpsTask, mode: WordRetestMode, completionBlockers: string[] = EMPTY_COMPLETION_BLOCKERS): WordRetestPrimaryAction[] {
  if (getWordRetestWorkspaceRole(task) === "completed") return []

  const wordRetest = task.wordRetest || {}
  const absent = isWordRetestAbsent(wordRetest)
  const scoreResult = getWordRetestScoreResult(wordRetest)

  if (mode === "assistant") {
    if (task.status === "requested" || task.status === "confirmed" || task.status === "on_hold") {
      return [{ kind: "status", status: "in_progress", label: "시험 시작" }]
    }
    if (task.status === "in_progress") {
      if (absent) return []
      if (completionBlockers.length > 0) {
        return [{ kind: "edit", label: getCompletionBlockerActionLabel(completionBlockers), blockers: completionBlockers }]
      }
      return [{ kind: "word_retest_complete", label: scoreResult === "failed" ? "불합격 보고" : "합격 보고" }]
    }
  }

  if (mode === "teacher" && task.status === "review_requested") {
    if (absent) return [{ kind: "status", status: "done", label: "미응시 확인" }]
    if (scoreResult === "failed") {
      return [
        { kind: "word_retest_retry", label: "재시험 추가" },
        { kind: "status", status: "done", label: "불합격 확인" },
      ]
    }
    if (completionBlockers.length > 0) {
      return [{ kind: "edit", label: getCompletionBlockerActionLabel(completionBlockers), blockers: completionBlockers }]
    }
    return [{ kind: "status", status: "done", label: "합격 확인" }]
  }

  return []
}

function shouldShowDetailStatusBadge(task: Pick<OpsTask, "type" | "status">) {
  return task.type !== "general" || task.status === "review_requested" || isClosedOpsTask(task)
}

function getTaskPrimaryName(input: OpsTaskInput) {
  const candidates = input.type === "word_retest"
    ? [
        input.wordRetest?.studentName,
        input.studentName,
        input.wordRetest?.className,
        input.className,
        input.wordRetest?.textbookName,
      ]
    : input.type === "transfer"
      ? [
          input.studentName,
          input.transfer?.toClassName,
          input.transfer?.fromClassName,
          input.className,
        ]
      : input.type === "withdrawal"
        ? [
            input.studentName,
            input.className,
            input.withdrawal?.teacherName,
          ]
        : input.type === "registration"
          ? [
              input.studentName,
              input.className,
              input.registration?.schoolName,
              input.registration?.schoolGrade,
            ]
          : []

  return candidates.map((value) => String(value || "").trim()).find(Boolean) || ""
}

function buildFallbackTaskTitle(input: OpsTaskInput) {
  if (input.type === "general") return input.title.trim()

  const primaryName = getTaskPrimaryName(input)
  const typeLabel = getTaskTypeLabel(input.type)

  return primaryName ? `${typeLabel}: ${primaryName}` : ""
}

function normalizeFormForSubmit(input: OpsTaskInput): OpsTaskInput {
  if (input.type === "word_retest") {
    return {
      ...input,
      assigneeId: "",
      assigneeTeam: "조교팀",
    }
  }

  if (input.type !== "registration") return input

  const pipelineStatus = input.registration?.pipelineStatus || REGISTRATION_PIPELINE_STATUSES[0]?.value || "0. 등록 문의"
  const nextStatus = getRegistrationTaskStatusForPipeline(pipelineStatus, input.status) as OpsTaskStatus
  const transitionAt = new Date().toISOString()
  const nextCompletedAt = nextStatus === "done"
    ? input.completedAt || transitionAt
    : ""

  return {
    ...input,
    status: nextStatus,
    completedAt: nextCompletedAt,
    registration: prepareRegistrationPipelineTransition(input.registration || {}, pipelineStatus, transitionAt),
  }
}

function sanitizeRegistrationInquiryOnlyInput(input: OpsTaskInput): OpsTaskInput {
  if (input.type !== "registration") return input
  const registration = input.registration || {}
  return {
    ...input,
    status: "requested",
    completedAt: "",
    classId: "",
    className: "",
    textbookId: "",
    textbookTitle: "",
    secondaryAssigneeId: "",
    registration: {
      pipelineStatus: REGISTRATION_PIPELINE_STATUSES[0]?.value || "0. 등록 문의",
      inquiryAt: registration.inquiryAt || "",
      schoolGrade: registration.schoolGrade || "",
      schoolName: registration.schoolName || "",
      parentPhone: registration.parentPhone || "",
      studentPhone: registration.studentPhone || "",
      requestNote: registration.requestNote || "",
    },
  }
}

function getWordRetestStudentPayload(
  input: OpsTaskInput,
  studentId: string,
  students: OpsStudentOption[],
  indexes: OpsTaskOptionIndexes,
  useGeneratedTitle: boolean,
): OpsTaskInput {
  const student = findStudentOption(students, studentId, indexes)
  const studentName = student?.label || input.studentName || input.wordRetest?.studentName || ""
  const nextInput: OpsTaskInput = {
    ...input,
    studentId,
    studentName,
    wordRetest: {
      ...(input.wordRetest || {}),
      studentName,
    },
  }

  return {
    ...nextInput,
    title: useGeneratedTitle ? buildFallbackTaskTitle(nextInput) || input.title : input.title,
  }
}

function pickInputCompletedAt(input: OpsTaskInput, existing?: OpsTask) {
  if (Object.prototype.hasOwnProperty.call(input, "completedAt")) {
    return input.completedAt || ""
  }

  return existing?.completedAt || ""
}

function parseTodoistQuickAdd(
  rawText: string,
  profiles: OpsProfileOption[],
  {
    currentUserId,
    currentUserLabel,
    dueTodayValue,
    dueTomorrowValue,
  }: {
    currentUserId: string
    currentUserLabel: string
    dueTodayValue: string
    dueTomorrowValue: string
  },
): Pick<OpsTaskInput, "title" | "assigneeId" | "dueAt" | "priority" | "memo"> {
  const tokens = rawText
    .trim()
    .replace(/(\d{1,2})월\s+(\d{1,2})일/g, "$1월$2일")
    .replace(/(\d{1,2})\s*([/.])\s*(\d{1,2})/g, "$1$2$3")
    .replace(/\bthis week\b/gi, "thisweek")
    .replace(/\bnext week\b/gi, "nextweek")
    .replace(/\b(next|this)\s+(sun|sunday|mon|monday|tue|tuesday|wed|wednesday|thu|thursday|fri|friday|sat|saturday)\b/gi, "$1$2")
    .replace(/다음\s+(일요일|월요일|화요일|수요일|목요일|금요일|토요일)/g, "다음$1")
    .replace(/이번\s+(일요일|월요일|화요일|수요일|목요일|금요일|토요일)/g, "이번$1")
    .replace(/이번\s+주/g, "이번주")
    .replace(/다음\s+주/g, "다음주")
    .split(/\s+/)
    .filter(Boolean)
  let dueAt = ""
  let assigneeId = ""
  let priority: OpsTaskPriority = "normal"
  let explicitTime = ""
  let pendingMeridiem: QuickAddMeridiem | "" = ""
  let pendingWeekdayModifier: QuickAddWeekdayModifier = ""
  let pendingAssigneeLookup = false
  let pendingDueLookup = false
  let collectingQuickAddMemo = false
  const labels: string[] = []
  const titleTokens: string[] = []
  const weekdayTokens = new Map<string, number>([
    ["일요일", 0],
    ["sun", 0],
    ["sunday", 0],
    ["월요일", 1],
    ["mon", 1],
    ["monday", 1],
    ["화요일", 2],
    ["tue", 2],
    ["tuesday", 2],
    ["수요일", 3],
    ["wed", 3],
    ["wednesday", 3],
    ["목요일", 4],
    ["thu", 4],
    ["thursday", 4],
    ["금요일", 5],
    ["fri", 5],
    ["friday", 5],
    ["토요일", 6],
    ["sat", 6],
    ["saturday", 6],
  ])

  tokens.forEach((token) => {
    const cleanToken = cleanQuickAddToken(token)
    const normalized = normalizeQuickAddToken(token)
    if (!cleanToken) return
    const setDueAt = (nextDueAt: string) => {
      dueAt = explicitTime ? withTime(nextDueAt, explicitTime) : nextDueAt
    }
    const applyCompactDate = (dateToken: string) => {
      const compactDate = parseCompactQuickAddDateToken(dateToken.toLowerCase(), { dueTodayValue, dueTomorrowValue })
      if (!compactDate) return false
      setDueAt(compactDate.date)
      if (compactDate.time) {
        explicitTime = compactDate.time
        dueAt = withTime(dueAt, compactDate.time)
      }
      pendingMeridiem = ""
      pendingWeekdayModifier = ""
      return true
    }
    const applyDateToken = (dateToken: string) => {
      const normalizedDateToken = dateToken.trim().toLowerCase()
      if (!normalizedDateToken) return false
      if (normalizedDateToken.endsWith("까지")) return applyDateToken(normalizedDateToken.replace(/까지$/, ""))
      if (applyCompactDate(normalizedDateToken)) return true
      if (["오늘", "today"].includes(normalizedDateToken)) {
        setDueAt(dueTodayValue)
        pendingWeekdayModifier = ""
        return true
      }
      if (["내일", "tomorrow"].includes(normalizedDateToken)) {
        setDueAt(dueTomorrowValue)
        pendingWeekdayModifier = ""
        return true
      }
      if (["모레"].includes(normalizedDateToken)) {
        setDueAt(quickDateTimeInputValue(2))
        pendingWeekdayModifier = ""
        return true
      }
      if (["다음주", "nextweek"].includes(normalizedDateToken)) {
        setDueAt(quickDateTimeForNextWeekStart())
        pendingWeekdayModifier = "next"
        return true
      }
      if (["이번주", "thisweek"].includes(normalizedDateToken)) {
        setDueAt(quickDateTimeForThisWeekday(5))
        pendingWeekdayModifier = "this"
        return true
      }
      if (/^\d{4}-\d{2}-\d{2}$/.test(normalizedDateToken)) {
        setDueAt(`${normalizedDateToken}T09:00`)
        pendingWeekdayModifier = ""
        return true
      }
      const forceThisWeekday = pendingWeekdayModifier === "this" || normalizedDateToken.startsWith("이번") || normalizedDateToken.startsWith("this")
      const forceNextWeekday = pendingWeekdayModifier === "next" || normalizedDateToken.startsWith("다음") || normalizedDateToken.startsWith("next")
      const weekdayText = normalizedDateToken.replace(/^다음/, "").replace(/^이번/, "").replace(/^next/, "").replace(/^this/, "")
      const weekday = weekdayTokens.get(weekdayText)
      if (weekday !== undefined) {
        setDueAt(forceThisWeekday
          ? quickDateTimeForThisWeekday(weekday)
          : forceNextWeekday
            ? quickDateTimeForNextCalendarWeekday(weekday)
            : quickDateTimeForNextWeekday(weekday))
        pendingWeekdayModifier = ""
        return true
      }
      return false
    }
    const applyAssignee = (assigneeName: string) => {
      const nextAssigneeId = resolveQuickAddAssigneeId(assigneeName, profiles, currentUserId, currentUserLabel)
      if (nextAssigneeId) {
        assigneeId = nextAssigneeId
        return true
      }
      if (assigneeName.trim()) labels.push(`담당 후보: ${assigneeName.trim()}`)
      return false
    }

    if (collectingQuickAddMemo) {
      labels.push(normalizeQuickAddMemoToken(cleanToken))
      return
    }
    if (pendingDueLookup) {
      pendingDueLookup = false
      if (applyDateToken(cleanToken)) return
    }
    if (pendingAssigneeLookup) {
      pendingAssigneeLookup = false
      applyAssignee(cleanToken)
      return
    }
    const memoDirective = getQuickAddMemoDirective(cleanToken)
    if (memoDirective) {
      collectingQuickAddMemo = true
      if (memoDirective.value) labels.push(normalizeQuickAddMemoToken(memoDirective.value))
      return
    }
    const dueDirective = getQuickAddDueDirective(cleanToken)
    if (dueDirective) {
      if (dueDirective.value) applyDateToken(dueDirective.value)
      else pendingDueLookup = true
      return
    }
    const assigneeDirective = getQuickAddAssigneeDirective(cleanToken)
    if (assigneeDirective) {
      if (assigneeDirective.value) applyAssignee(assigneeDirective.value)
      else pendingAssigneeLookup = true
      return
    }
    if (["담당", "담당자", "assignee", "assign"].includes(normalized)) {
      pendingAssigneeLookup = true
      return
    }
    if (["마감", "마감일", "예정", "예정일", "기한", "일정", "due"].includes(normalized)) {
      pendingDueLookup = true
      return
    }
    if (applyDateToken(normalized)) return
    if (normalized === "오전" || normalized === "am") {
      pendingMeridiem = "am"
      return
    }
    if (normalized === "오후" || normalized === "pm") {
      pendingMeridiem = "pm"
      return
    }
    if (normalized === "다음" || normalized === "next") {
      pendingWeekdayModifier = "next"
      return
    }
    if (normalized === "이번" || normalized === "this") {
      pendingWeekdayModifier = "this"
      return
    }
    const normalizedTime = normalizeQuickAddTimeToken(normalized, pendingMeridiem || undefined)
    if (normalizedTime) {
      explicitTime = normalizedTime
      dueAt = withTime(dueAt, normalizedTime)
      pendingMeridiem = ""
      return
    }
    if (normalized === "나에게" || normalized === "+me") {
      assigneeId = currentUserId
      return
    }
    const priorityAlias = TODO_QUICK_ADD_PRIORITY_ALIASES[normalized]
    if (priorityAlias) {
      priority = priorityAlias
      return
    }
    if ((cleanToken.startsWith("@") || cleanToken.startsWith("#")) && cleanToken.length > 1) {
      labels.push(normalizeQuickAddMemoToken(cleanToken))
      return
    }
    if (cleanToken.startsWith("+") && cleanToken.length > 1) {
      const assigneeName = cleanToken.slice(1)
      applyAssignee(assigneeName)
      return
    }
    pendingMeridiem = ""
    pendingWeekdayModifier = ""
    titleTokens.push(cleanToken)
  })

  return {
    title: titleTokens.join(" ").trim(),
    assigneeId,
    dueAt,
    priority,
    memo: labels.length > 0 ? labels.join(" ") : "",
  }
}

function mergeOpsTaskWorkspaceOptionData(
  current: OpsTaskWorkspaceData,
  enrichment: OpsTaskWorkspaceOptionData,
): OpsTaskWorkspaceData {
  const profileLabels = new Map(enrichment.profiles.map((profile) => [profile.id, profile.label]))
  const enrichedTasks = current.tasks.map((task) => ({
    ...task,
    requestedByLabel: profileLabels.get(task.requestedBy) || task.requestedByLabel,
    assigneeLabel: profileLabels.get(task.assigneeId) || task.assigneeLabel,
    secondaryAssigneeLabel: profileLabels.get(task.secondaryAssigneeId) || task.secondaryAssigneeLabel,
    comments: task.comments.map((comment) => ({
      ...comment,
      authorLabel: profileLabels.get(comment.authorId) || comment.authorLabel,
    })),
    attachments: task.attachments.map((attachment) => ({
      ...attachment,
      uploadedByLabel: profileLabels.get(attachment.uploadedBy) || attachment.uploadedByLabel,
    })),
    events: task.events.map((event) => ({
      ...event,
      actorLabel: profileLabels.get(event.actorId) || event.actorLabel,
    })),
  }))

  return {
    ...current,
    tasks: enrichedTasks,
    profiles: enrichment.profiles,
    students: enrichment.students,
    classes: enrichment.classes,
    textbooks: enrichment.textbooks,
    teachers: enrichment.teachers,
  }
}

export function OpsTaskWorkspace({ workspace = "todo" }: { workspace?: WorkspaceKey }) {
  const { user } = useAuth()
  return <OpsTaskWorkspaceSession key={user?.id || "anonymous"} workspace={workspace} />
}

function OpsTaskWorkspaceSession({ workspace }: { workspace: WorkspaceKey }) {
  const router = useRouter()
  const pathname = usePathname()
  const scopedTaskType = WORKSPACE_TASK_TYPE[workspace]
  const isTodoWorkspace = workspace === "todo"
  const isRegistrationWorkspace = workspace === "registration"
  const isWithdrawalWorkspace = workspace === "withdrawal"
  const isTransferWorkspace = workspace === "transfer"
  const isWordRetestWorkspace = workspace === "word_retest"
  const searchParams = useSearchParams()
  const requestedWithdrawalStudentId = isWithdrawalWorkspace && searchParams.get("create") === "withdrawal"
    ? searchParams.get("studentId") || ""
    : ""
  const { user, session, canManageAll, isAdmin, isStaff, isTeacher } = useAuth()
  const notificationControlPlaneAvailability = useNotificationControlPlaneAvailability()
  const canonicalNotificationEnabled = notificationControlPlaneAvailability.status === "enabled"
  const legacyNotificationEnabled = notificationControlPlaneAvailability.status === "disabled"
  const notificationWorkflowKey = WORKSPACE_NOTIFICATION_WORKFLOW_KEY[workspace]
  const showNotificationSettingsLauncher = (canManageAll || isStaff)
  const showLegacyNotificationSettingsLauncher = legacyNotificationEnabled || (canonicalNotificationEnabled && showNotificationSettingsLauncher)
  const currentUserId = user?.id || ""
  const registrationFixtureValue = searchParams.get("fixture")
  const registrationFixtureRequested = isRegistrationWorkspace
    && shouldEnableRegistrationSubjectTrackFixture(process.env.NODE_ENV, registrationFixtureValue)
  const [registrationFixtureModule, setRegistrationFixtureModule] = useState<RegistrationSubjectTrackFixtureModule | null>(null)
  const registrationFixtureStateRef = useRef<RegistrationSubjectTrackFixtureState | null>(null)
  const [, setRegistrationFixtureRevision] = useState(0)
  useEffect(() => {
    if (!registrationFixtureRequested) {
      registrationFixtureStateRef.current = null
      setRegistrationFixtureModule(null)
      return
    }
    let disposed = false
    void import("./registration-track-fixtures").then((fixtureModule) => {
      if (disposed) return
      registrationFixtureStateRef.current = fixtureModule.createRegistrationSubjectTrackFixtureState()
      setRegistrationFixtureModule(fixtureModule)
      setRegistrationFixtureRevision((current) => current + 1)
    })
    return () => {
      disposed = true
      registrationFixtureStateRef.current = null
    }
  }, [registrationFixtureRequested])
  const registrationFixtureEnabled = Boolean(
    registrationFixtureRequested
    && registrationFixtureModule
    && registrationFixtureStateRef.current,
  )
  const registrationFixtureViewer = registrationFixtureEnabled
    ? registrationFixtureModule?.resolveRegistrationSubjectTrackFixtureViewer(
        registrationFixtureStateRef.current!,
        searchParams.get("fixtureRole"),
      ) || null
    : null
  const workspaceLoadOptions = isRegistrationWorkspace
    ? {
        taskType: scopedTaskType,
        viewerId: currentUserId,
        includeManagementOptions: false,
        includeTeacherOptions: false,
        includeProfileOptions: false,
      }
    : {
        taskType: scopedTaskType,
        viewerId: currentUserId,
        includeManagementOptions: !isTodoWorkspace,
        includeTeacherOptions: true,
        includeProfileOptions: true,
      }
  const initialWorkspaceData = registrationFixtureRequested
    ? null
    : getCachedOpsTaskWorkspaceData(workspaceLoadOptions)
  const [data, setData] = useState<OpsTaskWorkspaceData | null>(() => initialWorkspaceData)
  const [loading, setLoading] = useState(() => !initialWorkspaceData)
  const [registrationOptionsLoading, setRegistrationOptionsLoading] = useState(false)
  const [registrationOptionsError, setRegistrationOptionsError] = useState("")
  const [view, setView] = useState<ViewKey>("all")
  const [todoView, setTodoView] = useState<TodoViewKey>("inbox")
  const [withdrawalView, setWithdrawalView] = useState<WithdrawalViewKey>("applicant")
  const [registrationView, setRegistrationView] = useState<RegistrationViewKey>("inquiry")
  const [todoSort, setTodoSort] = useState<TodoSortKey>("due")
  const [requestedByFilter, setRequestedByFilter] = useState<TodoSelectFilterKey>("all")
  const [requestedTeamFilter, setRequestedTeamFilter] = useState<TodoSelectFilterKey>("all")
  const [assigneeFilter, setAssigneeFilter] = useState<TodoSelectFilterKey>("all")
  const [assigneeTeamFilter, setAssigneeTeamFilter] = useState<TodoSelectFilterKey>("all")
  const [taskFocus, setTaskFocus] = useState<TaskFocus>("none")
  const [query, setQuery] = useState("")
  const [quickAddText, setQuickAddText] = useState("")
  const [showClosed, setShowClosed] = useState(false)
  const [wordRetestMode, setWordRetestMode] = useState<WordRetestMode>("assistant")
  const [wordRetestBranchFilter, setWordRetestBranchFilter] = useState<WordRetestBranchFilter>("all")
  const [wordRetestPeriodFilter, setWordRetestPeriodFilter] = useState<WordRetestPeriodFilter>("all")
  const [wordRetestCustomStartDate, setWordRetestCustomStartDate] = useState("")
  const [wordRetestCustomEndDate, setWordRetestCustomEndDate] = useState("")
  const [wordRetestTeacherFilter, setWordRetestTeacherFilter] = useState<WordRetestSelectFilterKey>("all")
  const [wordRetestClassFilter, setWordRetestClassFilter] = useState<WordRetestSelectFilterKey>("all")
  const [wordRetestScoreDrafts, setWordRetestScoreDrafts] = useState<Record<string, WordRetestScoreDraft>>({})
  const [wordRetestStudentIds, setWordRetestStudentIds] = useState<string[]>([])
  const [wordRetestSelectedTaskIds, setWordRetestSelectedTaskIds] = useState<Set<string>>(() => new Set())
  const [withdrawalNotificationOpen, setWithdrawalNotificationOpen] = useState(false)
  const [transferNotificationOpen, setTransferNotificationOpen] = useState(false)
  const [registrationNotificationOpen, setRegistrationNotificationOpen] = useState(false)
  const [canonicalNotificationOpen, setCanonicalNotificationOpen] = useState(false)
  const [registrationProcessManualOpen, setRegistrationProcessManualOpen] = useState(false)
  const [registrationCustomerMessageTask, setRegistrationCustomerMessageTask] = useState<OpsTask | null>(null)
  const [withdrawalNotificationSettings] = useState<WithdrawalNotificationSetting[]>(() => buildDefaultWithdrawalNotificationSettings())
  const [withdrawalNotificationTemplates] = useState<Record<WithdrawalNotificationTriggerKey, WithdrawalNotificationTemplate>>(() => DEFAULT_WITHDRAWAL_NOTIFICATION_TEMPLATES)
  const [transferNotificationSettings] = useState<WithdrawalNotificationSetting[]>(() => buildDefaultWithdrawalNotificationSettings())
  const [transferNotificationTemplates] = useState<Record<WithdrawalNotificationTriggerKey, WithdrawalNotificationTemplate>>(() => DEFAULT_TRANSFER_NOTIFICATION_TEMPLATES)
  const [registrationNotificationSettings] = useState<WithdrawalNotificationSetting[]>(() => buildDefaultWithdrawalNotificationSettings())
  const [registrationNotificationTemplates] = useState<Record<WithdrawalNotificationTriggerKey, WithdrawalNotificationTemplate>>(() => DEFAULT_REGISTRATION_NOTIFICATION_TEMPLATES)
  const [formOpen, setFormOpen] = useState(false)
  const [formDetailStep, setFormDetailStep] = useState<FormDetailStepKey>("registration_contact")
  const [detailOpen, setDetailOpen] = useState(false)
  const [editingTask, setEditingTask] = useState<OpsTask | null>(null)
  const [selectedTask, setSelectedTask] = useState<OpsTask | null>(null)
  const [selectedRegistrationTrackId, setSelectedRegistrationTrackId] = useState<string | null>(null)
  const selectedRegistrationTrackIdRef = useRef<string | null>(selectedRegistrationTrackId)
  selectedRegistrationTrackIdRef.current = selectedRegistrationTrackId
  const [registrationCaseDetail, setRegistrationCaseDetail] = useState<OpsRegistrationCaseDetail | null>(null)
  const [registrationConsultationOutcomeTrackId, setRegistrationConsultationOutcomeTrackId] = useState<string | null>(null)
  const [form, setForm] = useState<OpsTaskInput>(() => cloneForm())
  const [registrationInitialWorkflowDraft, setRegistrationInitialWorkflowDraft] = useState<RegistrationInitialWorkflowDraft>(() => (
    createRegistrationInitialWorkflowDraft([])
  ))
  const [registrationPersistence, setRegistrationPersistence] = useState<RegistrationInitialPersistenceProbeResult>(() => ({
    mode: "blocked_indeterminate",
    error: new Error("registration_runtime_not_probed"),
  }))
  const formBaselineRef = useRef(serializeOpsTaskInput(form))
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState("")
  const [formCompletionBlockers, setFormCompletionBlockers] = useState<string[]>([])
  const [formCompletionIntent, setFormCompletionIntent] = useState<FormCompletionIntent | null>(null)
  const [confirmingFormClose, setConfirmingFormClose] = useState(false)
  const formCloseReturnFocusRef = useRef<HTMLElement | null>(null)
  const workspaceMountedRef = useRef(false)
  const latestWorkspaceViewerIdRef = useRef(currentUserId)
  latestWorkspaceViewerIdRef.current = currentUserId
  const workspaceLoadGenerationRef = useRef(0)
  const workspaceViewerIdRef = useRef(currentUserId)
  const workspaceViewerGenerationRef = useRef(0)
  const workspaceDataViewerIdRef = useRef(currentUserId)
  const registrationTrackSelectionRef = useRef("")
  const registrationCreateAttemptRef = useRef<RegistrationCreateAttempt | null>(null)
  const [pendingRegistrationVisitNotificationTargets, setPendingRegistrationVisitNotificationTargets] = useState<RegistrationVisitNotificationTarget[]>([])
  const [retryingRegistrationVisitNotifications, setRetryingRegistrationVisitNotifications] = useState(false)
  const registrationVisitNotificationRetryInFlightRef = useRef(false)
  const registrationVisitNotificationRetryGenerationRef = useRef(0)
  const withdrawalCreateHandledRef = useRef("")
  const openCreateRef = useRef<((type: OpsTaskType, initialValues?: Partial<OpsTaskInput>) => void) | null>(null)
  const registrationOptionsLoadedRef = useRef(false)
  const registrationOptionsLoadGenerationRef = useRef(0)
  const registrationOptionsDataRef = useRef<OpsTaskWorkspaceOptionData | null>(null)
  const [notice, setNotice] = useState("")
  const [commentBody, setCommentBody] = useState("")
  const [attachmentName, setAttachmentName] = useState("")
  const [attachmentLink, setAttachmentLink] = useState("")
  const [deleteTarget, setDeleteTarget] = useState<OpsTask | null>(null)
  const [bulkDeleteTargets, setBulkDeleteTargets] = useState<OpsTask[]>([])
  const [statusUndo, setStatusUndo] = useState<StatusUndoState | null>(null)
  const formMemoId = useId()
  const attachmentNameId = useId()
  const attachmentLinkId = useId()
  const quickAddInputRef = useRef<HTMLInputElement | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const autoAbsentWordRetestIdsRef = useRef<Set<string>>(new Set())
  const wordRetestTeacherFilterTouchedRef = useRef(false)
  const deferredQuery = useDeferredValue(query)

  const currentUserLabel = useMemo(
    () => [user?.name, user?.email, user?.loginId].map((value) => String(value || "").trim()).find(Boolean) || "",
    [user?.email, user?.loginId, user?.name],
  )
  const currentUserTeam = useMemo(
    () => [
      (user as { teacherTeam?: string; teacher_team?: string; team?: string } | null)?.teacherTeam,
      (user as { teacherTeam?: string; teacher_team?: string; team?: string } | null)?.teacher_team,
      (user as { teacherTeam?: string; teacher_team?: string; team?: string } | null)?.team,
    ].map((value) => String(value || "").trim()).find(Boolean) || "",
    [user],
  )
  const currentUserContext = useMemo(() => ({
    currentUserId,
    currentUserLabel,
    currentUserTeam,
  }), [currentUserId, currentUserLabel, currentUserTeam])
  const canDelete = canManageAll || isStaff
  const registrationViewerId = registrationFixtureEnabled
    ? registrationFixtureViewer?.viewerId || ""
    : currentUserId
  const registrationViewerRole = registrationFixtureEnabled
    ? registrationFixtureViewer?.viewerRole || "assistant"
    : isAdmin
      ? "admin"
      : isStaff
        ? "staff"
        : isTeacher
          ? "teacher"
          : "assistant"
  const canManageRegistrationWorkflow = registrationFixtureEnabled
    ? ["admin", "staff"].includes(registrationFixtureViewer?.viewerRole || "")
    : canManageAll || isStaff
  const canManageWithdrawalWorkflow = canManageAll || isStaff
  const canManageTransferWorkflow = canManageAll || isStaff
  const canDeleteTask = useCallback(
    (task: OpsTask) => {
      if (task.type === "registration" && isRegistrationCompletionImmutable(task.registration?.pipelineStatus)) return false
      const isOwnGeneralTask = (
        task.type === "general" &&
        Boolean(currentUserId) &&
        [task.requestedBy, task.assigneeId, task.secondaryAssigneeId].includes(currentUserId)
      )

      if (isAdmin || isOwnGeneralTask) return true
      return canDelete && (task.type === "general" || !isClosedOpsTask(task))
    },
    [canDelete, currentUserId, isAdmin],
  )
  const workspaceLabel = WORKSPACE_LABELS[workspace]

  const replaceRegistrationFixtureState = useCallback((nextState: RegistrationSubjectTrackFixtureState) => {
    registrationFixtureStateRef.current = nextState
    setRegistrationFixtureRevision((current) => current + 1)
  }, [])

  useEffect(() => {
    if (!registrationFixtureEnabled || !registrationFixtureModule || !registrationFixtureStateRef.current) return
    const adapter = registrationFixtureModule.createRegistrationSubjectTrackFixtureAdapter({
      getState: () => {
        if (!registrationFixtureStateRef.current) throw new Error("registration_subject_track_fixture_not_ready")
        return registrationFixtureStateRef.current
      },
      replaceState: replaceRegistrationFixtureState,
    })
    return installRegistrationSubjectTrackFixtureRuntime(
      process.env.NODE_ENV,
      registrationFixtureValue,
      adapter,
    )
  }, [registrationFixtureEnabled, registrationFixtureModule, registrationFixtureValue, replaceRegistrationFixtureState])

  const reload = useCallback(async (force = false, showPending = true) => {
    if (latestWorkspaceViewerIdRef.current !== currentUserId) return
    if (registrationFixtureRequested && !registrationFixtureEnabled) {
      setLoading(true)
      return
    }
    if (registrationFixtureEnabled) {
      workspaceDataViewerIdRef.current = currentUserId
      setData(registrationFixtureStateRef.current!.workspaceData)
      setLoading(false)
      return
    }
    const loadGeneration = ++workspaceLoadGenerationRef.current
    const viewerChanged = workspaceViewerIdRef.current !== currentUserId
    if (viewerChanged) {
      workspaceViewerIdRef.current = currentUserId
      workspaceViewerGenerationRef.current += 1
      workspaceDataViewerIdRef.current = ""
      registrationOptionsLoadedRef.current = false
      registrationOptionsLoadGenerationRef.current += 1
      registrationOptionsDataRef.current = null
      setRegistrationOptionsLoading(false)
      setRegistrationOptionsError("")
      const resetForm = cloneForm()
      formBaselineRef.current = serializeOpsTaskInput(resetForm)
      setForm(resetForm)
      setSelectedTask(null)
      setSelectedRegistrationTrackId(null)
      setRegistrationCaseDetail(null)
      registrationTrackSelectionRef.current = ""
      registrationCreateAttemptRef.current = null
      registrationVisitNotificationRetryGenerationRef.current += 1
      registrationVisitNotificationRetryInFlightRef.current = false
      setPendingRegistrationVisitNotificationTargets([])
      setRetryingRegistrationVisitNotifications(false)
      setEditingTask(null)
      setFormOpen(false)
      setDetailOpen(false)
      setRegistrationCustomerMessageTask(null)
      setConfirmingFormClose(false)
      setFormCompletionBlockers([])
      setFormCompletionIntent(null)
      setDeleteTarget(null)
      setBulkDeleteTargets([])
      setWordRetestSelectedTaskIds(new Set())
      setWordRetestStudentIds([])
      setWithdrawalNotificationOpen(false)
      setTransferNotificationOpen(false)
      setRegistrationNotificationOpen(false)
      setRegistrationProcessManualOpen(false)
      setStatusUndo(null)
      setCommentBody("")
      setAttachmentName("")
      setAttachmentLink("")
      setQuery("")
      setQuickAddText("")
      setMessage("")
      setNotice("")
      setSaving(false)
      setData(null)
    }
    const loadOptions = isRegistrationWorkspace
      ? {
          taskType: scopedTaskType,
          viewerId: currentUserId,
          includeManagementOptions: false,
          includeTeacherOptions: false,
          includeProfileOptions: false,
        }
      : {
          taskType: scopedTaskType,
          viewerId: currentUserId,
          includeManagementOptions: !isTodoWorkspace,
          includeTeacherOptions: true,
          includeProfileOptions: true,
        }
    const cachedData = force
      ? null
      : getCachedOpsTaskWorkspaceData(loadOptions) || getPersistedOpsTaskWorkspaceData(loadOptions)
    if (cachedData) {
      workspaceDataViewerIdRef.current = currentUserId
      setData((current) => current || cachedData)
      setLoading(false)
    }
    if (showPending && !cachedData) setLoading(true)
    const nextData = await loadOpsTaskWorkspaceData({ ...loadOptions, force })
    if (
      latestWorkspaceViewerIdRef.current !== currentUserId
      || workspaceLoadGenerationRef.current !== loadGeneration
    ) return
    const enrichmentData = registrationOptionsDataRef.current
    workspaceDataViewerIdRef.current = currentUserId
    setData(
      isRegistrationWorkspace && enrichmentData
        ? mergeOpsTaskWorkspaceOptionData(nextData, enrichmentData)
        : nextData,
    )
    setLoading(false)
  }, [currentUserId, isRegistrationWorkspace, isTodoWorkspace, registrationFixtureEnabled, registrationFixtureRequested, scopedTaskType])

  useEffect(() => {
    workspaceMountedRef.current = true
    return () => {
      workspaceMountedRef.current = false
      workspaceViewerGenerationRef.current += 1
      registrationVisitNotificationRetryGenerationRef.current += 1
      registrationVisitNotificationRetryInFlightRef.current = false
    }
  }, [])

  useEffect(() => {
    void reload()
    return () => {
      workspaceLoadGenerationRef.current += 1
      registrationOptionsLoadGenerationRef.current += 1
    }
  }, [reload])

  const ensureRegistrationOptions = useCallback(async (force = false) => {
    if (registrationFixtureRequested && !registrationFixtureEnabled) return false
    if (registrationFixtureEnabled) {
      const enrichmentData = registrationFixtureStateRef.current!.optionData
      registrationOptionsLoadedRef.current = true
      registrationOptionsDataRef.current = enrichmentData
      setRegistrationOptionsLoading(false)
      setRegistrationOptionsError("")
      setData(registrationFixtureStateRef.current!.workspaceData)
      return true
    }
    if (
      !isRegistrationWorkspace
      || latestWorkspaceViewerIdRef.current !== currentUserId
      || (!force && registrationOptionsLoadedRef.current)
    ) return registrationOptionsLoadedRef.current
    const loadGeneration = ++registrationOptionsLoadGenerationRef.current
    setRegistrationOptionsLoading(true)
    setRegistrationOptionsError("")

    const enrichmentData = await loadOpsTaskWorkspaceOptionData({
      taskType: scopedTaskType,
      viewerId: currentUserId,
      force,
    })
    if (
      latestWorkspaceViewerIdRef.current !== currentUserId
      || registrationOptionsLoadGenerationRef.current !== loadGeneration
    ) return false

    if (!enrichmentData.schemaReady) {
      setRegistrationOptionsError(enrichmentData.error || "선택 정보를 불러오지 못했습니다.")
      setRegistrationOptionsLoading(false)
      return false
    }

    registrationOptionsLoadedRef.current = true
    registrationOptionsDataRef.current = enrichmentData
    setData((current) => current
      ? mergeOpsTaskWorkspaceOptionData(current, enrichmentData)
      : current)
    setRegistrationOptionsLoading(false)
    return enrichmentData.directorCatalogStatus === "authoritative"
  }, [currentUserId, isRegistrationWorkspace, registrationFixtureEnabled, registrationFixtureRequested, scopedTaskType])

  const retryRegistrationOptions = useCallback(async () => {
    registrationOptionsLoadedRef.current = false
    registrationOptionsDataRef.current = null
    return ensureRegistrationOptions(true)
  }, [ensureRegistrationOptions])

  useEffect(() => {
    const nextView = searchParams.get("view")
    const nextFocus = searchParams.get("focus")
    const nextWordRetestRole = searchParams.get("role") || ""
    const nextWordRetestBranch = searchParams.get("branch") || ""
    const nextWordRetestPeriod = searchParams.get("period") || ""
    const nextWordRetestFrom = searchParams.get("from") || ""
    const nextWordRetestTo = searchParams.get("to") || ""
    const nextWorkflowFlow = searchParams.get("flow") || ""
    const nextTodoRouteState = isTodoWorkspace ? getTodoRouteState(searchParams) : null
    if (nextTodoRouteState) {
      setTodoView(nextTodoRouteState.list)
      setTodoSort(nextTodoRouteState.sort || (nextTodoRouteState.status ? "status" : "due"))
    } else if (isRegistrationWorkspace) {
      if (isRegistrationViewKey(nextWorkflowFlow)) setRegistrationView(nextWorkflowFlow)
    } else if (isWithdrawalWorkspace || isTransferWorkspace) {
      if (isWithdrawalViewKey(nextWorkflowFlow)) setWithdrawalView(nextWorkflowFlow)
    } else if (isWordRetestWorkspace) {
      if (isWordRetestModeKey(nextWordRetestRole)) setWordRetestMode(nextWordRetestRole)
      if (isWordRetestBranchFilterKey(nextWordRetestBranch)) setWordRetestBranchFilter(nextWordRetestBranch)
      setWordRetestPeriodFilter(isWordRetestPeriodFilterKey(nextWordRetestPeriod) ? nextWordRetestPeriod : "all")
      setWordRetestCustomStartDate(toDateKey(nextWordRetestFrom))
      setWordRetestCustomEndDate(toDateKey(nextWordRetestTo))
    } else if (!isTodoWorkspace && nextView && isViewKey(nextView)) {
      setView(nextView)
    }
    if (nextFocus && isTaskFocus(nextFocus)) {
      setTaskFocus(nextFocus)
    }
  }, [isRegistrationWorkspace, isTodoWorkspace, isTransferWorkspace, isWithdrawalWorkspace, isWordRetestWorkspace, searchParams])

  useEffect(() => {
    if (!isWordRetestWorkspace) return
    if (isWordRetestModeKey(searchParams.get("role") || "")) return
    setWordRetestMode(isTeacher && !isStaff ? "teacher" : "assistant")
  }, [isStaff, isTeacher, isWordRetestWorkspace, searchParams])

  const syncView = (nextView: ViewKey, nextFocus: TaskFocus = "none") => {
    setView(nextView)
    setTaskFocus(nextFocus)

    const searchParams = new URLSearchParams(window.location.search)
    searchParams.set("view", nextView)
    searchParams.delete("list")
    searchParams.delete("flow")
    if (nextFocus === "none") {
      searchParams.delete("focus")
    } else {
      searchParams.set("focus", nextFocus)
    }
    const queryString = searchParams.toString()
    window.history.replaceState(null, "", `${window.location.pathname}${queryString ? `?${queryString}` : ""}`)
  }

  const syncTodoView = (nextView: TodoViewKey) => {
    setTodoView(nextView)
    setTaskFocus("none")
    const searchParams = new URLSearchParams(window.location.search)
    searchParams.set("list", nextView)
    searchParams.delete("view")
    searchParams.delete("flow")
    searchParams.delete("focus")
    searchParams.delete("filter")
    const queryString = searchParams.toString()
    window.history.replaceState(null, "", `${window.location.pathname}${queryString ? `?${queryString}` : ""}`)
  }

  const syncWithdrawalView = (nextView: WithdrawalViewKey) => {
    setWithdrawalView(nextView)
    setTaskFocus("none")
    const searchParams = new URLSearchParams(window.location.search)
    searchParams.set("flow", nextView)
    searchParams.delete("view")
    searchParams.delete("list")
    searchParams.delete("focus")
    const queryString = searchParams.toString()
    window.history.replaceState(null, "", `${window.location.pathname}${queryString ? `?${queryString}` : ""}`)
  }

  const syncRegistrationView = (nextView: RegistrationViewKey) => {
    setRegistrationView(nextView)
    setTaskFocus("none")
    setDetailOpen(false)
    setSelectedRegistrationTrackId(null)
    setRegistrationCaseDetail(null)
    registrationTrackSelectionRef.current = ""
    const searchParams = new URLSearchParams(window.location.search)
    searchParams.set("flow", nextView)
    searchParams.delete("taskId")
    searchParams.delete("trackId")
    searchParams.delete("view")
    searchParams.delete("list")
    searchParams.delete("focus")
    const queryString = searchParams.toString()
    window.history.replaceState(null, "", `${window.location.pathname}${queryString ? `?${queryString}` : ""}`)
  }

  function handleRegistrationViewTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, currentView: RegistrationViewKey) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return
    event.preventDefault()
    const currentIndex = REGISTRATION_VIEW_TABS.findIndex((tab) => tab.key === currentView)
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? REGISTRATION_VIEW_TABS.length - 1
        : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + REGISTRATION_VIEW_TABS.length) % REGISTRATION_VIEW_TABS.length
    const nextView = REGISTRATION_VIEW_TABS[nextIndex]?.key
    if (!nextView) return
    syncRegistrationView(nextView)
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>(`[data-registration-view-tab="${nextView}"]`)?.focus()
    })
  }

  const syncWordRetestMode = (nextMode: WordRetestMode) => {
    setWordRetestMode(nextMode)
    setTaskFocus("none")
    const searchParams = new URLSearchParams(window.location.search)
    searchParams.set("role", nextMode)
    searchParams.delete("view")
    searchParams.delete("list")
    searchParams.delete("flow")
    searchParams.delete("focus")
    const queryString = searchParams.toString()
    window.history.replaceState(null, "", `${window.location.pathname}${queryString ? `?${queryString}` : ""}`)
  }

  const syncWordRetestBranchFilter = (nextBranch: WordRetestBranchFilter) => {
    setWordRetestBranchFilter(nextBranch)
    const searchParams = new URLSearchParams(window.location.search)
    if (nextBranch === "all") searchParams.delete("branch")
    else searchParams.set("branch", nextBranch)
    searchParams.delete("view")
    searchParams.delete("list")
    searchParams.delete("flow")
    const queryString = searchParams.toString()
    window.history.replaceState(null, "", `${window.location.pathname}${queryString ? `?${queryString}` : ""}`)
  }

  const syncWordRetestPeriodFilter = (nextPeriod: WordRetestPeriodFilter) => {
    setWordRetestPeriodFilter(nextPeriod)
    const searchParams = new URLSearchParams(window.location.search)
    if (nextPeriod === "all") {
      searchParams.delete("period")
      searchParams.delete("from")
      searchParams.delete("to")
    } else {
      searchParams.set("period", nextPeriod)
      if (nextPeriod !== "custom") {
        searchParams.delete("from")
        searchParams.delete("to")
      }
    }
    searchParams.delete("view")
    searchParams.delete("list")
    searchParams.delete("flow")
    const queryString = searchParams.toString()
    window.history.replaceState(null, "", `${window.location.pathname}${queryString ? `?${queryString}` : ""}`)
  }

  const syncWordRetestCustomDate = (key: "from" | "to", value: string) => {
    const nextDate = toDateKey(value)
    if (key === "from") setWordRetestCustomStartDate(nextDate)
    else setWordRetestCustomEndDate(nextDate)
    setWordRetestPeriodFilter("custom")

    const searchParams = new URLSearchParams(window.location.search)
    searchParams.set("period", "custom")
    if (nextDate) searchParams.set(key, nextDate)
    else searchParams.delete(key)
    searchParams.delete("view")
    searchParams.delete("list")
    searchParams.delete("flow")
    const queryString = searchParams.toString()
    window.history.replaceState(null, "", `${window.location.pathname}${queryString ? `?${queryString}` : ""}`)
  }

  const syncTodoSort = (nextSort: TodoSortKey) => {
    setTodoSort(nextSort)
    const searchParams = new URLSearchParams(window.location.search)
    searchParams.set("list", todoView)
    searchParams.set("sort", nextSort)
    searchParams.delete("view")
    searchParams.delete("focus")
    searchParams.delete("flow")
    const queryString = searchParams.toString()
    window.history.replaceState(null, "", `${window.location.pathname}${queryString ? `?${queryString}` : ""}`)
  }

  const syncTaskDeepLink = useCallback((nextTaskId: string | null, nextTrackId: string | null = null) => {
    const searchParams = new URLSearchParams(window.location.search)
    if (nextTaskId) {
      searchParams.set("taskId", nextTaskId)
    } else {
      searchParams.delete("taskId")
    }
    if (nextTaskId && nextTrackId && !isLegacyRegistrationTrackId(nextTrackId)) {
      searchParams.set("trackId", nextTrackId)
    } else {
      searchParams.delete("trackId")
    }
    const queryString = searchParams.toString()
    window.history.replaceState(null, "", `${window.location.pathname}${queryString ? `?${queryString}` : ""}`)
  }, [])

  const workspaceDataBelongsToCurrentViewer = workspaceDataViewerIdRef.current === currentUserId
  const tasks = workspaceDataBelongsToCurrentViewer ? data?.tasks || EMPTY_TASKS : EMPTY_TASKS
  const profiles = data?.profiles || EMPTY_PROFILE_OPTIONS
  const students = data?.students || EMPTY_STUDENT_OPTIONS
  const classes = data?.classes || EMPTY_CLASS_OPTIONS
  const textbooks = data?.textbooks || EMPTY_TEXTBOOK_OPTIONS
  const teachers = data?.teachers || EMPTY_TEACHER_OPTIONS
  const registrationInitialSubjects = useMemo(
    () => parseRegistrationSubjects(form.subject) as RegistrationSubject[],
    [form.subject],
  )
  const registrationResolvedDirectorIds = useMemo(() => Object.fromEntries(
    registrationInitialSubjects.flatMap((subject) => {
      const resolution = resolveRegistrationDirectorDefault({
        subjects: [subject],
        grade: form.registration?.schoolGrade,
        inquiryAt: form.registration?.inquiryAt,
        teachers,
        profiles,
      })
      return resolution.status === "resolved" && resolution.profileId
        ? [[subject, resolution.profileId]]
        : []
    }),
  ) as Partial<Record<RegistrationSubject, string>>, [
    form.registration?.inquiryAt,
    form.registration?.schoolGrade,
    profiles,
    registrationInitialSubjects,
    teachers,
  ])
  const registrationDirectorOptionsBySubject = useMemo(() => {
    const adminProfileIds = new Set(profiles
      .filter((profile) => String(profile.role || "").trim().toLowerCase() === "admin")
      .map((profile) => profile.id))
    const optionsFor = (subject: RegistrationSubject) => {
      const seen = new Set<string>()
      return teachers.flatMap((teacher) => {
        const profileId = String(teacher.profileId || "").trim()
        if (!profileId || seen.has(profileId) || !adminProfileIds.has(profileId)) return []
        if (teacher.subjects?.length && !teacher.subjects.includes(subject)) return []
        seen.add(profileId)
        return [{ value: profileId, label: teacher.label }]
      })
    }
    return { 영어: optionsFor("영어"), 수학: optionsFor("수학") }
  }, [profiles, teachers])
  const optionIndexes = useMemo(() => buildOpsTaskOptionIndexes(students, classes, textbooks, teachers), [students, classes, textbooks, teachers])

  useEffect(() => {
    if (form.type !== "registration") return
    setRegistrationInitialWorkflowDraft((current) => (
      reconcileRegistrationInitialWorkflowDraft(current, registrationInitialSubjects)
    ))
  }, [form.type, registrationInitialSubjects])

  useEffect(() => {
    if (!formOpen || form.type !== "registration" || editingTask) return
    let active = true
    setRegistrationPersistence({
      mode: "blocked_indeterminate",
      error: new Error("registration_runtime_probe_pending"),
    })
    void probeRegistrationInitialPersistence({
      probeSubjectRuntime: probeRegistrationSubjectTrackRuntime,
      probeIntakeRuntime: probeRegistrationIntakeWorkflowRuntime,
    }).then((result) => {
      if (active) setRegistrationPersistence(result)
    })
    return () => {
      active = false
    }
  }, [editingTask, form.type, formOpen])
  const confirmationByTaskId = useMemo(() => buildOperationConfirmationMap(
    tasks,
    optionIndexes,
    students,
    classes,
    textbooks,
    teachers,
  ), [classes, optionIndexes, students, tasks, teachers, textbooks])
  const taskById = useMemo(
    () => new Map(tasks.map((task) => [task.id, task])),
    [tasks],
  )
  const profileLabelById = useMemo(
    () => new Map(profiles.map((profile) => [profile.id, profile.label])),
    [profiles],
  )
  const profileTeamById = useMemo(
    () => buildTaskProfileTeamLookup(profiles, teachers),
    [profiles, teachers],
  )
  const currentUserTaskTeam = useMemo(
    () => profileTeamById.get(currentUserId) || normalizeTaskTeamValue(currentUserTeam),
    [currentUserId, currentUserTeam, profileTeamById],
  )
  const currentUserTeacherOption = useMemo(
    () => findCurrentUserTeacherOption(teachers, currentUserId, user?.email, user?.loginId, currentUserLabel),
    [currentUserId, currentUserLabel, teachers, user?.email, user?.loginId],
  )
  const shouldDefaultWordRetestTeacherFilter = useMemo(() => {
    if (!isWordRetestTeacherOption(currentUserTeacherOption)) return false
    if (normalizeTaskTeamValue(currentUserTaskTeam) === "영어팀") return true
    return normalizeTaskTeamValue(currentUserTeacherOption?.subjects || []) === "영어팀"
  }, [currentUserTaskTeam, currentUserTeacherOption])
  const assigneeProfileOptions = useMemo(
    () => getProfilesForTeam(profiles, form.assigneeTeam || "", profileTeamById, form.assigneeId || ""),
    [form.assigneeId, form.assigneeTeam, profileTeamById, profiles],
  )
  const scopedTasks = useMemo(
    () => tasks.filter((task) => task.type === scopedTaskType),
    [scopedTaskType, tasks],
  )
  const summary = useMemo(
    () => summarizeOpsTasks(scopedTasks, { currentUserId, currentUserLabel }),
    [currentUserId, currentUserLabel, scopedTasks],
  )
  const operationNeedsConfirmation = useMemo(() => {
    return scopedTasks.filter((task) => isOpenTask(task) && confirmationByTaskId.get(task.id) === true)
  }, [confirmationByTaskId, scopedTasks])
  const operationNeedsOrganization = useMemo(() => {
    return scopedTasks.filter((task) => isOpenTask(task) && (!task.assigneeId || !hasTaskSchedule(task)))
  }, [scopedTasks])
  const operationMetrics = useMemo(() => [
    { key: "today" as const, label: "오늘 예정", value: summary.todayDue, view: "calendar" as ViewKey },
    { key: "overdue" as const, label: "지연", value: summary.overdue, view: "all" as ViewKey },
    { key: "mine" as const, label: "내 담당", value: summary.assignedToMe, view: "all" as ViewKey },
    { key: "unassigned" as const, label: "미정리", value: operationNeedsOrganization.length, view: "all" as ViewKey },
    { key: "confirmation" as const, label: "확인 필요", value: operationNeedsConfirmation.length, view: "all" as ViewKey },
  ], [operationNeedsConfirmation.length, operationNeedsOrganization.length, summary.assignedToMe, summary.overdue, summary.todayDue])
  const visibleOperationMetrics = useMemo(
    () => operationMetrics.filter((metric) => metric.value > 0 || taskFocus === metric.key),
    [operationMetrics, taskFocus],
  )
  const todayKey = useMemo(() => toDateKey(new Date()), [])
  const todoFilterOptions = useMemo(() => buildTodoFilterOptions(scopedTasks), [scopedTasks])
  const todoCounts = useMemo(() => {
    const openGeneralTasks = scopedTasks.filter((task) => !isClosedOpsTask(task))
    return {
      inbox: openGeneralTasks.filter((task) => isOpsTaskInUserInbox(task, currentUserContext)).length,
      sent: openGeneralTasks.filter((task) => isOpsTaskInUserSent(task, currentUserContext)).length,
      completed: scopedTasks.filter((task) => isClosedOpsTask(task)).length,
    }
  }, [currentUserContext, scopedTasks])
  const withdrawalCounts = useMemo(() => ({
    applicant: getWithdrawalViewTasks(scopedTasks, "applicant").length,
    operations: getWithdrawalViewTasks(scopedTasks, "operations").length,
    closed: getWithdrawalViewTasks(scopedTasks, "closed").length,
  }), [scopedTasks])
  const transferCounts = useMemo(() => ({
    applicant: getWithdrawalViewTasks(scopedTasks, "applicant").length,
    operations: getWithdrawalViewTasks(scopedTasks, "operations").length,
    closed: getWithdrawalViewTasks(scopedTasks, "closed").length,
  }), [scopedTasks])
  const registrationTrackItems = useMemo(
    () => buildRegistrationTrackListItems(scopedTasks),
    [scopedTasks],
  )
  const registrationCounts = useMemo(
    () => getRegistrationTrackTabCounts(registrationTrackItems.map((item) => item.track)),
    [registrationTrackItems],
  )
  const visibleRegistrationTrackItems = useMemo(
    () => filterRegistrationTrackListItems(registrationTrackItems, registrationView),
    [registrationTrackItems, registrationView],
  )
  const wordRetestRoleContext = useMemo(
    () => (canManageAll || isStaff ? {} : currentUserContext),
    [canManageAll, currentUserContext, isStaff],
  )
  const branchScopedWordRetestTasks = useMemo(() => (
    scopedTasks.filter((task) => wordRetestBranchFilter === "all" || getWordRetestBranch(task) === wordRetestBranchFilter)
  ), [scopedTasks, wordRetestBranchFilter])
  const periodScopedWordRetestTasks = useMemo(() => (
    branchScopedWordRetestTasks.filter((task) => matchesWordRetestPeriodFilter(
      task,
      wordRetestPeriodFilter,
      todayKey,
      wordRetestCustomStartDate,
      wordRetestCustomEndDate,
    ))
  ), [branchScopedWordRetestTasks, todayKey, wordRetestCustomEndDate, wordRetestCustomStartDate, wordRetestPeriodFilter])
  const wordRetestRoleCounts = useMemo(() => {
    const openWordRetests = periodScopedWordRetestTasks.filter((task) => !isClosedOpsTask(task))
    return {
      assistant: openWordRetests.filter((task) => isWordRetestInAssistantQueue(task, wordRetestRoleContext)).length,
      teacher: openWordRetests.filter((task) => isWordRetestInTeacherQueue(task, wordRetestRoleContext)).length,
    }
  }, [periodScopedWordRetestTasks, wordRetestRoleContext])
  const wordRetestFilterSourceTasks = useMemo(() => (
    periodScopedWordRetestTasks.filter((task) => {
      if (!showClosed && !isOpenTask(task)) return false
      if (showClosed && isClosedOpsTask(task)) return true
      if (wordRetestMode === "assistant") return isWordRetestInAssistantQueue(task, wordRetestRoleContext)
      return isWordRetestInTeacherQueue(task, wordRetestRoleContext)
    })
  ), [periodScopedWordRetestTasks, showClosed, wordRetestMode, wordRetestRoleContext])
  const wordRetestFilterOptions = useMemo(
    () => buildWordRetestFilterOptions(wordRetestFilterSourceTasks),
    [wordRetestFilterSourceTasks],
  )
  useEffect(() => {
    if (!isWordRetestWorkspace) return
    if (wordRetestTeacherFilter !== "all" && !wordRetestFilterOptions.teacher.some((option) => option.value === wordRetestTeacherFilter)) {
      setWordRetestTeacherFilter("all")
    }
    if (wordRetestClassFilter !== "all" && !wordRetestFilterOptions.class.some((option) => option.value === wordRetestClassFilter)) {
      setWordRetestClassFilter("all")
    }
  }, [isWordRetestWorkspace, wordRetestClassFilter, wordRetestFilterOptions, wordRetestTeacherFilter])
  useEffect(() => {
    if (
      !isWordRetestWorkspace ||
      wordRetestTeacherFilterTouchedRef.current ||
      wordRetestTeacherFilter !== "all" ||
      !shouldDefaultWordRetestTeacherFilter ||
      !currentUserTeacherOption
    ) return

    const normalizedTeacherLabel = normalizeLookupValue(currentUserTeacherOption.label)
    const option = wordRetestFilterOptions.teacher.find((item) => item.value === currentUserTeacherOption.id) ||
      wordRetestFilterOptions.teacher.find((item) => normalizeLookupValue(item.label) === normalizedTeacherLabel)

    if (option) setWordRetestTeacherFilter(option.value)
  }, [
    currentUserTeacherOption,
    isWordRetestWorkspace,
    shouldDefaultWordRetestTeacherFilter,
    wordRetestFilterOptions.teacher,
    wordRetestTeacherFilter,
  ])
  const hasQuery = !isRegistrationWorkspace && !isWithdrawalWorkspace && !isTransferWorkspace && query.trim().length > 0

  const visibleTasks = useMemo(() => {
    const todoTaskSource = scopedTasks
    const nextTasks = todoTaskSource
      .filter((task) => {
        if (isTodoWorkspace) {
          if (todoView === "inbox") return isOpsTaskInUserInbox(task, currentUserContext) && isOpenTask(task)
          if (todoView === "sent") return isOpsTaskInUserSent(task, currentUserContext) && isOpenTask(task)
          return isClosedOpsTask(task)
        }

        if (!isRegistrationWorkspace && !isWithdrawalWorkspace && !isTransferWorkspace && !showClosed && !isOpenTask(task)) return false
        if (taskFocus === "today" && !hasOpsTaskCalendarDate(task, todayKey)) return false
        if (taskFocus === "overdue") {
          if (!hasOpsTaskOverdueCalendarDate(task, todayKey)) return false
        }
	        if (taskFocus === "confirmation" && confirmationByTaskId.get(task.id) !== true) return false
	        if (taskFocus === "mine" && !isOpsTaskAssignedToUser(task, currentUserId, currentUserLabel)) return false
	        if (taskFocus === "unassigned" && task.assigneeId && hasTaskSchedule(task)) return false
	        if (isWordRetestWorkspace) {
	          if (wordRetestBranchFilter !== "all" && getWordRetestBranch(task) !== wordRetestBranchFilter) return false
	          if (!matchesWordRetestPeriodFilter(task, wordRetestPeriodFilter, todayKey, wordRetestCustomStartDate, wordRetestCustomEndDate)) return false
	          if (!matchesWordRetestFilter(getWordRetestTeacherFilterValue(task), wordRetestTeacherFilter)) return false
	          if (!matchesWordRetestFilter(getWordRetestClassFilterValue(task), wordRetestClassFilter)) return false
	          if (showClosed && isClosedOpsTask(task)) return true
	          if (wordRetestMode === "assistant") return isWordRetestInAssistantQueue(task, wordRetestRoleContext)
	          return isWordRetestInTeacherQueue(task, wordRetestRoleContext)
	        }
		        if (isRegistrationWorkspace || isWithdrawalWorkspace || isTransferWorkspace) return true
		        if (view === "calendar" || view === "all" || view === "status" || view === "assignee") return true
		        return true
	      })
      .filter((task) => isRegistrationWorkspace || isWithdrawalWorkspace || isTransferWorkspace || matchesSearch(task, deferredQuery))
      .filter((task) => !isTodoWorkspace || matchesTodoTeamFilters(task, {
        requestedByFilter,
        requestedTeamFilter,
        assigneeFilter,
        assigneeTeamFilter,
      }))
	    if (isRegistrationWorkspace) return nextTasks
	    if (isWithdrawalWorkspace || isTransferWorkspace) return getWithdrawalViewTasks(nextTasks, withdrawalView)
	    if (isWordRetestWorkspace) return sortWordRetestTasksByTestAt(nextTasks)
    if (!isTodoWorkspace) return nextTasks
    if (todoView === "completed") return sortCompletedTodoTasks(nextTasks)
    if (todoSort === "status") return sortOpsTasksByWorkflowStatus(nextTasks, todayKey)
    if (todoSort === "priority") return sortOpsTasksByPriority(nextTasks, todayKey)
    return sortOpsTasksByWorkDate(nextTasks, todayKey)
  }, [assigneeFilter, assigneeTeamFilter, confirmationByTaskId, currentUserContext, currentUserId, currentUserLabel, deferredQuery, isRegistrationWorkspace, isTodoWorkspace, isTransferWorkspace, isWithdrawalWorkspace, isWordRetestWorkspace, requestedByFilter, requestedTeamFilter, scopedTasks, showClosed, taskFocus, todayKey, todoSort, todoView, view, withdrawalView, wordRetestBranchFilter, wordRetestClassFilter, wordRetestCustomEndDate, wordRetestCustomStartDate, wordRetestMode, wordRetestPeriodFilter, wordRetestRoleContext, wordRetestTeacherFilter])

  useEffect(() => {
    if (!isWordRetestWorkspace) return
    const visibleTaskIds = new Set(visibleTasks.map((task) => task.id))
    setWordRetestSelectedTaskIds((current) => {
      let changed = false
      const next = new Set<string>()
      current.forEach((taskId) => {
        if (visibleTaskIds.has(taskId)) {
          next.add(taskId)
        } else {
          changed = true
        }
      })
      return changed ? next : current
    })
  }, [isWordRetestWorkspace, visibleTasks])

  const calendarItems = useMemo(
    () => {
      return loadCalendarRows(visibleTasks)
    },
    [visibleTasks],
  )
  const visibleCompletionBlockersByTaskId = useMemo(() => buildOperationCompletionBlockerMap(
    visibleTasks,
    students,
    classes,
    textbooks,
    teachers,
    optionIndexes,
  ), [classes, optionIndexes, students, teachers, textbooks, visibleTasks])
  const dueTodayValue = useMemo(() => quickDateTimeInputValue(0), [])
  const dueTomorrowValue = useMemo(() => quickDateTimeInputValue(1), [])
  const quickAddPreviewItems = useMemo<QuickAddPreviewItem[]>(() => {
    if (!isTodoWorkspace || !quickAddText.trim()) return []

    const parsed = parseTodoistQuickAdd(quickAddText, profiles, {
      currentUserId,
      currentUserLabel,
      dueTodayValue,
      dueTomorrowValue,
    })
    const items: QuickAddPreviewItem[] = []
    if (parsed.dueAt) items.push({ key: "due", label: getQuickAddDuePreviewLabel(parsed.dueAt, todayKey, toDateKey(dueTomorrowValue)) })
    if (parsed.assigneeId) items.push({ key: "assignee", label: profileLabelById.get(parsed.assigneeId) || "담당" })
    if (parsed.priority && parsed.priority !== "normal") items.push({ key: "priority", label: getTaskPriorityLabel(parsed.priority) })
    if (parsed.memo) items.push({ key: "memo", label: parsed.memo })
    return items
  }, [currentUserId, currentUserLabel, dueTodayValue, dueTomorrowValue, isTodoWorkspace, profileLabelById, profiles, quickAddText, todayKey])
  const isTodoFilteredEmpty = isTodoWorkspace && (
    requestedByFilter !== "all" ||
    requestedTeamFilter !== "all" ||
    assigneeFilter !== "all" ||
    assigneeTeamFilter !== "all"
  )
  const isWordRetestFilteredEmpty = isWordRetestWorkspace && (
    wordRetestBranchFilter !== "all" ||
    wordRetestPeriodFilter !== "all" ||
    Boolean(wordRetestCustomStartDate) ||
    Boolean(wordRetestCustomEndDate) ||
    wordRetestTeacherFilter !== "all" ||
    wordRetestClassFilter !== "all"
  )
  const isWithdrawalFilteredEmpty = (isWithdrawalWorkspace || isTransferWorkspace) && withdrawalView !== "applicant"
  const isRegistrationFilteredEmpty = isRegistrationWorkspace && registrationView !== "inquiry"
  const isFilteredEmpty = hasQuery || isTodoFilteredEmpty || isWordRetestFilteredEmpty || isWithdrawalFilteredEmpty || isRegistrationFilteredEmpty || (!isTodoWorkspace && taskFocus !== "none")
  const visibleWorkspaceItemCount = isRegistrationWorkspace
    ? visibleRegistrationTrackItems.length
    : visibleTasks.length
  const showEmptyCreate = !isTodoWorkspace && !loading && !isFilteredEmpty && visibleWorkspaceItemCount === 0
  const showToolbarCreate = (!registrationFixtureEnabled || canManageRegistrationWorkflow) && !isTodoWorkspace && (isRegistrationWorkspace || isWithdrawalWorkspace || isTransferWorkspace || !showEmptyCreate)
  const hasLoadBlocker = Boolean(data && !data.schemaReady)
  const canOpenCreate = isTodoWorkspace || (!loading && !hasLoadBlocker)
  const createActionDisabled = saving || !canOpenCreate
  const closedScopedTaskCount = scopedTasks.filter((task) => isClosedOpsTask(task)).length
  const showClosedToggle = !isTodoWorkspace && !isRegistrationWorkspace && !isWithdrawalWorkspace && !isTransferWorkspace && (closedScopedTaskCount > 0 || showClosed)
  const hasSearchableScopedTasks = isTodoWorkspace
    ? scopedTasks.length > 0
    : isRegistrationWorkspace || isWithdrawalWorkspace || isTransferWorkspace
      ? scopedTasks.length > 0
      : scopedTasks.some((task) => showClosed || isOpenTask(task))
  const showSearch = !isRegistrationWorkspace && !isWithdrawalWorkspace && !isTransferWorkspace && (hasQuery || visibleTasks.length > 0 || hasSearchableScopedTasks)
  const emptyActionLabel = getWorkspaceCreateActionLabel(workspace, workspaceLabel)
  const emptyTaskLabel = isTodoWorkspace
    ? getTodoEmptyLabel(todoView, isFilteredEmpty)
    : isFilteredEmpty
      ? "조건에 맞는 항목 없음"
      : `${workspaceLabel} 없음`
  const emptyCalendarLabel = isFilteredEmpty ? "조건에 맞는 일정 없음" : "일정 없음"
  const shouldHideEmptySurface = !loading && visibleWorkspaceItemCount === 0 && (hasLoadBlocker || Boolean(message && !formOpen && !detailOpen))
	  const formDetailTabs = useMemo(() => getFormDetailTabs(form.type), [form.type])
	  const isTemplateForm = form.type !== "general"
	  const isWordRetestForm = form.type === "word_retest"
	  const activeFormDetailStep = formDetailTabs.some((tab) => tab.key === formDetailStep)
	    ? formDetailStep
	    : getDefaultFormDetailStep(form.type)
	  const activeFormStepIndex = Math.max(0, formDetailTabs.findIndex((tab) => tab.key === activeFormDetailStep))
	  const previousFormDetailStep = formDetailTabs[activeFormStepIndex - 1]
	  const nextFormDetailStep = formDetailTabs[activeFormStepIndex + 1]
	  const shouldShowFormDetailTabs = isTemplateForm && !isWordRetestForm && form.type !== "withdrawal" && form.type !== "transfer" && form.type !== "registration" && formDetailTabs.length > 1
	  const formStepProgressLabel = shouldShowFormDetailTabs ? `${activeFormStepIndex + 1}/${formDetailTabs.length}` : ""
  const previousFormStepLabel = previousFormDetailStep ? `이전: ${previousFormDetailStep.label}` : ""
  const nextFormStepLabel = nextFormDetailStep ? `다음: ${nextFormDetailStep.label}` : ""
  const showTemplateDueAt = isTemplateForm && form.type !== "word_retest"
  const formRequestedAtLabel = dateLabel(editingTask?.createdAt || new Date().toISOString())
  const formRequestedByLabel = profileLabelById.get(form.requestedBy || "") || editingTask?.requestedByLabel || (form.requestedBy === currentUserId ? currentUserLabel : "") || "미지정"
  const formRequestedTeamLabel = form.requestedTeam || editingTask?.requestedTeam || currentUserTaskTeam || "미지정"
  const isFormDirty = formOpen && serializeOpsTaskInput(form) !== formBaselineRef.current
  const isEditingLockedCompletedTask = Boolean(editingTask && isClosedOpsTask(editingTask) && !formCompletionIntent)
  const canSubmitCurrentForm = canSubmitOpsTaskForm(form, Boolean(editingTask))
  const formDialogTitle = editingTask
    ? form.type === "general"
      ? "할 일 수정"
      : `${getTaskTypeLabel(form.type)} 수정`
	    : isTemplateForm
	      ? getWorkspaceCreateActionLabel(workspace, getTaskTypeLabel(form.type))
	      : isTodoWorkspace
	        ? "할 일 추가"
	        : `${workspaceLabel} 추가`
  const formCloseLabel = "닫기"

  function openCreate(type: OpsTaskType = scopedTaskType, initialValues: Partial<OpsTaskInput> = {}) {
    if (!canOpenCreate) return
    if (type === "registration") void ensureRegistrationOptions()
    const defaultAssigneeId = currentUserId || ""
    const defaultAssigneeTeam = profileTeamById.get(defaultAssigneeId) || ""
    const defaultDueAt = taskFocus === "today" ? dueTodayValue : ""
    const defaultWordRetestTeacher = findCurrentUserTeacherOption(
      teachers,
      currentUserId,
      user?.email,
      user?.loginId,
      currentUserLabel,
    )
    const wordRetestDefaults = getWordRetestRequestDefaults(type, currentUserId, currentUserTaskTeam, defaultWordRetestTeacher)
    const registrationDefaults = type === "registration" ? getRegistrationCreateDefaults(new Date().toISOString()) : {}
    const nextForm = cloneForm({
      ...EMPTY_FORM,
      requestedBy: currentUserId,
      requestedTeam: currentUserTaskTeam,
      assigneeId: defaultAssigneeId,
      assigneeTeam: defaultAssigneeTeam,
      dueAt: defaultDueAt,
      ...registrationDefaults,
      ...wordRetestDefaults,
      ...initialValues,
      type,
    })
    registrationCreateAttemptRef.current = null
    setRegistrationInitialWorkflowDraft(createRegistrationInitialWorkflowDraft(
      parseRegistrationSubjects(nextForm.subject) as RegistrationSubject[],
    ))
    setEditingTask(null)
    setForm(nextForm)
    setWordRetestStudentIds([])
    formBaselineRef.current = serializeOpsTaskInput(nextForm)
    setFormDetailStep(getDefaultFormDetailStep(type))
    setMessage("")
    setFormCompletionBlockers([])
    setFormCompletionIntent(null)
    setConfirmingFormClose(false)
    setNotice("")
    setStatusUndo(null)
    setFormOpen(true)
  }

  openCreateRef.current = openCreate

  useEffect(() => {
    if (!requestedWithdrawalStudentId || loading || !data || !canOpenCreate || formOpen) return
    const signature = `${currentUserId}:${requestedWithdrawalStudentId}`
    if (withdrawalCreateHandledRef.current === signature) return

    withdrawalCreateHandledRef.current = signature
    openCreateRef.current?.("withdrawal", buildWithdrawalCreatePrefill(requestedWithdrawalStudentId, data.students, data.classes))

    const params = new URLSearchParams(searchParams.toString())
    params.delete("create")
    params.delete("studentId")
    const nextQuery = params.toString()
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false })
  }, [
    canOpenCreate,
    currentUserId,
    data,
    formOpen,
    loading,
    pathname,
    requestedWithdrawalStudentId,
    router,
    searchParams,
  ])

  const openEdit = useCallback((task: OpsTask, blockers: string[] = [], completionIntent: FormCompletionIntent | null = null) => {
    if (task.type === "registration") void ensureRegistrationOptions()
    const inferredCompletionIntent = completionIntent || getCompletionIntentForBlockedEdit(task, blockers)
    const shouldDeferWordRetestRetryBlockers = inferredCompletionIntent?.kind === "word_retest_retry"
    const nextForm = applyFormCompletionIntent(formFromTask(task), inferredCompletionIntent)
    setDetailOpen(false)
    registrationCreateAttemptRef.current = null
    setRegistrationInitialWorkflowDraft(createRegistrationInitialWorkflowDraft([]))
    syncTaskDeepLink(null)
    setEditingTask(task)
    setForm(nextForm)
    setWordRetestStudentIds(task.type === "word_retest" && task.studentId ? [task.studentId] : [])
    formBaselineRef.current = serializeOpsTaskInput(nextForm)
    setFormDetailStep(getCompletionBlockerFormStep(task.type, blockers) || getDefaultFormDetailStep(task.type))
    setMessage(blockers.length > 0 && !shouldDeferWordRetestRetryBlockers ? getCompletionBlockerActionLabel(blockers) : "")
    setFormCompletionBlockers(shouldDeferWordRetestRetryBlockers ? [] : blockers)
    setFormCompletionIntent(inferredCompletionIntent)
    setConfirmingFormClose(false)
    setNotice("")
    setStatusUndo(null)
    setFormOpen(true)
  }, [ensureRegistrationOptions, syncTaskDeepLink])

  const openFailedWordRetestRetryForm = useCallback((task: OpsTask) => {
    const baseForm = formFromTask(task)
    const wordRetest = baseForm.wordRetest || {}
    const nextForm = cloneForm({
      ...baseForm,
      status: "requested",
      completedAt: "",
      requestedBy: currentUserId || baseForm.requestedBy,
      requestedTeam: currentUserTaskTeam || baseForm.requestedTeam,
      assigneeId: "",
      assigneeTeam: "조교팀",
      startAt: "",
      dueAt: "",
      wordRetest: {
        ...wordRetest,
        retestStatus: "not_started",
        testAt: "",
        firstScore: "",
        secondScore: "",
        thirdScore: "",
        scoreOutOf100: "",
      },
    })

    setDetailOpen(false)
    syncTaskDeepLink(null)
    setEditingTask(task)
    setForm(nextForm)
    setWordRetestStudentIds(nextForm.studentId ? [nextForm.studentId] : [])
    formBaselineRef.current = serializeOpsTaskInput(nextForm)
    setFormDetailStep("word_retest_basic")
    setMessage("")
    setFormCompletionBlockers([])
    setFormCompletionIntent({
      kind: "word_retest_retry",
      retryReason: "failed",
      status: "requested",
      wordRetestStatus: "not_started",
    })
    setConfirmingFormClose(false)
    setNotice("")
    setStatusUndo(null)
    setFormOpen(true)
  }, [currentUserId, currentUserTaskTeam, syncTaskDeepLink])

  const loadRegistrationCaseForWorkspace = useCallback((taskId: string, force = false) => {
    if (registrationFixtureEnabled && registrationFixtureModule && registrationFixtureStateRef.current) {
      const detail = registrationFixtureModule.getRegistrationSubjectTrackFixtureCase(registrationFixtureStateRef.current, taskId)
      if (!detail) return Promise.reject(new Error("registration_subject_track_fixture_case_not_found"))
      return Promise.resolve(detail)
    }
    return loadOpsRegistrationCaseDetail(taskId, registrationViewerId, { force })
  }, [registrationFixtureEnabled, registrationFixtureModule, registrationViewerId])

  const openDetail = useCallback((task: OpsTask, trackId: string | null = null) => {
    const nextTrackId = task.type === "registration" ? trackId : null
    registrationTrackSelectionRef.current = nextTrackId ? `${task.id}:${nextTrackId}` : ""
    setRegistrationCaseDetail(null)
    setSelectedTask(task)
    setSelectedRegistrationTrackId(nextTrackId)
    setDetailOpen(true)
    syncTaskDeepLink(task.id, nextTrackId)
    setMessage("")
    setFormCompletionBlockers([])
    setFormCompletionIntent(null)
    setNotice("")
    setStatusUndo(null)
    setCommentBody("")
    setAttachmentName("")
    setAttachmentLink("")
  }, [syncTaskDeepLink])

  const openRegistrationCustomerMessage = useCallback((task: OpsTask) => {
    setDetailOpen(false)
    setSelectedRegistrationTrackId(null)
    setRegistrationCaseDetail(null)
    registrationTrackSelectionRef.current = ""
    syncTaskDeepLink(null)
    setRegistrationCustomerMessageTask(task)
    setMessage("")
    setNotice("")
  }, [syncTaskDeepLink])

  const openRegistrationTrack = useCallback(async (taskId: string, trackId: string) => {
    const task = taskById.get(taskId)
    if (!task || task.type !== "registration") {
      setMessage("선택한 등록 업무를 찾을 수 없습니다. 목록을 다시 불러오세요.")
      return null
    }

    openDetail(task, trackId)
    if (isLegacyRegistrationTrackId(trackId)) {
      syncTaskDeepLink(taskId, null)
      return { task, track: task.registrationTracks?.find((item) => item.id === trackId) || null, detail: null }
    }

    syncTaskDeepLink(taskId, trackId)
    const selectionKey = `${taskId}:${trackId}`
    registrationTrackSelectionRef.current = selectionKey
    try {
      const [detail] = await Promise.all([
        loadRegistrationCaseForWorkspace(taskId),
        canManageRegistrationWorkflow ? ensureRegistrationOptions() : Promise.resolve(),
      ])
      if (registrationTrackSelectionRef.current !== selectionKey) return null
      const track = detail.tracks.find((item) => item.id === trackId)
      if (!track) {
        setSelectedRegistrationTrackId(null)
        setRegistrationCaseDetail(null)
        registrationTrackSelectionRef.current = ""
        syncTaskDeepLink(taskId, null)
        setMessage("선택한 과목 흐름이 변경되었습니다. 목록을 다시 불러오세요.")
        return null
      }
      const exactTask = { ...detail.task, registrationTracks: detail.tracks }
      setRegistrationCaseDetail(detail)
      setSelectedTask(exactTask)
      setDetailOpen(true)
      return { task: exactTask, track, detail }
    } catch (error) {
      if (registrationTrackSelectionRef.current === selectionKey) {
        setMessage(getOpsTaskActionErrorMessage(error, "선택한 과목 상세를 불러오지 못했습니다."))
      }
      return null
    }
  }, [canManageRegistrationWorkflow, ensureRegistrationOptions, loadRegistrationCaseForWorkspace, openDetail, syncTaskDeepLink, taskById])

  const editRegistrationTrack = useCallback(async (taskId: string, trackId: string) => {
    const selection = await openRegistrationTrack(taskId, trackId)
    if (!selection) return
    if (isLegacyRegistrationTrackId(trackId)) {
      openEdit(selection.task)
      return
    }
    setNotice(`[${selection.track?.subject || "과목"}] 과목별 상세를 확인하세요.`)
  }, [openEdit, openRegistrationTrack])

  const handleSelectRegistrationTrack = useCallback((trackId: string) => {
    const taskId = registrationCaseDetail?.task.id || selectedTask?.id || ""
    if (!taskId || !trackId) return
    registrationTrackSelectionRef.current = `${taskId}:${trackId}`
    setSelectedRegistrationTrackId(trackId)
    setRegistrationConsultationOutcomeTrackId(null)
    syncTaskDeepLink(taskId, trackId)
    setMessage("")
  }, [registrationCaseDetail?.task.id, selectedTask?.id, syncTaskDeepLink])

  const reloadRegistrationCaseDetail = useCallback(async (preferredTrackId?: string) => {
    const taskId = registrationCaseDetail?.task.id || selectedTask?.id || ""
    const currentTrackId = preferredTrackId || selectedRegistrationTrackIdRef.current || ""
    if (!taskId || !registrationViewerId || !currentTrackId || isLegacyRegistrationTrackId(currentTrackId)) return
    const selectionKey = `${taskId}:${currentTrackId}`
    registrationTrackSelectionRef.current = selectionKey
    try {
      const [detail] = await Promise.all([
        loadRegistrationCaseForWorkspace(taskId, true),
        reload(true, false),
      ])
      if (registrationTrackSelectionRef.current !== selectionKey) return
      const nextTrack = detail.tracks.find((track) => track.id === currentTrackId) || detail.tracks[0] || null
      setRegistrationCaseDetail(detail)
      setSelectedTask({ ...detail.task, registrationTracks: detail.tracks })
      setSelectedRegistrationTrackId(nextTrack?.id || null)
      syncTaskDeepLink(taskId, nextTrack?.id || null)
    } catch (error) {
      if (registrationTrackSelectionRef.current === selectionKey) {
        setMessage(getOpsTaskActionErrorMessage(error, "등록 상세를 다시 불러오지 못했습니다."))
      }
      throw error
    }
  }, [loadRegistrationCaseForWorkspace, registrationCaseDetail?.task.id, registrationViewerId, reload, selectedTask?.id, syncTaskDeepLink])

  const postRegistrationAdmissionAction = useCallback(async (payload: Record<string, unknown>) => {
    if (registrationFixtureEnabled) {
      const fixture = payload.action === "check"
        ? executeRegistrationSubjectTrackFixtureAction("checkRegistrationAdmissionMessage", payload)
        : payload.action === "reconcile"
          ? executeRegistrationSubjectTrackFixtureAction("reconcileRegistrationAdmissionMessage", payload)
          : payload.action === "release"
            ? executeRegistrationSubjectTrackFixtureAction("releaseRegistrationAdmissionMessageRetry", payload)
            : executeRegistrationSubjectTrackFixtureAction("sendRegistrationAdmissionMessage", payload)
      if (!fixture) throw new Error("registration_subject_track_fixture_runtime_unavailable")
      await fixture
      return
    }
    const sessionToken = session?.access_token || ""
    if (!sessionToken) throw new Error("인증 정보를 다시 확인하세요.")
    const response = await fetch("/api/solapi/registration", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${sessionToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    })
    const result = await response.json().catch(() => ({})) as { error?: string; warning?: string }
    if (!response.ok) throw new Error(result.error || "입학신청서 상태를 변경하지 못했습니다.")
    if (result.warning) setNotice(result.warning)
  }, [registrationFixtureEnabled, session?.access_token])

  const handleRegistrationTrackAction = useCallback(async (
    taskId: string,
    trackId: string,
    action: RegistrationTrackListAction,
  ) => {
    if (action !== "complete_consultation") return
    if (isLegacyRegistrationTrackId(trackId)) {
      await openRegistrationTrack(taskId, trackId)
      setMessage("데이터 전환 전 등록 업무는 기존 상세에서 처리하세요.")
      return
    }

    setSaving(true)
    setMessage("")
    const actionSelectionKey = `action:${taskId}:${trackId}`
    registrationTrackSelectionRef.current = actionSelectionKey
    try {
      const detail = await loadRegistrationCaseForWorkspace(taskId, true)
      if (registrationTrackSelectionRef.current !== actionSelectionKey) return
      const track = detail.tracks.find((item) => item.id === trackId) || null
      const activeConsultation = detail.consultations.find((consultation) => (
        consultation.trackId === trackId
        && ((track?.status === "consultation_waiting" && consultation.mode === "phone" && consultation.status === "waiting")
          || (track?.status === "visit_consultation_scheduled" && consultation.mode === "visit" && consultation.status === "scheduled"))
      )) || null
      const permissions = getRegistrationActionPermissions({
        viewerId: registrationViewerId,
        viewerRole: registrationViewerRole,
        track,
        activeConsultation,
      })

      if (!track || !permissions.canCompleteConsultation) {
        setMessage("상담 담당자 또는 진행 상태가 변경되었습니다. 목록을 다시 불러왔습니다.")
        await reload(true, false)
        return
      }

      registrationTrackSelectionRef.current = `${taskId}:${trackId}`
      setSelectedRegistrationTrackId(trackId)
      setRegistrationCaseDetail(detail)
      setSelectedTask({ ...detail.task, registrationTracks: detail.tracks })
      setDetailOpen(true)
      setRegistrationConsultationOutcomeTrackId(trackId)
      syncTaskDeepLink(taskId, trackId)
      setNotice(`[${track.subject}] 상담 결과 입력을 계속 진행하세요.`)
    } catch (error) {
      if (registrationTrackSelectionRef.current === actionSelectionKey) {
        setMessage(getOpsTaskActionErrorMessage(error, "상담 상세를 확인하지 못했습니다."))
      }
    } finally {
      setSaving(false)
    }
  }, [loadRegistrationCaseForWorkspace, openRegistrationTrack, registrationViewerId, registrationViewerRole, reload, syncTaskDeepLink])

  useEffect(() => {
    if (deleteTarget) return
    const currentSearchParams = new URLSearchParams(window.location.search)
    const deepLinkedTaskId = currentSearchParams.get("taskId") || ""
    const deepLinkedTrackId = currentSearchParams.get("trackId") || ""
    if (!deepLinkedTaskId || !data || !workspaceDataBelongsToCurrentViewer) return
    const deepLinkedTask = taskById.get(deepLinkedTaskId)
    if (!deepLinkedTask) {
      syncTaskDeepLink(null)
      return
    }
    if (deepLinkedTask.type !== "registration" && deepLinkedTrackId) {
      syncTaskDeepLink(deepLinkedTaskId, null)
    }
    if (deepLinkedTask.type === "word_retest") {
      openEdit(deepLinkedTask)
      return
    }
    if (deepLinkedTask.type === "registration" && deepLinkedTrackId) {
      if (
        selectedRegistrationTrackId === deepLinkedTrackId
        && selectedTask?.id === deepLinkedTaskId
        && detailOpen
      ) return
      setSelectedRegistrationTrackId(deepLinkedTrackId)
      void openRegistrationTrack(deepLinkedTaskId, deepLinkedTrackId)
      return
    }
    setSelectedRegistrationTrackId(null)
    setRegistrationCaseDetail(null)
    registrationTrackSelectionRef.current = ""
    setSelectedTask(deepLinkedTask)
    setDetailOpen(true)
  }, [data, deleteTarget, detailOpen, openEdit, openRegistrationTrack, searchParams, selectedRegistrationTrackId, selectedTask?.id, syncTaskDeepLink, taskById, workspaceDataBelongsToCurrentViewer])

  function handleDetailOpenChange(nextOpen: boolean) {
    setDetailOpen(nextOpen)
    if (!nextOpen) {
      setSelectedRegistrationTrackId(null)
      setRegistrationCaseDetail(null)
      setRegistrationConsultationOutcomeTrackId(null)
      registrationTrackSelectionRef.current = ""
      syncTaskDeepLink(null)
    }
  }

  function closeForm() {
    if (saving) return
    if (isFormDirty) {
      formCloseReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      setConfirmingFormClose(true)
      return
    }
    setFormOpen(false)
    setFormCompletionIntent(null)
    registrationCreateAttemptRef.current = null
  }

  function discardFormAndClose() {
    formCloseReturnFocusRef.current = null
    setConfirmingFormClose(false)
    setFormOpen(false)
    setFormCompletionIntent(null)
    registrationCreateAttemptRef.current = null
  }

  function cancelFormCloseConfirmation() {
    setConfirmingFormClose(false)
    window.requestAnimationFrame(() => formCloseReturnFocusRef.current?.focus())
  }

  function handleFormOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      setFormOpen(true)
      return
    }
    closeForm()
  }

  const updateForm = <Key extends keyof OpsTaskInput>(key: Key, value: OpsTaskInput[Key]) => {
    setMessage("")
    setFormCompletionBlockers([])
    setConfirmingFormClose(false)
    setForm((current) => ({ ...current, [key]: value }))
  }

  const updateFormPatch = (patch: Partial<OpsTaskInput>) => {
    setMessage("")
    setFormCompletionBlockers([])
    setConfirmingFormClose(false)
    setForm((current) => ({
      ...current,
      ...patch,
      ...(patch.registration
        ? { registration: { ...(current.registration || {}), ...patch.registration } }
        : {}),
    }))
  }

  function resetFormFeedback() {
    setMessage("")
    setFormCompletionBlockers([])
    setConfirmingFormClose(false)
  }

  function handleAssigneeChange(value: string) {
    resetFormFeedback()
    const nextTeam = profileTeamById.get(value) || ""
    setForm((current) => ({
      ...current,
      assigneeId: value,
      assigneeTeam: nextTeam || current.assigneeTeam || "",
    }))
  }

  function handleAssigneeTeamChange(value: string) {
    resetFormFeedback()
    const nextTeam = normalizeTaskTeamValue(value)
    setForm((current) => ({
      ...current,
      assigneeTeam: nextTeam,
      assigneeId: shouldClearProfileForTeam(current.assigneeId, nextTeam, profileTeamById) ? "" : current.assigneeId,
    }))
  }

  const updateRegistration = (key: keyof NonNullable<OpsTaskInput["registration"]>, value: string | boolean) => {
    setMessage("")
    setFormCompletionBlockers([])
    setConfirmingFormClose(false)
    setForm((current) => ({
      ...current,
      registration: { ...(current.registration || {}), [key]: value },
    }))
  }

  const updateWithdrawal = (key: keyof NonNullable<OpsTaskInput["withdrawal"]>, value: string | boolean) => {
    setMessage("")
    setFormCompletionBlockers([])
    setConfirmingFormClose(false)
    setForm((current) => ({
      ...current,
      withdrawal: { ...(current.withdrawal || {}), [key]: value },
    }))
  }

  const updateTransfer = (key: keyof NonNullable<OpsTaskInput["transfer"]>, value: string | boolean) => {
    setMessage("")
    setFormCompletionBlockers([])
    setConfirmingFormClose(false)
    setForm((current) => ({
      ...current,
      transfer: { ...(current.transfer || {}), [key]: value },
    }))
  }

  const updateWordRetest = (key: keyof NonNullable<OpsTaskInput["wordRetest"]>, value: string) => {
    setMessage("")
    setFormCompletionBlockers([])
    setConfirmingFormClose(false)
    setForm((current) => ({
      ...current,
      wordRetest: { ...(current.wordRetest || {}), [key]: value },
    }))
  }

  const invalidatePendingWorkspaceReloads = useCallback(() => {
    if (latestWorkspaceViewerIdRef.current !== currentUserId) return false
    workspaceLoadGenerationRef.current += 1
    setLoading(false)
    if (isRegistrationWorkspace) {
      registrationOptionsLoadGenerationRef.current += 1
      registrationOptionsLoadedRef.current = false
      setRegistrationOptionsLoading(false)
    }
    return true
  }, [currentUserId, isRegistrationWorkspace])

  const applyTaskPatch = (taskId: string, patch: Partial<OpsTask>) => {
    if (!invalidatePendingWorkspaceReloads()) return false
    setData((current) => current ? {
      ...current,
      tasks: sortWorkspaceTasks(current.tasks.map((task) => task.id === taskId ? { ...task, ...patch } : task)),
    } : current)
    setSelectedTask((current) => current?.id === taskId ? { ...current, ...patch } : current)
    return true
  }

  const prependTask = (task: OpsTask) => {
    if (!invalidatePendingWorkspaceReloads()) return false
    setData((current) => {
      const workspaceData = current || emptyOpsTaskWorkspaceData

      return {
        ...workspaceData,
        tasks: sortWorkspaceTasks([task, ...workspaceData.tasks]),
      }
    })
    return true
  }

  const replaceTaskInState = (nextTask: OpsTask) => {
    if (!invalidatePendingWorkspaceReloads()) return false
    setData((current) => {
      const workspaceData = current || emptyOpsTaskWorkspaceData
      const replaced = workspaceData.tasks.some((task) => task.id === nextTask.id)

      return {
        ...workspaceData,
        tasks: sortWorkspaceTasks(replaced
          ? workspaceData.tasks.map((task) => task.id === nextTask.id ? nextTask : task)
          : [nextTask, ...workspaceData.tasks]),
      }
    })
    setSelectedTask((current) => current?.id === nextTask.id ? nextTask : current)
    return true
  }

  const handleRegistrationCustomerMessageSent = async (taskId: string) => {
    const syncedTask = await loadOpsTaskById(taskId)
    if (syncedTask && replaceTaskInState(syncedTask)) {
      setRegistrationCustomerMessageTask(syncedTask)
    }
    setNotice("입학신청서 발송을 반영했습니다.")
  }

  const completeManualRegistrationAdmissionMessage = async (taskId: string) => {
    const task = taskById.get(taskId) || registrationCustomerMessageTask
    if (!task || task.type !== "registration") throw new Error("등록 업무 데이터를 다시 불러오세요.")
    const pipelineStatus = getManualAdmissionCompletionStatus(task.registration?.pipelineStatus)
    if (!pipelineStatus) throw new Error("입학 등록 결정 단계에서 발송 완료를 반영할 수 있습니다.")

    const payload = normalizeFormForSubmit({
      ...formFromTask(task),
      registration: {
        ...(task.registration || {}),
        admissionNoticeSent: true,
        pipelineStatus,
      },
    })
    await updateOpsTask(task.id, payload)
    const syncedTask = await loadOpsTaskById(task.id)
    if (!syncedTask) throw new Error("발송 완료 후 등록 업무를 다시 불러오지 못했습니다.")
    if (replaceTaskInState(syncedTask)) {
      setRegistrationCustomerMessageTask(syncedTask)
    }
  }

  const updateTaskInState = (taskId: string, updater: (task: OpsTask) => OpsTask) => {
    if (!invalidatePendingWorkspaceReloads()) return false
    setData((current) => current ? {
      ...current,
      tasks: sortWorkspaceTasks(current.tasks.map((task) => task.id === taskId ? updater(task) : task)),
    } : current)
    setSelectedTask((current) => current?.id === taskId ? updater(current) : current)
    return true
  }

  const appendTaskComment = (taskId: string, comment: OpsTaskComment) => {
    updateTaskInState(taskId, (task) => ({
      ...task,
      comments: [...task.comments, comment],
      updatedAt: comment.createdAt || task.updatedAt,
    }))
  }

  const appendTaskAttachment = (taskId: string, attachment: OpsTaskAttachment) => {
    updateTaskInState(taskId, (task) => ({
      ...task,
      attachments: [...task.attachments, attachment],
      updatedAt: attachment.uploadedAt || task.updatedAt,
    }))
  }

  const removeTaskFromState = (taskId: string) => {
    if (!invalidatePendingWorkspaceReloads()) return false
    setData((current) => current ? {
      ...current,
      tasks: current.tasks.filter((task) => task.id !== taskId),
    } : current)
    setSelectedTask((current) => current?.id === taskId ? null : current)
    return true
  }

  const buildLocalTaskFromInput = (taskId: string, input: OpsTaskInput, existing?: OpsTask): OpsTask => {
    const timestamp = new Date().toISOString()
    const requestedBy = input.requestedBy || existing?.requestedBy || currentUserId
    const assigneeId = input.assigneeId || ""
    const secondaryAssigneeId = input.secondaryAssigneeId || ""
    const status = input.status || existing?.status || "requested"

    return {
      id: taskId,
      title: input.title,
      type: input.type,
      status,
      priority: input.priority || existing?.priority || "normal",
      requestedBy,
      requestedByLabel: profileLabelById.get(requestedBy) || existing?.requestedByLabel || (requestedBy === currentUserId ? currentUserLabel : ""),
      requestedTeam: input.requestedTeam || existing?.requestedTeam || "",
      assigneeId,
      assigneeLabel: profileLabelById.get(assigneeId) || "",
      assigneeTeam: input.assigneeTeam || existing?.assigneeTeam || "",
      secondaryAssigneeId,
      secondaryAssigneeLabel: profileLabelById.get(secondaryAssigneeId) || "",
      studentId: input.studentId || "",
      studentName: input.studentName || "",
      classId: input.classId || "",
      className: input.className || "",
      textbookId: input.textbookId || "",
      textbookTitle: input.textbookTitle || "",
      campus: input.campus || "",
      subject: input.subject || "",
      startAt: input.startAt || "",
      dueAt: input.dueAt || "",
      completedAt: pickInputCompletedAt(input, existing),
      memo: input.memo || "",
      createdAt: existing?.createdAt || timestamp,
      updatedAt: timestamp,
      registration: input.type === "registration" ? input.registration : undefined,
      withdrawal: input.type === "withdrawal" ? input.withdrawal : undefined,
      transfer: input.type === "transfer" ? input.transfer : undefined,
      wordRetest: input.type === "word_retest" ? input.wordRetest : undefined,
      comments: existing?.comments || [],
      attachments: existing?.attachments || [],
      events: existing?.events || [],
    }
  }

  const submitQuickAdd = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const parsed = parseTodoistQuickAdd(quickAddText, profiles, {
      currentUserId,
      currentUserLabel,
      dueTodayValue,
      dueTomorrowValue,
    })
    if (!parsed.title.trim()) {
      setMessage("할 일 내용을 입력하세요.")
      setNotice("")
      setStatusUndo(null)
      return
    }
    const quickDueAt = parsed.dueAt || ""
    const quickPriority = parsed.priority || "normal"
    const quickAssigneeId = parsed.assigneeId || ""
    const quickAssigneeTeam = profileTeamById.get(quickAssigneeId) || ""
    const quickMemo = parsed.memo || ""

    setSaving(true)
    setMessage("")
    setFormCompletionBlockers([])
    setNotice("")
    setStatusUndo(null)
    try {
      const taskId = await createOpsTask({
        ...EMPTY_FORM,
        type: "general",
        title: parsed.title,
        requestedBy: currentUserId,
        requestedTeam: currentUserTaskTeam,
        assigneeId: quickAssigneeId,
        assigneeTeam: quickAssigneeTeam,
        dueAt: quickDueAt,
        priority: quickPriority,
        memo: quickMemo,
      })
      const createdAt = new Date().toISOString()
      prependTask({
        id: taskId,
        title: parsed.title,
        type: "general",
        status: "requested",
        priority: quickPriority,
        requestedBy: currentUserId,
        requestedByLabel: currentUserLabel,
        requestedTeam: currentUserTaskTeam,
        assigneeId: quickAssigneeId,
        assigneeLabel: profileLabelById.get(quickAssigneeId) || "",
        assigneeTeam: quickAssigneeTeam,
        secondaryAssigneeId: "",
        secondaryAssigneeLabel: "",
        studentId: "",
        studentName: "",
        classId: "",
        className: "",
        textbookId: "",
        textbookTitle: "",
        campus: "",
        subject: "",
        startAt: "",
        dueAt: quickDueAt,
        completedAt: "",
        memo: quickMemo,
        createdAt,
        updatedAt: createdAt,
        comments: [],
        attachments: [],
        events: [],
      })
      const createdTask = buildLocalTaskFromInput(taskId, {
        ...EMPTY_FORM,
        type: "general",
        title: parsed.title,
        requestedBy: currentUserId,
        requestedTeam: currentUserTaskTeam,
        assigneeId: quickAssigneeId,
        assigneeTeam: quickAssigneeTeam,
        dueAt: quickDueAt,
        priority: quickPriority,
        memo: quickMemo,
      })
      const nextTodoView: TodoViewKey = isOpsTaskInUserInbox(createdTask, currentUserContext) ? "inbox" : "sent"
      if (todoView !== nextTodoView) {
        syncTodoView(nextTodoView)
      }
      setQuery("")
      setQuickAddText("")
      const nextTodoLabel = TODO_VIEW_TABS.find((tab) => tab.key === nextTodoView)?.label || "목록"
      setNotice(`${nextTodoLabel}에 추가했습니다.`)
    } catch (error) {
      setMessage(getOpsTaskActionErrorMessage(error, "저장하지 못했습니다."))
    } finally {
      setSaving(false)
    }
  }

  async function retryPendingRegistrationVisitNotifications() {
    if (registrationVisitNotificationRetryInFlightRef.current || pendingRegistrationVisitNotificationTargets.length === 0) return
    const retryTargets = [...pendingRegistrationVisitNotificationTargets]
    const retryViewerId = currentUserId
    const retryGeneration = registrationVisitNotificationRetryGenerationRef.current + 1
    registrationVisitNotificationRetryGenerationRef.current = retryGeneration
    registrationVisitNotificationRetryInFlightRef.current = true
    setRetryingRegistrationVisitNotifications(true)
    try {
      const result = await dispatchRegistrationVisitNotificationTargets(
        retryTargets,
        (target: RegistrationVisitNotificationTarget) => sendRegistrationVisitNotificationTarget(target, session?.access_token || ""),
      )
      if (
        !workspaceMountedRef.current
        || latestWorkspaceViewerIdRef.current !== retryViewerId
        || registrationVisitNotificationRetryGenerationRef.current !== retryGeneration
      ) return
      setPendingRegistrationVisitNotificationTargets((current) => (
        reconcileRegistrationVisitNotificationRetryTargets(current, retryTargets, result.failedTargets)
      ))
      if (result.failedTargets.length > 0) {
        setNotice(`방문상담 알림 ${result.failedTargets.length}건을 아직 전송하지 못했습니다. 같은 저장본으로 다시 시도할 수 있습니다.`)
      } else if (result.warnings.length > 0) {
        setNotice("방문상담 알림 전달은 접수됐습니다. 감사 이력을 확인하세요.")
      } else {
        setNotice("선택한 방문상담 알림 재시도를 마쳤습니다.")
      }
    } finally {
      if (registrationVisitNotificationRetryGenerationRef.current === retryGeneration) {
        registrationVisitNotificationRetryInFlightRef.current = false
        if (workspaceMountedRef.current && latestWorkspaceViewerIdRef.current === retryViewerId) {
          setRetryingRegistrationVisitNotifications(false)
        }
      }
    }
  }

  const submitForm = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const submissionViewerId = currentUserId
    const submissionViewerGeneration = workspaceViewerGenerationRef.current
    const submissionForm = form
    const registrationCreateBlockers = submissionForm.type === "registration"
      ? getRegistrationCreateBlockers(submissionForm)
      : []
    if (registrationCreateBlockers.length > 0) {
      setMessage(getRegistrationCreateErrorMessage(submissionForm))
      setFormCompletionBlockers(registrationCreateBlockers)
      focusRegistrationFormSection(registrationCreateBlockers[0])
      return
    }
    const nextTitle = submissionForm.title.trim() || buildFallbackTaskTitle(submissionForm)
    if (!nextTitle) {
      setMessage(submissionForm.type === "general" ? "할 일을 입력하세요." : "학생명이나 수업명 중 하나를 입력하세요.")
      setNotice("")
      setStatusUndo(null)
      return
    }

    setSaving(true)
    setMessage("")
    setNotice("")
    setStatusUndo(null)
    let savedWithRefreshWarning = false
    let savedWithNotificationDeliveryFailure = false
    let savedWithNotificationAuditWarning = false
    const loadSavedTaskOrFallback = async (taskId: string, input: OpsTaskInput, existing?: OpsTask) => {
      try {
        return (await loadOpsTaskById(taskId)) || buildLocalTaskFromInput(taskId, input, existing)
      } catch {
        savedWithRefreshWarning = true
        return buildLocalTaskFromInput(taskId, input, existing)
      }
    }
    try {
      const wasEditing = Boolean(editingTask)
      const formWithRequesterDefaults: OpsTaskInput = submissionForm.type === "general"
        ? {
          ...submissionForm,
          title: nextTitle,
          requestedBy: submissionForm.requestedBy || editingTask?.requestedBy || currentUserId,
          requestedTeam: submissionForm.requestedTeam || editingTask?.requestedTeam || currentUserTaskTeam,
        }
        : { ...submissionForm, title: nextTitle }
      const inputWithCompletionIntent = applyFormCompletionIntent(formWithRequesterDefaults, formCompletionIntent)
      const prefilledRegistrationPipelineStatus = getRegistrationPrefillPipelineStatus(inputWithCompletionIntent)
      const inputWithRegistrationPrefillStatus = inputWithCompletionIntent.type === "registration"
        ? {
          ...inputWithCompletionIntent,
          registration: {
            ...(inputWithCompletionIntent.registration || {}),
            pipelineStatus: prefilledRegistrationPipelineStatus,
          },
        }
        : inputWithCompletionIntent
      const payload = normalizeFormForSubmit(inputWithRegistrationPrefillStatus)
      const isFailedWordRetestRetry = formCompletionIntent?.kind === "word_retest_retry"
        && formCompletionIntent.retryReason === "failed"
        && Boolean(editingTask)
        && payload.type === "word_retest"
      const intentBlockers = formCompletionIntent?.kind === "word_retest_retry" && payload.type === "word_retest" && !String(payload.wordRetest?.testAt || "").trim()
        ? ["본시험일"]
        : []
      const wordRetestRequiredBlockers = getWordRetestRequiredInputBlockers(
        payload,
        data?.textbooks || EMPTY_TEXTBOOK_OPTIONS,
        optionIndexes,
      )
      const operationCompletionBlockers = isFailedWordRetestRetry
        ? []
        : getOperationCompletionBlockers(
          payload,
          data?.students || EMPTY_STUDENT_OPTIONS,
          data?.classes || EMPTY_CLASS_OPTIONS,
          data?.textbooks || EMPTY_TEXTBOOK_OPTIONS,
          data?.teachers || EMPTY_TEACHER_OPTIONS,
          optionIndexes,
        )
      const completionBlockers = prioritizeCompletionBlockers([...intentBlockers, ...wordRetestRequiredBlockers, ...operationCompletionBlockers])
      if (completionBlockers.length > 0) {
        setFormDetailStep(getCompletionBlockerFormStep(payload.type, completionBlockers) || getDefaultFormDetailStep(payload.type))
        setMessage(getCompletionBlockerActionLabel(completionBlockers))
        setFormCompletionBlockers(completionBlockers)
        setSaving(false)
        return
      }
      if (isFailedWordRetestRetry && editingTask && payload.type === "word_retest") {
        const timestamp = new Date().toISOString()
        const originalWordRetest = editingTask.wordRetest || {}
        const completedPayload = normalizeFormForSubmit({
          ...formFromTask(editingTask),
          status: "done",
          completedAt: timestamp,
          wordRetest: {
            ...originalWordRetest,
            retestStatus: "done",
          },
        })
        const retryPayload = normalizeFormForSubmit({
          ...payload,
          status: "requested",
          completedAt: "",
          assigneeId: "",
          assigneeTeam: "조교팀",
          startAt: "",
          dueAt: "",
          wordRetest: {
            ...(payload.wordRetest || {}),
            retestStatus: "not_started",
            firstScore: "",
            secondScore: "",
            thirdScore: "",
            scoreOutOf100: "",
          },
        })

        await updateOpsTask(editingTask.id, completedPayload)
        const taskId = await createOpsTask(retryPayload)
        const [syncedOriginal, syncedRetry] = await Promise.all([
          loadSavedTaskOrFallback(editingTask.id, completedPayload, editingTask),
          loadSavedTaskOrFallback(taskId, retryPayload),
        ])
        replaceTaskInState(syncedOriginal)
        prependTask(syncedRetry)
        setFormOpen(false)
        setFormCompletionBlockers([])
        setFormCompletionIntent(null)
        setConfirmingFormClose(false)
        setWordRetestStudentIds([])
        setQuery("")
        setNotice(savedWithRefreshWarning
          ? "재시험 저장은 완료했습니다. 최신 상세는 새로고침해 확인하세요."
          : "재시험을 추가하고 불합격을 확인했습니다.")
        return
      }
      const createWordRetestStudentIds = wasEditing || payload.type !== "word_retest"
        ? []
        : Array.from(new Set(wordRetestStudentIds.map((studentId) => studentId.trim()).filter(Boolean)))
      const createPayloads = createWordRetestStudentIds.length > 0
        ? createWordRetestStudentIds.map((studentId) => getWordRetestStudentPayload(
          payload,
          studentId,
          data?.students || EMPTY_STUDENT_OPTIONS,
          optionIndexes,
          !form.title.trim(),
        ))
        : [payload]
      const savedTasks: OpsTask[] = []
      if (editingTask) {
        const positivelyIdentifiedLegacyRegistrationEdit = payload.type === "registration"
          && Boolean(editingTask.registrationTracks?.length)
          && editingTask.registrationTracks!.every((track) => track.legacy)
        const canonicalRegistrationEdit = payload.type === "registration"
          && !positivelyIdentifiedLegacyRegistrationEdit
        if (payload.type === "registration" && canonicalRegistrationEdit) {
          const registration = payload.registration || {}
          const detail = await loadOpsRegistrationCaseDetail(editingTask.id, currentUserId, { force: true })
          await updateRegistrationCaseCommon({
            taskId: editingTask.id,
            studentName: payload.studentName || "",
            schoolGrade: registration.schoolGrade || "",
            schoolName: registration.schoolName || "",
            parentPhone: registration.parentPhone || "",
            studentPhone: registration.studentPhone || "",
            campus: normalizeRegistrationCampus(payload.campus),
            inquiryAt: registration.inquiryAt || "",
            requestNote: registration.requestNote || "",
            priority: payload.priority || "normal",
            expectedCommonRevision: detail.commonRevision,
            requestKey: createRegistrationMutationRequestKey("registration-common-update"),
          })
          try {
            const updatedDetail = await loadOpsRegistrationCaseDetail(editingTask.id, currentUserId, { force: true })
            savedTasks.push({ ...updatedDetail.task, registrationTracks: updatedDetail.tracks })
          } catch {
            savedWithRefreshWarning = true
            savedTasks.push({
              ...buildLocalTaskFromInput(editingTask.id, payload, editingTask),
              registrationTracks: editingTask.registrationTracks,
            })
          }
        } else {
          await updateOpsTask(editingTask.id, payload)
          savedTasks.push(await loadSavedTaskOrFallback(editingTask.id, payload, editingTask))
        }
      } else {
        for (const createPayload of createPayloads) {
          if (createPayload.type === "registration") {
            const registration = createPayload.registration || {}
            const subjects = parseRegistrationSubjects(createPayload.subject) as RegistrationSubject[]
            const registrationPersistence = await probeRegistrationInitialPersistence({
              probeSubjectRuntime: probeRegistrationSubjectTrackRuntime,
              probeIntakeRuntime: probeRegistrationIntakeWorkflowRuntime,
            })
            setRegistrationPersistence(registrationPersistence)
            assertRegistrationCreateAttemptPersistenceMode(
              registrationCreateAttemptRef.current,
              registrationPersistence.mode,
            )

            if (registrationPersistence.mode === "blocked_maintenance") {
              throw new Error("등록 데이터 전환 중입니다. 전환이 끝난 뒤 다시 저장하세요.")
            }
            if (registrationPersistence.mode === "blocked_mismatch") {
              throw new Error("registration_runtime_version_mismatch")
            }
            if (registrationPersistence.mode === "blocked_indeterminate") {
              throw registrationPersistence.error
            }

            const initialDraft = registrationPersistence.mode === "ready_atomic"
              ? registrationInitialWorkflowDraft
              : createRegistrationInitialWorkflowDraft(subjects)
            const blockers = registrationPersistence.mode === "ready_atomic"
              ? getRegistrationInitialWorkflowBlockers(initialDraft, subjects, registrationResolvedDirectorIds)
              : []
            if (blockers.length > 0) {
              setFormCompletionBlockers(blockers)
              throw new Error(`초기 업무를 확인하세요: ${blockers.join(", ")}`)
            }
            const normalizedInitialWorkflow = normalizeRegistrationInitialWorkflow(initialDraft, subjects)
            registrationCreateAttemptRef.current = createRegistrationCreateAttempt(
              registrationCreateAttemptRef.current,
              {
                studentName: createPayload.studentName || "",
                schoolGrade: registration.schoolGrade || "",
                schoolName: registration.schoolName || "",
                parentPhone: registration.parentPhone || "",
                studentPhone: registration.studentPhone || "",
                campus: normalizeRegistrationCampus(createPayload.campus),
                inquiryAt: registration.inquiryAt || "",
                subjects,
                requestNote: registration.requestNote || "",
                priority: createPayload.priority || "normal",
              },
              normalizedInitialWorkflow,
              {
                persistenceMode: registrationPersistence.mode,
                createRequestKey: () => createRegistrationMutationRequestKey("registration-create"),
                createInquiryAt: () => new Date().toISOString(),
              },
            )
            const createAttempt = registrationCreateAttemptRef.current
            const registrationReceiptPayload: OpsTaskInput = {
              ...createPayload,
              registration: {
                ...registration,
                inquiryAt: createAttempt.inquiryAt,
              },
            }

            if (createAttempt.writer === "atomic") {
              const response = await createRegistrationCaseWithInitialWorkflow({
                ...createAttempt.common,
                inquiryAt: createAttempt.inquiryAt,
                subjectPlans: createAttempt.normalizedInitialWorkflow.subjectPlans,
                levelTestAppointment: createAttempt.normalizedInitialWorkflow.levelTestAppointment,
                visitAppointment: createAttempt.normalizedInitialWorkflow.visitAppointment,
                directorOverrides: createAttempt.normalizedInitialWorkflow.directorOverrides,
                requestKey: createAttempt.requestKey,
              })
              registrationCreateAttemptRef.current = null
              const notificationResult = await dispatchRegistrationVisitNotificationTargets(
                response.notificationTargets,
                (target: RegistrationVisitNotificationTarget) => sendRegistrationVisitNotificationTarget(target, session?.access_token || ""),
              )
              const notificationStateBelongsToSubmissionViewer = (
                workspaceMountedRef.current
                && latestWorkspaceViewerIdRef.current === submissionViewerId
                && workspaceViewerGenerationRef.current === submissionViewerGeneration
              )
              if (notificationStateBelongsToSubmissionViewer && notificationResult.failedTargets.length > 0) {
                setPendingRegistrationVisitNotificationTargets((current) => (
                  mergeRegistrationVisitNotificationTargets(current, notificationResult.failedTargets)
                ))
                savedWithNotificationDeliveryFailure = true
              }
              if (notificationStateBelongsToSubmissionViewer && notificationResult.warnings.length > 0) {
                savedWithNotificationAuditWarning = true
              }
              try {
                const detail = await loadOpsRegistrationCaseDetail(response.taskId, currentUserId, { force: true })
                savedTasks.push({ ...detail.task, registrationTracks: detail.tracks })
              } catch {
                savedWithRefreshWarning = true
                savedTasks.push({
                  ...buildLocalTaskFromInput(response.taskId, registrationReceiptPayload),
                  registrationTracks: response.tracks,
                })
              }
              continue
            }

            const inquiryOnlyPayload = sanitizeRegistrationInquiryOnlyInput(registrationReceiptPayload)
            if (createAttempt.writer === "canonical") {
              const response = await createRegistrationCase({
                ...createAttempt.common,
                inquiryAt: createAttempt.inquiryAt,
                requestKey: createAttempt.requestKey,
              })
              registrationCreateAttemptRef.current = null
              try {
                const detail = await loadOpsRegistrationCaseDetail(response.taskId, currentUserId, { force: true })
                savedTasks.push({ ...detail.task, registrationTracks: detail.tracks })
              } catch {
                savedWithRefreshWarning = true
                savedTasks.push({
                  ...buildLocalTaskFromInput(response.taskId, inquiryOnlyPayload),
                  registrationTracks: response.tracks,
                })
              }
              continue
            }
            if (createAttempt.writer === "legacy") {
              registrationCreateAttemptRef.current = markRegistrationLegacyCreateStarted(createAttempt)
              const taskId = await createOpsTask(inquiryOnlyPayload)
              registrationCreateAttemptRef.current = null
              savedTasks.push(await loadSavedTaskOrFallback(taskId, inquiryOnlyPayload))
              continue
            }
          }
          const taskId = await createOpsTask(createPayload)
          savedTasks.push(await loadSavedTaskOrFallback(taskId, createPayload))
        }
      }
      registrationCreateAttemptRef.current = null
      setFormOpen(false)
      setFormCompletionBlockers([])
      setFormCompletionIntent(null)
      setConfirmingFormClose(false)
      setWordRetestStudentIds([])
      if (wasEditing) {
        if (savedTasks[0]) replaceTaskInState(savedTasks[0])
      } else {
        savedTasks.forEach((task) => prependTask(task))
        setQuery("")
      }
      if (payload.type === "withdrawal" && !wasEditing) {
        savedTasks.forEach((task) => {
          void notifyWithdrawalWorkflow("submitted", task, withdrawalNotificationSettings, withdrawalNotificationTemplates, session?.access_token || "")
        })
      }
      if (payload.type === "transfer" && !wasEditing) {
        savedTasks.forEach((task) => {
          void notifyTransferWorkflow("submitted", task, transferNotificationSettings, transferNotificationTemplates, session?.access_token || "")
        })
      }
      if (payload.type === "registration" && !wasEditing) {
        savedTasks.forEach((task) => {
          void notifyRegistrationWorkflow(
            getRegistrationNotificationTriggerForPipelineStatus(task.registration?.pipelineStatus),
            task,
            registrationNotificationSettings,
            registrationNotificationTemplates,
            session?.access_token || "",
          )
        })
      }
      const itemLabel = payload.type === "general" ? "할 일" : getTaskTypeLabel(payload.type)
      const savedNotice = wasEditing
        ? `${itemLabel}을 수정했습니다.`
        : savedTasks.length > 1
          ? `${itemLabel} ${savedTasks.length}건을 추가했습니다.`
          : `${itemLabel}을 추가했습니다.`
      setNotice(savedWithNotificationAuditWarning && savedWithNotificationDeliveryFailure
        ? `${savedNotice} 일부 방문상담 알림의 전달 상태와 감사 이력을 확인하세요. 업무는 정상 저장되었습니다.`
        : savedWithNotificationAuditWarning
          ? `${savedNotice} 방문상담 알림 전달은 접수됐습니다. 감사 이력을 확인하세요.`
          : savedWithNotificationDeliveryFailure
            ? `${savedNotice} 방문상담 알림은 전송하지 못했습니다. 업무는 정상 저장되었습니다.`
        : savedWithRefreshWarning
          ? `${savedNotice} 최신 상세는 새로고침해 확인하세요.`
          : savedNotice)
    } catch (error) {
      setMessage(
        submissionForm.type === "registration" && !editingTask
          ? getRegistrationPersistenceErrorMessage(error, getOpsTaskActionErrorMessage(error, "저장하지 못했습니다."))
          : getOpsTaskActionErrorMessage(error, "저장하지 못했습니다."),
      )
    } finally {
      setSaving(false)
    }
  }

  const handleFormKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault()
      event.currentTarget.requestSubmit()
    }
  }

  function focusRegistrationFormSection(blocker: string) {
    const nextStep = getCompletionBlockerFormStep(form.type, [blocker]) || activeFormDetailStep
    setFormDetailStep(nextStep)
    if (form.type !== "registration") return

    const sectionKey = getRegistrationFormSectionForBlocker(blocker)
    const focusKey = getRegistrationBlockerFocusKey(blocker)
    window.requestAnimationFrame(() => {
      const section = document.getElementById(`registration-form-${sectionKey}`)
      if (!section) return
      section.scrollIntoView({ block: "start", behavior: "smooth" })
      const focusTarget = focusKey
        ? section.querySelector<HTMLElement>(`[data-registration-focus="${focusKey}"]`)
        : null
      const firstEnabledControl = (focusTarget || section).querySelector<HTMLElement>(
        'input:not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled)',
      )
      firstEnabledControl?.focus({ preventScroll: true })
    })
  }

  const changeStatus = async (task: OpsTask, status: OpsTaskStatus) => {
    setSaving(true)
    setMessage("")
    setNotice("")
    setStatusUndo(null)
    try {
      await updateOpsTaskStatus(task, status)
      const shouldRefreshSyncedTask = status === "done" || task.type === "registration" || task.type === "word_retest"
      const syncedTask = shouldRefreshSyncedTask ? await loadOpsTaskById(task.id) : null
      const changedAt = new Date().toISOString()
      const notificationTask: OpsTask = syncedTask || {
        ...task,
        status,
        completedAt: status === "done" ? changedAt : "",
        updatedAt: changedAt,
      }
      if (syncedTask) {
        replaceTaskInState(syncedTask)
      } else {
        applyTaskPatch(task.id, {
          status,
          completedAt: status === "done" ? changedAt : "",
        })
      }
      if (task.type === "withdrawal") {
        void notifyWithdrawalWorkflow(getWithdrawalNotificationTriggerForStatus(status), notificationTask, withdrawalNotificationSettings, withdrawalNotificationTemplates, session?.access_token || "")
      }
      if (task.type === "transfer") {
        void notifyTransferWorkflow(getWithdrawalNotificationTriggerForStatus(status), notificationTask, transferNotificationSettings, transferNotificationTemplates, session?.access_token || "")
      }
      if (task.type === "registration") {
        void notifyRegistrationWorkflow(
          getRegistrationNotificationTriggerForPipelineStatus(notificationTask.registration?.pipelineStatus),
          notificationTask,
          registrationNotificationSettings,
          registrationNotificationTemplates,
          session?.access_token || "",
        )
      }
      const canUndoStatusChange = task.type === "general" || status !== "done"
      if (canUndoStatusChange) {
        setStatusUndo({
          taskId: task.id,
          title: task.title,
          previousStatus: task.status,
          nextStatus: status,
        })
      }
      setNotice("진행상태를 변경했습니다.")
    } catch (error) {
      setMessage(getOpsTaskActionErrorMessage(error, "진행상태를 바꾸지 못했습니다."))
    } finally {
      setSaving(false)
    }
  }


  const updateWithdrawalChecklist = async (task: OpsTask, field: WithdrawalChecklistField, checked: boolean) => {
    if (!canManageWithdrawalWorkflow || !canEditTaskDetails(task)) return

    setSaving(true)
    setMessage("")
    setNotice("")
    setStatusUndo(null)
    try {
      const payload = normalizeFormForSubmit({
        ...formFromTask(task),
        withdrawal: {
          ...(task.withdrawal || {}),
          [field]: checked,
        },
      })
      await updateOpsTask(task.id, payload)
      const syncedTask = await loadOpsTaskById(task.id)
      replaceTaskInState(syncedTask || buildLocalTaskFromInput(task.id, payload, task))
      setNotice("처리 확인을 저장했습니다.")
    } catch (error) {
      setMessage(getOpsTaskActionErrorMessage(error, "처리 확인을 저장하지 못했습니다."))
    } finally {
      setSaving(false)
    }
  }

  const updateTransferChecklist = async (task: OpsTask, field: TransferChecklistField, checked: boolean) => {
    if (!canManageTransferWorkflow || !canEditTaskDetails(task)) return

    setSaving(true)
    setMessage("")
    setNotice("")
    setStatusUndo(null)
    try {
      const payload = normalizeFormForSubmit({
        ...formFromTask(task),
        transfer: {
          ...(task.transfer || {}),
          [field]: checked,
        },
      })
      await updateOpsTask(task.id, payload)
      const syncedTask = await loadOpsTaskById(task.id)
      replaceTaskInState(syncedTask || buildLocalTaskFromInput(task.id, payload, task))
      setNotice("처리 확인을 저장했습니다.")
    } catch (error) {
      setMessage(getOpsTaskActionErrorMessage(error, "처리 확인을 저장하지 못했습니다."))
    } finally {
      setSaving(false)
    }
  }

  const updateWordRetestFlow = async (task: OpsTask, input: OpsTaskInput, successMessage: string) => {
    setSaving(true)
    setMessage("")
    setNotice("")
    setStatusUndo(null)
    try {
      const payload = normalizeFormForSubmit(input)
      await updateOpsTask(task.id, payload)
      const syncedTask = await loadOpsTaskById(task.id)
      replaceTaskInState(syncedTask || buildLocalTaskFromInput(task.id, payload, task))
      setNotice(successMessage)
    } catch (error) {
      setMessage(getOpsTaskActionErrorMessage(error, "단어 재시험 진행상태를 바꾸지 못했습니다."))
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    if (!isWordRetestWorkspace || loading || !data) return

    const nextTasks = wordRetestFilterSourceTasks.filter((task) => (
      shouldAutoMarkWordRetestAbsent(task) && !autoAbsentWordRetestIdsRef.current.has(task.id)
    ))

    if (nextTasks.length === 0) return

    async function autoMarkPastWordRetestsAbsent() {
      const mutationViewerId = currentUserId
      const mutationLoadGeneration = workspaceLoadGenerationRef.current
      nextTasks.forEach((task) => autoAbsentWordRetestIdsRef.current.add(task.id))
      try {
        const syncedTasks = await Promise.all(nextTasks.map(async (task) => {
          const wordRetest = task.wordRetest || {}
          const payload = normalizeFormForSubmit({
            ...formFromTask(task),
            status: "review_requested",
            wordRetest: {
              ...wordRetest,
              retestStatus: "absent",
              firstScore: "",
              secondScore: "",
              thirdScore: "",
              scoreOutOf100: "",
            },
          })
          await updateOpsTask(task.id, payload)
          const syncedTask = await loadOpsTaskById(task.id)
          return syncedTask || {
            ...task,
            ...payload,
            updatedAt: new Date().toISOString(),
          }
        }))
        if (!workspaceMountedRef.current || latestWorkspaceViewerIdRef.current !== mutationViewerId) return
        if (workspaceLoadGenerationRef.current !== mutationLoadGeneration) {
          void reload(true, false)
          return
        }
        if (!invalidatePendingWorkspaceReloads()) return
        setData((current) => {
          const workspaceData = current || emptyOpsTaskWorkspaceData
          return {
            ...workspaceData,
            tasks: sortWorkspaceTasks(workspaceData.tasks.map((task) => (
              syncedTasks.find((syncedTask) => syncedTask.id === task.id) || task
            ))),
          }
        })
        setSelectedTask((current) => {
          if (!current) return current
          return syncedTasks.find((task) => task.id === current.id) || current
        })
        setMessage("")
        setNotice(nextTasks.length > 1
          ? `본시험일 기준 일주일 경과 ${nextTasks.length}건을 미응시 보고했습니다.`
          : "본시험일 기준 일주일 경과 항목을 미응시 보고했습니다.")
      } catch (error) {
        if (workspaceMountedRef.current && latestWorkspaceViewerIdRef.current === mutationViewerId) {
          setMessage(getOpsTaskActionErrorMessage(error, "본시험일 기준 미응시 보고를 자동 반영하지 못했습니다."))
        }
      } finally {
        nextTasks.forEach((task) => autoAbsentWordRetestIdsRef.current.delete(task.id))
      }
    }

    void autoMarkPastWordRetestsAbsent()
  }, [currentUserId, data, invalidatePendingWorkspaceReloads, isWordRetestWorkspace, loading, reload, wordRetestFilterSourceTasks])

  const submitWordRetestCompletion = async (task: OpsTask) => {
    const wordRetest = task.wordRetest || {}
    const scoreResult = getWordRetestScoreResult(wordRetest)
    await updateWordRetestFlow(task, {
      ...formFromTask(task),
      status: "review_requested",
      wordRetest: {
        ...wordRetest,
        retestStatus: "done",
      },
    }, scoreResult === "failed"
      ? "불합격 결과를 담당선생님에게 보냈습니다."
      : "합격 결과를 담당선생님에게 보냈습니다.")
  }

  const updateWordRetestScoreDraft = (task: OpsTask, key: keyof WordRetestScoreDraft, value: string) => {
    setWordRetestScoreDrafts((current) => ({
      ...current,
      [task.id]: {
        ...(current[task.id] || getWordRetestScoreDraft(task)),
        [key]: value,
      },
    }))
  }

  const saveWordRetestInlineScores = async (task: OpsTask) => {
    const wordRetest = task.wordRetest || {}
    if (isWordRetestAbsent(wordRetest)) return
    const draft = wordRetestScoreDrafts[task.id] || getWordRetestScoreDraft(task)

    await updateWordRetestFlow(task, {
      ...formFromTask(task),
      status: task.status,
      wordRetest: {
        ...wordRetest,
        ...draft,
        retestStatus: wordRetest.retestStatus || "not_started",
      },
    }, "점수를 저장했습니다.")
    setWordRetestScoreDrafts((current) => {
      const nextDrafts = { ...current }
      delete nextDrafts[task.id]
      return nextDrafts
    })
  }

  const changeRegistrationPipeline = async (task: OpsTask, pipelineStatus: string) => {
    const currentPipelinePrefix = getRegistrationPipelinePrefix(task.registration?.pipelineStatus)
    const nextPipelinePrefix = getRegistrationPipelinePrefix(pipelineStatus)
    if (currentPipelinePrefix.startsWith("4-") && nextPipelinePrefix === "1.") {
      const retryTask = {
        ...task,
        registration: prepareRegistrationLevelTestRetry(task.registration || {}),
      }
      const retryBlockers = getRegistrationPipelineActionBlockers(retryTask, pipelineStatus)
      openEdit(retryTask, retryBlockers, { registrationPipelineStatus: pipelineStatus })
      return
    }

    const transitionTask: OpsTask = {
      ...task,
      registration: prepareRegistrationPipelineTransition(task.registration || {}, pipelineStatus),
    }
    const pipelineActionBlockers = getRegistrationPipelineActionBlockers(transitionTask, pipelineStatus)
    if (pipelineActionBlockers.length > 0) {
      openEdit(transitionTask, pipelineActionBlockers, { registrationPipelineStatus: pipelineStatus })
      return
    }

    const payload = normalizeFormForSubmit({
      ...formFromTask(transitionTask),
      registration: transitionTask.registration,
    })
    const completionBlockers = getOperationCompletionBlockers(
      payload,
      data?.students || EMPTY_STUDENT_OPTIONS,
      data?.classes || EMPTY_CLASS_OPTIONS,
      data?.textbooks || EMPTY_TEXTBOOK_OPTIONS,
      data?.teachers || EMPTY_TEACHER_OPTIONS,
      optionIndexes,
    )
    if (completionBlockers.length > 0) {
      openEdit(transitionTask, completionBlockers, { registrationPipelineStatus: pipelineStatus })
      return
    }

    setSaving(true)
    setMessage("")
    setNotice("")
    setStatusUndo(null)
    try {
      await updateOpsTask(task.id, payload)
      const fallbackNotificationTask = buildLocalTaskFromInput(task.id, payload, task)
      let notificationTask = fallbackNotificationTask
      let refreshWarning = ""
      try {
        const syncedTask = await loadOpsTaskById(task.id)
        if (syncedTask) {
          notificationTask = syncedTask
        } else {
          refreshWarning = "최신 상세는 새로고침해 확인하세요."
        }
      } catch {
        refreshWarning = "최신 상세는 새로고침해 확인하세요."
      }
      replaceTaskInState(notificationTask)
      void notifyRegistrationWorkflow(
        getRegistrationNotificationTriggerForPipelineStatus(notificationTask.registration?.pipelineStatus),
        notificationTask,
        registrationNotificationSettings,
        registrationNotificationTemplates,
        session?.access_token || "",
      )
      setNotice(refreshWarning ? `등록 단계를 변경했습니다. ${refreshWarning}` : "등록 단계를 변경했습니다.")
    } catch (error) {
      setMessage(getOpsTaskActionErrorMessage(error, "등록 단계를 변경하지 못했습니다."))
    } finally {
      setSaving(false)
    }
  }

  const undoStatusChange = async () => {
    if (!statusUndo) return
    const currentTask = tasks.find((task) => task.id === statusUndo.taskId)
    if (!currentTask) {
      setStatusUndo(null)
      return
    }

    setSaving(true)
    setMessage("")
    try {
      await updateOpsTaskStatus(currentTask, statusUndo.previousStatus)
      const shouldRefreshSyncedTask = currentTask.type === "registration" || currentTask.type === "word_retest"
      const syncedTask = shouldRefreshSyncedTask ? await loadOpsTaskById(statusUndo.taskId) : null
      if (syncedTask) {
        replaceTaskInState(syncedTask)
      } else {
        applyTaskPatch(statusUndo.taskId, {
          status: statusUndo.previousStatus,
          completedAt: statusUndo.previousStatus === "done" ? new Date().toISOString() : "",
        })
      }
      setStatusUndo(null)
      setNotice("진행상태 변경을 되돌렸습니다.")
    } catch (error) {
      setMessage(getOpsTaskActionErrorMessage(error, "진행상태를 되돌리지 못했습니다."))
    } finally {
      setSaving(false)
    }
  }

  const submitComment = async () => {
    if (!selectedTask || !commentBody.trim()) return
    setSaving(true)
    setMessage("")
    setNotice("")
    setStatusUndo(null)
    try {
      const comment = await addOpsTaskComment(selectedTask.id, commentBody.trim())
      appendTaskComment(selectedTask.id, {
        ...comment,
        authorLabel: comment.authorLabel || currentUserLabel,
      })
      setCommentBody("")
      setNotice("댓글을 추가했습니다.")
    } catch (error) {
      setMessage(getOpsTaskActionErrorMessage(error, "댓글을 추가하지 못했습니다."))
    } finally {
      setSaving(false)
    }
  }

  const submitAttachment = async () => {
    if (!selectedTask || !attachmentName.trim() || !attachmentLink.trim()) return
    setSaving(true)
    setMessage("")
    setNotice("")
    setStatusUndo(null)
    try {
      const attachment = await addOpsTaskAttachment(selectedTask.id, attachmentName.trim(), attachmentLink.trim())
      appendTaskAttachment(selectedTask.id, {
        ...attachment,
        uploadedByLabel: attachment.uploadedByLabel || currentUserLabel,
      })
      setAttachmentName("")
      setAttachmentLink("")
      setNotice("첨부 링크를 저장했습니다.")
    } catch (error) {
      setMessage(getOpsTaskActionErrorMessage(error, "첨부 링크를 저장하지 못했습니다."))
    } finally {
      setSaving(false)
    }
  }

  const requestRemoveTask = (task: OpsTask) => {
    if (!canDeleteTask(task)) return
    setDetailOpen(false)
    syncTaskDeepLink(null)
    setFormOpen(false)
    setMessage("")
    setFormCompletionBlockers([])
    setNotice("")
    setStatusUndo(null)
    setDeleteTarget(task)
  }

  const requestRemoveWordRetests = (selectedTasks: OpsTask[]) => {
    const deletableTasks = selectedTasks.filter((task) => task.type === "word_retest" && canDeleteTask(task))
    if (deletableTasks.length === 0) {
      setMessage("삭제할 수 있는 단어 재시험이 없습니다.")
      return
    }

    setDetailOpen(false)
    setFormOpen(false)
    setMessage("")
    setFormCompletionBlockers([])
    setNotice("")
    setStatusUndo(null)
    setDeleteTarget(null)
    setBulkDeleteTargets(deletableTasks)
  }

  const confirmRemoveTask = async () => {
    if (!deleteTarget || !canDeleteTask(deleteTarget)) return
    setSaving(true)
    setMessage("")
    setNotice("")
    setStatusUndo(null)
    try {
      const taskId = deleteTarget.id
      await deleteOpsTask(taskId)
      setDeleteTarget(null)
      setDetailOpen(false)
      syncTaskDeepLink(null)
      removeTaskFromState(taskId)
      const itemLabel = deleteTarget.type === "general" ? "할 일" : getTaskTypeLabel(deleteTarget.type)
      setNotice(`${itemLabel} 삭제 완료`)
    } catch (error) {
      setMessage(getOpsTaskActionErrorMessage(error, "삭제하지 못했습니다."))
    } finally {
      setSaving(false)
    }
  }

  const confirmRemoveWordRetests = async () => {
    const deletableTasks = bulkDeleteTargets.filter((task) => task.type === "word_retest" && canDeleteTask(task))
    if (deletableTasks.length === 0) return
    setSaving(true)
    setMessage("")
    setNotice("")
    setStatusUndo(null)
    try {
      const deletedTaskIds = new Set(deletableTasks.map((task) => task.id))
      await Promise.all(deletableTasks.map((task) => deleteOpsTask(task.id)))
      setBulkDeleteTargets([])
      setWordRetestSelectedTaskIds((current) => {
        const next = new Set(current)
        deletedTaskIds.forEach((taskId) => next.delete(taskId))
        return next
      })
      if (!invalidatePendingWorkspaceReloads()) return
      setData((current) => current
        ? { ...current, tasks: current.tasks.filter((task) => !deletedTaskIds.has(task.id)) }
        : current)
      setSelectedTask((current) => current && deletedTaskIds.has(current.id) ? null : current)
      setDetailOpen(false)
      syncTaskDeepLink(null)
      setNotice(`단어 재시험 ${deletableTasks.length}건 삭제 완료`)
    } catch (error) {
      setMessage(getOpsTaskActionErrorMessage(error, "선택한 단어 재시험을 삭제하지 못했습니다."))
    } finally {
      setSaving(false)
    }
  }

  const selectedTaskFresh = workspaceDataBelongsToCurrentViewer && selectedTask
    ? selectedTask.type === "registration" && selectedRegistrationTrackId
      ? selectedTask
      : taskById.get(selectedTask.id) || selectedTask
    : null
  const isRegistrationDetail = selectedTaskFresh?.type === "registration"
  const isCanonicalRegistrationTrackDetail = Boolean(
    isRegistrationDetail
    && selectedRegistrationTrackId
    && !isLegacyRegistrationTrackId(selectedRegistrationTrackId),
  )
  const deleteTargetRemovesCompletedOperation = deleteTarget ? deleteTarget.type !== "general" && isClosedOpsTask(deleteTarget) : false
  const nextAction = selectedTaskFresh && !isCanonicalRegistrationTrackDetail ? getNextTaskStatusAction(selectedTaskFresh) : null
  const selectedRegistrationAction = selectedTaskFresh && !isCanonicalRegistrationTrackDetail ? getNextRegistrationPipelineAction(selectedTaskFresh) : null
  const selectedRegistrationReopenStatus = selectedTaskFresh?.type === "registration" && !isCanonicalRegistrationTrackDetail
    ? getRegistrationReopenStatus(selectedTaskFresh.registration?.pipelineStatus)
    : ""
	  const completionBlockers = selectedTaskFresh
	    ? getOperationCompletionBlockers(
        inputFromTaskForCompletionCheck(selectedTaskFresh),
        data?.students || EMPTY_STUDENT_OPTIONS,
        data?.classes || EMPTY_CLASS_OPTIONS,
        data?.textbooks || EMPTY_TEXTBOOK_OPTIONS,
        data?.teachers || EMPTY_TEACHER_OPTIONS,
        optionIndexes,
      )
	    : []
	  const detailWordRetestPrimaryActions = selectedTaskFresh?.type === "word_retest"
	    ? getWordRetestPrimaryActions(selectedTaskFresh, wordRetestMode, completionBlockers)
	    : []
	  const nextActionBlocked = nextAction?.status === "done" && completionBlockers.length > 0
	  const detailPrimaryAction = selectedTaskFresh?.type === "word_retest" ? null : selectedRegistrationAction || nextAction
  const detailPrimaryActionBlocked = selectedRegistrationAction
    ? selectedRegistrationAction.pipelineStatus.startsWith("7.") && completionBlockers.length > 0
    : nextActionBlocked
  const detailBlockedActionLabel = getCompletionBlockerActionLabel(completionBlockers)
  const selectedTaskCanEdit = selectedTaskFresh ? canEditTaskDetails(selectedTaskFresh) : false
  const showRegistrationDetailCompletionBlockers = Boolean(
    isRegistrationDetail && shouldShowRegistrationCompletionBlockers(selectedTaskFresh?.registration?.pipelineStatus),
  )
  const detailCompletionBlockers = isRegistrationDetail && !showRegistrationDetailCompletionBlockers
    ? EMPTY_COMPLETION_BLOCKERS
    : completionBlockers
  const isWithdrawalDetail = selectedTaskFresh?.type === "withdrawal"
  const isTransferDetail = selectedTaskFresh?.type === "transfer"
  const isProcessDetail = isWithdrawalDetail || isTransferDetail
  const isCompletedProcessDetail = Boolean(selectedTaskFresh && isProcessDetail && isClosedOpsTask(selectedTaskFresh))
  const canManageWithdrawalStatusAction = (!isRegistrationDetail || canManageRegistrationWorkflow) && (!isWithdrawalDetail || canManageWithdrawalWorkflow) && (!isTransferDetail || canManageTransferWorkflow)
  const toggleWordRetestSelection = useCallback((task: OpsTask, selected: boolean) => {
    if (task.type !== "word_retest" || !canDeleteTask(task)) return
    setWordRetestSelectedTaskIds((current) => {
      const next = new Set(current)
      if (selected) next.add(task.id)
      else next.delete(task.id)
      return next
    })
  }, [canDeleteTask])
  const toggleAllVisibleWordRetests = useCallback((selected: boolean, taskList: OpsTask[]) => {
    const selectableTasks = taskList.filter((task) => task.type === "word_retest" && canDeleteTask(task))
    setWordRetestSelectedTaskIds((current) => {
      const next = new Set(current)
      selectableTasks.forEach((task) => {
        if (selected) next.add(task.id)
        else next.delete(task.id)
      })
      return next
    })
  }, [canDeleteTask])
  const clearWordRetestSelection = useCallback(() => {
    setWordRetestSelectedTaskIds(new Set())
  }, [])
  const handleWordRetestStatusChange = useStableEvent((task: OpsTask, status: OpsTaskStatus) => {
    void changeStatus(task, status)
  })
  const handleWordRetestCompletion = useStableEvent((task: OpsTask) => {
    void submitWordRetestCompletion(task)
  })
  const handleWordRetestRetry = useStableEvent((task: OpsTask) => {
    openFailedWordRetestRetryForm(task)
  })
  const handleWordRetestScoreSave = useStableEvent((task: OpsTask) => {
    void saveWordRetestInlineScores(task)
  })
  const focusQuickAdd = useCallback(() => {
    quickAddInputRef.current?.focus()
  }, [])
  const focusSearch = useCallback(() => {
    if (searchInputRef.current) {
      searchInputRef.current.focus()
      return
    }
    if (isTodoWorkspace) focusQuickAdd()
  }, [focusQuickAdd, isTodoWorkspace])
  const workspaceSurfaceClassName = isWithdrawalWorkspace || isTransferWorkspace || isRegistrationWorkspace
    ? "flex flex-col gap-2"
    : "flex flex-col gap-2 rounded-lg border bg-card p-3 shadow-xs"

  useEffect(() => {
    if (!isTodoWorkspace) return

    const handleShortcut = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || formOpen || detailOpen || deleteTarget || bulkDeleteTargets.length > 0) return

      const target = event.target as HTMLElement | null
      const tagName = target?.tagName?.toLowerCase()
      const isEditableTarget = Boolean(
        target?.isContentEditable ||
        tagName === "input" ||
        tagName === "textarea" ||
        tagName === "select",
      )
      if (isEditableTarget) return

      if (event.key.toLowerCase() === "n") {
        event.preventDefault()
        focusQuickAdd()
      }
      if (event.key === "/") {
        event.preventDefault()
        focusSearch()
      }
    }

    window.addEventListener("keydown", handleShortcut)
    return () => window.removeEventListener("keydown", handleShortcut)
  }, [bulkDeleteTargets.length, deleteTarget, detailOpen, focusQuickAdd, focusSearch, formOpen, isTodoWorkspace])

  return (
    <div className="flex flex-col gap-4 px-3 pb-6 sm:px-4 lg:px-6">
      {!isTodoWorkspace && !isRegistrationWorkspace && !isWithdrawalWorkspace && !isTransferWorkspace && !isWordRetestWorkspace && visibleOperationMetrics.length > 0 && (
        <div className={HORIZONTAL_CHIP_BAR_CLASS}>
          {visibleOperationMetrics.map((metric) => (
            <DashboardMetric
              key={metric.key}
              label={metric.label}
              value={metric.value}
              active={taskFocus === metric.key}
              onClick={() => syncView(metric.view, metric.key)}
            />
          ))}
        </div>
      )}

      <div className={workspaceSurfaceClassName}>
        <div className={isTodoWorkspace ? "flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start" : isWordRetestWorkspace ? "flex min-w-0 items-center justify-between gap-2" : "flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between"}>
	          <div className={`${HORIZONTAL_TAB_BAR_CLASS} ${isTodoWorkspace ? "flex-1" : isWordRetestWorkspace ? "flex-1 flex-nowrap overflow-x-auto" : "w-full lg:flex-1"}`} role="tablist" aria-label={isTodoWorkspace ? "할 일 목록" : isWordRetestWorkspace ? "단어 재시험 역할" : isRegistrationWorkspace ? "등록 흐름" : isWithdrawalWorkspace ? "퇴원 흐름" : isTransferWorkspace ? "전반 흐름" : `${workspaceLabel} 보기`}>
	            {isWordRetestWorkspace
	              ? WORD_RETEST_ROLE_TABS.map((tab) => {
	                const roleCount = wordRetestRoleCounts[tab.key]

	                return (
	                  <button
	                    key={tab.key}
	                    type="button"
	                    role="tab"
	                    onClick={() => syncWordRetestMode(tab.key)}
	                    aria-selected={wordRetestMode === tab.key}
	                    aria-label={roleCount > 0 ? `${tab.label} ${roleCount}건` : tab.label}
	                    className={[
	                      "shrink-0 rounded-md px-3 py-2 text-sm font-medium transition-colors",
	                      wordRetestMode === tab.key
	                        ? "bg-primary text-primary-foreground"
	                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
	                    ].join(" ")}
	                  >
	                    <span>{tab.label}</span>
	                    {roleCount > 0 && (
	                      <span aria-hidden="true" className="ml-1 rounded bg-background/65 px-1.5 py-0.5 text-xs text-inherit opacity-80">
	                        {roleCount}
	                      </span>
	                    )}
	                  </button>
	                )
	              })
	              : isRegistrationWorkspace
	                ? REGISTRATION_VIEW_TABS.map((tab) => {
	                  const registrationCount = registrationCounts[tab.key]

	                  return (
	                    <button
	                      key={tab.key}
	                      type="button"
	                      role="tab"
	                      data-registration-view-tab={tab.key}
	                      tabIndex={registrationView === tab.key ? 0 : -1}
	                      onClick={() => syncRegistrationView(tab.key)}
	                      onKeyDown={(event) => handleRegistrationViewTabKeyDown(event, tab.key)}
	                      aria-selected={registrationView === tab.key}
	                      aria-label={registrationCount > 0 ? `${tab.label} ${registrationCount}건` : tab.label}
	                      className={[
	                        "shrink-0 rounded-md px-3 py-2 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40",
	                        registrationView === tab.key
	                          ? "bg-primary text-primary-foreground"
	                          : "text-muted-foreground hover:bg-muted hover:text-foreground",
	                      ].join(" ")}
	                    >
	                      <span>{tab.label}</span>
	                      {registrationCount > 0 && (
	                        <span aria-hidden="true" className="ml-1 rounded bg-background/65 px-1.5 py-0.5 text-xs text-inherit opacity-80">
	                          {registrationCount}
	                        </span>
	                      )}
	                    </button>
	                  )
	                })
	              : isWithdrawalWorkspace || isTransferWorkspace
	                ? WITHDRAWAL_VIEW_TABS.map((tab) => {
	                  const withdrawalCount = (isTransferWorkspace ? transferCounts : withdrawalCounts)[tab.key]

	                  return (
	                    <button
	                      key={tab.key}
	                      type="button"
	                      role="tab"
	                      onClick={() => syncWithdrawalView(tab.key)}
	                      aria-selected={withdrawalView === tab.key}
	                      aria-label={withdrawalCount > 0 ? `${tab.label} ${withdrawalCount}건` : tab.label}
	                      className={[
	                        "shrink-0 rounded-md px-3 py-2 text-sm font-medium transition-colors",
	                        withdrawalView === tab.key
	                          ? "bg-primary text-primary-foreground"
	                          : "text-muted-foreground hover:bg-muted hover:text-foreground",
	                      ].join(" ")}
	                    >
	                      <span>{tab.label}</span>
	                      {withdrawalCount > 0 && (
	                        <span aria-hidden="true" className="ml-1 rounded bg-background/65 px-1.5 py-0.5 text-xs text-inherit opacity-80">
	                          {withdrawalCount}
	                        </span>
	                      )}
	                    </button>
	                  )
	                })
	              : isTodoWorkspace
	              ? TODO_VIEW_TABS.map((tab) => {
	                const todoCount = todoCounts[tab.key]

                return (
                  <button
                    key={tab.key}
                    type="button"
                    role="tab"
                    onClick={() => syncTodoView(tab.key)}
                    aria-selected={todoView === tab.key}
                    aria-label={todoCount > 0 ? `${tab.label} ${todoCount}건` : tab.label}
                    className={[
                      "shrink-0 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                      todoView === tab.key
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    ].join(" ")}
                  >
                    <span>{tab.label}</span>
                    {todoCount > 0 && (
                      <span aria-hidden="true" className="ml-1 rounded bg-background/65 px-1.5 py-0.5 text-xs text-inherit opacity-80">
                        {todoCount}
                      </span>
                    )}
                  </button>
                )
              })
              : OPERATION_VIEW_TABS.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  onClick={() => syncView(tab.key)}
                  aria-selected={view === tab.key}
                  className={[
                    "shrink-0 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    view === tab.key
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  ].join(" ")}
                >
                  {tab.label}
                </button>
              ))}
          </div>
          <div className={isTodoWorkspace ? "flex shrink-0 flex-wrap items-center justify-end gap-2" : isWordRetestWorkspace ? "flex shrink-0 items-center justify-end gap-2" : "flex flex-wrap items-center gap-2 lg:shrink-0 lg:justify-end"}>
	            {!isTodoWorkspace && !isRegistrationWorkspace && !isWithdrawalWorkspace && !isTransferWorkspace && !isWordRetestWorkspace && taskFocus !== "none" && (
              <Button type="button" variant="secondary" size="sm" onClick={() => syncView(view)}>
                <X className="size-4" />
                {TASK_FOCUS_LABELS[taskFocus]} 해제
              </Button>
            )}
            {showClosedToggle && !isWordRetestWorkspace && (
              <Button type="button" variant="outline" size="sm" aria-pressed={showClosed} onClick={() => setShowClosed((value) => !value)}>
                <Check className="size-4" />
                {showClosed ? "완료 숨김" : "완료 보기"}
              </Button>
            )}
            {isRegistrationWorkspace && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setRegistrationProcessManualOpen(true)}
                aria-label="등록 프로세스 & 매뉴얼"
                title="등록 프로세스 & 매뉴얼"
                aria-haspopup="dialog"
                className="size-8 px-0"
              >
                <BookOpenCheck className="size-4" aria-hidden="true" />
                <span className="sr-only">등록 프로세스 &amp; 매뉴얼</span>
              </Button>
            )}
            {showNotificationSettingsLauncher && canonicalNotificationEnabled && (isTodoWorkspace || isWordRetestWorkspace) ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setCanonicalNotificationOpen(true)}
                aria-label={isTodoWorkspace ? "할 일 알림 설정" : "영어 단어 재시험 알림 설정"}
                title={isTodoWorkspace ? "할 일 알림 설정" : "영어 단어 재시험 알림 설정"}
                className="size-8 px-0"
              >
                <Bell className="size-4" aria-hidden="true" />
                <span className="sr-only">{isTodoWorkspace ? "할 일 알림 설정" : "영어 단어 재시험 알림 설정"}</span>
              </Button>
            ) : null}
            {!registrationFixtureEnabled && showLegacyNotificationSettingsLauncher && (isRegistrationWorkspace || isWithdrawalWorkspace || isTransferWorkspace) && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  if (canonicalNotificationEnabled) setCanonicalNotificationOpen(true)
                  else if (isRegistrationWorkspace) setRegistrationNotificationOpen(true)
                  else if (isTransferWorkspace) setTransferNotificationOpen(true)
                  else setWithdrawalNotificationOpen(true)
                }}
                aria-label={isRegistrationWorkspace ? "등록 알림 설정" : isTransferWorkspace ? "전반 알림 설정" : "퇴원 알림 설정"}
                title={isRegistrationWorkspace ? "등록 알림 설정" : isTransferWorkspace ? "전반 알림 설정" : "퇴원 알림 설정"}
                className="size-8 px-0"
              >
                <Bell className="size-4" aria-hidden="true" />
                <span className="sr-only">{isRegistrationWorkspace ? "등록 알림 설정" : isTransferWorkspace ? "전반 알림 설정" : "퇴원 알림 설정"}</span>
              </Button>
            )}
            {!isWordRetestWorkspace && !isRegistrationWorkspace && !isWithdrawalWorkspace && !isTransferWorkspace && (
              <Button type="button" variant="outline" size="sm" onClick={() => void reload(true)} disabled={loading} aria-label="새로고침" className="size-8 px-0">
                <RefreshCw className="size-4" />
                <span className="sr-only">새로고침</span>
              </Button>
            )}
	            {showToolbarCreate && (
	              <Button type="button" size="sm" onClick={() => openCreate(scopedTaskType)} disabled={createActionDisabled}>
	                <Plus className="size-4" />
	                {getWorkspaceCreateActionLabel(workspace, workspaceLabel)}
	              </Button>
	            )}
          </div>
        </div>
        {isTodoWorkspace && (
          <div className="grid gap-2">
            <form onSubmit={submitQuickAdd} className="grid gap-2 rounded-md border bg-background p-2 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
              <Input
                ref={quickAddInputRef}
                value={quickAddText}
                aria-label="할 일 빠른 추가"
                autoComplete="off"
                enterKeyHint="done"
                onChange={(event) => setQuickAddText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setQuickAddText("")
                }}
                placeholder="예: 긴급. 담당 홍길동. 내일까지 할 일 하기"
                data-testid="todo-quick-add-input"
                className="h-10 border-0 shadow-none focus-visible:ring-0"
              />
              <Button
                type="submit"
                size="sm"
                aria-label="자연어로 할 일 빠른 추가"
                disabled={saving || !quickAddText.trim()}
                className="h-10 shrink-0 px-3"
                data-testid="todo-quick-add-submit"
              >
                <Plus className="size-4" />
                <span>빠른 추가</span>
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label="입력창으로 할 일 요청"
                onClick={() => openCreate("general")}
                disabled={createActionDisabled}
                className="h-10 shrink-0 px-3"
              >
                추가
              </Button>
            </form>
            {quickAddPreviewItems.length > 0 && (
              <div
                aria-label="빠른 입력 해석"
                aria-live="polite"
                className="flex min-h-7 flex-wrap gap-1 px-1"
                data-testid="todo-quick-add-preview"
              >
                {quickAddPreviewItems.map((item) => (
                  <span
                    key={item.key}
                    className="max-w-full truncate rounded-full border bg-muted/35 px-2 py-1 text-xs font-medium text-muted-foreground"
                  >
                    {item.label}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {(showSearch || (isWordRetestWorkspace && showClosedToggle)) && (
          <div className="flex items-center gap-2">
            {showSearch ? (
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  ref={searchInputRef}
                  type="search"
                  value={query}
                  aria-label={`${workspaceLabel} 검색`}
                  autoComplete="off"
                  enterKeyHint="search"
                  data-testid="task-search-input"
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") setQuery("")
                  }}
                  placeholder={WORKSPACE_SEARCH_PLACEHOLDERS[workspace]}
                  className="pl-9 pr-9"
                />
                {query && (
                  <button
                    type="button"
                    aria-label="검색 지우기"
                    onClick={() => setQuery("")}
                    className="absolute right-2 top-1/2 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <X className="size-4" />
                  </button>
                )}
              </div>
            ) : (
              <div className="min-w-0 flex-1" />
            )}
            {isWordRetestWorkspace && showClosedToggle && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-pressed={showClosed}
                onClick={() => setShowClosed((value) => !value)}
                className="h-9 shrink-0 whitespace-nowrap px-3"
              >
                <Check className="size-4" />
                <span>{showClosed ? "완료 숨김" : "완료 보기"}</span>
              </Button>
            )}
          </div>
        )}

	        {isWordRetestWorkspace && (
	          <div className="grid gap-2">
	            <div className="flex flex-wrap gap-2">
	              <div className="inline-flex w-fit rounded-md border bg-background p-1" aria-label="단어 재시험 지점">
	                {WORD_RETEST_BRANCH_FILTERS.map((filter) => (
	                  <button
	                    key={filter.key}
	                    type="button"
	                    aria-pressed={wordRetestBranchFilter === filter.key}
	                    aria-label={`${filter.label} 단어 재시험 보기`}
	                    onClick={() => syncWordRetestBranchFilter(filter.key)}
	                    className={[
	                      "rounded px-3 py-1.5 text-sm font-medium",
	                      wordRetestBranchFilter === filter.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
	                    ].join(" ")}
	                  >
	                    {filter.label}
	                  </button>
	                ))}
	              </div>
	              <WordRetestPeriodFilterBar
	                value={wordRetestPeriodFilter}
	                startDate={wordRetestCustomStartDate}
	                endDate={wordRetestCustomEndDate}
	                onChange={syncWordRetestPeriodFilter}
	                onStartDateChange={(value) => syncWordRetestCustomDate("from", value)}
	                onEndDateChange={(value) => syncWordRetestCustomDate("to", value)}
	              />
	            </div>
	            <WordRetestFilterBar
	              options={wordRetestFilterOptions}
	              teacherFilter={wordRetestTeacherFilter}
	              classFilter={wordRetestClassFilter}
	              onTeacherChange={(value) => {
	                wordRetestTeacherFilterTouchedRef.current = true
	                setWordRetestTeacherFilter(value)
	              }}
	              onClassChange={setWordRetestClassFilter}
	            />
	          </div>
	        )}

        {isTodoWorkspace && (
          <div className="grid gap-2">
            <TodoTeamFilterBar
              options={todoFilterOptions}
              requestedByFilter={requestedByFilter}
              requestedTeamFilter={requestedTeamFilter}
              assigneeFilter={assigneeFilter}
              assigneeTeamFilter={assigneeTeamFilter}
              onRequestedByChange={setRequestedByFilter}
              onRequestedTeamChange={setRequestedTeamFilter}
              onAssigneeChange={setAssigneeFilter}
              onAssigneeTeamChange={setAssigneeTeamFilter}
            />
          </div>
        )}

        {data && !data.schemaReady && (
          <div role="alert" className="flex flex-col gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between">
            <span>{data?.error || "할 일 DB 마이그레이션을 적용하세요."}</span>
            <Button type="button" variant="outline" size="sm" onClick={() => void reload(true)} disabled={loading}>
              <RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} aria-hidden="true" />
              다시 시도
            </Button>
          </div>
        )}
        {(notice || pendingRegistrationVisitNotificationTargets.length > 0) && !detailOpen && (
          <div role="status" aria-live="polite" className="flex flex-col gap-2 rounded-md border border-primary/25 bg-primary/5 px-3 py-2 text-sm font-medium text-primary sm:flex-row sm:items-center sm:justify-between">
            <span>{notice || `방문상담 알림 ${pendingRegistrationVisitNotificationTargets.length}건을 전송하지 못했습니다. 알림 재시도를 눌러 주세요.`}</span>
            {pendingRegistrationVisitNotificationTargets.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void retryPendingRegistrationVisitNotifications()}
                disabled={retryingRegistrationVisitNotifications}
                className="h-7 w-full px-2 text-primary hover:bg-primary/10 hover:text-primary sm:w-auto"
              >
                {retryingRegistrationVisitNotifications
                  ? "방문상담 알림 재시도 중"
                  : `방문상담 알림 재시도 (${pendingRegistrationVisitNotificationTargets.length})`}
              </Button>
            )}
            {statusUndo && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void undoStatusChange()}
                disabled={saving}
                aria-label={`${statusUndo.title} 진행상태 변경 되돌리기`}
                className="h-7 w-full px-2 text-primary hover:bg-primary/10 hover:text-primary sm:w-auto"
              >
                되돌리기
              </Button>
            )}
          </div>
        )}
        {message && !formOpen && !detailOpen && <div role="alert" className="rounded-md border border-destructive/30 px-3 py-2 text-sm whitespace-pre-line text-destructive">{message}</div>}

	        {loading ? (
          <TaskListSkeleton showType={!isTodoWorkspace} />
	        ) : shouldHideEmptySurface ? null : isRegistrationWorkspace ? (
	          <RegistrationTrackList
	            key={registrationView}
	            items={visibleRegistrationTrackItems}
	            viewerId={registrationViewerId}
	            viewerRole={registrationViewerRole}
	            loading={loading}
	            disabled={saving}
	            onOpen={(taskId, trackId) => void openRegistrationTrack(taskId, trackId)}
	            onEdit={(taskId, trackId) => void editRegistrationTrack(taskId, trackId)}
	            onAction={(taskId, trackId, action) => void handleRegistrationTrackAction(taskId, trackId, action)}
	            emptyLabel={emptyTaskLabel}
	          />
	        ) : isWithdrawalWorkspace ? (
	          <WithdrawalDataTable
	            tasks={visibleTasks}
	            todayKey={todayKey}
	            loading={loading}
	            onOpen={openDetail}
	            onEdit={openEdit}
	            onStatusChange={(task, status) => void changeStatus(task, status)}
	            onChecklistChange={(task, field, checked) => void updateWithdrawalChecklist(task, field, checked)}
	            canManageWorkflow={canManageWithdrawalWorkflow}
	            statusActionDisabled={saving}
	            onCreate={() => openCreate(scopedTaskType)}
	            emptyLabel={emptyTaskLabel}
	            emptyActionLabel={emptyActionLabel}
	            showEmptyAction={false}
	            completionBlockersByTaskId={visibleCompletionBlockersByTaskId}
	          />
	        ) : isTransferWorkspace ? (
	          <TransferDataTable
	            tasks={visibleTasks}
	            todayKey={todayKey}
	            loading={loading}
	            onOpen={openDetail}
	            onEdit={openEdit}
	            onStatusChange={(task, status) => void changeStatus(task, status)}
	            onChecklistChange={(task, field, checked) => void updateTransferChecklist(task, field, checked)}
	            canManageWorkflow={canManageTransferWorkflow}
	            statusActionDisabled={saving}
	            onCreate={() => openCreate(scopedTaskType)}
	            emptyLabel={emptyTaskLabel}
	            emptyActionLabel={emptyActionLabel}
	            showEmptyAction={false}
	            completionBlockersByTaskId={visibleCompletionBlockersByTaskId}
	          />
	        ) : isWordRetestWorkspace ? (
	          <WordRetestTaskList
	            tasks={visibleTasks}
	            mode={wordRetestMode}
	            onOpen={openEdit}
	            onEdit={openEdit}
	            onStatusChange={handleWordRetestStatusChange}
	            onComplete={handleWordRetestCompletion}
	            onRetry={handleWordRetestRetry}
	            scoreDrafts={wordRetestScoreDrafts}
	            onScoreDraftChange={updateWordRetestScoreDraft}
	            onScoreSave={handleWordRetestScoreSave}
	            statusActionDisabled={saving}
	            selectedTaskIds={wordRetestSelectedTaskIds}
	            canSelectTask={canDeleteTask}
	            onSelectTask={toggleWordRetestSelection}
	            onSelectAll={toggleAllVisibleWordRetests}
	            onClearSelection={clearWordRetestSelection}
	            onBulkDelete={requestRemoveWordRetests}
	            onCreate={() => openCreate(scopedTaskType)}
	            emptyLabel={emptyTaskLabel}
	            emptyActionLabel={emptyActionLabel}
	            showEmptyAction={showEmptyCreate}
	            completionBlockersByTaskId={visibleCompletionBlockersByTaskId}
	          />
	        ) : !isTodoWorkspace && view === "calendar" ? (
	          <CalendarList
            items={calendarItems}
            tasks={visibleTasks}
            todayKey={todayKey}
            onOpen={openDetail}
            onEdit={openEdit}
            onStatusChange={(task, status) => void changeStatus(task, status)}
            onRegistrationPipelineAdvance={(task, pipelineStatus) => void changeRegistrationPipeline(task, pipelineStatus)}
            statusActionDisabled={saving}
            onCreate={isTodoWorkspace ? focusQuickAdd : () => openCreate(scopedTaskType)}
            emptyLabel={emptyCalendarLabel}
            emptyActionLabel={emptyActionLabel}
            showEmptyAction={isTodoWorkspace ? false : showEmptyCreate}
            completionBlockersByTaskId={visibleCompletionBlockersByTaskId}
          />
        ) : !isTodoWorkspace && view === "status" ? (
          <GroupedTaskList
            groups={groupOpsTasksByStatus(visibleTasks).filter((group) => group.tasks.length > 0)}
            todayKey={todayKey}
            onOpen={openDetail}
            onEdit={openEdit}
            onStatusChange={(task, status) => void changeStatus(task, status)}
            onRegistrationPipelineAdvance={(task, pipelineStatus) => void changeRegistrationPipeline(task, pipelineStatus)}
            statusActionDisabled={saving}
            onCreate={() => openCreate(scopedTaskType)}
            emptyLabel={emptyTaskLabel}
            emptyActionLabel={emptyActionLabel}
            showEmptyAction={showEmptyCreate}
            showType={false}
            completionBlockersByTaskId={visibleCompletionBlockersByTaskId}
          />
        ) : !isTodoWorkspace && view === "assignee" ? (
          <GroupedTaskList
            groups={groupOpsTasksByAssignee(visibleTasks)}
            todayKey={todayKey}
            onOpen={openDetail}
            onEdit={openEdit}
            onStatusChange={(task, status) => void changeStatus(task, status)}
            onRegistrationPipelineAdvance={(task, pipelineStatus) => void changeRegistrationPipeline(task, pipelineStatus)}
            statusActionDisabled={saving}
            onCreate={() => openCreate(scopedTaskType)}
            emptyLabel={emptyTaskLabel}
            emptyActionLabel={emptyActionLabel}
            showEmptyAction={showEmptyCreate}
            showType={false}
            completionBlockersByTaskId={visibleCompletionBlockersByTaskId}
          />
        ) : (
          <TaskList
            tasks={visibleTasks}
            todayKey={todayKey}
            onOpen={openDetail}
            onEdit={openEdit}
            onStatusChange={(task, status) => void changeStatus(task, status)}
            onRegistrationPipelineAdvance={(task, pipelineStatus) => void changeRegistrationPipeline(task, pipelineStatus)}
            statusActionDisabled={saving}
            onCreate={isTodoWorkspace ? focusQuickAdd : () => openCreate(scopedTaskType)}
            emptyLabel={emptyTaskLabel}
            emptyActionLabel={emptyActionLabel}
            showEmptyAction={showEmptyCreate}
            showType={false}
            sortKey={todoSort}
            onSortChange={syncTodoSort}
            completionBlockersByTaskId={visibleCompletionBlockersByTaskId}
          />
        )}
      </div>

      {canonicalNotificationEnabled ? (
        <NotificationControlPanel
          workflowKey={notificationWorkflowKey}
          presentation="dialog"
          open={workspaceDataBelongsToCurrentViewer && canonicalNotificationOpen}
          onOpenChange={setCanonicalNotificationOpen}
        />
      ) : null}

      {legacyNotificationEnabled && isWithdrawalWorkspace && (
        <WithdrawalNotificationSettingsDialog
          open={workspaceDataBelongsToCurrentViewer && withdrawalNotificationOpen}
          onOpenChange={setWithdrawalNotificationOpen}
          isManager={canManageAll || isStaff}
          sessionToken={session?.access_token || ""}
        />
      )}

      {legacyNotificationEnabled && isTransferWorkspace && (
        <TransferNotificationSettingsDialog
          open={workspaceDataBelongsToCurrentViewer && transferNotificationOpen}
          onOpenChange={setTransferNotificationOpen}
          isManager={canManageAll || isStaff}
          sessionToken={session?.access_token || ""}
        />
      )}

      {isRegistrationWorkspace && (
        <RegistrationProcessManualDialog
          open={workspaceDataBelongsToCurrentViewer && registrationProcessManualOpen}
          onOpenChange={setRegistrationProcessManualOpen}
        />
      )}

      {legacyNotificationEnabled && isRegistrationWorkspace && (
        <RegistrationNotificationSettingsDialog
          open={workspaceDataBelongsToCurrentViewer && registrationNotificationOpen}
          onOpenChange={setRegistrationNotificationOpen}
          isManager={canManageAll || isStaff}
          sessionToken={session?.access_token || ""}
        />
      )}

      <RegistrationCustomerMessageDialog
        open={workspaceDataBelongsToCurrentViewer && Boolean(registrationCustomerMessageTask)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setRegistrationCustomerMessageTask(null)
        }}
        task={registrationCustomerMessageTask}
        sessionToken={session?.access_token || ""}
        canSend={canManageRegistrationWorkflow}
        onSent={handleRegistrationCustomerMessageSent}
        onManualSent={completeManualRegistrationAdmissionMessage}
      />

      <Dialog open={workspaceDataBelongsToCurrentViewer && formOpen} onOpenChange={handleFormOpenChange}>
        <DialogContent className={[
          "z-[80] max-h-[calc(100dvh-1rem)] scroll-pb-24 overflow-x-hidden overflow-y-auto overscroll-contain sm:max-h-[92vh]",
          form.type === "transfer" ? "sm:max-w-5xl xl:max-w-6xl" : form.type === "registration" ? "sm:max-w-4xl" : isTemplateForm ? "sm:max-w-3xl" : "sm:min-h-[min(760px,92vh)] sm:max-w-2xl",
        ].join(" ")}
          closeButtonLabel={formCloseLabel}
          onCloseButtonClick={closeForm}
        >
          <DialogHeader className="-mx-6 -mt-6 border-b px-6 pb-5 pt-4">
            <DialogTitle>{formDialogTitle}</DialogTitle>
            <DialogDescription className="sr-only">
              운영 업무를 입력하고 저장합니다.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitForm} onKeyDown={handleFormKeyDown} className="grid gap-3">
            {form.type === "registration" && registrationOptionsLoading && (
              <div role="status" aria-live="polite" className="rounded-md border bg-muted/35 px-3 py-2 text-sm text-muted-foreground">
                상담 책임자·수업·교재 선택 정보를 불러오는 중입니다.
              </div>
            )}
            {form.type === "registration" && registrationOptionsError && (
              <div role="alert" className="flex flex-col gap-2 rounded-md border border-destructive/30 px-3 py-2 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between">
                <span>{registrationOptionsError}</span>
                <Button type="button" variant="outline" size="sm" onClick={() => void ensureRegistrationOptions()}>
                  다시 불러오기
                </Button>
              </div>
            )}
            {message && !isTemplateForm && (
              <div role="alert" className="rounded-md border border-destructive/30 px-3 py-2 text-sm whitespace-pre-line text-destructive">
                {message}
              </div>
            )}
            {!isTemplateForm && (
              <>
                <div className="grid gap-3 pt-1 md:grid-cols-[160px_minmax(0,1fr)]">
                  <PrioritySelectField value={form.priority || "normal"} onChange={(value) => updateForm("priority", value)} />
                  <TextField
                    label="제목"
                    value={form.title}
                    placeholder="무엇을 해야 하나요?"
                    autoFocus={!editingTask}
                    onChange={(value) => updateForm("title", value)}
                  />
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <TeamSelectField label="담당팀" value={form.assigneeTeam || ""} options={TODO_TEAM_OPTIONS} onChange={handleAssigneeTeamChange} />
                  <ProfileSelect
                    value={form.assigneeId || ""}
                    profiles={assigneeProfileOptions}
                    onChange={handleAssigneeChange}
                  />
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <DateField
                    label="시작일"
                    value={dateInputValue(form.startAt)}
                    onChange={(value) => updateForm("startAt", value)}
                    onClear={() => updateForm("startAt", "")}
                    clearLabel="시작일 지우기"
                  />
                  <DateField
                    label="마감일"
                    value={dateInputValue(form.dueAt)}
                    onChange={(value) => updateForm("dueAt", value)}
                    onClear={() => updateForm("dueAt", "")}
                    clearLabel="마감일 지우기"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted/45 px-3 py-2">
                  {currentUserId && (
                    <Button
                      type="button"
                      variant={form.assigneeId === currentUserId ? "default" : "outline"}
                      size="sm"
                      onClick={() => handleAssigneeChange(currentUserId)}
                    >
                      <UserRound className="size-4" />
                      나에게
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant={dateInputValue(form.startAt) === dateInputValue(dueTodayValue) ? "default" : "outline"}
                    size="sm"
                    onClick={() => updateForm("startAt", toDateKey(dueTodayValue))}
                  >
                    <CalendarDays className="size-4" />
                    오늘 시작
                  </Button>
                  <Button
                    type="button"
                    variant={dateInputValue(form.dueAt) === dateInputValue(dueTodayValue) ? "default" : "outline"}
                    size="sm"
                    onClick={() => updateForm("dueAt", toDateKey(dueTodayValue))}
                  >
                    <CalendarDays className="size-4" />
                    오늘 마감
                  </Button>
                  <Button
                    type="button"
                    variant={dateInputValue(form.dueAt) === dateInputValue(dueTomorrowValue) ? "default" : "outline"}
                    size="sm"
                    onClick={() => updateForm("dueAt", toDateKey(dueTomorrowValue))}
                  >
                    <CalendarDays className="size-4" />
                    내일 마감
                  </Button>
                </div>

                <label htmlFor={formMemoId} className="grid gap-1.5 text-sm font-medium">
                  <span>메모</span>
                  <Textarea
                    id={formMemoId}
                    value={form.memo || ""}
                    onChange={(event) => updateForm("memo", event.target.value)}
                    placeholder="메모"
                    className="min-h-20 resize-y"
                  />
                </label>

                <div className="grid gap-3 border-t pt-3 md:grid-cols-3">
                  <ReadonlyInfoField label="요청팀" value={formRequestedTeamLabel} />
                  <ReadonlyInfoField label="요청자" value={formRequestedByLabel} />
                  <ReadonlyInfoField label="요청일시" value={formRequestedAtLabel} />
                </div>
              </>
            )}

	            {isWordRetestForm && (
	              <section className="grid gap-4 rounded-lg border p-3">
	                {message && (
	                  <div role="alert" className="rounded-md border border-destructive/30 whitespace-pre-line bg-background px-3 py-2 text-sm text-destructive">
	                    <span>{message}</span>
	                    {!isEditingLockedCompletedTask && formCompletionBlockers.length > 0 && (
	                      <span className="mt-2 flex flex-wrap gap-1">
	                        {formCompletionBlockers.map((blocker) => (
	                          <button
	                            key={blocker}
	                            type="button"
	                            onClick={() => setFormDetailStep(getCompletionBlockerFormStep(form.type, [blocker]) || activeFormDetailStep)}
	                            aria-label={`${blocker} ${getCompletionBlockerNeedLabel(blocker)} 입력 위치로 이동`}
	                            className="inline-flex min-h-7 items-center rounded-full border border-destructive/25 bg-background px-2 py-0.5 text-[11px] font-medium text-destructive hover:bg-destructive/10"
	                          >
	                            {blocker} {getCompletionBlockerNeedLabel(blocker)}
	                          </button>
	                        ))}
	                      </span>
	                    )}
	                  </div>
                )}
                <WordRetestProgressStepper
                  value={form.wordRetest?.retestStatus || "not_started"}
                  taskStatus={form.status}
                  wordRetest={form.wordRetest}
                />
	                <TypeSpecificFields
	                  step="word_retest_basic"
	                  form={form}
	                  formCompletionIntent={formCompletionIntent}
	                  wordRetestStudentIds={wordRetestStudentIds}
	                  onWordRetestStudentIdsChange={setWordRetestStudentIds}
	                  students={data?.students || EMPTY_STUDENT_OPTIONS}
	                  classes={data?.classes || EMPTY_CLASS_OPTIONS}
	                  teachers={data?.teachers || EMPTY_TEACHER_OPTIONS}
	                  textbooks={data?.textbooks || EMPTY_TEXTBOOK_OPTIONS}
	                  updateForm={updateForm}
	                  updateFormPatch={updateFormPatch}
	                  updateRegistration={updateRegistration}
	                  updateWithdrawal={updateWithdrawal}
	                  updateTransfer={updateTransfer}
	                  updateWordRetest={updateWordRetest}
	                />
	                <TypeSpecificFields
	                  step="word_retest_scope"
	                  form={form}
	                  formCompletionIntent={formCompletionIntent}
	                  wordRetestStudentIds={wordRetestStudentIds}
	                  onWordRetestStudentIdsChange={setWordRetestStudentIds}
	                  students={data?.students || EMPTY_STUDENT_OPTIONS}
	                  classes={data?.classes || EMPTY_CLASS_OPTIONS}
	                  teachers={data?.teachers || EMPTY_TEACHER_OPTIONS}
	                  textbooks={data?.textbooks || EMPTY_TEXTBOOK_OPTIONS}
	                  updateForm={updateForm}
	                  updateFormPatch={updateFormPatch}
	                  updateRegistration={updateRegistration}
	                  updateWithdrawal={updateWithdrawal}
	                  updateTransfer={updateTransfer}
	                  updateWordRetest={updateWordRetest}
	                />
		                {editingTask && formCompletionIntent?.kind !== "word_retest_retry" && (
		                  <section className="grid gap-3 rounded-lg border bg-muted/20 p-3">
	                    <div className="flex items-center justify-between gap-2">
	                      <h3 className="text-sm font-semibold">점수</h3>
	                    </div>
	                    <TypeSpecificFields
	                      step="word_retest_scores"
	                      form={form}
	                      formCompletionIntent={formCompletionIntent}
	                      wordRetestStudentIds={wordRetestStudentIds}
	                      onWordRetestStudentIdsChange={setWordRetestStudentIds}
	                      students={data?.students || EMPTY_STUDENT_OPTIONS}
	                      classes={data?.classes || EMPTY_CLASS_OPTIONS}
	                      teachers={data?.teachers || EMPTY_TEACHER_OPTIONS}
	                      textbooks={data?.textbooks || EMPTY_TEXTBOOK_OPTIONS}
	                      updateForm={updateForm}
	                      updateFormPatch={updateFormPatch}
	                      updateRegistration={updateRegistration}
	                      updateWithdrawal={updateWithdrawal}
	                      updateTransfer={updateTransfer}
	                      updateWordRetest={updateWordRetest}
	                    />
	                  </section>
	                )}
	              </section>
	            )}

            {isTemplateForm && !isWordRetestForm && formDetailTabs.length > 0 && (
              <section className={form.type === "withdrawal" || form.type === "transfer" || form.type === "registration" ? "grid gap-3" : "grid gap-3 rounded-lg border p-3"}>
	                {shouldShowFormDetailTabs && formStepProgressLabel && (
	                  <div className="flex items-center justify-between gap-2 px-1 text-xs font-medium text-muted-foreground">
                    <span>{getTaskTypeLabel(form.type)}</span>
                    <span>{formStepProgressLabel}</span>
                  </div>
                )}
                {shouldShowFormDetailTabs && (
                  <div
                    className={`${HORIZONTAL_MUTED_CHIP_BAR_CLASS} items-center`}
                    role="group"
                    aria-label={`${getTaskTypeLabel(form.type)} 입력 단계 ${formStepProgressLabel}`}
                  >
	                    {formDetailTabs.map((tab) => (
	                      <button
                        key={tab.key}
                        type="button"
                        aria-pressed={activeFormDetailStep === tab.key}
                        onClick={() => setFormDetailStep(tab.key)}
                        className={[
                          "shrink-0 rounded px-3 py-1.5 text-sm font-medium transition-colors",
                          activeFormDetailStep === tab.key
                            ? "bg-background text-foreground shadow-xs"
                            : "text-muted-foreground hover:text-foreground",
                        ].join(" ")}
                      >
                          {tab.label}
                        </button>
                      ))}
                  </div>
                )}
                {message && (
                  <div role="alert" className="rounded-md border border-destructive/30 whitespace-pre-line bg-background px-3 py-2 text-sm text-destructive">
                    <span>{message}</span>
                    {!isEditingLockedCompletedTask && formCompletionBlockers.length > 0 && (
                      <span className="mt-2 flex flex-wrap gap-1">
                        {formCompletionBlockers.map((blocker) => (
                          <button
                            key={blocker}
                            type="button"
                            onClick={() => focusRegistrationFormSection(blocker)}
                            aria-label={`${blocker} ${getCompletionBlockerNeedLabel(blocker)} 입력 단계로 이동`}
                            className="inline-flex min-h-7 items-center rounded-full border border-destructive/25 bg-background px-2 py-0.5 text-[11px] font-medium text-destructive hover:bg-destructive/10"
                          >
                            {blocker} {getCompletionBlockerNeedLabel(blocker)}
                          </button>
                        ))}
                      </span>
                    )}
                  </div>
                )}
	                <TypeSpecificFields
	                  step={activeFormDetailStep}
	                  form={form}
	                  formCompletionIntent={formCompletionIntent}
	                  students={data?.students || EMPTY_STUDENT_OPTIONS}
                  classes={data?.classes || EMPTY_CLASS_OPTIONS}
                  teachers={data?.teachers || EMPTY_TEACHER_OPTIONS}
                  textbooks={data?.textbooks || EMPTY_TEXTBOOK_OPTIONS}
                  updateForm={updateForm}
                  updateFormPatch={updateFormPatch}
                  updateRegistration={updateRegistration}
                  registrationPersistence={registrationPersistence}
                  registrationInitialWorkflowDraft={registrationInitialWorkflowDraft}
                  registrationResolvedDirectorIds={registrationResolvedDirectorIds}
                  registrationDirectorOptionsBySubject={registrationDirectorOptionsBySubject}
                  onRegistrationInitialWorkflowChange={setRegistrationInitialWorkflowDraft}
                  editingRegistration={Boolean(editingTask)}
                  updateWithdrawal={updateWithdrawal}
                  updateTransfer={updateTransfer}
                  updateWordRetest={updateWordRetest}
                />
              </section>
            )}

            {isTemplateForm && !isWordRetestForm && form.type !== "withdrawal" && form.type !== "transfer" && form.type !== "registration" && (
              <section className="grid gap-3 rounded-lg border bg-muted/20 p-3">
                <div className={showTemplateDueAt ? "grid gap-3 md:grid-cols-2" : "grid gap-3"}>
                  <ProfileSelect
                    label="담당자"
                    value={form.assigneeId || ""}
                    profiles={profiles}
                    onChange={(value) => updateForm("assigneeId", value)}
                  />
                  {showTemplateDueAt && (
                    <TextField label={getDueAtDisplayLabel(form.type)} type="datetime-local" value={dateTimeInputValue(form.dueAt)} onChange={(value) => updateForm("dueAt", value)} />
                  )}
                </div>
                {editingTask && (
                  <TextField
                    label="제목 직접 지정"
                    value={form.title}
                    placeholder="제목"
                    onChange={(value) => updateForm("title", value)}
                  />
                )}
              </section>
            )}
            <div className="-mx-6 -mb-6 flex flex-col gap-2 border-t bg-background px-6 py-4 sm:flex-row sm:items-center sm:justify-end">
              {!isEditingLockedCompletedTask && formCompletionBlockers.length > 0 && formCompletionIntent?.kind !== "word_retest_retry" && (
                (() => {
                  const firstBlocker = formCompletionBlockers[0]
                  return (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => focusRegistrationFormSection(firstBlocker)}
                      aria-label={`${getCompletionBlockerActionLabel(formCompletionBlockers)} 바로 입력`}
                      className="w-full sm:w-auto"
                    >
                      {getCompletionBlockerActionLabel(formCompletionBlockers)}
                    </Button>
                  )
                })()
              )}
	              {shouldShowFormDetailTabs && (
                <div className="flex w-full items-center gap-2 sm:mr-auto sm:w-auto">
                  {previousFormDetailStep && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setFormDetailStep(previousFormDetailStep.key)}
                      aria-label="이전 단계"
                      className="min-w-0 flex-1 sm:flex-none"
                    >
                      <ChevronLeft className="size-4" />
                      <span className="truncate">{previousFormStepLabel}</span>
                    </Button>
                  )}
                  {nextFormDetailStep && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setFormDetailStep(nextFormDetailStep.key)}
                      aria-label="다음 단계"
                      className="min-w-0 flex-1 sm:flex-none"
                    >
                      <span className="truncate">{nextFormStepLabel}</span>
                      <ChevronRight className="size-4" />
                    </Button>
                  )}
                </div>
              )}
              <Button type="button" variant="outline" onClick={closeForm} className="w-full sm:w-auto">
                {formCloseLabel}
              </Button>
              {!isEditingLockedCompletedTask && (
                <Button type="submit" disabled={saving || (!canSubmitCurrentForm && form.type !== "registration")} className="w-full sm:w-auto">
                  {saving ? "저장 중" : getFormCompletionIntentSubmitLabel(formCompletionIntent, form.type, Boolean(editingTask))}
                </Button>
              )}
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={workspaceDataBelongsToCurrentViewer && confirmingFormClose}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) cancelFormCloseConfirmation()
        }}
      >
        <DialogContent className="z-[90] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>입력한 내용을 버릴까요?</DialogTitle>
            <DialogDescription className="sr-only">
              저장하지 않은 입력 내용 폐기를 확인합니다.
            </DialogDescription>
            <p className="text-sm text-muted-foreground">
              저장하지 않은 내용은 복구할 수 없습니다.
            </p>
          </DialogHeader>
          <DialogFooter className="flex-col-reverse gap-2 sm:flex-row">
            <Button type="button" variant="outline" onClick={cancelFormCloseConfirmation} disabled={saving}>
              계속 작성
            </Button>
            <Button type="button" variant="destructive" onClick={discardFormAndClose} disabled={saving}>
              저장하지 않고 닫기
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={workspaceDataBelongsToCurrentViewer && detailOpen} onOpenChange={handleDetailOpenChange}>
        <DialogContent className={[
          "max-h-[calc(100dvh-1rem)] scroll-pb-24 overflow-x-hidden overflow-y-auto overscroll-contain sm:max-h-[92vh]",
          selectedTaskFresh?.type === "general" ? "sm:max-w-2xl" : selectedTaskFresh?.type === "word_retest" ? "sm:max-w-3xl" : selectedTaskFresh?.type === "registration" || selectedTaskFresh?.type === "withdrawal" || selectedTaskFresh?.type === "transfer" ? "sm:max-w-3xl" : "sm:max-w-5xl",
        ].join(" ")}>
          <DialogHeader>
            <DialogTitle>{selectedTaskFresh?.title || "상세"}</DialogTitle>
            <DialogDescription className="sr-only">
              선택한 운영 업무의 처리 상태를 확인합니다.
            </DialogDescription>
          </DialogHeader>
          {(notice || pendingRegistrationVisitNotificationTargets.length > 0) && (
            <div role="status" aria-live="polite" className="flex flex-col gap-2 rounded-md border border-primary/25 bg-primary/5 px-3 py-2 text-sm font-medium text-primary sm:flex-row sm:items-center sm:justify-between">
              <span>{notice || `방문상담 알림 ${pendingRegistrationVisitNotificationTargets.length}건을 전송하지 못했습니다. 알림 재시도를 눌러 주세요.`}</span>
              {pendingRegistrationVisitNotificationTargets.length > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void retryPendingRegistrationVisitNotifications()}
                  disabled={retryingRegistrationVisitNotifications}
                  className="h-7 w-full px-2 text-primary hover:bg-primary/10 hover:text-primary sm:w-auto"
                >
                  {retryingRegistrationVisitNotifications
                    ? "방문상담 알림 재시도 중"
                    : `방문상담 알림 재시도 (${pendingRegistrationVisitNotificationTargets.length})`}
                </Button>
              )}
              {statusUndo && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void undoStatusChange()}
                  disabled={saving}
                  aria-label={`${statusUndo.title} 진행상태 변경 되돌리기`}
                  className="h-7 w-full px-2 text-primary hover:bg-primary/10 hover:text-primary sm:w-auto"
                >
                  되돌리기
                </Button>
              )}
            </div>
          )}
          {message && (
            <div role="alert" className="rounded-md border border-destructive/30 px-3 py-2 text-sm whitespace-pre-line text-destructive">
              {message}
            </div>
          )}
          {selectedTaskFresh && (
            <div className={selectedTaskFresh.type === "registration" || selectedTaskFresh.type === "withdrawal" || selectedTaskFresh.type === "transfer" ? "grid gap-4" : selectedTaskFresh.type === "general" || selectedTaskFresh.type === "word_retest" ? "grid gap-4" : "grid gap-4 lg:grid-cols-[1.15fr_0.85fr]"}>
              <div className={isProcessDetail || isRegistrationDetail ? "flex flex-col gap-3" : "flex flex-col gap-3 rounded-lg border p-4"}>
                {selectedTaskFresh.type === "general" ? (
                  <GeneralTaskDetailPanel task={selectedTaskFresh} />
                ) : selectedTaskFresh.type === "word_retest" ? (
                  <WordRetestDetailPanel task={selectedTaskFresh} />
                ) : selectedTaskFresh.type === "registration" ? (
                  registrationCaseDetail && isCanonicalRegistrationTrackDetail ? (
                    <RegistrationTrackEditor
                      task={selectedTaskFresh}
                      detail={registrationCaseDetail}
                      selectedTrackId={selectedRegistrationTrackId}
                      viewerId={registrationViewerId}
                      viewerRole={registrationViewerRole}
                      onSelectTrack={handleSelectRegistrationTrack}
                      onReload={reloadRegistrationCaseDetail}
                      onWarning={setMessage}
                      consultationOutcomeOpen={registrationConsultationOutcomeTrackId === selectedRegistrationTrackId}
                      onConsultationOutcomeOpenChange={(open) => setRegistrationConsultationOutcomeTrackId(open ? selectedRegistrationTrackId : null)}
                      notificationToken={registrationFixtureEnabled ? "" : session?.access_token || ""}
                      profiles={data?.profiles || EMPTY_PROFILE_OPTIONS}
                      directorOptions={data?.profiles || EMPTY_PROFILE_OPTIONS}
                      teacherOptions={data?.teachers || EMPTY_TEACHER_OPTIONS}
                      directorCatalogStatus={registrationOptionsLoading ? "loading" : registrationOptionsDataRef.current?.directorCatalogStatus || (registrationOptionsError ? "error" : "loading")}
                      onRetryDirectorCatalog={retryRegistrationOptions}
                      classOptions={data?.classes || EMPTY_CLASS_OPTIONS}
                      textbookOptions={data?.textbooks || EMPTY_TEXTBOOK_OPTIONS}
                      caseLevelActions={(
                        registrationCaseDetail.tracks.some((track) => ["enrollment_decided", "enrollment_processing", "registered"].includes(track.status))
                        || registrationCaseDetail.admissionBatches.length > 0
                        || Boolean(registrationCaseDetail.admissionApplicationMessageId)
                        || Boolean(registrationCaseDetail.admissionApplicationMessageStatus)
                        || registrationCaseDetail.admissionApplicationMessageClaimActive
                        || Boolean(registrationCaseDetail.task.registration?.admissionNoticeSent)
                      ) ? (
                        <RegistrationAdmissionPanel
                          taskId={registrationCaseDetail.task.id}
                          tracks={registrationCaseDetail.tracks}
                          enrollments={registrationCaseDetail.enrollments}
                          batches={registrationCaseDetail.admissionBatches}
                          classes={data?.classes || EMPTY_CLASS_OPTIONS}
                          admissionNoticeSent={Boolean(registrationCaseDetail.task.registration?.admissionNoticeSent)}
                          admissionApplicationMessageId={registrationCaseDetail.admissionApplicationMessageId}
                          admissionApplicationMessageStatus={registrationCaseDetail.admissionApplicationMessageStatus}
                          admissionApplicationMessageClaimActive={registrationCaseDetail.admissionApplicationMessageClaimActive}
                          admissionApplicationMessageUpdatedAt={registrationCaseDetail.admissionApplicationMessageUpdatedAt}
                          permissions={{ canManage: canManageRegistrationWorkflow, readOnly: !canManageRegistrationWorkflow }}
                          onSendAdmissionMessage={({ taskId, requestKey }) => postRegistrationAdmissionAction({ taskId, requestKey })}
                          onCheckAdmissionMessage={({ messageId }) => postRegistrationAdmissionAction({ taskId: registrationCaseDetail.task.id, action: "check", messageId })}
                          onReconcileAdmissionMessage={({ messageId, resolution, providerEvidence, reason, requestKey }) => postRegistrationAdmissionAction({ taskId: registrationCaseDetail.task.id, action: "reconcile", messageId, resolution, providerEvidence, reason, requestKey })}
                          onReleaseAdmissionMessageRetry={({ messageId, providerEvidence, reason, requestKey }) => postRegistrationAdmissionAction({ taskId: registrationCaseDetail.task.id, action: "release", messageId, providerEvidence, reason, requestKey })}
                          onReload={reloadRegistrationCaseDetail}
                          onWarning={setMessage}
                        />
                      ) : null}
                    />
                  ) : isCanonicalRegistrationTrackDetail ? (
                    <div role="status" aria-live="polite" className="rounded-md border px-3 py-10 text-center text-sm text-muted-foreground">
                      과목별 등록 상세를 불러오는 중입니다.
                    </div>
                  ) : (
                    <RegistrationDetailPanel task={selectedTaskFresh} selectedTrackId={selectedRegistrationTrackId} />
                  )
                ) : selectedTaskFresh.type === "withdrawal" ? (
                  <WithdrawalDetailPanel task={selectedTaskFresh} />
                ) : selectedTaskFresh.type === "transfer" ? (
                  <TransferDetailPanel task={selectedTaskFresh} />
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <TaskTypeBadge type={selectedTaskFresh.type} />
                      {shouldShowDetailStatusBadge(selectedTaskFresh) && <TaskStatusBadge status={selectedTaskFresh.status} />}
                      <Badge variant="outline">{getTaskPriorityLabel(selectedTaskFresh.priority)}</Badge>
                      {selectedTaskFresh.campus && <Badge variant="secondary">{selectedTaskFresh.campus}</Badge>}
                      {selectedTaskFresh.subject && <Badge variant="secondary">{selectedTaskFresh.subject}</Badge>}
                    </div>
                    <dl className="grid gap-3 text-sm md:grid-cols-2">
                      {selectedTaskFresh.studentName && <Info label="학생" value={selectedTaskFresh.studentName} />}
                      {selectedTaskFresh.className && <Info label="수업" value={selectedTaskFresh.className} />}
                      {selectedTaskFresh.textbookTitle && <Info label="교재" value={selectedTaskFresh.textbookTitle} />}
                      {selectedTaskFresh.assigneeLabel && <Info label="담당" value={selectedTaskFresh.assigneeLabel || "미지정"} />}
                      {selectedTaskFresh.dueAt && <Info label={getDueAtDisplayLabel(selectedTaskFresh.type)} value={dateLabel(selectedTaskFresh.dueAt)} />}
                      {selectedTaskFresh.completedAt && <Info label="완료" value={dateLabel(selectedTaskFresh.completedAt)} />}
                    </dl>
                  </>
                )}
                {!isProcessDetail && (
                  <CompletionBlockerActionPanel
                    task={selectedTaskFresh}
                    blockers={detailCompletionBlockers}
                    onSelect={(blocker) => openEdit(selectedTaskFresh, [blocker])}
                  />
                )}
                {selectedTaskFresh.type !== "general" && selectedTaskFresh.type !== "word_retest" && selectedTaskFresh.type !== "registration" && !isProcessDetail && <TypeDetail task={selectedTaskFresh} />}
                {selectedTaskFresh.type !== "general" && !isProcessDetail && <AutoSyncResultSummary task={selectedTaskFresh} />}
	                {selectedTaskFresh.type !== "general" && selectedTaskFresh.type !== "word_retest" && !isProcessDetail && selectedTaskFresh.memo && <p className="rounded-md bg-muted p-3 text-sm">{selectedTaskFresh.memo}</p>}
	                {!isCompletedProcessDetail && !isCanonicalRegistrationTrackDetail && <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
	                  {selectedTaskFresh.type === "word_retest" && (
	                    <>
	                      {detailWordRetestPrimaryActions.map((action) => (
	                        <WordRetestRoleActionButton
	                          key={`${action.kind}-${action.label}`}
	                          task={selectedTaskFresh}
	                          action={action}
	                          onEdit={openEdit}
	                          onStatusChange={(task, status) => void changeStatus(task, status)}
	                          onComplete={(task) => void submitWordRetestCompletion(task)}
	                          onRetry={openFailedWordRetestRetryForm}
	                          disabled={saving}
	                        />
	                      ))}
	                    </>
	                  )}
                  {selectedTaskFresh.type === "registration" && !isCanonicalRegistrationTrackDetail ? (
                    <RegistrationDecisionActions
                      task={selectedTaskFresh}
                      onSelect={(task, pipelineStatus) => void changeRegistrationPipeline(task, pipelineStatus)}
                      disabled={saving || !canManageRegistrationWorkflow}
                    />
                  ) : null}
                  {selectedTaskFresh.type === "registration" && !isCanonicalRegistrationTrackDetail && canOpenRegistrationCustomerMessage(selectedTaskFresh) ? (
                    <Button
                      type="button"
                      size="sm"
                      variant={selectedTaskFresh.registration?.admissionNoticeSent ? "outline" : "default"}
                      className="w-full sm:w-auto"
                      onClick={() => openRegistrationCustomerMessage(selectedTaskFresh)}
                      disabled={saving || !canManageRegistrationWorkflow}
                    >
                      <MessageSquareText className="size-4" aria-hidden="true" />
                      {selectedTaskFresh.registration?.admissionNoticeSent ? "입학신청서 다시 발송" : "입학신청서 발송"}
                    </Button>
                  ) : null}
                  {selectedTaskFresh.type === "registration" && selectedRegistrationReopenStatus ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="w-full sm:w-auto"
                      onClick={() => void changeRegistrationPipeline(selectedTaskFresh, selectedRegistrationReopenStatus)}
                      disabled={saving || !canManageRegistrationWorkflow}
                    >
                      {getRegistrationPipelinePrefix(selectedTaskFresh.registration?.pipelineStatus) === "9."
                        ? "문의로 다시 열기"
                        : "상담 결과로 다시 열기"}
                    </Button>
                  ) : null}
                  {canManageWithdrawalStatusAction && ((!isProcessDetail || !detailPrimaryActionBlocked) && detailPrimaryAction) && (
	                    <Button
                      type="button"
                      size="sm"
                      variant={detailPrimaryActionBlocked ? "outline" : "default"}
                      className="w-full sm:w-auto"
                      onClick={() => {
                        if (detailPrimaryActionBlocked) {
                          openEdit(selectedTaskFresh, completionBlockers)
                          return
                        }
                        if (selectedRegistrationAction) {
                          void changeRegistrationPipeline(selectedTaskFresh, selectedRegistrationAction.pipelineStatus)
                          return
                        }
                        if (nextAction) void changeStatus(selectedTaskFresh, nextAction.status)
                      }}
                      title={detailPrimaryActionBlocked ? `${completionBlockers.join(", ")} 연결 필요` : undefined}
                      disabled={saving}
                    >
                      {detailPrimaryActionBlocked ? detailBlockedActionLabel : detailPrimaryAction.label}
                    </Button>
                  )}
                  {!isProcessDetail && getSecondaryTaskStatusOptions(selectedTaskFresh)
                    .map((status) => (
                      <Button
                        key={status.value}
                        type="button"
                        variant="outline"
                        size="sm"
                        className="w-full sm:w-auto"
                        onClick={() => void changeStatus(selectedTaskFresh, status.value as OpsTaskStatus)}
                        disabled={saving}
                      >
                        {status.label}
                      </Button>
                    ))}
                  {selectedTaskCanEdit && !isCanonicalRegistrationTrackDetail && (
                    <Button type="button" variant="outline" size="sm" onClick={() => openEdit(selectedTaskFresh)} className="w-full sm:w-auto">
                      수정
                    </Button>
                  )}
                  {canDeleteTask(selectedTaskFresh) && !isCanonicalRegistrationTrackDetail && (
                    <Button type="button" variant="destructive" size="sm" onClick={() => requestRemoveTask(selectedTaskFresh)} className="w-full sm:w-auto">
                      <Trash2 className="size-4" />
                      삭제
                    </Button>
                  )}
                </div>}
              </div>

              {selectedTaskFresh.type !== "registration" && selectedTaskFresh.type !== "word_retest" && !isProcessDetail && (
			      <div className="flex flex-col gap-3">
                <details className="rounded-lg border p-4" open={selectedTaskFresh.comments.length > 0}>
                  <summary className="cursor-pointer text-sm font-semibold">
                    {selectedTaskFresh.comments.length > 0 ? `댓글 ${selectedTaskFresh.comments.length}` : "댓글 추가"}
                  </summary>
                  <CommentPanelContent
                    task={selectedTaskFresh}
                    commentBody={commentBody}
                    onCommentBodyChange={setCommentBody}
                    onSubmit={() => void submitComment()}
                    saving={saving}
                  />
                </details>

                {selectedTaskFresh.type !== "general" && <details className="rounded-lg border p-4" open={selectedTaskFresh.attachments.length > 0}>
                  <summary className="cursor-pointer text-sm font-semibold">
                    {selectedTaskFresh.attachments.length > 0 ? `첨부 ${selectedTaskFresh.attachments.length}` : "첨부 추가"}
                  </summary>
                  <div className="mt-3 flex flex-col gap-2">
                    {selectedTaskFresh.attachments.map((attachment) => (
                      <a
                        key={attachment.id}
                        href={attachment.driveLink}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted"
                      >
                        <FileText className="size-4" />
                        <span className="truncate">{attachment.fileName}</span>
                      </a>
                    ))}
                  </div>
                  <div className="mt-3 grid gap-2">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <label htmlFor={attachmentNameId} className="grid gap-1.5 text-sm font-medium">
                        <span>파일명</span>
                        <Input id={attachmentNameId} value={attachmentName} onChange={(event) => setAttachmentName(event.target.value)} placeholder="파일명" />
                      </label>
                      <label htmlFor={attachmentLinkId} className="grid gap-1.5 text-sm font-medium">
                        <span>Drive 링크</span>
                        <Input type="url" inputMode="url" value={attachmentLink} id={attachmentLinkId} onChange={(event) => setAttachmentLink(event.target.value)} placeholder="Drive 링크" />
                      </label>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void submitAttachment()}
                      disabled={saving || !attachmentName.trim() || !attachmentLink.trim()}
                    >
                      링크 저장
                    </Button>
                  </div>
                </details>}

                {selectedTaskFresh.type !== "general" && selectedTaskFresh.events.length > 1 && <details className="rounded-lg border p-4">
                  <summary className="cursor-pointer text-sm font-semibold">이력 {selectedTaskFresh.events.length}</summary>
                  <div className="mt-3 flex flex-col gap-2 text-sm">
                    {selectedTaskFresh.events.length === 0 && <p className="text-muted-foreground">이력 없음</p>}
                    {selectedTaskFresh.events.map((event) => (
                      <div key={event.id} className="rounded-md bg-muted px-3 py-2">
                        <div className="text-xs text-muted-foreground">{dateLabel(event.createdAt)} · {event.actorLabel || "시스템"}</div>
                        <div>{getOpsTaskEventLabel(event)}</div>
                      </div>
                    ))}
                  </div>
                </details>}
              </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={workspaceDataBelongsToCurrentViewer && bulkDeleteTargets.length > 0} onOpenChange={(open) => !open && setBulkDeleteTargets([])}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>단어 재시험 {bulkDeleteTargets.length}건 삭제할까요?</DialogTitle>
            <DialogDescription className="sr-only">
              선택한 단어 재시험 여러 건의 삭제를 확인합니다.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm font-medium">
            {bulkDeleteTargets.slice(0, 3).map((task) => getWordRetestStudentLabel(task)).join(", ")}
            {bulkDeleteTargets.length > 3 ? ` 외 ${bulkDeleteTargets.length - 3}건` : ""}
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={() => setBulkDeleteTargets([])} disabled={saving} className="w-full sm:w-auto">
              취소
            </Button>
            <Button type="button" variant="destructive" onClick={() => void confirmRemoveWordRetests()} disabled={saving} className="w-full sm:w-auto">
              선택 삭제
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={workspaceDataBelongsToCurrentViewer && Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {deleteTargetRemovesCompletedOperation
                ? `${deleteTarget?.title || "완료된 운영 업무"} 이력 삭제할까요?`
                : deleteTarget?.title ? `${deleteTarget.title} 삭제할까요?` : "삭제할까요?"}
            </DialogTitle>
            <DialogDescription className="sr-only">
              선택한 운영 업무의 삭제 또는 닫기 처리를 확인합니다.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={() => setDeleteTarget(null)} disabled={saving} className="w-full sm:w-auto">
              취소
            </Button>
            <Button type="button" variant="destructive" onClick={() => void confirmRemoveTask()} disabled={saving} className="w-full sm:w-auto">
              {deleteTargetRemovesCompletedOperation ? "이력 삭제" : "삭제"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

    </div>
  )
}

function TypeSpecificFields({
  step,
  form,
  formCompletionIntent,
  wordRetestStudentIds,
  onWordRetestStudentIdsChange,
  students,
  classes,
  teachers,
  textbooks,
  updateForm,
  updateFormPatch,
  updateRegistration,
  registrationPersistence,
  registrationInitialWorkflowDraft,
  registrationResolvedDirectorIds,
  registrationDirectorOptionsBySubject,
  onRegistrationInitialWorkflowChange,
  editingRegistration,
  updateWithdrawal,
  updateTransfer,
  updateWordRetest,
}: {
  step: FormDetailStepKey
  form: OpsTaskInput
  formCompletionIntent?: FormCompletionIntent | null
  wordRetestStudentIds?: string[]
  onWordRetestStudentIdsChange?: (values: string[]) => void
  students: OpsStudentOption[]
  classes: OpsClassOption[]
  teachers: OpsTeacherOption[]
  textbooks: OpsTextbookOption[]
  updateForm: <Key extends keyof OpsTaskInput>(key: Key, value: OpsTaskInput[Key]) => void
  updateFormPatch: (patch: Partial<OpsTaskInput>) => void
  updateRegistration: (key: keyof NonNullable<OpsTaskInput["registration"]>, value: string | boolean) => void
  registrationPersistence?: RegistrationInitialPersistenceProbeResult
  registrationInitialWorkflowDraft?: RegistrationInitialWorkflowDraft
  registrationResolvedDirectorIds?: Partial<Record<RegistrationSubject, string>>
  registrationDirectorOptionsBySubject?: Record<RegistrationSubject, Array<{ value: string; label: string }>>
  onRegistrationInitialWorkflowChange?: (draft: RegistrationInitialWorkflowDraft) => void
  editingRegistration?: boolean
  updateWithdrawal: (key: keyof NonNullable<OpsTaskInput["withdrawal"]>, value: string | boolean) => void
  updateTransfer: (key: keyof NonNullable<OpsTaskInput["transfer"]>, value: string | boolean) => void
  updateWordRetest: (key: keyof NonNullable<OpsTaskInput["wordRetest"]>, value: string) => void
}) {
  const { user: typeSpecificUser } = useAuth()
  const registration = form.registration || {}
  const withdrawal = form.withdrawal || {}
  const transfer = form.transfer || {}
  const wordRetest = form.wordRetest || {}
  const formSubject = form.subject || ""
  const formClassId = form.classId || ""
  const formStudentId = form.studentId || ""
  const withdrawalTeacherName = withdrawal.teacherName || ""
  const transferFromTeacherName = transfer.fromTeacherName || ""
  const transferFromClassId = transfer.fromClassId || ""
  const transferToTeacherName = transfer.toTeacherName || ""
  const transferToClassId = transfer.toClassId || ""
  const wordRetestAbsent = isWordRetestAbsent(wordRetest)
  const findStudent = (id: string) => students.find((student) => student.id === id)
  const findClass = (id: string) => classes.find((classItem) => classItem.id === id)
  const findTeacher = (id: string) => teachers.find((teacher) => teacher.id === id)
  const findTextbook = (id: string) => textbooks.find((textbook) => textbook.id === id)
  const selectedWordRetestStudentIds = form.type === "word_retest"
    ? (wordRetestStudentIds && wordRetestStudentIds.length > 0 ? wordRetestStudentIds : form.studentId ? [form.studentId] : [])
    : []
  const selectedWordRetestStudents = selectedWordRetestStudentIds.map((studentId) => findStudent(studentId)).filter((student): student is OpsStudentOption => Boolean(student))
  const selectedWordRetestStudent = form.type === "word_retest" ? selectedWordRetestStudents[0] || findStudent(form.studentId || "") : undefined
  const selectedWordRetestClassId = form.type === "word_retest" ? form.classId || "" : ""
  const selectedWordRetestClass = form.type === "word_retest" ? findClass(selectedWordRetestClassId) : undefined
  const selectedWordRetestTeacherId = form.type === "word_retest" ? wordRetest.teacherId || "" : ""
  const selectedWordRetestTeacher = form.type === "word_retest" ? findTeacher(selectedWordRetestTeacherId) : undefined
  const wordRetestClassScheduleItems = useMemo(
    () => getWordRetestClassScheduleItems(selectedWordRetestClass),
    [selectedWordRetestClass],
  )
  const wordRetestStudentOptions = uniqueStudentOptions([
    ...selectedWordRetestStudents,
    ...getWordRetestStudentOptions(students, selectedWordRetestClass, form.studentId || ""),
  ])
  const wordRetestClassOptions = getWordRetestClassOptions(classes, selectedWordRetestStudent, selectedWordRetestClassId, selectedWordRetestTeacher)
  const wordRetestTeacherOptions = getWordRetestTeacherOptions(teachers, selectedWordRetestTeacherId)
  const selectedWithdrawalTeacher = form.type === "withdrawal"
    ? findTeacherByName(withdrawalTeacherName)
    : undefined
  const selectedWithdrawalTeacherId = selectedWithdrawalTeacher?.id ||
    (withdrawalTeacherName ? `withdrawal-teacher:${normalizeLookupValue(withdrawalTeacherName)}` : "")
  const withdrawalSubjectOptions = getWithdrawalSubjectOptions(classes, formSubject)
  const withdrawalTeacherOptions = getWithdrawalTeacherOptions(teachers, classes, formSubject, withdrawalTeacherName)
  const withdrawalClassOptions = getWithdrawalClassOptions(classes, formSubject, withdrawalTeacherName, formClassId)
  const selectedWithdrawalClass = form.type === "withdrawal" ? findClass(formClassId) : undefined
  const withdrawalStudentOptions = getWithdrawalStudentOptions(students, classes, withdrawalClassOptions, formClassId, formStudentId)
  const selectedTransferFromTeacher = form.type === "transfer"
    ? findTeacherByName(transferFromTeacherName)
    : undefined
  const selectedTransferFromTeacherId = selectedTransferFromTeacher?.id ||
    (transferFromTeacherName ? `withdrawal-teacher:${normalizeLookupValue(transferFromTeacherName)}` : "")
  const selectedTransferToTeacher = form.type === "transfer"
    ? findTeacherByName(transferToTeacherName)
    : undefined
  const selectedTransferToTeacherId = selectedTransferToTeacher?.id ||
    (transferToTeacherName ? `withdrawal-teacher:${normalizeLookupValue(transferToTeacherName)}` : "")
  const transferSubjectOptions = getWithdrawalSubjectOptions(classes, formSubject)
  const transferFromTeacherOptions = getWithdrawalTeacherOptions(teachers, classes, formSubject, transferFromTeacherName)
  const transferFromClassOptions = getWithdrawalClassOptions(classes, formSubject, transferFromTeacherName, transferFromClassId)
  const selectedTransferFromClass = form.type === "transfer" ? findClass(transferFromClassId) : undefined
  const transferStudentOptions = getWithdrawalStudentOptions(students, classes, transferFromClassOptions, transferFromClassId, formStudentId)
  const transferToTeacherOptions = getWithdrawalTeacherOptions(teachers, classes, formSubject, transferToTeacherName)
  const rawTransferToClassOptions = getWithdrawalClassOptions(classes, formSubject, transferToTeacherName, transferToClassId || formClassId)
  const transferToClassOptions = rawTransferToClassOptions.filter((classItem) => (
    !transferFromClassId || classItem.id !== transferFromClassId || classItem.id === transferToClassId
  ))
  const selectedTransferToClass = form.type === "transfer" ? findClass(transferToClassId || formClassId) : undefined
  const [manualLinkedFields, setManualLinkedFields] = useState<Record<string, boolean>>({})
  const [wordRetestTextbookGradeFilter, setWordRetestTextbookGradeFilter] = useState("all")
  const wordRetestTextbookGradeFilters = useMemo(() => getWordRetestTextbookGradeFilters(textbooks), [textbooks])
  const wordRetestTextbookOptions = useMemo(() => getWordRetestTextbookOptions(
    textbooks,
    form.textbookId || "",
    wordRetestTextbookGradeFilter,
  ), [form.textbookId, textbooks, wordRetestTextbookGradeFilter])
  const selectedRegistrationClassId = form.type === "registration" ? formClassId : ""
  const selectedRegistrationViewerId = typeSpecificUser?.id || ""
  const [registrationClassDetailResult, setRegistrationClassDetailResult] = useState<{
    classId: string
    viewerId: string
    detail: OpsRegistrationClassDetail | null
  }>({ classId: "", viewerId: "", detail: null })
  const registrationClassDetailRequestRef = useRef(0)
  const registrationTextbookDefaultPendingClassRef = useRef("")
  const registrationTextbookClearedClassRef = useRef("")
  const selectedRegistrationClass = selectedRegistrationClassId ? findClass(selectedRegistrationClassId) : undefined
  const currentRegistrationClassDetail = registrationClassDetailResult.viewerId === selectedRegistrationViewerId
    && registrationClassDetailResult.classId === selectedRegistrationClassId
    ? registrationClassDetailResult.detail
    : null
  const registrationLinkedTextbookIds = useMemo(
    () => currentRegistrationClassDetail
      ? currentRegistrationClassDetail.textbookIds
      : selectedRegistrationClass?.textbookIds || [],
    [currentRegistrationClassDetail, selectedRegistrationClass],
  )

  useEffect(() => {
    const selectedClassId = selectedRegistrationClassId
    registrationClassDetailRequestRef.current += 1
    const requestToken = registrationClassDetailRequestRef.current
    if (!selectedClassId) return
    let disposed = false

    void loadOpsRegistrationClassDetail(selectedClassId, { viewerId: selectedRegistrationViewerId })
      .then((detail) => {
        if (disposed || requestToken !== registrationClassDetailRequestRef.current) return
        if (!detail || detail.id !== selectedClassId) {
          setRegistrationClassDetailResult({ classId: selectedClassId, viewerId: selectedRegistrationViewerId, detail: null })
          return
        }
        setRegistrationClassDetailResult({ classId: selectedClassId, viewerId: selectedRegistrationViewerId, detail })
      })
      .catch(() => {
        if (disposed || requestToken !== registrationClassDetailRequestRef.current) return
        setRegistrationClassDetailResult({ classId: selectedClassId, viewerId: selectedRegistrationViewerId, detail: null })
      })

    return () => {
      disposed = true
    }
  }, [selectedRegistrationClassId, selectedRegistrationViewerId])

  useEffect(() => {
    const pendingRegistrationTextbookId = resolveRegistrationLinkedTextbookDefault({
      classId: formClassId,
      pendingClassId: registrationTextbookDefaultPendingClassRef.current,
      clearedClassId: registrationTextbookClearedClassRef.current,
      textbookId: form.textbookId,
      linkedTextbookIds: registrationLinkedTextbookIds,
      availableTextbookIds: textbooks.map((textbook) => textbook.id),
    })
    if (!pendingRegistrationTextbookId) return
    const textbook = textbooks.find((item) => item.id === pendingRegistrationTextbookId)
    if (!textbook) return
    registrationTextbookDefaultPendingClassRef.current = ""
    updateFormPatch({ textbookId: textbook.id, textbookTitle: textbook.label })
  }, [form.textbookId, formClassId, registrationLinkedTextbookIds, textbooks, updateFormPatch])

  function openManualField(field: string) {
    setManualLinkedFields((current) => ({ ...current, [field]: true }))
  }

  function shouldShowManualField(field: string, linkedId: string | undefined, textValue: string | undefined) {
    return !linkedId && (manualLinkedFields[field] || Boolean(String(textValue || "").trim()))
  }

  function normalizeLinkedLabel(value: string) {
    return value.replace(/\s+/g, "").toLowerCase()
  }

  function findTeacherByName(name: string) {
    const normalizedName = normalizeLinkedLabel(name)
    if (!normalizedName) return undefined
    return teachers.find((teacher) => normalizeLinkedLabel(teacher.label) === normalizedName)
  }

  function findClassPrimaryTextbook(classItem: OpsClassOption) {
    const textbookId = classItem.textbookIds.find((id) => findTextbook(id))
    return textbookId || ""
  }

  function findClassWordRetestTextbook(classItem: OpsClassOption) {
    const textbookId = classItem.textbookIds.find((id) => {
      const textbook = findTextbook(id)
      return textbook ? isWordRetestTextbookOption(textbook) : false
    })
    return textbookId || ""
  }

  function findClassBranch(classItem: OpsClassOption) {
    const roomText = `${classItem.room || ""} ${classItem.meta || ""}`
    if (roomText.includes("별관")) return "별관"
    if (roomText.includes("본관")) return "본관"
    return ""
  }

  function clearWithdrawalScheduleSelection() {
    updateWithdrawal("withdrawalDate", "")
    updateWithdrawal("withdrawalSession", "")
    updateWithdrawal("completedLessonHours", "")
    updateWithdrawal("fourWeekLessonHours", "")
  }

  function clearTransferFromScheduleSelection() {
    updateTransfer("fromClassEndDate", "")
    updateTransfer("fromClassEndSession", "")
  }

  function clearTransferToScheduleSelection() {
    updateTransfer("toClassStartDate", "")
    updateTransfer("toClassStartSession", "")
  }

  function renderWordRetestTextbookFilters() {
    if (textbooks.length === 0) return null
    return (
      <div className="grid gap-2">
        <div className="flex flex-wrap gap-1">
          {["all", ...wordRetestTextbookGradeFilters].map((filterValue) => (
            <button
              key={`grade-${filterValue}`}
              type="button"
              aria-pressed={wordRetestTextbookGradeFilter === filterValue}
              onClick={() => setWordRetestTextbookGradeFilter(filterValue)}
              className={[
                "rounded-full border px-2 py-0.5 text-[11px] font-medium transition",
                wordRetestTextbookGradeFilter === filterValue ? "border-primary/45 bg-primary/10 text-primary" : "bg-background text-muted-foreground hover:bg-muted",
              ].join(" ")}
            >
              {filterValue === "all" ? "학년구분 전체" : filterValue}
            </button>
          ))}
        </div>
      </div>
    )
  }

  function findStudentPrimaryClass(student: OpsStudentOption, options: { wordRetestOnly?: boolean } = {}) {
    const classIds = getStudentRosterClassIds(student, classes).filter((id) => {
      const classItem = findClass(id)
      if (!classItem) return false
      if (options.wordRetestOnly && !isWordRetestClassOption(classItem)) return false
      return true
    })
    if (classIds.length !== 1) return ""
    return classIds[0] || ""
  }

  const selectStudent = (
    studentId: string,
    options: {
      fillRegistration?: boolean
      fillWithdrawalClass?: boolean
      fillTransferFromClass?: boolean
      fillWordRetest?: boolean
      fillWordRetestClass?: boolean
    } = {},
  ) => {
    const student = findStudent(studentId)
    updateForm("studentId", studentId)
    if (!studentId) {
      updateForm("studentName", "")
      if (options.fillWordRetest) updateWordRetest("studentName", "")
      return
    }
    if (!student) return

    updateForm("studentName", student.label)
    const classId = findStudentPrimaryClass(student)
    const wordRetestClassId = findStudentPrimaryClass(student, { wordRetestOnly: true })
    if (options.fillRegistration) {
      updateRegistration("schoolGrade", registration.schoolGrade || student.grade)
      updateRegistration("schoolName", registration.schoolName || student.school)
      updateRegistration("studentPhone", registration.studentPhone || student.contact)
      updateRegistration("parentPhone", registration.parentPhone || student.parentContact)
    }
    if (options.fillWithdrawalClass) {
      updateWithdrawal("schoolGrade", withdrawal.schoolGrade || student.grade)
    }
    if (options.fillWithdrawalClass && classId && !form.classId) selectClass(classId, { fillWithdrawal: true })
    if (options.fillTransferFromClass && classId && !transfer.fromClassId) selectClass(classId, { fillTransferFrom: true })
    if (options.fillWordRetest) {
      updateWordRetest("studentName", student.label)
    }
    if (options.fillWordRetestClass && wordRetestClassId && !form.classId) selectClass(wordRetestClassId, { fillWordRetest: true })
  }

  function selectWordRetestStudents(studentIds: string[]) {
    const nextStudentIds = Array.from(new Set(studentIds.map((studentId) => studentId.trim()).filter(Boolean)))
    onWordRetestStudentIdsChange?.(nextStudentIds)
    selectStudent(nextStudentIds[0] || "", { fillWordRetest: true, fillWordRetestClass: true })
  }

  function selectWithdrawalSubject(subject: string) {
    const preserveUnscopedWithdrawalStudent = Boolean(form.studentId && !form.classId)
    updateForm("subject", subject)
    if (subject !== form.subject) {
      updateWithdrawal("teacherName", "")
      updateForm("classId", "")
      updateForm("className", "")
      if (!preserveUnscopedWithdrawalStudent) {
        updateForm("studentId", "")
        updateForm("studentName", "")
      }
      clearWithdrawalScheduleSelection()
    }
  }

  function selectWithdrawalTeacher(teacherId: string) {
    const teacher = findTeacher(teacherId)
    const option = withdrawalTeacherOptions.find((item) => item.id === teacherId)
    const teacherName = teacher?.label || option?.label || ""
    const preserveUnscopedWithdrawalStudent = Boolean(form.studentId && !form.classId)
    if (teacherId !== selectedWithdrawalTeacherId) {
      updateForm("classId", "")
      updateForm("className", "")
      if (!preserveUnscopedWithdrawalStudent) {
        updateForm("studentId", "")
        updateForm("studentName", "")
      }
      clearWithdrawalScheduleSelection()
    }
    updateWithdrawal("teacherName", teacherName)
    if (!teacherId) return

    if (!form.subject && teacher?.subjects.length === 1) updateForm("subject", teacher.subjects[0] || "")
  }

  function selectTransferSubject(subject: string) {
    updateForm("subject", subject)
    if (subject !== form.subject) {
      updateTransfer("fromTeacherName", "")
      updateTransfer("fromClassId", "")
      updateTransfer("fromClassName", "")
      updateForm("studentId", "")
      updateForm("studentName", "")
      updateTransfer("toTeacherName", "")
      updateTransfer("toClassId", "")
      updateTransfer("toClassName", "")
      updateForm("classId", "")
      updateForm("className", "")
      clearTransferFromScheduleSelection()
      clearTransferToScheduleSelection()
    }
  }

  function selectTransferFromTeacher(teacherId: string) {
    const teacher = findTeacher(teacherId)
    const option = transferFromTeacherOptions.find((item) => item.id === teacherId)
    const teacherName = teacher?.label || option?.label || ""
    if (teacherId !== selectedTransferFromTeacherId) {
      updateTransfer("fromClassId", "")
      updateTransfer("fromClassName", "")
      updateForm("studentId", "")
      updateForm("studentName", "")
      clearTransferFromScheduleSelection()
    }
    updateTransfer("fromTeacherName", teacherName)
    if (!teacherId) return

    if (!form.subject && teacher?.subjects.length === 1) updateForm("subject", teacher.subjects[0] || "")
  }

  function selectTransferToTeacher(teacherId: string) {
    const teacher = findTeacher(teacherId)
    const option = transferToTeacherOptions.find((item) => item.id === teacherId)
    const teacherName = teacher?.label || option?.label || ""
    if (teacherId !== selectedTransferToTeacherId) {
      updateTransfer("toClassId", "")
      updateTransfer("toClassName", "")
      updateForm("classId", "")
      updateForm("className", "")
      clearTransferToScheduleSelection()
    }
    updateTransfer("toTeacherName", teacherName)
    if (!teacherId) return

    if (!form.subject && teacher?.subjects.length === 1) updateForm("subject", teacher.subjects[0] || "")
  }

  function syncWithdrawalScheduleSelection(metrics: ReturnType<typeof getWithdrawalScheduleMetrics>) {
    updateWithdrawal("withdrawalDate", metrics.withdrawalDate)
    updateWithdrawal("withdrawalSession", metrics.withdrawalSession)
    updateWithdrawal("completedLessonHours", metrics.completedLessonHours)
    updateWithdrawal("fourWeekLessonHours", metrics.fourWeekLessonHours)
  }

  function syncTransferFromScheduleSelection(metrics: ReturnType<typeof getTransferClassScheduleMetrics>) {
    updateTransfer("fromClassEndDate", metrics.transferDate)
    updateTransfer("fromClassEndSession", metrics.transferSession)
  }

  function syncTransferToScheduleSelection(metrics: ReturnType<typeof getTransferClassScheduleMetrics>) {
    updateTransfer("toClassStartDate", metrics.transferDate)
    updateTransfer("toClassStartSession", metrics.transferSession)
  }

  const selectClass = (classId: string, options: { fillRegistration?: boolean; fillTransferFrom?: boolean; fillTransferTo?: boolean; fillWordRetest?: boolean; fillWithdrawal?: boolean } = {}) => {
    const classItem = findClass(classId)
    if (options.fillRegistration) {
      if (classId === formClassId) return
      registrationClassDetailRequestRef.current += 1
      registrationTextbookDefaultPendingClassRef.current = classId
      registrationTextbookClearedClassRef.current = ""
      const defaultTextbookId = resolveRegistrationLinkedTextbookDefault({
        classId,
        pendingClassId: classId,
        clearedClassId: "",
        textbookId: "",
        linkedTextbookIds: classItem?.textbookIds || [],
        availableTextbookIds: textbooks.map((textbook) => textbook.id),
      })
      const defaultTextbook = defaultTextbookId ? findTextbook(defaultTextbookId) : undefined
      if (defaultTextbook) registrationTextbookDefaultPendingClassRef.current = ""
      updateFormPatch({
        classId,
        className: classItem?.label || "",
        subject: form.subject || classItem?.subject || "",
        textbookId: defaultTextbook?.id || "",
        textbookTitle: defaultTextbook?.label || "",
        registration: {
          schoolGrade: registration.schoolGrade || classItem?.grade || "",
          classStartDate: "",
          classStartSession: "",
          textbookBillingIssued: false,
        },
      })
      return
    }
    const isWithdrawalClassChange = Boolean(options.fillWithdrawal && classId !== form.classId)
    const isTransferToClassChange = Boolean(options.fillTransferTo && classId !== (transfer.toClassId || form.classId || ""))
    if (options.fillTransferFrom) {
      const isTransferFromClassChange = classId !== (transfer.fromClassId || "")
      updateTransfer("fromClassId", classId)
      if (!classId) {
        updateTransfer("fromClassName", "")
        updateForm("studentId", "")
        updateForm("studentName", "")
        clearTransferFromScheduleSelection()
        return
      }
      if (!classItem) return

      updateTransfer("fromClassName", classItem.label)
      updateTransfer("fromTeacherName", transfer.fromTeacherName || classItem.teacher)
      if (!form.subject) updateForm("subject", classItem.subject)
      if (isTransferFromClassChange) {
        updateForm("studentId", "")
        updateForm("studentName", "")
        clearTransferFromScheduleSelection()
      }
      const textbookId = findClassPrimaryTextbook(classItem)
      const primaryTextbook = textbookId ? findTextbook(textbookId) : undefined
      if (textbookId && primaryTextbook && !form.textbookId) selectTextbook(textbookId)
      return
    }
    updateForm("classId", classId)
    if (!classId) {
      updateForm("className", "")
      if (options.fillWithdrawal) {
        updateForm("studentId", "")
        updateForm("studentName", "")
        clearWithdrawalScheduleSelection()
      }
      if (options.fillWordRetest) updateWordRetest("className", "")
      if (options.fillTransferTo) {
        updateTransfer("toClassId", "")
        updateTransfer("toClassName", "")
        clearTransferToScheduleSelection()
      }
      return
    }
    if (!classItem) return

    updateForm("className", classItem.label)
    if (form.type !== "registration" || !form.subject) updateForm("subject", classItem.subject)
    const shouldPreferWordRetestTextbook = form.type === "word_retest" || options.fillWordRetest
    const textbookId = shouldPreferWordRetestTextbook ? findClassWordRetestTextbook(classItem) : findClassPrimaryTextbook(classItem)
    const primaryTextbook = textbookId ? findTextbook(textbookId) : undefined
    const shouldUsePrimaryTextbook = Boolean(primaryTextbook && (!shouldPreferWordRetestTextbook || isWordRetestTextbookOption(primaryTextbook)))
    if (textbookId && shouldUsePrimaryTextbook && !form.textbookId) selectTextbook(textbookId)
    if (options.fillRegistration) {
      updateRegistration("schoolGrade", registration.schoolGrade || classItem.grade)
    }
    if (options.fillTransferFrom) {
      updateTransfer("fromClassId", classItem.id)
      updateTransfer("fromClassName", classItem.label)
      updateTransfer("fromTeacherName", transfer.fromTeacherName || classItem.teacher)
    }
    if (options.fillTransferTo) {
      updateTransfer("toClassId", classItem.id)
      updateTransfer("toClassName", classItem.label)
      updateTransfer("toTeacherName", transfer.toTeacherName || classItem.teacher)
      if (isTransferToClassChange) clearTransferToScheduleSelection()
    }
    if (options.fillWordRetest) {
      updateWordRetest("className", classItem.label)
      const branch = findClassBranch(classItem)
      if (branch) updateWordRetest("branch", branch)
      if (classItem.teacher) {
        const teacher = findTeacherByName(classItem.teacher)
        if (teacher && !wordRetest.teacherId) selectTeacher(teacher.id)
        else updateWordRetest("teacherName", wordRetest.teacherName || classItem.teacher)
      }
      if (textbookId && shouldUsePrimaryTextbook && !wordRetest.textbookName) selectTextbook(textbookId, { fillWordRetest: true })
    }
    if (options.fillWithdrawal) {
      const withdrawalStudent = findStudent(form.studentId || "")
      const nextWithdrawalClassContainsStudent = Boolean(
        withdrawalStudent && getStudentRosterClassIds(withdrawalStudent, classes).includes(classItem.id),
      )
      updateWithdrawal("schoolGrade", withdrawal.schoolGrade || classItem.grade)
      if (classItem.teacher) updateWithdrawal("teacherName", withdrawal.teacherName || classItem.teacher)
      if (isWithdrawalClassChange) {
        if (!nextWithdrawalClassContainsStudent) {
          updateForm("studentId", "")
          updateForm("studentName", "")
        }
        clearWithdrawalScheduleSelection()
      }
    }
  }

  const selectTeacher = (teacherId: string) => {
    const teacher = findTeacher(teacherId)
    updateWordRetest("teacherId", teacherId)
    if (!teacherId) {
      updateWordRetest("teacherName", "")
      return
    }
    if (!teacher) return
    updateWordRetest("teacherName", teacher.label)
  }

  const selectTextbook = (textbookId: string, options: { fillWordRetest?: boolean } = {}) => {
    const textbook = findTextbook(textbookId)
    updateForm("textbookId", textbookId)
    if (!textbookId) {
      updateForm("textbookTitle", "")
      if (options.fillWordRetest) updateWordRetest("textbookName", "")
      return
    }
    if (!textbook) return
    updateForm("textbookTitle", textbook.label)
    if (options.fillWordRetest) updateWordRetest("textbookName", textbook.label)
  }

  if (form.type === "registration") {
    const registrationSubjects = parseRegistrationSubjects(form.subject) as RegistrationSubject[]

    return (
      <div className="grid min-w-0">
        <RegistrationFormSection
          sectionKey="inquiry"
          title="문의 정보"
          active
          enabled
        >
          <div className="grid gap-3 md:grid-cols-2">
            {editingRegistration ? (
              <ReadonlyInfoField label="과목" value={registrationSubjects.join(", ") || "-"} />
            ) : (
              <RegistrationFocusTarget focusKey="subject">
                <RegistrationSubjectField
                  label={<RegistrationFieldLabel label="과목" requirement="required" />}
                  values={registrationSubjects}
                  required
                  onChange={(values) => updateForm("subject", serializeRegistrationSubjects(values))}
                />
              </RegistrationFocusTarget>
            )}
            <RegistrationFocusTarget focusKey="studentName">
              <TextField
                label={<RegistrationFieldLabel label="학생명" requirement="required" />}
                value={form.studentName || ""}
                required
                onChange={(value) => updateForm("studentName", value)}
              />
            </RegistrationFocusTarget>
            <RegistrationFocusTarget focusKey="schoolGrade">
              <TaskListboxField
                label={<RegistrationFieldLabel label="학년" requirement="required" />}
                value={registration.schoolGrade || ""}
                options={[
                  { value: "", label: "미정" },
                  ...(registration.schoolGrade && !REGISTRATION_GRADE_OPTIONS.includes(registration.schoolGrade)
                    ? [{ value: registration.schoolGrade, label: registration.schoolGrade }]
                    : []),
                  ...REGISTRATION_GRADE_OPTIONS.map((grade) => ({ value: grade, label: grade })),
                ]}
                required
                onChange={(value) => updateRegistration("schoolGrade", value)}
              />
            </RegistrationFocusTarget>
            <TextField
              label={<RegistrationFieldLabel label="학교" requirement="optional" />}
              value={registration.schoolName || ""}
              onChange={(value) => updateRegistration("schoolName", value)}
            />
            <RegistrationFocusTarget focusKey="parentPhone">
              <TextField
                label={<RegistrationFieldLabel label="학부모 전화" requirement="required" />}
                value={registration.parentPhone || ""}
                inputMode="tel"
                required
                error={registration.parentPhone && !isValidRegistrationMobilePhone(registration.parentPhone)
                  ? "010으로 시작하는 휴대전화 번호를 입력하세요."
                  : ""}
                onChange={(value) => updateRegistration("parentPhone", normalizeRegistrationPhone(value))}
              />
            </RegistrationFocusTarget>
            <TextField
              label={<RegistrationFieldLabel label="학생 전화" requirement="optional" />}
              value={registration.studentPhone || ""}
              inputMode="tel"
              onChange={(value) => updateRegistration("studentPhone", normalizeRegistrationPhone(value))}
            />
          </div>
          <TextField
            label="요청 사항"
            value={registration.requestNote || ""}
            onChange={(value) => updateRegistration("requestNote", value)}
          />
        </RegistrationFormSection>

        {!editingRegistration
          && registrationPersistence?.mode === "ready_atomic"
          && registrationInitialWorkflowDraft
          && registrationResolvedDirectorIds
          && registrationDirectorOptionsBySubject
          && onRegistrationInitialWorkflowChange && (
            <RegistrationInitialPlanControl
              subjects={registrationSubjects}
              draft={registrationInitialWorkflowDraft}
              resolvedDirectorIds={registrationResolvedDirectorIds}
              directorOptionsBySubject={registrationDirectorOptionsBySubject}
              disabled={false}
              onChange={onRegistrationInitialWorkflowChange}
            />
          )}
        {!editingRegistration && registrationPersistence?.mode === "canonical_inquiry" && (
          <p role="note" className="border-t pt-3 text-sm text-muted-foreground">초기 일정 기능 준비 전에는 문의 정보만 저장합니다.</p>
        )}
        {!editingRegistration && registrationPersistence?.mode === "legacy_inquiry" && (
          <p role="note" className="border-t pt-3 text-sm text-muted-foreground">기존 등록 환경에서는 문의 정보만 저장합니다.</p>
        )}
        {!editingRegistration && registrationPersistence?.mode === "blocked_maintenance" && (
          <p role="alert" className="border-t pt-3 text-sm text-destructive">등록 데이터 전환 중입니다. 전환이 끝난 뒤 다시 저장하세요.</p>
        )}
        {!editingRegistration && registrationPersistence?.mode === "blocked_mismatch" && (
          <p role="alert" className="border-t pt-3 text-sm text-destructive">등록 런타임 버전이 일치하지 않아 저장할 수 없습니다.</p>
        )}
        {!editingRegistration && registrationPersistence?.mode === "blocked_indeterminate" && (
          <p role="alert" className="border-t pt-3 text-sm text-destructive">등록 저장 환경을 확인하고 있습니다. 잠시 후 다시 시도하세요.</p>
        )}
      </div>
    )
  }

	  if (form.type === "withdrawal") {
      const canSelectWithdrawalTeacher = Boolean(form.subject)
      const canSelectWithdrawalClass = Boolean(form.subject && selectedWithdrawalTeacherId)
      const canSelectWithdrawalStudent = Boolean(form.subject && selectedWithdrawalTeacherId && form.classId)

	    return (
	      <section className="grid gap-4">
	        <div className="grid gap-3">
	          <div className="grid gap-3 md:grid-cols-2">
	            <TaskListboxField
	              label="과목"
	              value={form.subject || ""}
	              options={withdrawalSubjectOptions}
	              onChange={selectWithdrawalSubject}
	            />
	            <LinkedSelect
	              label="선생님"
	              value={selectedWithdrawalTeacherId}
	              options={withdrawalTeacherOptions}
	              onChange={selectWithdrawalTeacher}
                disabled={!canSelectWithdrawalTeacher}
                disabledPlaceholder="과목 먼저"
	              onManualSelect={() => openManualField("withdrawalTeacher")}
	              renderOption={(option) => <LinkedSelectedValue label={option.label} />}
	              renderSelected={(option) => <LinkedSelectedValue label={option.label} />}
	            />
	            <LinkedSelect
	              label="수업"
	              value={form.classId || ""}
	              options={withdrawalClassOptions}
	              onChange={(value) => selectClass(value, { fillWithdrawal: true })}
                disabled={!canSelectWithdrawalClass}
                disabledPlaceholder="선생님 먼저"
	              onManualSelect={() => openManualField("withdrawalClass")}
	              renderOption={(option) => <LinkedSelectedValue label={option.label} />}
	              renderSelected={(option) => <LinkedSelectedValue label={option.label} />}
	            />
	            <LinkedSelect
	              label="학생"
	              value={form.studentId || ""}
	              options={withdrawalStudentOptions}
	              onChange={(value) => selectStudent(value, { fillWithdrawalClass: true })}
                disabled={!canSelectWithdrawalStudent}
                disabledPlaceholder="수업 먼저"
	              onManualSelect={() => openManualField("withdrawalStudent")}
	              renderOption={(option) => {
	                const student = findStudent(option.id)
	                return <LinkedSelectedValue label={option.label} pills={[student?.grade, student?.school]} />
	              }}
	              renderSelected={(option) => <LinkedSelectedValue label={option.label} />}
	            />
	            {shouldShowManualField("withdrawalTeacher", selectedWithdrawalTeacherId, withdrawal.teacherName) && <TextField label="선생님명" value={withdrawal.teacherName || ""} onChange={(value) => updateWithdrawal("teacherName", value)} />}
	            {shouldShowManualField("withdrawalClass", form.classId, form.className) && <TextField label="수업명" value={form.className || ""} onChange={(value) => updateForm("className", value)} />}
	            {shouldShowManualField("withdrawalStudent", form.studentId, form.studentName) && <TextField label="학생명" value={form.studentName || ""} autoFocus onChange={(value) => updateForm("studentName", value)} />}
	          </div>
	        </div>
	        <div className="grid gap-3 md:grid-cols-2">
	          <TextareaField label="고객 퇴원사유" value={withdrawal.customerReason || ""} onChange={(value) => updateWithdrawal("customerReason", value)} />
	          <TextareaField label="선생님 의견" value={withdrawal.teacherOpinion || ""} onChange={(value) => updateWithdrawal("teacherOpinion", value)} />
		          <UndistributedTextbookListField label="미배부 교재" help={WITHDRAWAL_UNDISTRIBUTED_TEXTBOOK_HELP} value={withdrawal.undistributedTextbooks || ""} onChange={(value) => updateWithdrawal("undistributedTextbooks", value)} />
		          <WithdrawalScheduleCalendarField
		            key={form.classId || "withdrawal-schedule-calendar"}
		            classItem={selectedWithdrawalClass}
		            withdrawal={withdrawal}
		            onScheduleSelect={syncWithdrawalScheduleSelection}
		          />
		        </div>
		        <div className="grid gap-2 md:grid-cols-3">
		          <CheckField label="메이크에듀 퇴원처리" checked={Boolean(withdrawal.makeeduWithdrawalDone)} onChange={(value) => updateWithdrawal("makeeduWithdrawalDone", value)} />
		          <CheckField label="수업료 처리" checked={Boolean(withdrawal.feeProcessed)} onChange={(value) => updateWithdrawal("feeProcessed", value)} />
		          <CheckField label="교재비 처리" checked={Boolean(withdrawal.textbookFeeProcessed)} onChange={(value) => updateWithdrawal("textbookFeeProcessed", value)} />
		        </div>
		      </section>
		    )

    return null
  }

  if (form.type === "transfer") {
    const canSelectTransferFromTeacher = Boolean(form.subject)
    const canSelectTransferFromClass = Boolean(form.subject && selectedTransferFromTeacherId)
    const canSelectTransferStudent = Boolean(form.subject && selectedTransferFromTeacherId && transfer.fromClassId)
    const canSelectTransferToTeacher = Boolean(form.subject)
    const canSelectTransferToClass = Boolean(form.subject && selectedTransferToTeacherId)
    const transferTuitionAdjustment = getTransferTuitionAdjustment({
      fromClass: selectedTransferFromClass,
      toClass: selectedTransferToClass,
      fromDate: transfer.fromClassEndDate || "",
      toDate: transfer.toClassStartDate || "",
    })

    return (
      <section className="grid gap-4">
        <TransferWorkflowChart />
        <section aria-label="전반 공통 정보" className="grid gap-3">
          <div className="grid gap-3 md:grid-cols-2">
            <TaskListboxField
              label="과목"
              value={form.subject || ""}
              options={transferSubjectOptions}
              onChange={selectTransferSubject}
              attention={!form.subject}
            />
            <LinkedSelect
              label="학생"
              value={form.studentId || ""}
              options={transferStudentOptions}
              onChange={(value) => selectStudent(value, { fillTransferFromClass: true })}
              disabled={!canSelectTransferStudent}
              disabledPlaceholder="전 수업 먼저"
              attention={canSelectTransferStudent && !form.studentId}
              renderOption={(option) => {
                const student = findStudent(option.id)
                return <LinkedSelectedValue label={option.label} pills={[student?.grade, student?.school]} />
              }}
              renderSelected={(option) => <LinkedSelectedValue label={option.label} />}
            />
          </div>
          <TextareaField label="전반사유" value={transfer.transferReason || ""} onChange={(value) => updateTransfer("transferReason", value)} />
        </section>
        <div className="grid gap-4 lg:grid-cols-2">
          <section aria-label="전 수업 정보" className="grid content-start gap-3 rounded-md border bg-muted/20 p-3">
            <h3 className="text-sm font-semibold">전 수업 정보</h3>
            <LinkedSelect
              label="전 선생님"
              value={selectedTransferFromTeacherId}
              options={transferFromTeacherOptions}
              onChange={selectTransferFromTeacher}
              disabled={!canSelectTransferFromTeacher}
              disabledPlaceholder="과목 먼저"
              attention={canSelectTransferFromTeacher && !selectedTransferFromTeacherId}
              renderOption={(option) => <LinkedSelectedValue label={option.label} />}
              renderSelected={(option) => <LinkedSelectedValue label={option.label} />}
            />
            <LinkedSelect
              label="전 수업"
              value={transfer.fromClassId || ""}
              options={transferFromClassOptions}
              onChange={(value) => selectClass(value, { fillTransferFrom: true })}
              disabled={!canSelectTransferFromClass}
              disabledPlaceholder="전 선생님 먼저"
              attention={canSelectTransferFromClass && !transfer.fromClassId}
              renderOption={(option) => <LinkedSelectedValue label={option.label} />}
              renderSelected={(option) => <LinkedSelectedValue label={option.label} />}
            />
            <UndistributedTextbookListField label="전 미배부 교재" help={TRANSFER_FROM_UNDISTRIBUTED_TEXTBOOK_HELP} value={transfer.fromUndistributedTextbooks || ""} onChange={(value) => updateTransfer("fromUndistributedTextbooks", value)} />
            <TransferScheduleCalendarField
              key={transfer.fromClassId || "transfer-from-schedule-calendar"}
              label="전 수업 종료일"
              classItem={selectedTransferFromClass}
              dateValue={transfer.fromClassEndDate || ""}
              sessionValue={transfer.fromClassEndSession || ""}
              onScheduleSelect={syncTransferFromScheduleSelection}
            />
          </section>
          <section aria-label="후 수업 정보" className="grid content-start gap-3 rounded-md border bg-muted/20 p-3">
            <h3 className="text-sm font-semibold">후 수업 정보</h3>
            <LinkedSelect
              label="후 선생님"
              value={selectedTransferToTeacherId}
              options={transferToTeacherOptions}
              onChange={selectTransferToTeacher}
              disabled={!canSelectTransferToTeacher}
              disabledPlaceholder="과목 먼저"
              attention={canSelectTransferToTeacher && !selectedTransferToTeacherId}
              renderOption={(option) => <LinkedSelectedValue label={option.label} />}
              renderSelected={(option) => <LinkedSelectedValue label={option.label} />}
            />
            <LinkedSelect
              label="후 수업"
              value={transfer.toClassId || form.classId || ""}
              options={transferToClassOptions}
              onChange={(value) => selectClass(value, { fillTransferTo: true })}
              disabled={!canSelectTransferToClass}
              disabledPlaceholder="후 선생님 먼저"
              attention={canSelectTransferToClass && !(transfer.toClassId || form.classId)}
              renderOption={(option) => <LinkedSelectedValue label={option.label} />}
              renderSelected={(option) => <LinkedSelectedValue label={option.label} />}
            />
            <UndistributedTextbookListField label="후 미배부 교재" help={TRANSFER_TO_UNDISTRIBUTED_TEXTBOOK_HELP} value={transfer.toUndistributedTextbooks || ""} onChange={(value) => updateTransfer("toUndistributedTextbooks", value)} />
            <TransferScheduleCalendarField
              key={transfer.toClassId || form.classId || "transfer-to-schedule-calendar"}
              label="후 수업 시작일"
              classItem={selectedTransferToClass}
              dateValue={transfer.toClassStartDate || ""}
              sessionValue={transfer.toClassStartSession || ""}
              onScheduleSelect={syncTransferToScheduleSelection}
            />
          </section>
        </div>
        <TransferTuitionAdjustmentPanel adjustment={transferTuitionAdjustment} />
        <div className="grid gap-2 md:grid-cols-3">
          <CheckField label="메이크에듀 전반처리" checked={Boolean(transfer.makeeduTransferDone)} onChange={(value) => updateTransfer("makeeduTransferDone", value)} />
          <CheckField label="수업료 처리" checked={Boolean(transfer.feeProcessed)} onChange={(value) => updateTransfer("feeProcessed", value)} />
          <CheckField label="교재비 처리" checked={Boolean(transfer.textbookFeeProcessed)} onChange={(value) => updateTransfer("textbookFeeProcessed", value)} />
        </div>
      </section>
    )
  }

  if (form.type === "word_retest") {
    const isFailedWordRetestRetryForm = formCompletionIntent?.kind === "word_retest_retry" && formCompletionIntent.retryReason === "failed"

    if (step === "word_retest_basic") {
      return (
        <div className="grid gap-3">
          <LinkedSelect
            label="담당선생님"
            value={wordRetest.teacherId || ""}
            options={wordRetestTeacherOptions}
            onChange={(value) => selectTeacher(value)}
            onManualSelect={() => openManualField("wordRetestTeacher")}
            renderOption={(option) => <LinkedSelectedValue label={option.label} />}
            renderSelected={(option) => <LinkedSelectedValue label={option.label} />}
          />
          {shouldShowManualField("wordRetestTeacher", wordRetest.teacherId, wordRetest.teacherName) && <TextField label="담당선생님명" value={wordRetest.teacherName || ""} onChange={(value) => updateWordRetest("teacherName", value)} />}
          <div className="grid gap-3 md:grid-cols-2">
            <LinkedSelect
              label="수업"
              value={form.classId || ""}
              options={wordRetestClassOptions}
              onChange={(value) => selectClass(value, { fillWordRetest: true })}
              onManualSelect={() => openManualField("wordRetestClass")}
              renderOption={(option) => {
                const classItem = findClass(option.id)
                return <LinkedSelectedValue label={option.label} pills={[classItem?.teacher, classItem?.room]} />
              }}
              renderSelected={(option) => {
                const classItem = findClass(option.id)
                return <LinkedSelectedValue label={option.label} pills={[classItem?.teacher, classItem?.room]} />
              }}
            />
            <LinkedMultiSelect
              label="학생"
              values={selectedWordRetestStudentIds}
              options={wordRetestStudentOptions}
              onChange={selectWordRetestStudents}
              onManualSelect={() => openManualField("wordRetestStudent")}
              renderOption={(option) => {
                const student = findStudent(option.id)
                return <LinkedSelectedValue label={option.label} pills={[student?.grade, student?.school]} />
              }}
              renderSelected={(option) => {
                const student = findStudent(option.id)
                return <LinkedSelectedValue label={option.label} pills={[student?.grade, student?.school]} />
              }}
            />
          </div>
          {(shouldShowManualField("wordRetestClass", form.classId, wordRetest.className) || shouldShowManualField("wordRetestStudent", form.studentId, wordRetest.studentName)) && (
            <div className="grid gap-3 md:grid-cols-2">
              {shouldShowManualField("wordRetestClass", form.classId, wordRetest.className) && <TextField label="수업명" value={wordRetest.className || ""} onChange={(value) => {
                updateWordRetest("className", value)
                updateForm("className", value)
              }} />}
              {shouldShowManualField("wordRetestStudent", form.studentId, wordRetest.studentName) && <TextField label="학생명" value={wordRetest.studentName || ""} onChange={(value) => {
                updateWordRetest("studentName", value)
                updateForm("studentName", value)
              }} />}
            </div>
          )}
          <div className="grid gap-3 md:grid-cols-2">
            <WordRetestMainExamDateField
              label="본시험일"
              value={dateInputValue(wordRetest.testAt || "")}
              onChange={(value) => updateWordRetest("testAt", value)}
              onClear={() => updateWordRetest("testAt", "")}
              classScheduleItems={wordRetestClassScheduleItems}
            />
            <TaskListboxField label="장소" value={wordRetest.branch || "본관"} options={WORD_RETEST_BRANCH_OPTIONS} onChange={(value) => updateWordRetest("branch", value)} emptyClassName="text-foreground" />
          </div>
        </div>
      )
    }

    if (step === "word_retest_scope") {
      return (
        <div className="grid gap-3">
          <div className="grid gap-3 md:grid-cols-2">
            <LinkedSelect
              label="교재"
              value={form.textbookId || ""}
              options={wordRetestTextbookOptions}
              onChange={(value) => selectTextbook(value, { fillWordRetest: true })}
              onManualSelect={() => openManualField("wordRetestTextbook")}
              listHeader={renderWordRetestTextbookFilters()}
              renderOption={(option) => {
                const textbook = findTextbook(option.id)
                return <LinkedSelectedValue label={option.label} pills={[textbook ? inferWordRetestTextbookSubject(textbook) : "", textbook ? inferWordRetestTextbookGradePill(textbook) : ""]} />
              }}
              renderSelected={(option) => {
                const textbook = findTextbook(option.id)
                return <LinkedSelectedValue label={option.label} pills={[textbook ? inferWordRetestTextbookSubject(textbook) : "", textbook ? inferWordRetestTextbookGradePill(textbook) : ""]} />
              }}
            />
            <TextField label="시험범위" value={wordRetest.unit || ""} onChange={(value) => updateWordRetest("unit", value)} />
          </div>
          {shouldShowManualField("wordRetestTextbook", form.textbookId, wordRetest.textbookName) && <TextField label="교재명" value={wordRetest.textbookName || ""} onChange={(value) => updateWordRetest("textbookName", value)} />}
          <div className="grid gap-3 md:grid-cols-2">
            <TextField label="출제 개수" value={wordRetest.totalQuestionCount || ""} inputMode="numeric" onChange={(value) => updateWordRetest("totalQuestionCount", value)} />
            <TextField label="커트라인(합격 개수)" value={wordRetest.cutoffQuestionCount || ""} inputMode="numeric" onChange={(value) => updateWordRetest("cutoffQuestionCount", value)} />
          </div>
          <TextField label="메모" value={wordRetest.requestNote || ""} onChange={(value) => updateWordRetest("requestNote", value)} />
        </div>
      )
    }

    if (step === "word_retest_scores" && isFailedWordRetestRetryForm) return null

    if (step === "word_retest_scores") {
      return (
        <div className="grid gap-3">
          {wordRetestAbsent ? (
            <div className="flex min-h-10 items-center rounded-md border bg-background px-3 text-sm font-medium text-muted-foreground">
              점수 없음
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-3">
              <WordRetestAttemptScoreField
                label="1차 맞은 개수"
                value={wordRetest.firstScore || ""}
                totalQuestionCount={wordRetest.totalQuestionCount}
                cutoffQuestionCount={wordRetest.cutoffQuestionCount}
                onChange={(value) => updateWordRetest("firstScore", value)}
              />
              <WordRetestAttemptScoreField
                label="2차 맞은 개수"
                value={wordRetest.secondScore || ""}
                totalQuestionCount={wordRetest.totalQuestionCount}
                cutoffQuestionCount={wordRetest.cutoffQuestionCount}
                onChange={(value) => updateWordRetest("secondScore", value)}
              />
              <WordRetestAttemptScoreField
                label="3차 맞은 개수"
                value={wordRetest.thirdScore || ""}
                totalQuestionCount={wordRetest.totalQuestionCount}
                cutoffQuestionCount={wordRetest.cutoffQuestionCount}
                onChange={(value) => updateWordRetest("thirdScore", value)}
              />
            </div>
          )}
        </div>
      )
    }

    return null
  }

  return null
}


function TodoTeamFilterBar({
  options,
  requestedByFilter,
  requestedTeamFilter,
  assigneeFilter,
  assigneeTeamFilter,
  onRequestedByChange,
  onRequestedTeamChange,
  onAssigneeChange,
  onAssigneeTeamChange,
}: {
  options: TodoFilterOptions
  requestedByFilter: TodoSelectFilterKey
  requestedTeamFilter: TodoSelectFilterKey
  assigneeFilter: TodoSelectFilterKey
  assigneeTeamFilter: TodoSelectFilterKey
  onRequestedByChange: (value: TodoSelectFilterKey) => void
  onRequestedTeamChange: (value: TodoSelectFilterKey) => void
  onAssigneeChange: (value: TodoSelectFilterKey) => void
  onAssigneeTeamChange: (value: TodoSelectFilterKey) => void
}) {
  return (
    <div aria-label="할 일 필터" className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      <TodoFilterListbox label="요청자" allLabel="요청자 전체" value={requestedByFilter} options={options.requestedBy} onChange={onRequestedByChange} />
      <TodoFilterListbox label="요청팀" allLabel="요청팀 전체" value={requestedTeamFilter} options={options.requestedTeam} onChange={onRequestedTeamChange} />
      <TodoFilterListbox label="담당자" allLabel="담당자 전체" value={assigneeFilter} options={options.assignee} onChange={onAssigneeChange} />
      <TodoFilterListbox label="담당팀" allLabel="담당팀 전체" value={assigneeTeamFilter} options={options.assigneeTeam} onChange={onAssigneeTeamChange} />
    </div>
  )
}

function WordRetestPeriodFilterBar({
  value,
  startDate,
  endDate,
  onChange,
  onStartDateChange,
  onEndDateChange,
}: {
  value: WordRetestPeriodFilter
  startDate: string
  endDate: string
  onChange: (value: WordRetestPeriodFilter) => void
  onStartDateChange: (value: string) => void
  onEndDateChange: (value: string) => void
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <div className="inline-flex max-w-full overflow-x-auto rounded-md border bg-background p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="단어 재시험 본시험일 기간">
        {WORD_RETEST_PERIOD_FILTERS.map((filter) => (
          <button
            key={filter.key}
            type="button"
            aria-pressed={value === filter.key}
            aria-label={`${filter.label} 단어 재시험 보기`}
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
      {value === "custom" && (
        <div className="grid min-w-[18rem] flex-1 gap-2 sm:max-w-sm sm:grid-cols-2">
          <DatePickerControl
            value={startDate}
            onChange={onStartDateChange}
            placeholder="시작일"
            ariaLabel="단어 재시험 기간 시작일"
          />
          <DatePickerControl
            value={endDate}
            onChange={onEndDateChange}
            placeholder="종료일"
            ariaLabel="단어 재시험 기간 종료일"
          />
        </div>
      )}
    </div>
  )
}

function WordRetestFilterBar({
  options,
  teacherFilter,
  classFilter,
  onTeacherChange,
  onClassChange,
}: {
  options: WordRetestFilterOptions
  teacherFilter: WordRetestSelectFilterKey
  classFilter: WordRetestSelectFilterKey
  onTeacherChange: (value: WordRetestSelectFilterKey) => void
  onClassChange: (value: WordRetestSelectFilterKey) => void
}) {
  if (options.teacher.length === 0 && options.class.length === 0 && teacherFilter === "all" && classFilter === "all") return null

  return (
    <div aria-label="단어 재시험 필터" className="grid gap-2 sm:grid-cols-2">
      <TodoFilterListbox label="담당선생님" allLabel="담당선생님 전체" value={teacherFilter} options={options.teacher} onChange={onTeacherChange} />
      <TodoFilterListbox label="수업" allLabel="수업 전체" value={classFilter} options={options.class} onChange={onClassChange} />
    </div>
  )
}

function TodoFilterListbox({
  label,
  allLabel,
  value,
  options,
  onChange,
}: {
  label: string
  allLabel: string
  value: string
  options: TodoFilterOption[]
  onChange: (value: string) => void
}) {
  const fieldId = useId()
  const listId = useId()
  const [open, setOpen] = useState(false)
  const allOption = { value: "all", label: allLabel, count: 0 }
  const listboxOptions = [allOption, ...options]
  const selectedOption = listboxOptions.find((option) => option.value === value) || allOption

  function selectOption(nextValue: string) {
    onChange(nextValue)
    setOpen(false)
  }

  return (
    <div
      className="relative grid min-w-0 gap-1 text-xs font-medium text-muted-foreground"
      onBlur={(event) => {
        const nextTarget = event.relatedTarget
        if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return
        setOpen(false)
      }}
    >
      <span id={fieldId}>{label}</span>
      <button
        type="button"
        aria-labelledby={fieldId}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((current) => !current)}
        className={[
          "flex h-9 min-w-0 items-center justify-between gap-2 rounded-md border bg-background px-2.5 text-left text-sm text-foreground shadow-xs outline-none transition",
          open ? "border-ring ring-2 ring-ring/40" : "hover:border-foreground/30",
        ].join(" ")}
      >
        <span className="min-w-0 truncate">{selectedOption.label}{selectedOption.count ? ` ${selectedOption.count}` : ""}</span>
        <ChevronRight className={["size-4 shrink-0 text-muted-foreground transition-transform", open ? "rotate-90" : ""].join(" ")} />
      </button>
      {open && (
        <div
          id={listId}
          role="listbox"
          aria-labelledby={fieldId}
          className="absolute left-0 right-0 top-full z-40 mt-1 max-h-64 overflow-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-lg"
        >
          {listboxOptions.map((option) => {
            const selected = option.value === value
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => selectOption(option.value)}
                className={[
                  "flex w-full items-center justify-between gap-2 rounded px-2.5 py-2 text-left text-sm outline-none transition-colors",
                  selected ? "bg-primary/10 text-primary" : "hover:bg-muted",
                ].join(" ")}
              >
                <span className="min-w-0 truncate">{option.label}{option.count ? ` ${option.count}` : ""}</span>
                {selected && <Check className="size-4 shrink-0" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function EmptyTaskState({
  icon,
  label,
  actionLabel = "추가",
  showAction = true,
  onCreate,
}: {
  icon: ReactNode
  label: string
  actionLabel?: string
  showAction?: boolean
  onCreate: () => void
}) {
  return (
    <Empty className="min-h-48 border-0 p-6">
      <EmptyHeader className="gap-2">
        <EmptyMedia variant="icon" className="text-muted-foreground">
          {icon}
        </EmptyMedia>
        <EmptyTitle className="text-sm text-muted-foreground">{label}</EmptyTitle>
      </EmptyHeader>
      {showAction && (
        <EmptyContent className="gap-2">
          <Button type="button" size="sm" onClick={onCreate}>
            <Plus className="size-4" />
            {actionLabel}
          </Button>
        </EmptyContent>
      )}
    </Empty>
  )
}

function WordRetestStatusBadge({ value, taskStatus, wordRetest }: { value?: string; taskStatus?: OpsTaskStatus; wordRetest?: OpsTaskInput["wordRetest"] }) {
  const statusValue = String(value || "not_started").trim() || "not_started"
  const scoreResult = taskStatus === "review_requested" || taskStatus === "done" ? getWordRetestScoreResult(wordRetest) : null
  const toneClass = scoreResult === "failed"
    ? "border-destructive/25 bg-destructive/10 text-destructive"
    : statusValue === "done" || scoreResult === "passed"
      ? "border-primary/25 bg-primary/10 text-primary"
      : statusValue === "absent"
      ? "border-destructive/25 bg-destructive/10 text-destructive"
      : statusValue === "in_progress"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : "border-muted-foreground/20 bg-muted/50 text-muted-foreground"

  return (
    <span className={["inline-flex h-7 items-center rounded-full border px-2.5 text-xs font-semibold", toneClass].join(" ")}>
      {getWordRetestStatusLabel(statusValue, taskStatus, wordRetest)}
    </span>
  )
}

function WordRetestScoreResultCell({ wordRetest }: { wordRetest?: OpsTaskInput["wordRetest"] }) {
  if (isWordRetestAbsent(wordRetest)) {
    return <span className="text-sm text-muted-foreground">미응시</span>
  }

  const scorePercent = getWordRetestScorePercent(wordRetest)
  const scoreResult = getWordRetestScoreResult(wordRetest)
  if (scorePercent === null && scoreResult === null) {
    return <span className="text-sm text-muted-foreground">-</span>
  }

  const resultToneClass = scoreResult === "passed"
    ? "border-primary/25 bg-primary/10 text-primary"
    : scoreResult === "failed"
      ? "border-amber-200 bg-amber-50 text-amber-700"
      : "border-muted-foreground/20 bg-muted/40 text-muted-foreground"

  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1">
      {scorePercent !== null && (
        <span className="inline-flex h-7 items-center rounded-full border border-muted-foreground/20 bg-muted/40 px-2.5 text-xs font-semibold text-muted-foreground">
          {scorePercent}점
        </span>
      )}
      {scoreResult && (
        <span className={["inline-flex h-7 items-center rounded-full border px-2.5 text-xs font-semibold", resultToneClass].join(" ")}>
          {scoreResult === "passed" ? "통과" : "재시험"}
        </span>
      )}
    </span>
  )
}

type WordRetestDiagramTone = "muted" | "destructive" | "warning" | "primary" | "decision"

function getWordRetestDiagramToneClass(tone: WordRetestDiagramTone) {
  if (tone === "destructive") return "border-destructive/30 bg-destructive/[0.06] text-destructive"
  if (tone === "warning") return "border-amber-300/80 bg-amber-50 text-amber-800"
  if (tone === "primary") return "border-primary/30 bg-primary/[0.07] text-primary"
  if (tone === "decision") return "border-muted-foreground/30 bg-background text-foreground"
  return "border-border bg-muted/35 text-foreground"
}

function getWordRetestDiagramLineClass(tone: WordRetestDiagramTone) {
  if (tone === "destructive") return "bg-destructive/25"
  if (tone === "warning") return "bg-amber-300/60"
  if (tone === "primary") return "bg-primary/25"
  return "bg-border"
}

type WordRetestCompactFlowNode = {
  key: string
  label: string
  detail?: string
  returnToStart?: boolean
}

function WordRetestCompactNode({
  node,
  active,
  tone = "muted",
}: {
  node: WordRetestCompactFlowNode
  active?: boolean
  tone?: WordRetestDiagramTone
}) {
  const title = [node.label, node.detail].filter(Boolean).join(" · ")

  return (
    <span className={[
      "relative inline-flex h-10 w-[108px] shrink-0 flex-col justify-center rounded-md border px-2.5 text-left leading-tight shadow-sm",
      getWordRetestDiagramToneClass(tone),
      active ? "ring-2 ring-primary/45 ring-offset-1 ring-offset-background" : "",
    ].filter(Boolean).join(" ")}>
      <span className="truncate text-xs font-bold">{node.label}</span>
      {node.detail && (
        <span className="mt-0.5 truncate text-[10px] font-semibold opacity-65" title={title}>{node.detail}</span>
      )}
      {node.returnToStart && (
        <RefreshCw className="absolute right-1.5 top-1.5 size-3 text-current/70" aria-hidden />
      )}
    </span>
  )
}

function WordRetestFlowArrow({ tone = "muted" }: { tone?: WordRetestDiagramTone }) {
  return (
    <span className="flex w-5 shrink-0 items-center justify-center text-muted-foreground" aria-hidden>
      <span className={["h-px flex-1", getWordRetestDiagramLineClass(tone)].join(" ")} />
      <ChevronRight className="mx-0.5 size-3.5" />
    </span>
  )
}

function WordRetestFlowColumnSpacer() {
  return (
    <span className="contents" aria-hidden>
      <span className="h-10 w-[108px] shrink-0" />
      <span className="w-5 shrink-0" />
    </span>
  )
}

function WordRetestFlowLane({
  label,
  nodes,
  activeKeys,
  tone = "muted",
  leadingSlots = 0,
}: {
  label: string
  nodes: WordRetestCompactFlowNode[]
  activeKeys: Set<string>
  tone?: WordRetestDiagramTone
  leadingSlots?: number
}) {
  const labelClass = tone === "destructive"
    ? "border-destructive/25 bg-destructive/[0.05] text-destructive"
    : tone === "warning"
      ? "border-amber-300/70 bg-amber-50 text-amber-800"
      : tone === "primary"
        ? "border-primary/25 bg-primary/[0.06] text-primary"
        : "border-border bg-muted/40 text-foreground"

  return (
    <span className="grid min-w-[620px] grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-2 rounded-md px-1.5 py-1">
      <span className={["inline-flex h-8 items-center justify-center rounded-full border px-2 text-xs font-bold", labelClass].join(" ")}>
        {label}
      </span>
      <span className="flex min-w-0 items-center">
        {Array.from({ length: leadingSlots }).map((_, index) => (
          <WordRetestFlowColumnSpacer key={`leading-slot-${index}`} />
        ))}
        {nodes.map((node, index) => (
          <span key={node.key} className="contents">
            {index > 0 && <WordRetestFlowArrow tone={tone} />}
            <WordRetestCompactNode node={node} tone={tone} active={activeKeys.has(node.key)} />
          </span>
        ))}
      </span>
    </span>
  )
}

function WordRetestFlowChart({
  currentValue,
  taskStatus,
  wordRetest,
}: {
  currentValue: string
  taskStatus?: OpsTaskStatus
  wordRetest?: OpsTaskInput["wordRetest"]
}) {
  const scoreResult = getWordRetestScoreResult(wordRetest)
  const activeKeys = new Set<string>()
  const [failedBranch, passedBranch] = WORD_RETEST_DIAGRAM_RESULT_BRANCHES
  const commonNodes: WordRetestCompactFlowNode[] = WORD_RETEST_DIAGRAM_MAIN_NODES.map((node, index) => ({
    ...node,
    label: index === 0 ? "재시험 추가" : node.label,
    detail: index === 0 ? node.label : node.detail,
  }))
  const absentNodes: WordRetestCompactFlowNode[] = [
    WORD_RETEST_DIAGRAM_ABSENT_NODES[0],
    WORD_RETEST_DIAGRAM_ABSENT_NODES[1],
    WORD_RETEST_DIAGRAM_ABSENT_NODES[2],
    { key: "absent_retry_create", label: "재시험 추가", detail: "담당선생님", returnToStart: true },
  ]
  const failedNodes: WordRetestCompactFlowNode[] = [
    failedBranch.result,
    ...failedBranch.nodes,
  ]
  const passedNodes: WordRetestCompactFlowNode[] = [
    passedBranch.result,
    ...passedBranch.nodes,
  ]

  if (currentValue === "absent") {
    activeKeys.add("absent")
  } else if (currentValue === "in_progress") {
    activeKeys.add("in_progress")
  } else if (currentValue === "done" || taskStatus === "review_requested" || taskStatus === "done") {
    activeKeys.add("decision")
    if (scoreResult === "failed") activeKeys.add("failed_result")
    if (scoreResult === "passed") activeKeys.add("passed_result")
  } else {
    activeKeys.add("start")
  }

  return (
    <div className="overflow-x-auto rounded-md border bg-background p-2" aria-label="단어 재시험 업무 흐름">
      <div className="grid min-w-[620px] gap-1">
        <WordRetestFlowLane label="공통" nodes={commonNodes} activeKeys={activeKeys} />
        <WordRetestFlowLane label="미응시" nodes={absentNodes} activeKeys={activeKeys} tone="destructive" />
        <WordRetestFlowLane label={failedBranch.label} nodes={failedNodes} activeKeys={activeKeys} tone="warning" />
        <WordRetestFlowLane label={passedBranch.label} nodes={passedNodes} activeKeys={activeKeys} tone="primary" />
      </div>
    </div>
  )
}

function WordRetestProgressStepper({
  value,
  taskStatus,
  wordRetest,
}: {
  value?: string
  taskStatus?: OpsTaskStatus
  wordRetest?: OpsTaskInput["wordRetest"]
}) {
  const currentValue = String(value || "not_started").trim() || "not_started"
  const [open, setOpen] = useState(false)
  const statusLabel = getWordRetestStatusLabel(currentValue, taskStatus, wordRetest)

  return (
    <div className="overflow-hidden rounded-md border bg-background" aria-label="진행상태">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex min-h-12 w-full items-center justify-between gap-3 px-3 py-2 text-left transition hover:bg-muted/45"
      >
        <span className="min-w-0">
          <span className="block text-xs font-medium text-muted-foreground">현재 진행상태</span>
          <span className="block truncate text-sm font-semibold text-foreground">{statusLabel}</span>
        </span>
        <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground">
          {open ? "접기" : "업무 흐름 보기"}
          <ChevronRight className={["size-4 transition-transform", open ? "rotate-90" : ""].filter(Boolean).join(" ")} aria-hidden />
        </span>
      </button>
      {open && (
        <div className="border-t p-2">
          <WordRetestFlowChart currentValue={currentValue} taskStatus={taskStatus} wordRetest={wordRetest} />
        </div>
      )}
    </div>
  )
}

function WordRetestInlineScoreEditor({
  task,
  draft,
  disabled,
  onDraftChange,
  onSave,
}: {
  task: OpsTask
  draft: WordRetestScoreDraft
  disabled: boolean
  onDraftChange: (task: OpsTask, key: keyof WordRetestScoreDraft, value: string) => void
  onSave: (task: OpsTask) => void
}) {
  const dirty = isWordRetestScoreDraftDirty(task, draft)
  const absent = isWordRetestAbsent(task.wordRetest)

  if (absent) {
    return <span className="text-sm font-medium text-muted-foreground">미응시</span>
  }

  return (
    <span className="grid min-w-[13.5rem] grid-cols-[repeat(3,minmax(2.5rem,1fr))_auto] items-center gap-1">
      {([
        ["firstScore", "1차"],
        ["secondScore", "2차"],
        ["thirdScore", "3차"],
      ] as const).map(([key, label]) => (
        <Input
          key={key}
          value={draft[key]}
          inputMode="numeric"
          aria-label={`${getWordRetestStudentLabel(task)} ${label} 점수`}
          placeholder={label}
          disabled={disabled}
          onChange={(event) => onDraftChange(task, key, event.target.value)}
          className="h-8 min-w-0 px-2 text-xs"
        />
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || !dirty}
        onClick={() => onSave(task)}
        className="h-8 px-2 text-xs"
      >
        저장
      </Button>
    </span>
  )
}

function TodoTaskCard({
  task,
  onOpen,
  onStatusChange,
  statusActionDisabled,
}: {
  task: OpsTask
  onOpen: (task: OpsTask) => void
  onStatusChange: (task: OpsTask, status: OpsTaskStatus) => void
  statusActionDisabled: boolean
}) {
  const nextAction = getNextTaskStatusAction(task)
  const requesterLabel = [task.requestedByLabel || "미지정", task.requestedTeam || "미지정"].join(" / ")
  const assigneeLabel = [task.assigneeLabel || "미지정", task.assigneeTeam || "미지정"].join(" / ")

  return (
    <article className="grid gap-3 rounded-md border bg-background p-3 text-sm shadow-xs">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
          <TaskStatusBadge status={task.status} />
          <TodoPriorityBadge priority={task.priority} showNormal />
          <AutoSyncInlineBadge task={task} />
        </span>
        <span className="shrink-0 text-xs font-medium text-muted-foreground">{getTodoActionLabel(task)}</span>
      </div>

      <button
        type="button"
        aria-label={`${task.title} 상세 보기`}
        onClick={() => onOpen(task)}
        className="min-w-0 text-left hover:text-primary"
      >
        <span className={[
          "block truncate text-base font-semibold",
          isClosedOpsTask(task) ? "text-muted-foreground line-through" : "",
        ].filter(Boolean).join(" ")}
        >
          {task.title}
        </span>
      </button>

      <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
        <span className="min-w-0">
          <span className="mb-0.5 block font-medium text-foreground">요청</span>
          <span className="block truncate">{requesterLabel}</span>
        </span>
        <span className="min-w-0">
          <span className="mb-0.5 block font-medium text-foreground">담당</span>
          <span className="block truncate">{assigneeLabel}</span>
        </span>
        <span className="min-w-0 sm:col-span-2">
          <span className="mb-0.5 block font-medium text-foreground">시작/마감</span>
          <TodoDateSummary task={task} />
        </span>
      </div>

      {nextAction && (
        <Button
          type="button"
          variant={nextAction.status === "done" ? "default" : "outline"}
          size="sm"
          className="w-full"
          onClick={() => onStatusChange(task, nextAction.status)}
          disabled={statusActionDisabled}
        >
          {nextAction.label}
        </Button>
      )}
    </article>
  )
}

function TaskListSkeleton({ showType }: { showType: boolean }) {
  const gridClass = showType
    ? "md:grid-cols-[88px_88px_minmax(220px,1fr)_120px_120px_120px_150px]"
    : "md:grid-cols-[88px_140px_minmax(220px,1fr)_150px_150px_96px_120px]"

  return (
    <div className="overflow-hidden rounded-md border" aria-label="불러오는 중">
      <div className={`hidden border-b bg-muted/40 px-3 py-2 md:grid ${gridClass}`}>
        {Array.from({ length: 7 }).map((_, index) => (
          <span key={index} className="h-3 w-16 rounded bg-muted" />
        ))}
      </div>
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className={`grid gap-2 border-b px-3 py-3 last:border-b-0 md:items-center md:gap-0 ${gridClass}`}>
          {showType && <span className="size-6 rounded-full bg-muted" />}
          {!showType && <span className="h-5 w-12 rounded bg-muted" />}
          {showType && <span className="h-5 w-14 rounded bg-muted" />}
          {!showType && <span className="h-4 w-24 rounded bg-muted" />}
          <span className="grid gap-1.5">
            <span className="h-4 w-3/4 rounded bg-muted" />
            <span className="h-3 w-1/2 rounded bg-muted md:hidden" />
          </span>
          <span className="h-4 w-20 rounded bg-muted" />
          {showType && <span className="h-4 w-20 rounded bg-muted" />}
          <span className="h-4 w-24 rounded bg-muted" />
          {!showType && <span className="h-4 w-24 rounded bg-muted" />}
          {!showType && <span className="h-8 w-20 rounded bg-muted md:justify-self-end" />}
          {showType && <span className="h-8 w-24 rounded bg-muted md:justify-self-end" />}
        </div>
      ))}
    </div>
  )
}

function TaskList({
  tasks,
  todayKey,
  onOpen,
  onEdit,
  onStatusChange,
  onRegistrationPipelineAdvance,
  statusActionDisabled = false,
  onCreate,
  emptyLabel = "항목 없음",
  emptyActionLabel,
  showEmptyAction = true,
  showType = true,
  sortKey = "due",
  onSortChange = noopTodoSortChange,
  completionBlockersByTaskId = EMPTY_COMPLETION_BLOCKERS_BY_TASK_ID,
}: {
  tasks: OpsTask[]
  todayKey: string
  onOpen: (task: OpsTask) => void
  onEdit: (task: OpsTask, blockers?: string[]) => void
  onStatusChange: (task: OpsTask, status: OpsTaskStatus) => void
  onRegistrationPipelineAdvance: (task: OpsTask, pipelineStatus: string) => void
  statusActionDisabled?: boolean
  onCreate: () => void
  emptyLabel?: string
  emptyActionLabel?: string
  showEmptyAction?: boolean
  showType?: boolean
  sortKey?: TodoSortKey
  onSortChange?: (key: TodoSortKey) => void
  completionBlockersByTaskId?: OperationCompletionBlockerMap
}) {
  if (tasks.length === 0) {
    return (
      <EmptyTaskState
        icon={<Inbox className="size-5" />}
        label={emptyLabel}
        actionLabel={emptyActionLabel || (showType ? "추가" : "빠른 추가")}
        showAction={showEmptyAction}
        onCreate={onCreate}
      />
    )
  }

  const hasOperationRows = tasks.some((task) => task.type !== "general")
  const showTypeColumn = showType
  const isTodoList = !hasOperationRows
  const [statusColumn, priorityColumn, dueColumn] = TODO_TABLE_SORT_COLUMNS
  const gridClass = hasOperationRows
    ? showTypeColumn
      ? "md:grid-cols-[88px_88px_minmax(220px,1fr)_120px_120px_120px_150px]"
      : "md:grid-cols-[88px_minmax(220px,1fr)_120px_120px_120px_150px]"
    : "md:grid-cols-[88px_140px_minmax(220px,1fr)_150px_150px_96px_120px]"
  const header = (
    <div className={`hidden border-b bg-muted/50 px-3 py-2 text-xs font-medium text-muted-foreground md:grid xl:grid ${gridClass}`}>
      {isTodoList ? (
        <>
          <TodoSortableHeaderButton column={priorityColumn} sortKey={sortKey} onSortChange={() => onSortChange("priority")} />
          <TodoSortableHeaderButton column={dueColumn} sortKey={sortKey} onSortChange={() => onSortChange("due")} />
          <span>제목</span>
          <span>요청자/요청팀</span>
          <span>담당자/담당팀</span>
          <TodoSortableHeaderButton column={statusColumn} sortKey={sortKey} onSortChange={() => onSortChange("status")} />
          <span className="text-right">다음 액션</span>
        </>
      ) : (
        <>
          <span>상태</span>
          {showTypeColumn && <span>유형</span>}
          <span>업무</span>
          <span>담당</span>
          {hasOperationRows && <span>학생</span>}
          <span>기한</span>
          {hasOperationRows && <span className="text-right">다음 액션</span>}
        </>
      )}
    </div>
  )
  const rows = tasks.map((task) => (
    <TaskListRow
      key={task.id}
      task={task}
      todayKey={todayKey}
      onOpen={onOpen}
      onEdit={onEdit}
      onStatusChange={onStatusChange}
      onRegistrationPipelineAdvance={onRegistrationPipelineAdvance}
      statusActionDisabled={statusActionDisabled}
      showType={showTypeColumn}
      todoControls={!showType}
      showOperationColumns={hasOperationRows}
      completionBlockers={completionBlockersByTaskId.get(task.id) || EMPTY_COMPLETION_BLOCKERS}
    />
  ))

  if (isTodoList) {
    return (
      <div className="grid gap-2">
        <div data-testid="todo-mobile-task-list" className="grid gap-2 xl:hidden">
          {tasks.map((task) => (
            <TodoTaskCard
              key={task.id}
              task={task}
              onOpen={onOpen}
              onStatusChange={onStatusChange}
              statusActionDisabled={statusActionDisabled}
            />
          ))}
        </div>
        <div data-testid="todo-table-task-list" className="hidden overflow-hidden rounded-md border xl:block">
          {header}
          {rows}
        </div>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-md border">
      {hasOperationRows && header}
      {rows}
    </div>
  )
}

function WordRetestTaskList({
  tasks,
  mode,
  onOpen,
  onEdit,
  onStatusChange,
  onComplete,
  onRetry,
  scoreDrafts,
  onScoreDraftChange,
  onScoreSave,
  statusActionDisabled = false,
  selectedTaskIds,
  canSelectTask,
  onSelectTask,
  onSelectAll,
  onClearSelection,
  onBulkDelete,
  onCreate,
  emptyLabel = "단어 재시험 없음",
  emptyActionLabel = "추가",
  showEmptyAction = true,
  completionBlockersByTaskId = EMPTY_COMPLETION_BLOCKERS_BY_TASK_ID,
}: {
  tasks: OpsTask[]
  mode: WordRetestMode
  onOpen: (task: OpsTask) => void
  onEdit: (task: OpsTask, blockers?: string[]) => void
  onStatusChange: (task: OpsTask, status: OpsTaskStatus) => void
  onComplete: (task: OpsTask) => void
  onRetry: (task: OpsTask) => void
  scoreDrafts: Record<string, WordRetestScoreDraft>
  onScoreDraftChange: (task: OpsTask, key: keyof WordRetestScoreDraft, value: string) => void
  onScoreSave: (task: OpsTask) => void
  statusActionDisabled?: boolean
  selectedTaskIds: Set<string>
  canSelectTask: (task: OpsTask) => boolean
  onSelectTask: (task: OpsTask, selected: boolean) => void
  onSelectAll: (selected: boolean, tasks: OpsTask[]) => void
  onClearSelection: () => void
  onBulkDelete: (tasks: OpsTask[]) => void
  onCreate: () => void
  emptyLabel?: string
  emptyActionLabel?: string
  showEmptyAction?: boolean
  completionBlockersByTaskId?: OperationCompletionBlockerMap
}) {
  const [columnWidths, setColumnWidths] = useState<Record<WordRetestTableColumnKey, number>>(WORD_RETEST_TABLE_COLUMN_WIDTHS)
  const gridTemplateColumns = getWordRetestTableGridTemplate(columnWidths)
  const gridTemplateStyle = { "--word-retest-grid-template": gridTemplateColumns } as CSSProperties
  const selectableTasks = useMemo(() => tasks.filter(canSelectTask), [canSelectTask, tasks])
  const selectedTasks = useMemo(() => tasks.filter((task) => selectedTaskIds.has(task.id) && canSelectTask(task)), [canSelectTask, selectedTaskIds, tasks])
  const allVisibleSelected = selectableTasks.length > 0 && selectableTasks.every((task) => selectedTaskIds.has(task.id))
  const partiallySelected = selectedTasks.length > 0 && !allVisibleSelected

  function startColumnResize(key: WordRetestTableColumnKey, event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = columnWidths[key]

    function handlePointerMove(moveEvent: PointerEvent) {
      const nextWidth = Math.max(WORD_RETEST_TABLE_COLUMN_MIN_WIDTHS[key], startWidth + moveEvent.clientX - startX)
      setColumnWidths((current) => ({ ...current, [key]: nextWidth }))
    }

    function handlePointerUp() {
      window.removeEventListener("pointermove", handlePointerMove)
      window.removeEventListener("pointerup", handlePointerUp)
    }

    window.addEventListener("pointermove", handlePointerMove)
    window.addEventListener("pointerup", handlePointerUp)
  }

  if (tasks.length === 0) {
    return (
      <EmptyTaskState
        icon={<FileText className="size-5" />}
        label={emptyLabel}
        actionLabel={emptyActionLabel}
        showAction={showEmptyAction}
        onCreate={onCreate}
      />
    )
  }

  return (
    <div className="overflow-x-auto rounded-md border">
      {selectedTasks.length > 0 && (
        <div className="flex flex-col gap-2 border-b bg-muted/30 px-3 py-2 text-sm font-medium sm:flex-row sm:items-center sm:justify-between">
          <span>{selectedTasks.length}건 선택</span>
          <span className="flex flex-wrap gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClearSelection} disabled={statusActionDisabled}>
              선택 해제
            </Button>
            <Button type="button" variant="destructive" size="sm" onClick={() => onBulkDelete(selectedTasks)} disabled={statusActionDisabled}>
              <Trash2 className="size-4" />
              선택 삭제
            </Button>
          </span>
        </div>
      )}
      <div
        className="hidden min-w-max border-b bg-muted/50 px-3 py-2 text-xs font-medium text-muted-foreground md:grid md:items-center md:gap-3 md:[grid-template-columns:var(--word-retest-grid-template)]"
        style={gridTemplateStyle}
      >
        <span className="flex min-w-0 items-center justify-center">
          <input
            type="checkbox"
            aria-label="보이는 단어 재시험 전체 선택"
            checked={allVisibleSelected}
            disabled={selectableTasks.length === 0 || statusActionDisabled}
            ref={(node) => {
              if (node) node.indeterminate = partiallySelected
            }}
            onChange={(event) => onSelectAll(event.target.checked, tasks)}
            className="size-4 rounded border-border text-primary"
          />
        </span>
        <WordRetestResizableHeaderCell label="상태" columnKey="status" onResizeStart={startColumnResize} />
        <WordRetestResizableHeaderCell label="본시험일" columnKey="testAt" onResizeStart={startColumnResize} />
        <WordRetestResizableHeaderCell label="담당선생님" columnKey="teacher" onResizeStart={startColumnResize} />
        <WordRetestResizableHeaderCell label="수업" columnKey="class" onResizeStart={startColumnResize} />
        <WordRetestResizableHeaderCell label="학생" columnKey="student" onResizeStart={startColumnResize} />
        <WordRetestResizableHeaderCell label="교재" columnKey="textbook" onResizeStart={startColumnResize} />
        <WordRetestResizableHeaderCell label="시험범위" columnKey="unit" onResizeStart={startColumnResize} />
        <WordRetestResizableHeaderCell label="출제 개수" columnKey="total" onResizeStart={startColumnResize} />
        <WordRetestResizableHeaderCell label="커트라인" columnKey="cutoff" onResizeStart={startColumnResize} />
        <WordRetestResizableHeaderCell label="맞은 개수" columnKey="score" onResizeStart={startColumnResize} />
        <WordRetestResizableHeaderCell label="결과" columnKey="result" onResizeStart={startColumnResize} />
        <WordRetestResizableHeaderCell label="다음 액션" columnKey="action" align="right" onResizeStart={startColumnResize} />
      </div>
      {tasks.map((task) => (
        <WordRetestTaskRow
          key={task.id}
          task={task}
          mode={mode}
          completionBlockers={completionBlockersByTaskId.get(task.id) || EMPTY_COMPLETION_BLOCKERS}
          onOpen={onOpen}
          onEdit={onEdit}
          onStatusChange={onStatusChange}
          onComplete={onComplete}
          onRetry={onRetry}
          scoreDraft={scoreDrafts[task.id]}
          onScoreDraftChange={onScoreDraftChange}
          onScoreSave={onScoreSave}
          statusActionDisabled={statusActionDisabled}
          selected={selectedTaskIds.has(task.id)}
          selectable={canSelectTask(task)}
          onSelectTask={onSelectTask}
          gridTemplateColumns={gridTemplateColumns}
        />
      ))}
    </div>
  )
}

function WordRetestResizableHeaderCell({
  label,
  columnKey,
  align = "left",
  onResizeStart,
}: {
  label: string
  columnKey: WordRetestTableColumnKey
  align?: "left" | "right"
  onResizeStart: (key: WordRetestTableColumnKey, event: ReactPointerEvent<HTMLButtonElement>) => void
}) {
  return (
    <span className={["relative min-w-0 pr-2", align === "right" ? "text-right" : ""].join(" ")}>
      <span className="block truncate">{label}</span>
      <button
        type="button"
        aria-label={`${label} 열 너비 조절`}
        onPointerDown={(event) => onResizeStart(columnKey, event)}
        className="absolute -right-1 top-1/2 h-5 w-2 -translate-y-1/2 cursor-col-resize rounded-full hover:bg-primary/25 focus-visible:bg-primary/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    </span>
  )
}

function shouldIgnoreWordRetestRowOpen(target: EventTarget | null) {
  if (!(target instanceof Element)) return false
  return Boolean(target.closest("button, input, textarea, select, a, [data-word-retest-interactive='true']"))
}

const WordRetestTaskRow = memo(function WordRetestTaskRow({
  task,
  mode,
  completionBlockers,
  onOpen,
  onEdit,
  onStatusChange,
  onComplete,
  onRetry,
  scoreDraft,
  onScoreDraftChange,
  onScoreSave,
  statusActionDisabled,
  selected,
  selectable,
  onSelectTask,
  gridTemplateColumns,
}: {
  task: OpsTask
  mode: WordRetestMode
  completionBlockers: string[]
  onOpen: (task: OpsTask) => void
  onEdit: (task: OpsTask, blockers?: string[]) => void
  onStatusChange: (task: OpsTask, status: OpsTaskStatus) => void
  onComplete: (task: OpsTask) => void
  onRetry: (task: OpsTask) => void
  scoreDraft?: WordRetestScoreDraft
  onScoreDraftChange: (task: OpsTask, key: keyof WordRetestScoreDraft, value: string) => void
  onScoreSave: (task: OpsTask) => void
  statusActionDisabled: boolean
  selected: boolean
  selectable: boolean
  onSelectTask: (task: OpsTask, selected: boolean) => void
  gridTemplateColumns: string
}) {
  const wordRetest = task.wordRetest || {}
  const primaryActions = getWordRetestPrimaryActions(task, mode, completionBlockers)
  const branch = getWordRetestBranch(task)
  const teacherLabel = getWordRetestTeacherLabel(task)
  const classLabel = getWordRetestClassLabel(task)
  const studentLabel = getWordRetestStudentLabel(task)
  const textbookLabel = getWordRetestTextbookLabel(task)
  const unitLabel = getWordRetestUnitLabel(task)
  const absent = isWordRetestAbsent(wordRetest)
  const resolvedScoreDraft = scoreDraft || getWordRetestScoreDraft(task)
  const scorePreviewWordRetest = { ...wordRetest, ...resolvedScoreDraft }

  return (
    <div
      onClick={(event) => {
        if (shouldIgnoreWordRetestRowOpen(event.target)) return
        onOpen(task)
      }}
      className="grid cursor-pointer gap-2 border-b px-3 py-3 text-sm last:border-b-0 hover:bg-muted/35 md:min-w-max md:items-center md:gap-3 md:[grid-template-columns:var(--word-retest-grid-template)]"
      style={{ "--word-retest-grid-template": gridTemplateColumns } as CSSProperties}
    >
      <span className="order-first flex min-w-0 items-center md:order-none md:justify-center">
        <input
          type="checkbox"
          aria-label={`${studentLabel} 단어 재시험 선택`}
          checked={selected}
          disabled={!selectable || statusActionDisabled}
          onChange={(event) => onSelectTask(task, event.target.checked)}
          onClick={(event) => event.stopPropagation()}
          className="size-4 rounded border-border text-primary"
        />
      </span>
      <span className="order-1 min-w-0 md:order-none">
        <span className="mr-2 text-xs text-muted-foreground md:hidden">진행상태</span>
        <WordRetestStatusBadge value={wordRetest.retestStatus} taskStatus={task.status} wordRetest={wordRetest} />
      </span>
      <span className="order-5 min-w-0 md:order-none">
        <span className="mr-2 text-xs text-muted-foreground md:hidden">본시험일</span>
        <span className="font-medium">{dateOnlyLabel(wordRetest.testAt || task.dueAt || "")}</span>
      </span>
      <span className="order-6 min-w-0 md:hidden">
        <span className="mr-2 text-xs text-muted-foreground">장소</span>
        <Badge variant="secondary">{branch}</Badge>
      </span>
      <span className="order-2 min-w-0 truncate font-medium md:order-none">
        <span className="mr-2 text-xs font-normal text-muted-foreground md:hidden">담당선생님</span>
        {teacherLabel}
      </span>
      <span className="order-3 min-w-0 truncate md:order-none">
        <span className="mr-2 text-xs text-muted-foreground md:hidden">수업</span>
        {classLabel}
      </span>
      <button
        type="button"
        aria-label={`${studentLabel} 단어 재시험 수정`}
        onClick={() => onOpen(task)}
        className="order-4 min-w-0 truncate text-left font-semibold hover:text-primary md:order-none"
      >
        <span className="mr-2 text-xs font-normal text-muted-foreground md:hidden">학생</span>
        {studentLabel}
      </button>
      <span className="group relative order-7 min-w-0 truncate md:order-none">
        <span className="mr-2 text-xs text-muted-foreground md:hidden">교재</span>
        <span tabIndex={0} title={textbookLabel} className="outline-none focus-visible:text-primary">
          {textbookLabel}
        </span>
        {textbookLabel !== "미지정" && (
          <span className="pointer-events-none absolute left-0 top-full z-50 mt-1 hidden max-w-sm whitespace-normal rounded-md border bg-popover px-2 py-1.5 text-xs font-medium text-popover-foreground shadow-lg group-hover:block group-focus-within:block">
            {textbookLabel}
          </span>
        )}
      </span>
      <span className="order-8 min-w-0 truncate text-muted-foreground md:order-none md:text-foreground">
        <span className="mr-2 text-xs text-muted-foreground md:hidden">시험범위</span>
        {unitLabel}
      </span>
      <span className="order-9 min-w-0 font-medium md:order-none">
        <span className="mr-2 text-xs font-normal text-muted-foreground md:hidden">출제 개수</span>
        {wordRetest.totalQuestionCount || "-"}
      </span>
      <span className="order-10 min-w-0 font-medium md:order-none">
        <span className="mr-2 text-xs font-normal text-muted-foreground md:hidden">커트라인</span>
        {wordRetest.cutoffQuestionCount || "-"}
      </span>
      <span className="order-11 min-w-0 md:order-none">
        <span className="mr-2 text-xs text-muted-foreground md:hidden">맞은 개수</span>
        <WordRetestInlineScoreEditor
          task={task}
          draft={resolvedScoreDraft}
          disabled={statusActionDisabled || absent || isClosedOpsTask(task)}
          onDraftChange={onScoreDraftChange}
          onSave={onScoreSave}
        />
      </span>
      <span className="order-12 min-w-0 md:order-none">
        <span className="mr-2 text-xs text-muted-foreground md:hidden">결과</span>
        <WordRetestScoreResultCell wordRetest={scorePreviewWordRetest} />
      </span>
      <span className="order-last flex flex-wrap justify-start gap-1.5 md:order-none md:justify-end">
        <span className="mr-2 text-xs text-muted-foreground md:hidden">다음 액션</span>
        {primaryActions.map((action) => (
          <WordRetestRoleActionButton
            key={`${action.kind}-${action.label}`}
            task={task}
            action={action}
            onEdit={onEdit}
            onStatusChange={onStatusChange}
            onComplete={onComplete}
            onRetry={onRetry}
            disabled={statusActionDisabled}
          />
        ))}
      </span>
    </div>
  )
})

function WordRetestRoleActionButton({
  task,
  action,
  onEdit,
  onStatusChange,
  onComplete,
  onRetry,
  disabled,
}: {
  task: OpsTask
  action: WordRetestPrimaryAction | null
  onEdit: (task: OpsTask, blockers?: string[]) => void
  onStatusChange: (task: OpsTask, status: OpsTaskStatus) => void
  onComplete: (task: OpsTask) => void
  onRetry: (task: OpsTask) => void
  disabled: boolean
}) {
  if (!action) return null

  return (
    <Button
      type="button"
      variant={(action.kind === "status" && action.status === "done") || action.kind === "word_retest_complete" ? "default" : "outline"}
      size="sm"
      onClick={() => {
        if (action.kind === "edit") {
          onEdit(task, action.blockers || [])
          return
        }
        if (action.kind === "word_retest_complete") {
          onComplete(task)
          return
        }
        if (action.kind === "word_retest_retry") {
          onRetry(task)
          return
        }
        onStatusChange(task, action.status)
      }}
      disabled={disabled}
    >
      {action.label}
    </Button>
  )
}

function noopTodoSortChange() {}

function TodoSortableHeaderButton({
  column,
  sortKey,
  onSortChange,
}: {
  column: { key: TodoSortKey; label: string }
  sortKey: TodoSortKey
  onSortChange: () => void
}) {
  const selected = sortKey === column.key
  const ariaSort = selected ? "ascending" : "none"

  return (
    <span role="columnheader" aria-sort={ariaSort} className="min-w-0">
      <button
        type="button"
        aria-pressed={selected}
        aria-label={`${column.label} 정렬`}
        onClick={onSortChange}
        className={[
          "inline-flex min-w-0 items-center gap-1 rounded px-1 py-0.5 text-left font-medium transition",
          selected ? "text-foreground" : "text-muted-foreground hover:bg-background hover:text-foreground",
        ].join(" ")}
      >
        <span className="truncate">{column.label}</span>
        <ChevronRight className={["size-3.5 shrink-0 transition-transform", selected ? "rotate-90" : ""].join(" ")} />
      </button>
    </span>
  )
}

function TaskListRow({
  task,
  todayKey,
  onOpen,
  onEdit,
  onStatusChange,
  onRegistrationPipelineAdvance,
  statusActionDisabled,
  showType,
  todoControls,
  showOperationColumns,
  completionBlockers,
}: {
  task: OpsTask
  todayKey: string
  onOpen: (task: OpsTask) => void
  onEdit: (task: OpsTask, blockers?: string[]) => void
  onStatusChange: (task: OpsTask, status: OpsTaskStatus) => void
  onRegistrationPipelineAdvance: (task: OpsTask, pipelineStatus: string) => void
  statusActionDisabled: boolean
  showType: boolean
  todoControls: boolean
  showOperationColumns: boolean
  completionBlockers: string[]
}) {
  const nextAction = getNextTaskStatusAction(task)
  const nextRegistrationAction = getNextRegistrationPipelineAction(task)
  const primaryOperationAction = nextRegistrationAction || nextAction
  const nextActionBlocked = nextAction?.status === "done" && completionBlockers.length > 0
  const primaryOperationActionBlocked = nextRegistrationAction
    ? nextRegistrationAction.pipelineStatus.startsWith("7.") && completionBlockers.length > 0
    : nextActionBlocked
  const isTodoRow = todoControls && task.type === "general"
  const isOperationRow = task.type !== "general"
  const blockedActionLabel = getCompletionBlockerActionLabel(completionBlockers)
  const organizationFixes = getTaskOrganizationFixes(task)
  const needsAssigneeFix = organizationFixes.includes("담당 지정")
  const needsScheduleFix = organizationFixes.includes("예정 지정")
  const gridClass = showType
    ? "md:grid-cols-[88px_88px_minmax(220px,1fr)_120px_120px_120px_150px]"
    : isOperationRow
      ? "md:grid-cols-[88px_minmax(220px,1fr)_120px_120px_120px_150px]"
      : "md:grid-cols-[88px_140px_minmax(220px,1fr)_150px_150px_96px_120px]"
  const taskMeta = [task.subject, task.campus, task.className, task.textbookTitle].filter(Boolean).join(" · ")
  const todoRequesterLabel = [task.requestedByLabel || "미지정", task.requestedTeam || "미지정"].join(" / ")
  const todoAssigneeLabel = [task.assigneeLabel || "미지정", task.assigneeTeam || "미지정"].join(" / ")

  if (isTodoRow) {
    return (
      <div
        className={`grid grid-cols-[auto_minmax(0,1fr)] gap-2 border-b px-3 py-3 text-sm transition-colors [contain-intrinsic-size:72px] [content-visibility:auto] last:border-b-0 hover:bg-muted/40 md:items-center md:gap-0 ${gridClass}`}
      >
        <span className="hidden md:block">
          <TodoPriorityBadge priority={task.priority} showNormal />
        </span>
        <span className="hidden text-muted-foreground md:block">
          <TodoDateSummary task={task} />
        </span>
        <button
          type="button"
          aria-label={`${task.title} 상세 보기`}
          onClick={() => onOpen(task)}
          className="min-w-0 text-left hover:text-primary md:col-auto"
        >
          <span className="flex min-w-0 items-center gap-2">
            <span
              className={[
                "truncate font-semibold",
                isClosedOpsTask(task) ? "text-muted-foreground line-through" : "",
              ].filter(Boolean).join(" ")}
            >
              {task.title}
            </span>
            <AutoSyncInlineBadge task={task} />
          </span>
          {taskMeta && <span className="block truncate text-xs text-muted-foreground">{taskMeta}</span>}
          <span className="mt-1 flex flex-wrap gap-1.5 text-xs text-muted-foreground md:hidden">
            <span>요청 {todoRequesterLabel}</span>
            <span>담당 {todoAssigneeLabel}</span>
            <span className="inline-flex min-w-0 items-start gap-1">
              <span>시작/마감</span>
              <TodoDateSummary task={task} />
            </span>
            <span>상태 {getTaskStatusLabel(task.status)}</span>
            <span>다음 액션 {getTodoActionLabel(task)}</span>
          </span>
        </button>
        <span className="hidden min-w-0 text-muted-foreground md:block">
          <span className="truncate">{todoRequesterLabel}</span>
        </span>
        <span className="hidden min-w-0 text-muted-foreground md:block">
          <span className="truncate">{todoAssigneeLabel}</span>
        </span>
        <span className="hidden md:block">
          <TaskStatusBadge status={task.status} />
        </span>
        <span className="col-span-full flex justify-start md:col-auto md:justify-end">
          {nextAction && (
            <Button
              type="button"
              variant={nextAction.status === "done" ? "default" : "outline"}
              size="sm"
              className="w-full sm:w-auto"
              onClick={() => onStatusChange(task, nextAction.status)}
              disabled={statusActionDisabled}
            >
              {nextAction.label}
            </Button>
          )}
        </span>
      </div>
    )
  }

  return (
    <div
      className={`grid grid-cols-[auto_minmax(0,1fr)] gap-2 border-b px-3 py-3 text-sm transition-colors [contain-intrinsic-size:72px] [content-visibility:auto] last:border-b-0 hover:bg-muted/40 md:items-center md:gap-0 ${gridClass}`}
    >
      <span className="row-start-1">
        <TaskStatusBadge status={task.status} />
      </span>
      {showType && <span><TaskTypeBadge type={task.type} /></span>}
      {isTodoRow && (
        <span className="hidden md:block">
          <TodoPriorityBadge priority={task.priority} showNormal />
        </span>
      )}
      <button
        type="button"
        aria-label={`${task.title} 상세 보기`}
        onClick={() => onOpen(task)}
        className="min-w-0 text-left hover:text-primary md:col-auto"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span
            className={[
              "truncate font-semibold",
              isTodoRow && isClosedOpsTask(task) ? "text-muted-foreground line-through" : "",
            ].filter(Boolean).join(" ")}
          >
            {task.title}
          </span>
          <AutoSyncInlineBadge task={task} />
        </span>
        {taskMeta && <span className="block truncate text-xs text-muted-foreground">{taskMeta}</span>}
        {isTodoRow && (
          <span className="mt-1 flex flex-wrap gap-1.5 text-xs text-muted-foreground md:hidden">
            <span>요청 {todoRequesterLabel}</span>
            <span>담당 {todoAssigneeLabel}</span>
            <span className="inline-flex min-w-0 items-start gap-1">
              <span>시작/마감</span>
              <TodoDateSummary task={task} />
            </span>
            <span>다음 액션 {getTodoActionLabel(task)}</span>
          </span>
        )}
      </button>
      {isTodoRow && (
        <span className="hidden min-w-0 text-muted-foreground md:block">
          <span className="truncate">{todoRequesterLabel}</span>
        </span>
      )}
      <span className={[isTodoRow ? "hidden md:block" : "", isOperationRow ? "col-span-full md:col-auto" : "", "min-w-0 text-muted-foreground md:text-foreground"].filter(Boolean).join(" ")}>
        {isOperationRow && <span className="mr-2 text-xs text-muted-foreground md:hidden">담당:</span>}
        {isOperationRow && needsAssigneeFix ? (
          <button
            type="button"
            onClick={() => onEdit(task)}
            aria-label={`${task.title}: 담당 지정`}
            className="inline-flex min-h-7 items-center rounded-full border bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
          >
            담당 지정
          </button>
        ) : (
          <span className="truncate">{isTodoRow ? todoAssigneeLabel : task.assigneeLabel || "미지정"}</span>
        )}
      </span>
      {showOperationColumns && !isOperationRow && <span className="hidden md:block" />}
      {isOperationRow && (
        <span className="col-span-full truncate text-muted-foreground md:col-auto md:text-foreground">
          <span className="mr-2 text-xs text-muted-foreground md:hidden">학생:</span>
          {task.studentName || "미지정"}
        </span>
      )}
      <span className={[isTodoRow ? "hidden md:block" : "", isOperationRow ? "col-span-full md:col-auto" : "", "text-muted-foreground md:text-foreground"].filter(Boolean).join(" ")}>
        {isOperationRow && <span className="mr-2 text-xs text-muted-foreground md:hidden">예정:</span>}
        {isOperationRow && needsScheduleFix ? (
          <button
            type="button"
            onClick={() => onEdit(task)}
            aria-label={`${task.title}: 예정 지정`}
            className="inline-flex min-h-7 items-center rounded-full border bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
          >
            예정 지정
          </button>
        ) : (
          isTodoRow ? <TodoDateSummary task={task} /> : <TaskScheduleLabel task={task} todayKey={todayKey} />
        )}
      </span>
      {isTodoRow && (
        <span className="col-span-full flex justify-start md:col-auto md:justify-end">
          {nextAction && (
            <Button
              type="button"
              variant={nextAction.status === "done" ? "default" : "outline"}
              size="sm"
              className="w-full sm:w-auto"
              onClick={() => onStatusChange(task, nextAction.status)}
              disabled={statusActionDisabled}
            >
              {nextAction.label}
            </Button>
          )}
        </span>
      )}
      {isOperationRow && (
        <span className="col-span-full flex flex-wrap justify-start gap-1.5 md:col-auto md:justify-end">
          {primaryOperationAction && (
            <Button
              type="button"
              variant={primaryOperationActionBlocked ? "outline" : "default"}
              size="sm"
              aria-label={`${task.title}: ${primaryOperationActionBlocked ? blockedActionLabel : primaryOperationAction.label}`}
              title={primaryOperationActionBlocked ? `${completionBlockers.join(", ")} 연결 필요` : undefined}
              onClick={() => {
                if (nextRegistrationAction) {
                  if (primaryOperationActionBlocked) {
                    onEdit(task, completionBlockers)
                    return
                  }
                  onRegistrationPipelineAdvance(task, nextRegistrationAction.pipelineStatus)
                  return
                }
                if (completionBlockers.length > 0 && nextAction?.status === "done") {
                  onEdit(task, completionBlockers)
                  return
                }
                if (nextAction) onStatusChange(task, nextAction.status)
              }}
              disabled={statusActionDisabled}
            >
              {primaryOperationActionBlocked ? <span>{blockedActionLabel}</span> : null}
              <span className={primaryOperationActionBlocked ? "hidden" : "contents"}>
                {primaryOperationActionBlocked ? "연결 필요" : primaryOperationAction.label}
              </span>
            </Button>
          )}
          {canEditTaskDetails(task) && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label={`${task.title} 수정`}
              onClick={() => onEdit(task)}
            >
              수정
            </Button>
          )}
        </span>
      )}
      {showOperationColumns && !isOperationRow && <span className="hidden md:block md:justify-self-end" />}
      {isOperationRow && primaryOperationActionBlocked && (
        <CompletionBlockerInlineChips
          task={task}
          blockers={completionBlockers}
          onSelect={(blocker) => onEdit(task, [blocker])}
          className="md:col-span-full md:pl-0"
          tone="destructive"
          showNeed
        />
      )}
    </div>
  )
}

function GroupedTaskList({
  groups,
  todayKey,
  onOpen,
  onEdit,
  onStatusChange,
  onRegistrationPipelineAdvance,
  statusActionDisabled = false,
  onCreate,
  emptyLabel = "업무 없음",
  emptyActionLabel,
  showEmptyAction = true,
  showType = true,
  completionBlockersByTaskId = EMPTY_COMPLETION_BLOCKERS_BY_TASK_ID,
}: {
  groups: Array<{ key: string; label: string; tasks: OpsTask[] }>
  todayKey: string
  onOpen: (task: OpsTask) => void
  onEdit: (task: OpsTask, blockers?: string[]) => void
  onStatusChange: (task: OpsTask, status: OpsTaskStatus) => void
  onRegistrationPipelineAdvance: (task: OpsTask, pipelineStatus: string) => void
  statusActionDisabled?: boolean
  onCreate: () => void
  emptyLabel?: string
  emptyActionLabel?: string
  showEmptyAction?: boolean
  showType?: boolean
  completionBlockersByTaskId?: OperationCompletionBlockerMap
}) {
  if (groups.length === 0) {
    return (
      <EmptyTaskState
        icon={<Inbox className="size-5" />}
        label={emptyLabel}
        actionLabel={emptyActionLabel}
        showAction={showEmptyAction}
        onCreate={onCreate}
      />
    )
  }

  return (
    <div className="grid gap-3">
      {groups.map((group) => (
        <section key={group.key} className="overflow-hidden rounded-md border">
          <div className="flex items-center justify-between border-b bg-muted/50 px-3 py-2">
            <h3 className="text-sm font-semibold">{group.label}</h3>
            <Badge variant="outline">{group.tasks.length}건</Badge>
          </div>
          <TaskList
            tasks={group.tasks}
            todayKey={todayKey}
            onOpen={onOpen}
            onEdit={onEdit}
            onStatusChange={onStatusChange}
            onRegistrationPipelineAdvance={onRegistrationPipelineAdvance}
            statusActionDisabled={statusActionDisabled}
            onCreate={onCreate}
            showType={showType}
            completionBlockersByTaskId={completionBlockersByTaskId}
          />
        </section>
      ))}
    </div>
  )
}

function loadCalendarRows(tasks: OpsTask[]) {
  return getOpsTaskCalendarItems(tasks)
}

function getCalendarDateState(date: string, todayKey: string) {
  if (date < todayKey) return "overdue"
  if (date === todayKey) return "today"
  return "upcoming"
}

function sortCalendarDatesForWork(dates: string[], todayKey: string) {
  return [...dates].sort((a, b) => {
    if (a === todayKey) return -1
    if (b === todayKey) return 1
    if (a < todayKey && b < todayKey) return b.localeCompare(a)
    if (a < todayKey) return -1
    if (b < todayKey) return 1
    return a.localeCompare(b)
  })
}

function getCalendarTaskContext(task?: OpsTask) {
  if (!task) return []

  return ([
    ["학생", task.studentName],
    ["수업", task.className],
    ["담당", task.assigneeLabel],
  ] as Array<[string, string | undefined]>)
    .map(([label, value]) => [label, String(value || "").trim()] as [string, string])
    .filter(([, value]) => value.length > 0)
}

function CalendarList({
  items,
  tasks,
  todayKey,
  onOpen,
  onEdit,
  onStatusChange,
  onRegistrationPipelineAdvance,
  statusActionDisabled,
  onCreate,
  emptyLabel = "일정 없음",
  emptyActionLabel,
  showEmptyAction = true,
  completionBlockersByTaskId = EMPTY_COMPLETION_BLOCKERS_BY_TASK_ID,
}: {
  items: Array<{ id: string; taskId: string; title: string; kind: string; date: string; status: string; taskType: string }>
  tasks: OpsTask[]
  todayKey: string
  onOpen: (task: OpsTask) => void
  onEdit: (task: OpsTask, blockers?: string[]) => void
  onStatusChange: (task: OpsTask, status: OpsTaskStatus) => void
  onRegistrationPipelineAdvance: (task: OpsTask, pipelineStatus: string) => void
  statusActionDisabled: boolean
  onCreate: () => void
  emptyLabel?: string
  emptyActionLabel?: string
  showEmptyAction?: boolean
  completionBlockersByTaskId?: OperationCompletionBlockerMap
}) {
  const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks])
  const grouped = items.reduce<Record<string, typeof items>>((accumulator, item) => {
    accumulator[item.date] = [...(accumulator[item.date] || []), item]
    return accumulator
  }, {})
  const dates = sortCalendarDatesForWork(Object.keys(grouped), todayKey)

  if (dates.length === 0) {
    return (
      <EmptyTaskState
        icon={<CalendarDays className="size-5" />}
        label={emptyLabel}
        actionLabel={emptyActionLabel}
        showAction={showEmptyAction}
        onCreate={onCreate}
      />
    )
  }

  return (
    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
      {dates.map((date) => {
        const dateState = getCalendarDateState(date, todayKey)

        return (
        <section
          key={date}
          className={[
            "rounded-md border p-3",
            dateState === "overdue"
              ? "border-destructive/30 bg-destructive/5"
              : dateState === "today"
                ? "border-primary/30 bg-primary/5"
                : "",
          ].filter(Boolean).join(" ")}
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">{date}</h3>
            <Badge variant={dateState === "overdue" ? "destructive" : dateState === "today" ? "default" : "outline"}>
              {dateState === "today" ? "오늘" : dateState === "overdue" ? "지연" : "예정"}
            </Badge>
          </div>
          <div className="flex flex-col gap-2">
            {grouped[date].map((item) => {
              const task = taskById.get(item.taskId)
              const closed = isClosedOpsTask(task || { status: item.status as OpsTaskStatus })
              const calendarTaskContext = getCalendarTaskContext(task)
              const nextAction = task ? getNextTaskStatusAction(task) : null
              const nextRegistrationAction = task ? getNextRegistrationPipelineAction(task) : null
              const primaryCalendarAction = nextRegistrationAction || nextAction
              const completionBlockers = task ? completionBlockersByTaskId.get(task.id) || EMPTY_COMPLETION_BLOCKERS : EMPTY_COMPLETION_BLOCKERS
              const nextActionBlocked = nextAction?.status === "done" && completionBlockers.length > 0
              const primaryCalendarActionBlocked = nextRegistrationAction
                ? nextRegistrationAction.pipelineStatus.startsWith("7.") && completionBlockers.length > 0
                : nextActionBlocked
              const blockedActionLabel = getCompletionBlockerActionLabel(completionBlockers)

              return (
                <div
                  key={item.id}
                  className={[
                    "grid w-full gap-2 rounded-md bg-muted px-3 py-2 text-sm hover:bg-primary/10 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center",
                    closed ? "opacity-50" : "",
                  ].join(" ")}
                >
                  <button
                    type="button"
                    onClick={() => task && onOpen(task)}
                    className="min-w-0 text-left"
                  >
                    <span className="block truncate font-medium">{item.title}</span>
                    <span className="text-xs text-muted-foreground">{item.kind} · {getTaskTypeLabel(item.taskType)}</span>
                    {calendarTaskContext.length > 0 && (
                      <span className="mt-1 flex flex-wrap gap-1">
                        {calendarTaskContext.map(([label, value]) => (
                          <span key={`${item.id}-${label}`} className="inline-flex max-w-full items-center gap-1 rounded bg-background/75 px-1.5 py-0.5 text-[11px] text-muted-foreground">
                            <span className="shrink-0">{label}</span>
                            <span className="truncate font-medium text-foreground">{value}</span>
                          </span>
                        ))}
                      </span>
                    )}
                  </button>
                  <span className="flex items-center gap-2 sm:justify-end">
                    <TaskStatusBadge status={item.status as OpsTaskStatus} />
                    {primaryCalendarAction && (
                      <Button
                        type="button"
                        variant={primaryCalendarActionBlocked ? "outline" : "secondary"}
                        size="sm"
                        disabled={statusActionDisabled}
                        className="h-8 flex-1 px-2 sm:flex-none"
                        onClick={() => {
                          if (!task || !primaryCalendarAction) return
                          if (primaryCalendarActionBlocked) {
                            onEdit(task, completionBlockers)
                            return
                          }
                          if (nextRegistrationAction) {
                            onRegistrationPipelineAdvance(task, nextRegistrationAction.pipelineStatus)
                            return
                          }
                          if (nextAction) onStatusChange(task, nextAction.status)
                        }}
                      >
                        {primaryCalendarActionBlocked ? blockedActionLabel : primaryCalendarAction.label}
                      </Button>
                    )}
                  </span>
                  {primaryCalendarActionBlocked && (
                    <CompletionBlockerInlineChips
                      task={{ id: item.id, title: item.title }}
                      blockers={completionBlockers}
                      onSelect={(blocker) => task && onEdit(task, [blocker])}
                      className="sm:col-span-2"
                      tone="destructive"
                      showNeed
                    />
                  )}
                </div>
              )
            })}
          </div>
        </section>
        )
      })}
    </div>
  )
}

function CompletionBlockerActionPanel({
  task,
  blockers,
  onSelect,
}: {
  task: Pick<OpsTask, "title">
  blockers: string[]
  onSelect: (blocker: string) => void
}) {
  if (blockers.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-sm" role="group" aria-label="완료 전 필요한 입력">
      {blockers.map((blocker) => (
        <button
          key={blocker}
          type="button"
          onClick={() => onSelect(blocker)}
          aria-label={`${task.title}: ${blocker} ${getCompletionBlockerNeedLabel(blocker)} 해결하러 가기`}
          className="inline-flex min-h-8 items-center rounded-md border bg-background px-2.5 py-1 text-xs font-medium text-foreground shadow-xs transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {getCompletionBlockerActionLabel([blocker])}
        </button>
      ))}
    </div>
  )
}

function CompletionBlockerInlineChips({
  task,
  blockers,
  onSelect,
  className = "",
  tone = "default",
  showNeed = false,
}: {
  task: Pick<OpsTask, "id" | "title">
  blockers: string[]
  onSelect: (blocker: string) => void
  className?: string
  tone?: "default" | "destructive"
  showNeed?: boolean
}) {
  if (blockers.length === 0) return null

  const toneClass = tone === "destructive"
    ? "border-destructive/25 text-destructive hover:bg-destructive/10"
    : "text-muted-foreground hover:border-primary/40 hover:bg-primary/5 hover:text-primary"

  return (
    <span className={["flex flex-wrap gap-1", className].filter(Boolean).join(" ")}>
      {blockers.map((blocker) => {
        const needLabel = getCompletionBlockerNeedLabel(blocker)
        return (
          <button
            key={`${task.id}-${blocker}`}
            type="button"
            onClick={() => onSelect(blocker)}
            aria-label={`${task.title}: ${blocker} ${needLabel} 해결하러 가기`}
            className={[
              "inline-flex min-h-7 items-center rounded-full border bg-background px-2 py-0.5 text-[11px] font-medium transition-colors",
              toneClass,
            ].join(" ")}
          >
            {getCompletionBlockerActionLabel([blocker])}
            {showNeed && <span className="ml-1 text-current/70">{needLabel}</span>}
          </button>
        )
      })}
    </span>
  )
}

function AutoSyncResultSummary({ task }: { task: OpsTask }) {
  const autoSyncedEvents = getAutoSyncedEvents(task)
  if (autoSyncedEvents.length === 0) return null

  return (
    <section className="grid gap-2 rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-primary">반영 완료</span>
        <Badge variant="secondary">자동 {autoSyncedEvents.length}</Badge>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {autoSyncedEvents.map((event) => (
          <span
            key={event.id}
            className="inline-flex min-w-0 items-center gap-1.5 rounded-md border bg-background px-2 py-1"
          >
            <Check className="size-3.5 shrink-0 text-primary" />
            <span className="shrink-0 text-muted-foreground">{event.fieldName}</span>
            <span className="min-w-0 truncate font-medium">{event.afterValue}</span>
          </span>
        ))}
      </div>
    </section>
  )
}

function DetailInfoTile({ label, value, children }: { label: string; value?: string; children?: ReactNode }) {
  return (
    <div className="grid min-w-0 gap-1.5 rounded-md border bg-muted/20 px-3 py-2 text-sm">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="min-w-0 font-medium text-foreground">
        {children || <span className="block truncate">{value || "미지정"}</span>}
      </dd>
    </div>
  )
}

function GeneralTaskDetailPanel({ task }: { task: OpsTask }) {
  return (
    <dl className="grid gap-3">
      <div className="grid gap-3 md:grid-cols-[160px_minmax(0,1fr)]">
        <DetailInfoTile label="우선순위">
          <TodoPriorityBadge priority={task.priority} showNormal />
        </DetailInfoTile>
        <DetailInfoTile label="제목" value={task.title} />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <DetailInfoTile label="담당팀" value={task.assigneeTeam || "미지정"} />
        <DetailInfoTile label="담당자" value={task.assigneeLabel || "미지정"} />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <DetailInfoTile label="시작일" value={dateLabel(task.startAt) === "-" ? "미지정" : dateLabel(task.startAt)} />
        <DetailInfoTile label="마감일" value={dateLabel(task.dueAt) === "-" ? "미지정" : dateLabel(task.dueAt)} />
      </div>
      <DetailInfoTile label="메모" value={task.memo || "미입력"} />
      <div className="grid gap-3 border-t pt-3 md:grid-cols-3">
        <DetailInfoTile label="요청팀" value={task.requestedTeam || "미지정"} />
        <DetailInfoTile label="요청자" value={task.requestedByLabel || "미지정"} />
        <DetailInfoTile label="요청일시" value={dateLabel(task.createdAt)} />
      </div>
      {shouldShowDetailStatusBadge(task) && (
        <div className="flex flex-wrap gap-2">
          <TaskStatusBadge status={task.status} />
        </div>
      )}
    </dl>
  )
}

function WordRetestDetailPanel({ task }: { task: OpsTask }) {
  const wordRetest = task.wordRetest || {}
  const requestNote = wordRetest.requestNote || task.memo || ""

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <TaskTypeBadge type={task.type} />
        <WordRetestStatusBadge value={wordRetest.retestStatus} taskStatus={task.status} wordRetest={wordRetest} />
        <Badge variant="outline">{getWordRetestBranch(task)}</Badge>
        <Badge variant="secondary">{getWordRetestTeacherLabel(task)}</Badge>
        <Badge variant="secondary">{getWordRetestClassLabel(task)}</Badge>
      </div>
      <WordRetestProgressStepper value={wordRetest.retestStatus || "not_started"} taskStatus={task.status} wordRetest={wordRetest} />
      <dl className="grid gap-3 md:grid-cols-2">
        <DetailInfoTile label="본시험일" value={dateOnlyLabel(wordRetest.testAt || task.dueAt || "") === "-" ? "미지정" : dateOnlyLabel(wordRetest.testAt || task.dueAt || "")} />
        <DetailInfoTile label="학생" value={getWordRetestStudentLabel(task)} />
        <DetailInfoTile label="교재" value={getWordRetestTextbookLabel(task)} />
        <DetailInfoTile label="시험범위" value={getWordRetestUnitLabel(task)} />
        <DetailInfoTile label="점수" value={getWordRetestScoreSummary(task)} />
        <DetailInfoTile label="점수 기준" value={[
          wordRetest.totalQuestionCount ? `출제 ${wordRetest.totalQuestionCount}개` : "",
          wordRetest.cutoffQuestionCount ? `커트라인 ${wordRetest.cutoffQuestionCount}개` : "",
        ].filter(Boolean).join(" · ") || "미지정"} />
        <DetailInfoTile label="운영상태">
          <TaskStatusBadge status={task.status} />
        </DetailInfoTile>
      </dl>
      {requestNote && (
        <DetailInfoTile label="메모" value={requestNote} />
      )}
    </div>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-medium">{value || "-"}</dd>
    </div>
  )
}

function OptionalInfo({ label, value }: { label: string; value?: string | boolean }) {
  if (value === undefined || value === null || value === "" || value === false) return null
  return <Info label={label} value={value === true ? "완료" : String(value)} />
}

function RegistrationExternalLinkInfo({ label, href }: { label: string; href?: string }) {
  if (!href) return null
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 min-w-0 font-medium">
        <a href={href} target="_blank" rel="noreferrer" className="block truncate text-primary underline-offset-4 hover:underline">
          {href}
        </a>
      </dd>
    </div>
  )
}

function RegistrationDetailPanel({ task, selectedTrackId }: { task: OpsTask; selectedTrackId?: string | null }) {
  const registration = task.registration || {}
  const selectedTrack = task.registrationTracks?.find((track) => track.id === selectedTrackId) || null
  const completedAt = dateLabel(task.completedAt)
  const pipelineStatus = registration.pipelineStatus || REGISTRATION_PIPELINE_STATUSES[0]?.value || "0. 등록 문의"
  const reachedSections = getRegistrationMobileSections(pipelineStatus, getRegistrationMobileSectionData(task, registration))
  const hasLevelTestDetail = Boolean(
    registration.levelTestAt || registration.levelTestPlace || registration.levelTestCompletedAt || registration.levelTestResult || registration.levelTestMaterialLink,
  )
  const hasConsultationDetail = Boolean(
    registration.phoneConsultationAt || registration.visitConsultationAt || registration.visitConsultationPlace || registration.consultationAt || registration.counselor,
  )
  const hasPlacementDetail = Boolean(
    task.classId || task.className || task.textbookId || task.textbookTitle || registration.classStartDate || registration.classStartSession || registration.requestNote,
  )
  const hasAdmissionDetail = Boolean(
    registration.admissionNoticeSent || registration.makeeduRegistered || registration.makeeduInvoiceSent || registration.paymentChecked,
  )
  const showLevelTestDetail = reachedSections.includes("level_test") && hasLevelTestDetail
  const showConsultationDetail = reachedSections.includes("consultation") && hasConsultationDetail
  const showPlacementDetail = reachedSections.includes("placement") || hasPlacementDetail
  const showAdmissionDetail = reachedSections.includes("admission") || hasAdmissionDetail

  return (
    <section className="grid gap-4" aria-label="등록 상세 신청서">
      <div className="flex flex-wrap items-center gap-2">
        <RegistrationWorkflowStatusBadge task={task} />
        <Badge variant="outline">{selectedTrack ? `${selectedTrack.subject} 과목별 흐름` : task.subject || "과목 미정"}</Badge>
        {selectedTrack?.directorName ? <Badge variant="secondary">상담 {selectedTrack.directorName}</Badge> : null}
        <span className="text-sm font-semibold">{task.studentName || "학생 미정"}</span>
      </div>

      <section className="grid gap-3 rounded-md border p-3" aria-label="문의 정보">
        <h3 className="text-sm font-semibold">문의 정보</h3>
        <dl className="grid gap-3 text-sm md:grid-cols-2">
          <Info label="학생" value={task.studentName || "미지정"} />
          <Info label="학년" value={registration.schoolGrade || "미정"} />
          <Info label="학교" value={registration.schoolName || "미정"} />
          <Info label="학부모 전화" value={registration.parentPhone || "미정"} />
          <OptionalInfo label="학생 전화" value={registration.studentPhone} />
          <Info label="문의일시" value={dateLabel(registration.inquiryAt || "")} />
        </dl>
      </section>

      {showLevelTestDetail ? (
        <section className="grid gap-3 rounded-md border p-3" aria-label="레벨테스트 정보">
          <h3 className="text-sm font-semibold">레벨테스트</h3>
          <dl className="grid gap-3 text-sm md:grid-cols-2">
          <Info label="레벨테스트" value={dateLabel(registration.levelTestAt || "")} />
          <OptionalInfo label="레벨테스트 장소" value={registration.levelTestPlace} />
          <Info label="레벨테스트 완료일시" value={dateLabel(registration.levelTestCompletedAt || "")} />
          <OptionalInfo label="레벨테스트 결과" value={registration.levelTestResult} />
          <RegistrationExternalLinkInfo label="시험지·결과지 URL" href={registration.levelTestMaterialLink} />
          </dl>
        </section>
      ) : null}

      {showConsultationDetail ? (
        <section className="grid gap-3 rounded-md border p-3" aria-label="상담 정보">
          <h3 className="text-sm font-semibold">상담</h3>
          <dl className="grid gap-3 text-sm md:grid-cols-2">
          <Info label="상담 책임자" value={registration.counselor || task.assigneeLabel || "미정"} />
          <Info label="전화상담" value={dateLabel(registration.phoneConsultationAt || "")} />
          <Info label="방문상담" value={getRegistrationVisitConsultationLabel(task)} />
          <Info label="상담 완료일시" value={dateLabel(registration.consultationAt || "")} />
          </dl>
        </section>
      ) : null}

      {showPlacementDetail ? (
        <section className="grid gap-3 rounded-md border p-3" aria-label="등록·대기 정보">
          <h3 className="text-sm font-semibold">등록·대기 정보</h3>
          <dl className="grid gap-3 text-sm md:grid-cols-2">
          <Info label="수업" value={task.className || "미정"} />
          <Info label="교재" value={task.textbookTitle || "미정"} />
          <Info label="수업시작일" value={dateInputValue(registration.classStartDate) || "미정"} />
          <Info label="수업시작회차" value={registration.classStartSession || "미정"} />
          <OptionalInfo label="요청 사항" value={registration.requestNote} />
          </dl>
        </section>
      ) : null}

      {showAdmissionDetail ? (
        <section className="grid gap-3 rounded-md border p-3" aria-label="입학 처리 정보">
          <h3 className="text-sm font-semibold">입학 처리</h3>
          <RegistrationOperationsChecklistChips registration={registration} />
        </section>
      ) : null}

      <details className="group rounded-md border">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-3 text-sm font-semibold [&::-webkit-details-marker]:hidden">
          <span>신청 · 처리</span>
          <ChevronRight className="size-4 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden="true" />
        </summary>
        <dl className="grid gap-3 border-t px-3 py-3 text-sm md:grid-cols-2">
          <Info label="신청자" value={task.requestedByLabel || "관리팀"} />
          <Info label="신청일시" value={dateLabel(task.createdAt)} />
          <Info label="담당자" value={task.assigneeLabel || task.assigneeTeam || "관리팀"} />
          <Info label="완료일시" value={completedAt === "-" ? "미정" : completedAt} />
          <Info label="진행상태 원문" value={pipelineStatus} />
        </dl>
      </details>
    </section>
  )
}

function WithdrawalDetailPanel({ task }: { task: OpsTask }) {
  const withdrawal = task.withdrawal || {}
  const progress = getWithdrawalProgressLabel(task)
  const completedAt = dateLabel(task.completedAt)

  return (
    <section className="grid gap-4" aria-label="퇴원 상세 신청서">
      <div className="grid gap-3 rounded-md border p-3">
        <dl className="grid gap-3 text-sm md:grid-cols-2">
          <Info label="과목" value={task.subject || "미지정"} />
          <Info label="선생님" value={withdrawal.teacherName || task.assigneeLabel || "미지정"} />
          <Info label="수업" value={task.className || "미지정"} />
          <Info label="학생" value={task.studentName || "미지정"} />
          <OptionalInfo label="고객 퇴원사유" value={withdrawal.customerReason} />
          <OptionalInfo label="선생님 의견" value={withdrawal.teacherOpinion} />
          <Info label="미배부 교재" value={withdrawal.undistributedTextbooks || "-"} />
          <Info label="퇴원일" value={dateInputValue(withdrawal.withdrawalDate) || "미정"} />
          <Info label="퇴원회차" value={withdrawal.withdrawalSession || "미정"} />
          <Info label="진행 수업시수" value={withdrawal.completedLessonHours || "자동 계산"} />
          <Info label="4주 기준 수업시수" value={withdrawal.fourWeekLessonHours || "자동 계산"} />
          <Info label="수업진행률" value={progress === "-" ? "자동 계산" : progress} />
          <div className="md:col-span-2">
            <dt className="text-xs text-muted-foreground">처리 확인</dt>
            <dd className="mt-1">
              <WithdrawalOperationsChecklistChips withdrawal={withdrawal} />
            </dd>
          </div>
        </dl>
      </div>

      <details className="group rounded-md border">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-3 text-sm font-semibold [&::-webkit-details-marker]:hidden">
          <span>신청 · 처리</span>
          <ChevronRight className="size-4 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden="true" />
        </summary>
        <dl className="grid gap-3 border-t px-3 py-3 text-sm md:grid-cols-2">
          <Info label="신청자" value={task.requestedByLabel || "담당선생님"} />
          <Info label="신청일시" value={dateLabel(task.createdAt)} />
          <Info label="담당자" value={task.assigneeLabel || task.assigneeTeam || "관리팀"} />
          <Info label="완료일시" value={completedAt === "-" ? "미정" : completedAt} />
        </dl>
      </details>
    </section>
  )
}

function TransferDetailPanel({ task }: { task: OpsTask }) {
  const transfer = task.transfer || {}
  const completedAt = dateLabel(task.completedAt)

  return (
    <section className="grid gap-4" aria-label="전반 상세 신청서">
      <div className="grid gap-3 rounded-md border p-3">
        <dl className="grid gap-3 text-sm md:grid-cols-2">
          <Info label="과목" value={task.subject || "미지정"} />
          <Info label="학생" value={task.studentName || "미지정"} />
          <Info label="전 선생님" value={transfer.fromTeacherName || "미지정"} />
          <Info label="후 선생님" value={transfer.toTeacherName || "미지정"} />
          <Info label="전 수업" value={transfer.fromClassName || "미지정"} />
          <Info label="후 수업" value={transfer.toClassName || task.className || "미지정"} />
          <OptionalInfo label="전반사유" value={transfer.transferReason} />
          <Info label="전 미배부 교재" value={transfer.fromUndistributedTextbooks || "-"} />
          <Info label="후 미배부 교재" value={transfer.toUndistributedTextbooks || "-"} />
          <Info label="전 수업 종료일" value={dateInputValue(transfer.fromClassEndDate) || "미정"} />
          <Info label="전 수업 종료회차" value={transfer.fromClassEndSession || "미정"} />
          <Info label="후 수업 시작일" value={dateInputValue(transfer.toClassStartDate) || "미정"} />
          <Info label="후 수업 시작회차" value={transfer.toClassStartSession || "미정"} />
          <div className="md:col-span-2">
            <dt className="text-xs text-muted-foreground">처리 확인</dt>
            <dd className="mt-1">
              <TransferOperationsChecklistChips transfer={transfer} />
            </dd>
          </div>
        </dl>
      </div>

      <details className="group rounded-md border">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-3 text-sm font-semibold [&::-webkit-details-marker]:hidden">
          <span>신청 · 처리</span>
          <ChevronRight className="size-4 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden="true" />
        </summary>
        <dl className="grid gap-3 border-t px-3 py-3 text-sm md:grid-cols-2">
          <Info label="신청자" value={task.requestedByLabel || "담당선생님"} />
          <Info label="신청일시" value={dateLabel(task.createdAt)} />
          <Info label="담당자" value={task.assigneeLabel || task.assigneeTeam || "관리팀"} />
          <Info label="완료일시" value={completedAt === "-" ? "미정" : completedAt} />
        </dl>
      </details>
    </section>
  )
}

function CommentPanelContent({
  task,
  commentBody,
  onCommentBodyChange,
  onSubmit,
  saving,
}: {
  task: OpsTask
  commentBody: string
  onCommentBodyChange: (value: string) => void
  onSubmit: () => void
  saving: boolean
}) {
  const commentBodyId = useId()

  return (
    <div className="mt-3 flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        {task.comments.map((comment) => (
          <div key={comment.id} className="rounded-md bg-muted p-2 text-sm">
            <div className="mb-1 flex justify-between gap-2 text-xs text-muted-foreground">
              <span>{comment.authorLabel || "작성자"}</span>
              <span>{dateLabel(comment.createdAt)}</span>
            </div>
            {comment.body}
          </div>
        ))}
      </div>
      <div className="grid gap-2">
        <label htmlFor={commentBodyId} className="sr-only">댓글</label>
        <Textarea id={commentBodyId} value={commentBody} onChange={(event) => onCommentBodyChange(event.target.value)} placeholder="댓글" />
        <Button type="button" size="sm" onClick={onSubmit} disabled={saving || !commentBody.trim()}>
          댓글 추가
        </Button>
      </div>
    </div>
  )
}

function TypeDetail({ task }: { task: OpsTask }) {
  if (task.type === "registration" && task.registration) {
    const registration = task.registration
	    return (
	      <div className="flex flex-col gap-3">
        <dl className="grid gap-3 rounded-md bg-muted/50 p-3 text-sm md:grid-cols-2">
          <Info label="진행상태" value={registration.pipelineStatus || REGISTRATION_PIPELINE_STATUSES[0]?.value || "0. 등록 문의"} />
          <OptionalInfo label="전화상담" value={dateInputValue(registration.phoneConsultationAt)} />
          <OptionalInfo label="방문상담" value={dateInputValue(registration.visitConsultationAt)} />
          <OptionalInfo label="레벨테스트" value={dateInputValue(registration.levelTestAt)} />
          <OptionalInfo label="수업 시작" value={dateInputValue(registration.classStartDate)} />
        </dl>
        <OperationChecklistSummary
          manualItems={[
            { label: "입학신청서 발송", checked: Boolean(registration.admissionNoticeSent) },
            { label: "메이크에듀 등록(수업, 교재)", checked: Boolean(registration.makeeduRegistered) },
            { label: "청구서 발송", checked: Boolean(registration.makeeduInvoiceSent) },
            { label: "수납 완료 확인", checked: Boolean(registration.paymentChecked) },
            { label: "등록 완료", checked: getRegistrationPipelinePrefix(registration.pipelineStatus) === "7." },
          ]}
        />
      </div>
    )
  }
	  if (task.type === "withdrawal" && task.withdrawal) {
	    return <WithdrawalDetailPanel task={task} />
	  }
  if (task.type === "transfer" && task.transfer) {
    const transfer = task.transfer
    return (
      <div className="flex flex-col gap-3">
        <dl className="grid gap-3 rounded-md bg-muted/50 p-3 text-sm md:grid-cols-2">
          <OptionalInfo label="전반사유" value={transfer.transferReason} />
          <OptionalInfo label="전 수업 종료" value={dateInputValue(transfer.fromClassEndDate)} />
          <OptionalInfo label="후 수업 시작" value={dateInputValue(transfer.toClassStartDate)} />
        </dl>
        <OperationChecklistSummary
          autoItems={[
            { label: "시간표 명단 변경", checked: Boolean(transfer.timetableRosterUpdated) },
          ]}
          manualItems={[
            { label: "메이크에듀 전반처리", checked: Boolean(transfer.makeeduTransferDone) },
            { label: "수업료 처리", checked: Boolean(transfer.feeProcessed) },
            { label: "교재비 처리", checked: Boolean(transfer.textbookFeeProcessed) },
          ]}
        />
      </div>
    )
  }
	  if (task.type === "word_retest" && task.wordRetest) {
	    const wordRetest = task.wordRetest
	    return (
	      <dl className="grid gap-3 rounded-md bg-muted/50 p-3 text-sm md:grid-cols-2">
	        <OptionalInfo label="지점" value={wordRetest.branch} />
	        <OptionalInfo label="담당선생님" value={getWordRetestTeacherLabel(task)} />
	        <OptionalInfo label="본시험일" value={dateOnlyLabel(wordRetest.testAt || "")} />
	        <OptionalInfo label="교재/시험범위" value={[wordRetest.textbookName, wordRetest.unit].filter(Boolean).join(" · ")} />
	        <OptionalInfo label="결과" value={getWordRetestScoreSummary(task)} />
	        <OptionalInfo label="출제 개수" value={wordRetest.totalQuestionCount} />
	        <OptionalInfo label="커트라인" value={wordRetest.cutoffQuestionCount} />
	        <OptionalInfo label="1차 맞은 개수" value={wordRetest.firstScore} />
	        <OptionalInfo label="2차 맞은 개수" value={wordRetest.secondScore} />
	        <OptionalInfo label="3차 맞은 개수" value={wordRetest.thirdScore} />
	        <OptionalInfo label="요청사항" value={wordRetest.requestNote} />
	      </dl>
	    )
	  }
  return null
}
