"use client"

import { useSearchParams } from "next/navigation"
import { useCallback, useDeferredValue, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type DragEvent, type FormEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react"
import { DndContext, KeyboardSensor, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core"
import { CSS } from "@dnd-kit/utilities"
import { CalendarDays, Check, Copy, FileText, GripVertical, Inbox, Kanban, Plus, RefreshCw, Search, Trash2, UserRound, X } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/providers/auth-provider"

import {
  OPS_TASK_STATUSES,
  REGISTRATION_PIPELINE_STATUSES,
  WORD_RETEST_STATUSES,
  buildRegistrationWorkflowPresetPatch,
  buildTransferClassPlanPatch,
  buildTransferScheduleDefaults,
  buildTransferTextbookDefaults,
  buildTransferWorkflowPresetPatch,
  buildWordRetestRerequestDraft,
  buildWithdrawalClassPlanPatch,
  buildWithdrawalSettlementDefaults,
  buildWithdrawalTextbookDefaults,
  buildWithdrawalWorkflowPresetPatch,
  buildWordRetestAssistantActionPatch,
  buildWordRetestWorkflowPresetPatch,
  groupOpsTasksByAssignee,
  groupOpsTasksByStatus,
  getOpsTaskCalendarItems,
  getOpsTaskScheduleCompletionBlockers,
  getOpsAutomationSourceLabel,
  getRegistrationCompletionChecklistItems,
  getRegistrationDuplicateCompletionBlockers,
  getRegistrationDuplicateStudentCandidates,
  getRegistrationEffectiveTextbookId,
  getRegistrationPrincipalQueueSummary,
  getWordRetestEffectiveBranch,
  getWordRetestEffectiveTextbookId,
  getTransferCompletionChecklistItems,
  getTaskPriorityLabel,
  getTaskStatusLabel,
  getTaskTypeLabel,
  getWithdrawalCompletionChecklistItems,
  getWordRetestAssistantQuickActions,
  getWordRetestExecutionStage,
  getWordRetestExecutionSummary,
  hasOpsTaskCalendarDate,
  hasOpsTaskOverdueCalendarDate,
  isWordRetestInBranchQueue,
  isWordRetestInExecutionQueue,
  isWordRetestRerequestable,
  isWordRetestScoreValue,
  isClosedOpsTask,
  isOpsTaskActionable,
  isOpsTaskAssignedToUser,
  sortWordRetestExecutionQueue,
  toDateKey,
} from "./ops-task-model"
import {
  addOpsTaskAttachment,
  addOpsTaskComment,
  createOpsTaskAutomationRule,
  createOpsTaskNotificationChannel,
  createOpsTask,
  deleteOpsTask,
  emptyOpsTaskWorkspaceData,
  getCachedOpsTaskWorkspaceData,
  loadOpsTaskById,
  loadOpsTaskWorkspaceData,
  summarizeOpsTasks,
  updateOpsTaskAutomationRule,
  updateOpsTaskNotificationChannel,
  updateOpsTask,
  updateOpsTaskStatus,
  type OpsTaskAttachment,
  type OpsTaskEvent,
  type OpsClassOption,
  type OpsLinkedOption,
  type OpsTaskComment,
  type OpsTaskChecklistItem,
  type OpsProfileOption,
  type OpsStudentOption,
  type OpsTeacherOption,
  type OpsTextbookOption,
  type OpsTaskPriority,
  type OpsTask,
  type OpsTaskInput,
  type OpsTaskStatus,
  type OpsTaskType,
  type OpsTaskAutomationRule,
  type OpsTaskAutomationRuleInput,
  type OpsTaskNotificationChannel,
  type OpsTaskNotificationChannelInput,
  type OpsTaskWorkspaceData,
  type OpsWithdrawalDetail,
} from "./ops-task-service"

type WorkspaceKey = "todo" | "registration" | "transfer" | "withdrawal" | "word_retest"
type ViewKey = "process" | "all" | "status" | "assignee" | "calendar"
type TodoViewKey = "inbox" | "today" | "upcoming" | "mine" | "board" | "calendar" | "filters" | "recurring" | "automations" | "completed"
type TodoFilterKey = "all" | "overdue" | "priority" | "unassigned" | "confirmation"
type TaskOrganizationFixField = "task.assignee" | "task.dueAt"
type OperationProcessWorkspaceKey = "registration" | "transfer" | "withdrawal"

type WordRetestMode = "teacher" | "assistant"
type WordRetestBranchMode = "all" | "본관" | "별관"
type WordRetestQueueMode = "all" | "today" | "in_progress" | "needs_score" | "absent" | "done"
type WordRetestTeacherQueueMode = "all" | "active" | "rerequest"
type WordRetestExecutionOptions = { today: string; now?: Date }
type WordRetestAssistantQuickAction = {
  key: string
  label: string
  kind: "status" | "edit_scores" | "quick_score"
  status?: OpsTaskStatus
  retestStatus?: string
  clearScores?: boolean
  scoreField?: "firstScore"
  score?: string
}
type WithdrawalSettlementDefaults = Partial<Pick<
  NonNullable<OpsTaskInput["withdrawal"]>,
  "withdrawalSession" | "completedLessonHours" | "fourWeekLessonHours"
>>
type WithdrawalTextbookDefaults = Partial<Pick<
  NonNullable<OpsTaskInput["withdrawal"]>,
  "undistributedTextbooks"
>>
type WithdrawalClassPlanPatch = WithdrawalSettlementDefaults & WithdrawalTextbookDefaults
type WithdrawalWorkflowPresetPatch = WithdrawalClassPlanPatch & Partial<Pick<
  NonNullable<OpsTaskInput["withdrawal"]>,
  "withdrawalDate"
>>
type TransferScheduleDefaults = Partial<Pick<
  NonNullable<OpsTaskInput["transfer"]>,
  "fromClassEndSession" | "toClassStartSession"
>>
type TransferTextbookDefaults = Partial<Pick<
  NonNullable<OpsTaskInput["transfer"]>,
  "fromUndistributedTextbooks" | "toUndistributedTextbooks"
>>
type TransferClassPlanPatch = TransferScheduleDefaults & TransferTextbookDefaults
type TransferWorkflowPresetPatch = TransferClassPlanPatch & Partial<Pick<
  NonNullable<OpsTaskInput["transfer"]>,
  "fromClassEndDate" | "toClassStartDate"
>>
type WordRetestWorkflowPresetPatch = Partial<Pick<
  NonNullable<OpsTaskInput["wordRetest"]>,
  "testAt" | "branch"
>>
type BuildWithdrawalTextbookDefaults = (input: {
  withdrawal: NonNullable<OpsTaskInput["withdrawal"]>
  classTextbooks: OpsTextbookOption[]
}) => WithdrawalTextbookDefaults
type BuildWithdrawalClassPlanPatch = (input: {
  withdrawal: NonNullable<OpsTaskInput["withdrawal"]>
  classItem?: OpsClassOption
  classTextbooks: OpsTextbookOption[]
}) => WithdrawalClassPlanPatch
type BuildWithdrawalWorkflowPresetPatch = (preset: string, input: {
  dueTodayValue: string
  withdrawal: NonNullable<OpsTaskInput["withdrawal"]>
  classItem?: OpsClassOption
  classTextbooks: OpsTextbookOption[]
}) => WithdrawalWorkflowPresetPatch
type BuildTransferTextbookDefaults = (input: {
  transfer: NonNullable<OpsTaskInput["transfer"]>
  fromTextbooks: OpsTextbookOption[]
  toTextbooks: OpsTextbookOption[]
}) => TransferTextbookDefaults
type BuildTransferClassPlanPatch = (input: {
  transfer: NonNullable<OpsTaskInput["transfer"]>
  fromClass?: OpsClassOption
  toClass?: OpsClassOption
  fromTextbooks: OpsTextbookOption[]
  toTextbooks: OpsTextbookOption[]
}) => TransferClassPlanPatch
type BuildTransferWorkflowPresetPatch = (preset: string, input: {
  dueTodayValue: string
  dueTomorrowValue: string
  transfer: NonNullable<OpsTaskInput["transfer"]>
  fromClass?: OpsClassOption
  toClass?: OpsClassOption
  fromTextbooks: OpsTextbookOption[]
  toTextbooks: OpsTextbookOption[]
}) => TransferWorkflowPresetPatch
type BuildWordRetestWorkflowPresetPatch = (preset: string, input: {
  dueTodayValue: string
  dueTomorrowValue: string
}) => WordRetestWorkflowPresetPatch
type TaskFocus = "none" | "today" | "overdue" | "mine" | "unassigned" | "confirmation"
type FormCompletionIntent = {
  status?: OpsTaskStatus
  registrationPipelineStatus?: string
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
type TodoBoardColumn = {
  key: "overdue" | "today" | "mine" | "upcoming" | "unsorted"
  label: string
  tasks: OpsTask[]
}
type OperationProcessStage = {
  key: string
  label: string
  status?: OpsTaskStatus
  pipelineStatus?: string
}
type OperationProcessBoardColumn = OperationProcessStage & {
  tasks: OpsTask[]
}
type OperationProcessColumnKey = string
type OperationProcessCellField = string
type OperationProcessInlineEditType = "text" | "date"
type OperationProcessDatabaseColumn = {
  key: OperationProcessColumnKey
  label: string
  width: number
  field?: OperationProcessCellField
}
type QuickAddPreviewItem = { key: string; label: string }
type OpsTaskOptionIndexes = {
  studentsById: Map<string, OpsStudentOption>
  classesById: Map<string, OpsClassOption>
  textbooksById: Map<string, OpsTextbookOption>
  teachersById: Map<string, OpsTeacherOption>
}
type OperationCompletionBlockerMap = Map<string, string[]>
type OperationConfirmationMap = Map<string, boolean>
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
type FormDetailRenderStep = FormDetailStepKey | "all"

const EMPTY_TASKS: OpsTask[] = []
const EMPTY_STUDENT_OPTIONS: OpsStudentOption[] = []
const EMPTY_CLASS_OPTIONS: OpsClassOption[] = []
const EMPTY_TEACHER_OPTIONS: OpsTeacherOption[] = []
const EMPTY_TEXTBOOK_OPTIONS: OpsTextbookOption[] = []
const EMPTY_AUTOMATION_RULES: OpsTaskAutomationRule[] = []
const EMPTY_NOTIFICATION_CHANNELS: OpsTaskNotificationChannel[] = []
const EMPTY_OPS_TASK_OPTION_INDEXES: OpsTaskOptionIndexes = {
  studentsById: new Map(),
  classesById: new Map(),
  textbooksById: new Map(),
  teachersById: new Map(),
}
const EMPTY_COMPLETION_BLOCKERS: string[] = []
const EMPTY_COMPLETION_BLOCKERS_BY_TASK_ID: OperationCompletionBlockerMap = new Map()
const EMPTY_CONFIRMATION_BY_TASK_ID: OperationConfirmationMap = new Map()
const LINKED_SELECT_SEARCH_THRESHOLD = 12
const LINKED_SELECT_QUERY_OPTION_LIMIT = 50
const LINKED_SELECT_MANUAL_VALUE = "__manual__"
const HORIZONTAL_CHIP_BAR_CLASS = "flex gap-1.5 overflow-x-auto rounded-md border bg-background p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
const HORIZONTAL_TAB_BAR_CLASS = "flex min-w-0 flex-wrap gap-1 overflow-visible sm:flex-nowrap sm:overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
const WORD_RETEST_QUEUE_BAR_CLASS = "flex flex-wrap gap-1.5 rounded-md border bg-background p-1"

const TODO_VIEW_TABS: Array<{ key: TodoViewKey; label: string }> = [
  { key: "inbox", label: "받은함" },
  { key: "today", label: "오늘" },
  { key: "upcoming", label: "예정" },
  { key: "mine", label: "내 담당" },
  { key: "board", label: "보드" },
  { key: "calendar", label: "일정" },
  { key: "filters", label: "필터" },
  { key: "recurring", label: "반복 업무" },
  { key: "automations", label: "자동화 규칙" },
  { key: "completed", label: "완료" },
]

const TODO_FILTER_TABS: Array<{ key: TodoFilterKey; label: string }> = [
  { key: "all", label: "전체" },
  { key: "overdue", label: "지연" },
  { key: "priority", label: "중요" },
  { key: "unassigned", label: "미정리" },
  { key: "confirmation", label: "확인 필요" },
]

const AUTOMATION_RECURRENCE_OPTIONS = [
  { value: "daily", label: "매일" },
  { value: "weekly", label: "매주" },
  { value: "monthly", label: "매월" },
  { value: "last_weekday", label: "매월 마지막 요일" },
]

const AUTOMATION_WEEKDAY_OPTIONS = [
  { value: "1", label: "월" },
  { value: "2", label: "화" },
  { value: "3", label: "수" },
  { value: "4", label: "목" },
  { value: "5", label: "금" },
  { value: "6", label: "토" },
  { value: "0", label: "일" },
]

const AUTOMATION_PRIORITY_OPTIONS: Array<{ value: OpsTaskPriority; label: string }> = [
  { value: "normal", label: "보통" },
  { value: "high", label: "중요" },
  { value: "urgent", label: "긴급" },
  { value: "low", label: "낮음" },
]

const AUTOMATION_CREATE_LEAD_OPTIONS = [
  { value: "0", label: "당일" },
  { value: "1", label: "전날" },
  { value: "3", label: "3일 전" },
  { value: "7", label: "1주 전" },
]

const AUTOMATION_GENERATION_MODE_OPTIONS = [
  { value: "scheduled", label: "정해진 시점 자동 생성" },
  { value: "after_completion", label: "완료 후 다음 회차 생성" },
]

const AUTOMATION_RELATED_ROUTE_OPTIONS = [
  { value: "/admin/tasks", label: "할 일" },
  { value: "/admin/registration", label: "등록" },
  { value: "/admin/transfer", label: "전반" },
  { value: "/admin/withdrawal", label: "퇴원" },
  { value: "/admin/word-retests", label: "단어 재시험" },
  { value: "/admin/curriculum", label: "수업계획" },
  { value: "/admin/academic-calendar", label: "학사일정" },
]

const TRIGGER_AUTOMATION_OPTIONS = [
  {
    triggerKey: "registration.completed",
    target: "registration",
    label: "등록 완료",
    defaultTitle: "{studentName} 첫 인사 및 안내 전화",
    dueBasis: "task.registration.classStartDate",
    offsetDays: "5",
    assigneeStrategy: "teacher",
  },
  {
    triggerKey: "transfer.completed",
    target: "transfer",
    label: "전반 완료",
    defaultTitle: "{studentName} 전반 적응 확인",
    dueBasis: "task.transfer.toClassStartDate",
    offsetDays: "7",
    assigneeStrategy: "teacher",
  },
  {
    triggerKey: "withdrawal.completed",
    target: "withdrawal",
    label: "퇴원 완료",
    defaultTitle: "{studentName} 퇴원 후 정산 확인",
    dueBasis: "task.withdrawal.withdrawalDate",
    offsetDays: "1",
    assigneeStrategy: "operator",
  },
  {
    triggerKey: "word_retest.completed",
    target: "word_retest",
    label: "재시험 완료",
    defaultTitle: "{studentName} 재시험 결과 안내",
    dueBasis: "task.wordRetest.testAt",
    offsetDays: "0",
    assigneeStrategy: "teacher",
  },
  {
    triggerKey: "ops.updated",
    target: "",
    label: "업무 변경됨",
    defaultTitle: "{studentName} 업무 변경 확인",
    dueBasis: "event.occurredAt",
    offsetDays: "0",
    assigneeStrategy: "operator",
  },
  {
    triggerKey: "ops.assignee_assigned",
    target: "",
    label: "담당자 배정됨",
    defaultTitle: "{studentName} 담당 배정 확인",
    dueBasis: "event.occurredAt",
    offsetDays: "0",
    assigneeStrategy: "operator",
  },
  {
    triggerKey: "ops.date_confirmed",
    target: "",
    label: "날짜 확정됨",
    defaultTitle: "{studentName} 일정 준비",
    dueBasis: "event.occurredAt",
    offsetDays: "0",
    assigneeStrategy: "operator",
  },
  {
    triggerKey: "curriculum.plan_saved",
    target: "curriculum",
    label: "수업계획 확정",
    defaultTitle: "{className} 다음 수업 자료 준비",
    dueBasis: "event.classItem.nextSessionDate",
    offsetDays: "-1",
    assigneeStrategy: "teacher",
  },
  {
    triggerKey: "academic_calendar.changed",
    target: "academic_calendar",
    label: "학사일정 변경됨",
    defaultTitle: "{eventTitle} 변경 확인",
    dueBasis: "event.occurredAt",
    offsetDays: "0",
    assigneeStrategy: "fixed",
  },
  {
    triggerKey: "academic_calendar.date_confirmed",
    target: "academic_calendar",
    label: "학사일정 날짜 확정",
    defaultTitle: "{eventTitle} 자료 준비",
    dueBasis: "event.academicEvent.start",
    offsetDays: "-7",
    assigneeStrategy: "fixed",
  },
]

const AUTOMATION_ASSIGNEE_STRATEGIES = [
  { value: "teacher", label: "담당 선생님" },
  { value: "operator", label: "처리 담당자" },
  { value: "fixed", label: "고정 담당자" },
  { value: "requester", label: "요청자" },
]

const GOOGLE_CHAT_CHANNEL_PRESETS = [
  { name: "데스크팀", teamKey: "desk" },
  { name: "조교팀", teamKey: "assistants" },
  { name: "영어팀", teamKey: "english" },
  { name: "수학팀", teamKey: "math" },
  { name: "선생님팀", teamKey: "teachers" },
  { name: "관리팀", teamKey: "admin" },
  { name: "원장님 확인방", teamKey: "principal" },
  { name: "전체 공지", teamKey: "all" },
]

const AUTOMATION_DUPLICATE_POLICY_OPTIONS = [
  { value: "automation_source_key", label: "기존 업무 유지" },
  { value: "update_due", label: "기존 마감일 갱신" },
]

const AUTOMATION_STATUS_CONDITION_OPTIONS = [
  { value: "all", label: "전체" },
  { value: "requested", label: "요청" },
  { value: "confirmed", label: "확인" },
  { value: "in_progress", label: "진행" },
  { value: "done", label: "완료" },
  { value: "on_hold", label: "보류" },
  { value: "canceled", label: "취소" },
]

const TRIGGER_DUE_BASIS_OPTIONS = [
  { value: "event.occurredAt", label: "이벤트 발생일" },
  { value: "task.registration.classStartDate", label: "첫 수업 시작일" },
  { value: "task.transfer.toClassStartDate", label: "새 수업 시작일" },
  { value: "task.withdrawal.withdrawalDate", label: "퇴원일" },
  { value: "task.wordRetest.testAt", label: "재시험일" },
  { value: "event.classItem.nextSessionDate", label: "다음 수업일" },
  { value: "event.academicEvent.start", label: "학사일정 시작일" },
  { value: "event.academicEvent.end", label: "학사일정 종료일" },
]

const WORD_RETEST_QUEUE_ITEMS: Array<{ key: WordRetestQueueMode; label: string }> = [
  { key: "all", label: "전체" },
  { key: "today", label: "오늘 응시" },
  { key: "in_progress", label: "진행 중" },
  { key: "needs_score", label: "점수 입력" },
  { key: "absent", label: "미응시" },
  { key: "done", label: "완료" },
]

const WORD_RETEST_TEACHER_QUEUE_ITEMS: Array<{ key: WordRetestTeacherQueueMode; label: string }> = [
  { key: "all", label: "내 요청" },
  { key: "active", label: "요청 중" },
  { key: "rerequest", label: "미응시 재요청" },
]

const WORD_RETEST_BRANCH_ITEMS: Array<{ key: WordRetestBranchMode; label: string }> = [
  { key: "all", label: "전체" },
  { key: "본관", label: "본관" },
  { key: "별관", label: "별관" },
]
const WORD_RETEST_QUICK_SCORE_PRESETS = ["100"]

const LEGACY_TODO_VIEW_ROUTES: Record<string, { list: TodoViewKey; filter?: TodoFilterKey }> = {
  all: { list: "filters", filter: "all" },
  inbox: { list: "inbox" },
  today: { list: "today" },
  upcoming: { list: "upcoming" },
  board: { list: "board" },
  calendar: { list: "calendar" },
  completed: { list: "completed" },
  overdue: { list: "filters", filter: "overdue" },
  mine: { list: "mine" },
  priority: { list: "filters", filter: "priority" },
  unassigned: { list: "filters", filter: "unassigned" },
  confirmation: { list: "filters", filter: "confirmation" },
}

const OPERATION_VIEW_TABS: Array<{ key: ViewKey; label: string }> = [
  { key: "process", label: "진행보드" },
  { key: "all", label: "전체" },
  { key: "status", label: "상태별" },
  { key: "assignee", label: "담당자별" },
  { key: "calendar", label: "일정" },
]

const OPERATION_PROCESS_BOARD_CONFIGS: Record<OperationProcessWorkspaceKey, { stages: OperationProcessStage[] }> = {
  registration: {
    stages: REGISTRATION_PIPELINE_STATUSES.map((status) => ({
      key: status.value,
      label: status.label,
      pipelineStatus: status.value,
    })),
  },
  transfer: {
    stages: [
      { key: "requested", label: "제출 완료", status: "requested" },
      { key: "in_progress", label: "처리 진행 중", status: "in_progress" },
      { key: "done", label: "처리 완료", status: "done" },
    ],
  },
  withdrawal: {
    stages: [
      { key: "requested", label: "제출 완료", status: "requested" },
      { key: "in_progress", label: "처리 진행 중", status: "in_progress" },
      { key: "done", label: "처리 완료", status: "done" },
    ],
  },
}

const OPERATION_PROCESS_DATABASE_COLUMNS: Record<OperationProcessWorkspaceKey, OperationProcessDatabaseColumn[]> = {
  registration: [
    { key: "title", label: "이름", width: 220, field: "task.title" },
    { key: "school", label: "학교", width: 132, field: "registration.schoolName" },
    { key: "grade", label: "학년", width: 88, field: "registration.schoolGrade" },
    { key: "subject", label: "과목", width: 88, field: "task.subject" },
    { key: "connection", label: "연계", width: 132 },
    { key: "parentPhone", label: "학부모 전화", width: 140, field: "registration.parentPhone" },
    { key: "studentPhone", label: "학생 전화", width: 140, field: "registration.studentPhone" },
    { key: "requestNote", label: "요청 사항", width: 220, field: "registration.requestNote" },
    { key: "inquiryAt", label: "문의일시", width: 154, field: "registration.inquiryAt" },
    { key: "inquiryChannel", label: "문의채널", width: 116, field: "registration.inquiryChannel" },
    { key: "levelTestAt", label: "레벨테스트일시", width: 154, field: "registration.levelTestAt" },
    { key: "levelTestPlace", label: "레벨테스트장소", width: 132, field: "registration.levelTestPlace" },
    { key: "levelTestResult", label: "레벨테스트결과", width: 160, field: "registration.levelTestResult" },
    { key: "counselor", label: "상담 책임자", width: 132, field: "registration.counselor" },
    { key: "phoneConsultationAt", label: "전화상담일시", width: 154, field: "registration.phoneConsultationAt" },
    { key: "visitConsultationAt", label: "방문상담일시", width: 154, field: "registration.visitConsultationAt" },
    { key: "visitConsultationRoom", label: "방문상담실", width: 120 },
    { key: "blockers", label: "필요 입력", width: 220 },
    { key: "actions", label: "작업", width: 124 },
  ],
  transfer: [
    { key: "id", label: "ID", width: 88 },
    { key: "stage", label: "진행상태", width: 148 },
    { key: "transferReason", label: "전반사유", width: 220, field: "transfer.transferReason" },
    { key: "student", label: "학생명", width: 140, field: "task.studentName" },
    { key: "subject", label: "과목", width: 88, field: "task.subject" },
    { key: "fromTeacherName", label: "전 선생님명", width: 132, field: "transfer.fromTeacherName" },
    { key: "fromClassName", label: "전 수업명", width: 184, field: "transfer.fromClassName" },
    { key: "fromClassEndDate", label: "전 수업 종료일", width: 132, field: "transfer.fromClassEndDate" },
    { key: "fromClassEndSession", label: "전 수업 종료회차", width: 140, field: "transfer.fromClassEndSession" },
    { key: "fromUndistributedTextbooks", label: "전 수업 미배부교재", width: 180, field: "transfer.fromUndistributedTextbooks" },
    { key: "toTeacherName", label: "후 선생님명", width: 132, field: "transfer.toTeacherName" },
    { key: "toClassName", label: "후 수업명", width: 184, field: "transfer.toClassName" },
    { key: "toClassStartDate", label: "후 수업 시작일", width: 132, field: "transfer.toClassStartDate" },
    { key: "toClassStartSession", label: "후 수업 시작회차", width: 140, field: "transfer.toClassStartSession" },
    { key: "toUndistributedTextbooks", label: "후 수업 미배부교재", width: 180, field: "transfer.toUndistributedTextbooks" },
    { key: "transferTimetableRosterUpdated", label: "수업시간표 명단 변경", width: 168 },
    { key: "makeeduTransferDone", label: "메이크에듀 전반처리", width: 168 },
    { key: "transferFeeSettled", label: "수업료, 교재비 정산처리", width: 190 },
    { key: "blockers", label: "필요 입력", width: 220 },
    { key: "actions", label: "작업", width: 124 },
  ],
  withdrawal: [
    { key: "id", label: "ID", width: 88 },
    { key: "stage", label: "진행상태", width: 148 },
    { key: "subject", label: "과목", width: 88, field: "task.subject" },
    { key: "grade", label: "학년", width: 88, field: "withdrawal.schoolGrade" },
    { key: "teacher", label: "선생님명", width: 132, field: "withdrawal.teacherName" },
    { key: "class", label: "수업명", width: 184, field: "withdrawal.class" },
    { key: "student", label: "학생명", width: 140, field: "task.studentName" },
    { key: "customerReason", label: "고객 퇴원사유", width: 220, field: "withdrawal.customerReason" },
    { key: "teacherOpinion", label: "선생님 의견", width: 220, field: "withdrawal.teacherOpinion" },
    { key: "handoffNote", label: "기타 전달내용", width: 220, field: "task.memo" },
    { key: "undistributedTextbooks", label: "미배부 교재", width: 180, field: "withdrawal.undistributedTextbooks" },
    { key: "withdrawalDate", label: "퇴원일", width: 132, field: "withdrawal.withdrawalDate" },
    { key: "withdrawalSession", label: "퇴원회차", width: 120, field: "withdrawal.withdrawalSession" },
    { key: "completedLessonHours", label: "진행된 수업시수", width: 140, field: "withdrawal.completedLessonHours" },
    { key: "fourWeekLessonHours", label: "4주 기준 수업시수", width: 150, field: "withdrawal.fourWeekLessonHours" },
    { key: "lessonProgressRate", label: "수업진행률", width: 112 },
    { key: "withdrawalTimetableRosterUpdated", label: "수업시간표 명단 변경", width: 168 },
    { key: "makeeduWithdrawalDone", label: "메이크에듀 퇴원처리", width: 168 },
    { key: "withdrawalFeeSettled", label: "수업료, 교재비 정산처리", width: 190 },
    { key: "blockers", label: "필요 입력", width: 220 },
    { key: "actions", label: "작업", width: 124 },
  ],
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
  word_retest: "단어 재시험",
}

const WORKSPACE_SEARCH_PLACEHOLDERS: Record<WorkspaceKey, string> = {
  todo: "할 일 검색",
  registration: "등록 검색",
  transfer: "전반 검색",
  withdrawal: "퇴원 검색",
  word_retest: "단어 재시험 검색",
}

const OPERATION_WORKSPACE_PATHS: Partial<Record<OpsTaskType, string>> = {
  registration: "/admin/registration",
  transfer: "/admin/transfer",
  withdrawal: "/admin/withdrawal",
  word_retest: "/admin/word-retests",
}

function getOperationWorkspaceHref(task: OpsTask) {
  const path = OPERATION_WORKSPACE_PATHS[task.type]
  if (!path) return ""
  return `${path}?taskId=${encodeURIComponent(task.id)}`
}

function getWordRetestStatusLabel(value: string) {
  return WORD_RETEST_STATUSES.find((status) => status.value === value)?.label || "시작 전"
}

const REGISTRATION_PIPELINE_ALL = "all"
const REGISTRATION_PIPELINE_NEXT_PREFIXES: Record<string, string> = {
  "0.": "1.",
  "1.": "2.",
  "2.": "3.",
  "3.": "5.",
  "4-1.": "5.",
  "4-2.": "5.",
  "4-3.": "5.",
  "5.": "6.",
  "6.": "7.",
}

const TASK_FOCUS_LABELS: Record<Exclude<TaskFocus, "none">, string> = {
  today: "오늘 예정",
  overdue: "지연",
  mine: "내 담당",
  unassigned: "미정리",
  confirmation: "확인 필요",
}

const VALID_TASK_FOCUSES = new Set<TaskFocus>(["none", "today", "overdue", "mine", "unassigned", "confirmation"])

function getFormDetailTabs(type: OpsTaskType): Array<{ key: FormDetailStepKey; label: string }> {
  if (type === "registration") {
    return [
      { key: "registration_contact", label: "문의" },
      { key: "registration_test", label: "레벨테스트" },
      { key: "registration_start", label: "원장 반배정" },
      { key: "registration_checks", label: "완료체크" },
    ]
  }

  if (type === "withdrawal") {
    return [
      { key: "withdrawal_basic", label: "퇴원" },
      { key: "withdrawal_reason", label: "사유" },
      { key: "withdrawal_checks", label: "체크" },
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

function isOperationProcessWorkspace(workspace: WorkspaceKey): workspace is OperationProcessWorkspaceKey {
  return workspace === "registration" || workspace === "transfer" || workspace === "withdrawal"
}

function isViewKey(value: string): value is ViewKey {
  return OPERATION_VIEW_TABS.some((tab) => tab.key === value)
}

function isTodoViewKey(value: string): value is TodoViewKey {
  return TODO_VIEW_TABS.some((tab) => tab.key === value)
}

function isTodoFilterKey(value: string): value is TodoFilterKey {
  return TODO_FILTER_TABS.some((tab) => tab.key === value)
}

function getTodoRouteState(searchParams: URLSearchParams): { list: TodoViewKey; filter?: TodoFilterKey } | null {
  const nextList = searchParams.get("list") || ""
  const nextFilter = searchParams.get("filter") || ""
  if (nextFilter === "mine") return { list: "mine" }
  if (isTodoViewKey(nextList)) {
    const routeFilter = nextFilter && isTodoFilterKey(nextFilter) ? nextFilter : nextList === "filters" ? "all" : undefined
    return {
      list: nextList,
      filter: routeFilter,
    }
  }
  if (nextFilter && isTodoFilterKey(nextFilter)) return { list: "filters", filter: nextFilter }

  const legacyView = searchParams.get("view") || ""
  return LEGACY_TODO_VIEW_ROUTES[legacyView] || null
}

function getTodoEmptyLabel(view: TodoViewKey, isFilteredEmpty: boolean) {
  if (isFilteredEmpty) return "조건에 맞는 할 일 없음"
  if (view === "inbox") return "받은함 비어 있음"
  if (view === "today") return "오늘 할 일 없음"
  if (view === "upcoming") return "예정된 할 일 없음"
  if (view === "mine") return "내 담당 할 일 없음"
  if (view === "board") return "보드에 표시할 할 일 없음"
  if (view === "calendar") return "일정 없음"
  if (view === "recurring") return "반복 업무 없음"
  if (view === "automations") return "자동화 업무 없음"
  if (view === "completed") return "완료한 할 일 없음"
  return "필터에 맞는 할 일 없음"
}

function isTaskFocus(value: string): value is TaskFocus {
  return VALID_TASK_FOCUSES.has(value as TaskFocus)
}

function isEnglishOperationOption(value: string) {
  const normalized = value.replace(/\s+/g, "").toLowerCase()
  return normalized.includes("영어") || normalized.includes("english")
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

function uniqueClassOptions(classes: OpsClassOption[]) {
  const seenIds = new Set<string>()
  return classes.filter((classItem) => {
    if (seenIds.has(classItem.id)) return false
    seenIds.add(classItem.id)
    return true
  })
}

function getWordRetestClassOptions(classes: OpsClassOption[], student?: OpsStudentOption, selectedClassId = "") {
  const englishClasses = classes.filter(isWordRetestClassOption)
  const baseClasses = englishClasses.length > 0 ? englishClasses : classes
  const studentClassIds = getStudentRosterClassIds(student, classes)
  const studentClasses = baseClasses.filter((classItem) => studentClassIds.includes(classItem.id))
  const selectedClass = classes.find((classItem) => classItem.id === selectedClassId)
  return uniqueClassOptions([selectedClass, ...(studentClasses.length > 0 ? studentClasses : baseClasses)].filter(Boolean) as OpsClassOption[])
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

function getClassScopedTextbookOptions(
  textbooks: OpsTextbookOption[],
  classItem?: OpsClassOption,
  selectedTextbookId = "",
) {
  if (!classItem || classItem.textbookIds.length === 0) return textbooks
  return textbooks.filter((textbook) => (
    classItem.textbookIds.includes(textbook.id) ||
    textbook.id === selectedTextbookId
  ))
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
  assigneeId: "",
  secondaryAssigneeId: "",
  studentId: "",
  classId: "",
  textbookId: "",
  studentName: "",
  className: "",
  textbookTitle: "",
  campus: "",
  subject: "",
  dueAt: "",
  memo: "",
  checklistItems: [],
  registration: {},
  withdrawal: {},
  transfer: {},
  wordRetest: { branch: "본관", retestStatus: "not_started" },
}

function normalizeTaskChecklistItems(items: OpsTaskInput["checklistItems"] = []): OpsTaskChecklistItem[] {
  return (items || [])
    .map((item, index) => {
      const label = String(item.label || "").trim()
      if (!label) return null
      return {
        id: String(item.id || `item-${index + 1}`).trim(),
        label,
        checked: item.checked === true,
      }
    })
    .filter((item): item is OpsTaskChecklistItem => Boolean(item))
}

function formatTaskChecklistText(items: OpsTaskInput["checklistItems"] = []) {
  return normalizeTaskChecklistItems(items).map((item) => item.label).join("\n")
}

function parseTaskChecklistText(value: string, previousItems: OpsTaskInput["checklistItems"] = []): OpsTaskChecklistItem[] {
  const previousByLabel = new Map(normalizeTaskChecklistItems(previousItems).map((item) => [item.label, item]))
  return value
    .split(/\n|,/)
    .map((label) => label.trim())
    .filter(Boolean)
    .map((label, index) => {
      const existing = previousByLabel.get(label)
      return {
        id: existing?.id || `manual-${index + 1}`,
        label,
        checked: existing?.checked || false,
      }
    })
}

function getTaskChecklistProgressLabel(items: OpsTaskInput["checklistItems"] = []) {
  const checklistItems = normalizeTaskChecklistItems(items)
  if (checklistItems.length === 0) return ""
  const done = checklistItems.filter((item) => item.checked).length
  return `체크 ${done}/${checklistItems.length}`
}

function cloneForm(input: OpsTaskInput = EMPTY_FORM): OpsTaskInput {
  return {
    ...EMPTY_FORM,
    ...input,
    checklistItems: normalizeTaskChecklistItems(input.checklistItems),
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
    assigneeId: task.assigneeId,
    secondaryAssigneeId: task.secondaryAssigneeId,
    studentId: task.studentId,
    classId: task.classId,
    textbookId: task.textbookId,
    studentName: task.studentName,
    className: task.className,
    textbookTitle: task.textbookTitle,
    campus: task.campus,
    subject: task.subject,
    dueAt: task.dueAt,
    completedAt: task.completedAt,
    memo: task.memo,
    checklistItems: task.checklistItems,
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

  if (intent.status) return { ...input, status: intent.status }

  return input
}

function getFormCompletionIntentSubmitLabel(intent: FormCompletionIntent | null) {
  if (!intent) return "저장"
  if (intent.registrationPipelineStatus) return `저장 후 ${getCompactRegistrationPipelineLabel(intent.registrationPipelineStatus)}`
  if (intent.status === "done") return "저장 후 완료"
  return "저장"
}

function isRegistrationPipelineComplete(input: OpsTaskInput) {
  return input.status === "done" || String(input.registration?.pipelineStatus || "").startsWith("7.")
}

function getMissingRegistrationCheckLabels(registration?: OpsTaskInput["registration"]) {
  return (getRegistrationCompletionChecklistItems(registration) as RegistrationCompletionChecklistItem[])
    .filter((item) => !item.checked)
    .map((item) => item.label)
}

function getMissingWithdrawalCheckLabels(withdrawal?: OpsTaskInput["withdrawal"]) {
  return (getWithdrawalCompletionChecklistItems(withdrawal) as CompletionChecklistItem[])
    .filter((item) => !item.auto && !item.checked)
    .map((item) => item.label)
}

function getMissingTransferCheckLabels(transfer?: OpsTaskInput["transfer"]) {
  return (getTransferCompletionChecklistItems(transfer) as CompletionChecklistItem[])
    .filter((item) => !item.auto && !item.checked)
    .map((item) => item.label)
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

function getCurrentUserTeacherOption(
  teachers: OpsTeacherOption[] = EMPTY_TEACHER_OPTIONS,
  currentUserId = "",
  currentUserEmail = "",
) {
  const safeUserId = String(currentUserId || "").trim()
  if (safeUserId) {
    const teacher = teachers.find((teacher) => teacher.profileId === safeUserId)
    if (teacher) return teacher
  }

  const currentEmail = normalizeLookupValue(currentUserEmail)
  if (!currentEmail) return undefined
  return teachers.find((teacher) => normalizeLookupValue(teacher.accountEmail) === currentEmail)
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
    const registrationTextbookId = getRegistrationEffectiveTextbookId(input, { classes })
    const registrationClass = findClassOption(classes, input.classId, indexes)
    const registrationClassPlanNeedsTextbook = Boolean(registrationClass && registrationClass.textbookIds.length <= 0)
    if (!String(input.registration?.classStartDate || "").trim()) blockers.push("수업시작일")
    if (!hasNewRegistrationStudent(input)) blockers.push("학생")
    getRegistrationDuplicateCompletionBlockers(input, students).forEach((blocker) => blockers.push(blocker))
    if (hasLinkedRecord(input.studentId) && !findStudentOption(students, input.studentId, indexes)) blockers.push("학생")
    if (!hasLinkedRecord(input.classId)) blockers.push("수업")
    if (hasLinkedRecord(input.classId) && !registrationClass) blockers.push("수업")
    if (!hasLinkedRecord(registrationTextbookId) && !registrationClassPlanNeedsTextbook) blockers.push("교재")
    if (hasLinkedRecord(registrationTextbookId) && !findTextbookOption(textbooks, registrationTextbookId, indexes)) blockers.push("교재")
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
    const wordRetestTextbookId = getWordRetestEffectiveTextbookId(input, { classes })
    const wordRetestBranch = getWordRetestEffectiveBranch(input, { classes })
    if (!hasLinkedRecord(input.studentId)) blockers.push("학생")
    if (hasLinkedRecord(input.studentId) && !findStudentOption(students, input.studentId, indexes)) blockers.push("학생")
    if (!hasLinkedRecord(input.classId)) blockers.push("수업")
    if (hasLinkedRecord(input.classId) && !findClassOption(classes, input.classId, indexes)) blockers.push("수업")
    if (!hasLinkedRecord(wordRetest.teacherId)) blockers.push("선생님")
    if (hasLinkedRecord(wordRetest.teacherId) && !findTeacherOption(teachers, wordRetest.teacherId, indexes)) blockers.push("선생님")
    if (!String(wordRetestBranch || "").trim()) blockers.push("지점")
    if (!hasLinkedRecord(wordRetestTextbookId)) blockers.push("교재")
    if (hasLinkedRecord(wordRetestTextbookId) && !findTextbookOption(textbooks, wordRetestTextbookId, indexes)) blockers.push("교재")
    if (!String(wordRetest.testAt || "").trim()) blockers.push("응시일시")
    if (!String(wordRetest.unit || "").trim()) blockers.push("단원")
    if (shouldRequireWordRetestScore(wordRetest)) blockers.push("점수")
  }

  getOpsTaskScheduleCompletionBlockers(input, { classes }).forEach((blocker) => blockers.push(blocker))

  const rosterBlockers = getRosterCompletionBlockers(input, students, classes, indexes)
  return prioritizeCompletionBlockers([...blockers, ...rosterBlockers])
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
  "기존 학생 후보": "기존 학생 연결",
  "수업": "수업 연결",
  "교재": "교재 연결",
  "전 수업": "전 수업 연결",
  "후 수업": "후 수업 연결",
  "다른 수업": "다른 수업 선택",
  "수업 명단": "수업 명단 확인",
  "전 수업 명단": "전 수업 명단 확인",
  "선생님": "선생님 연결",
  "수업시작일": "수업시작일 지정",
  "수업시작회차": "수업시작회차 입력",
  "퇴원일": "퇴원일 지정",
  "퇴원회차": "퇴원회차 지정",
  "진행 수업시수": "진행 수업시수 입력",
  "4주 기준 수업시수": "4주 기준 수업시수 입력",
  "수업시수 충돌": "수업시수 수정",
  "전 수업 종료일": "전 수업 종료일 지정",
  "후 수업 시작일": "후 수업 시작일 지정",
  "전 수업 종료회차": "전 수업 종료회차 지정",
  "후 수업 시작회차": "후 수업 시작회차 지정",
  "일정 충돌": "일정 충돌 수정",
  "회차 충돌": "회차 충돌 수정",
  "회차 공백": "회차 공백 수정",
  "수업계획 회차": "수업계획 확인",
  "전 수업계획 회차": "전 수업계획 확인",
  "후 수업계획 회차": "후 수업계획 확인",
  "수업계획 진도": "수업계획 진도 확인",
  "전 수업계획 진도": "전 수업계획 진도 확인",
  "후 수업계획 진도": "후 수업계획 진도 확인",
  "수업계획 교재": "수업계획 교재 확인",
  "전 수업계획 교재": "전 수업계획 교재 확인",
  "후 수업계획 교재": "후 수업계획 교재 확인",
  "원장 분석": "원장 분석 입력",
  "원장 반배정": "원장 반배정",
  "입학안내문": "입학안내문",
  "수납": "수납 확인",
  "메이크에듀 등록": "메이크에듀 등록",
  "청구서 발송": "청구서 발송",
  "교재 청구출고표": "교재 청구출고표",
  "메이크에듀 퇴원처리": "메이크에듀 퇴원처리",
  "메이크에듀 전반처리": "메이크에듀 전반처리",
  "수업료 처리": "수업료 처리",
  "교재비 처리": "교재비 처리",
  "응시일시": "응시일시 지정",
  "단원": "단원 입력",
  "점수": "점수 입력",
}

const COMPLETION_BLOCKER_PRIORITY = [
  ...Object.keys(BLOCKER_ACTION_LABELS),
]

const CLASS_PLAN_BLOCKER_SECTIONS: Record<string, string> = {
  "수업계획 회차": "lesson-design-periods",
  "전 수업계획 회차": "lesson-design-periods",
  "후 수업계획 회차": "lesson-design-periods",
  "수업계획 진도": "lesson-design-board",
  "전 수업계획 진도": "lesson-design-board",
  "후 수업계획 진도": "lesson-design-board",
  "수업계획 교재": "lesson-design-textbooks",
  "전 수업계획 교재": "lesson-design-textbooks",
  "후 수업계획 교재": "lesson-design-textbooks",
}

type CompletionBlockerTaskTarget = Pick<OpsTask, "id" | "title"> & Partial<Pick<OpsTask, "type" | "classId" | "registration" | "withdrawal" | "transfer">>

function getClassPlanSessionOrderValue(value: unknown) {
  const matchedSession = String(value || "").match(/\d+/)
  const sessionOrder = matchedSession ? Number(matchedSession[0]) : Number(value)
  return Number.isFinite(sessionOrder) && sessionOrder > 0 ? sessionOrder : 0
}

function getClassPlanBlockerSessionOrder(task: CompletionBlockerTaskTarget, blocker: string) {
  if (task.type === "registration" && (blocker === "수업계획 회차" || blocker === "수업계획 진도")) {
    return getClassPlanSessionOrderValue(task.registration?.classStartSession)
  }
  if (task.type === "withdrawal" && (blocker === "수업계획 회차" || blocker === "수업계획 진도")) {
    return getClassPlanSessionOrderValue(task.withdrawal?.withdrawalSession)
  }
  if (task.type === "transfer") {
    if (blocker.startsWith("전 ")) return getClassPlanSessionOrderValue(task.transfer?.fromClassEndSession)
    if (blocker.startsWith("후 ")) return getClassPlanSessionOrderValue(task.transfer?.toClassStartSession)
  }
  return 0
}

function getClassPlanBlockerHref(task: CompletionBlockerTaskTarget, blocker: string) {
  const sectionId = CLASS_PLAN_BLOCKER_SECTIONS[blocker]
  if (!sectionId) return ""

  const classId = getClassPlanBlockerClassId(task, blocker)
  if (!classId) return ""

  const params = new URLSearchParams()
  params.set("classId", classId)
  params.set("lessonDesign", "1")
  params.set("section", sectionId)
  const sessionOrder = getClassPlanBlockerSessionOrder(task, blocker)
  if (sessionOrder) params.set("sessionOrder", String(sessionOrder))
  return `/admin/curriculum/lesson-design?${params.toString()}`
}

function getClassPlanBlockerClassId(task: CompletionBlockerTaskTarget, blocker: string) {
  if (task.type === "transfer") {
    if (task.type === "transfer" && blocker.startsWith("전 ")) return task.transfer?.fromClassId || ""
    if (task.type === "transfer" && blocker.startsWith("후 ")) return task.transfer?.toClassId || task.classId || ""
    return task.transfer?.fromClassId || task.classId || task.transfer?.toClassId || ""
  }

  return task.classId || ""
}

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
  "수업계획 회차",
  "전 수업계획 회차",
  "후 수업계획 회차",
  "원장 반배정",
  "입학안내문",
  "수납",
  "메이크에듀 등록",
  "청구서 발송",
  "교재 청구출고표",
  "메이크에듀 퇴원처리",
  "메이크에듀 전반처리",
  "수업료 처리",
  "교재비 처리",
  "수업계획 진도",
  "전 수업계획 진도",
  "후 수업계획 진도",
  "수업계획 교재",
  "전 수업계획 교재",
  "후 수업계획 교재",
])

const INPUT_COMPLETION_BLOCKERS = new Set([
  "수업시작일",
  "수업시작회차",
  "원장 분석",
  "퇴원일",
  "전 수업 종료일",
  "후 수업 시작일",
  "퇴원회차",
  "진행 수업시수",
  "4주 기준 수업시수",
  "전 수업 종료회차",
  "후 수업 시작회차",
  "응시일시",
  "단원",
  "점수",
])

const FIX_COMPLETION_BLOCKERS = new Set(["일정 충돌", "회차 충돌", "회차 공백", "수업시수 충돌"])
const CHOICE_COMPLETION_BLOCKERS = new Set(["다른 수업"])

function getCompletionBlockerNeedLabel(blocker: string) {
  if (INPUT_COMPLETION_BLOCKERS.has(blocker)) return "입력 필요"
  if (FIX_COMPLETION_BLOCKERS.has(blocker)) return "수정 필요"
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
    if (blockers.some((blocker) => ["학생"].includes(blocker))) return "registration_contact"
    if (blockers.some((blocker) => ["기존 학생 후보"].includes(blocker))) return "registration_checks"
    if (blockers.some((blocker) => ["수업", "교재", "수업시작일", "수업시작회차", "수업계획 회차", "수업계획 진도", "수업계획 교재", "원장 반배정"].includes(blocker))) return "registration_start"
    if (blockers.some((blocker) => ["원장 분석"].includes(blocker))) return "registration_test"
    if (blockers.some((blocker) => ["입학안내문", "수납", "메이크에듀 등록", "청구서 발송", "교재 청구출고표"].includes(blocker))) return "registration_checks"
  }

  if (type === "withdrawal") {
    if (blockers.some((blocker) => ["학생", "수업", "수업 명단", "퇴원일", "퇴원회차", "진행 수업시수", "4주 기준 수업시수", "수업시수 충돌", "수업계획 회차", "수업계획 진도", "수업계획 교재"].includes(blocker))) return "withdrawal_basic"
    if (blockers.some((blocker) => ["메이크에듀 퇴원처리", "수업료 처리", "교재비 처리"].includes(blocker))) return "withdrawal_checks"
  }

  if (type === "transfer") {
    if (blockers.some((blocker) => ["학생"].includes(blocker))) return "transfer_basic"
    if (blockers.some((blocker) => ["전 수업", "후 수업", "다른 수업", "전 수업 명단", "전 수업 종료일", "후 수업 시작일", "전 수업 종료회차", "후 수업 시작회차", "일정 충돌", "회차 충돌", "회차 공백", "수업계획 회차", "전 수업계획 회차", "후 수업계획 회차", "수업계획 진도", "전 수업계획 진도", "후 수업계획 진도", "수업계획 교재", "전 수업계획 교재", "후 수업계획 교재"].includes(blocker))) return "transfer_schedule"
    if (blockers.some((blocker) => ["메이크에듀 전반처리", "수업료 처리", "교재비 처리"].includes(blocker))) return "transfer_checks"
  }

  if (type === "word_retest") {
    if (blockers.some((blocker) => ["학생", "수업", "선생님", "응시일시", "수업 명단"].includes(blocker))) return "word_retest_basic"
    if (blockers.some((blocker) => ["교재", "단원"].includes(blocker))) return "word_retest_scope"
    if (blockers.some((blocker) => ["점수"].includes(blocker))) return "word_retest_scores"
  }

  return null
}

function getCompletionBlockerFocusField(type: OpsTaskType, blockers: string[]) {
  const blocker = blockers[0] || ""

  if (type === "registration") {
    if (blocker === "학생") return "registration.studentName"
    if (blocker === "기존 학생 후보") return "registration.student"
    if (["수업", "수업계획 회차", "수업계획 진도"].includes(blocker)) return "registration.class"
    if (["교재", "수업계획 교재"].includes(blocker)) return "registration.textbook"
    if (blocker === "수업시작일") return "registration.classStartDate"
    if (blocker === "수업시작회차") return "registration.classStartSession"
    if (blocker === "원장 분석") return "registration.principalReviewNote"
    if (blocker === "원장 반배정") return "registration.principalPlacementChecked"
    if (blocker === "입학안내문") return "registration.admissionNoticeSent"
    if (blocker === "수납") return "registration.paymentChecked"
    if (blocker === "메이크에듀 등록") return "registration.makeeduRegistered"
    if (blocker === "청구서 발송") return "registration.makeeduInvoiceSent"
    if (blocker === "교재 청구출고표") return "registration.textbookBillingIssued"
  }

  if (type === "withdrawal") {
    if (blocker === "학생") return "withdrawal.student"
    if (["수업", "수업 명단", "수업계획 회차", "수업계획 진도", "수업계획 교재"].includes(blocker)) return "withdrawal.class"
    if (blocker === "퇴원일") return "withdrawal.withdrawalDate"
    if (blocker === "퇴원회차") return "withdrawal.withdrawalSession"
    if (blocker === "진행 수업시수") return "withdrawal.completedLessonHours"
    if (blocker === "4주 기준 수업시수") return "withdrawal.fourWeekLessonHours"
    if (blocker === "수업시수 충돌") return "withdrawal.completedLessonHours"
    if (blocker === "메이크에듀 퇴원처리") return "withdrawal.makeeduWithdrawalDone"
    if (blocker === "수업료 처리") return "withdrawal.feeProcessed"
    if (blocker === "교재비 처리") return "withdrawal.textbookFeeProcessed"
  }

  if (type === "transfer") {
    if (blocker === "학생") return "transfer.student"
    if (["전 수업", "전 수업 명단", "수업계획 회차", "전 수업계획 회차", "수업계획 진도", "전 수업계획 진도", "수업계획 교재", "전 수업계획 교재"].includes(blocker)) return "transfer.fromClass"
    if (["후 수업", "다른 수업", "후 수업계획 회차", "후 수업계획 진도", "후 수업계획 교재"].includes(blocker)) return "transfer.toClass"
    if (blocker === "전 수업 종료일") return "transfer.fromClassEndDate"
    if (blocker === "후 수업 시작일" || blocker === "일정 충돌") return "transfer.toClassStartDate"
    if (blocker === "전 수업 종료회차") return "transfer.fromClassEndSession"
    if (blocker === "회차 충돌" || blocker === "회차 공백") return "transfer.toClassStartSession"
    if (blocker === "후 수업 시작회차") return "transfer.toClassStartSession"
    if (blocker === "메이크에듀 전반처리") return "transfer.makeeduTransferDone"
    if (blocker === "수업료 처리") return "transfer.feeProcessed"
    if (blocker === "교재비 처리") return "transfer.textbookFeeProcessed"
  }

  if (type === "word_retest") {
    if (blocker === "학생") return "wordRetest.student"
    if (blocker === "수업" || blocker === "수업 명단") return "wordRetest.class"
    if (blocker === "선생님") return "wordRetest.teacher"
    if (blocker === "응시일시") return "wordRetest.testAt"
    if (blocker === "교재") return "wordRetest.textbook"
    if (blocker === "단원") return "wordRetest.unit"
    if (blocker === "점수") return "wordRetest.firstScore"
  }

  return ""
}

function buildRequiredCompletionFieldSet(type: OpsTaskType, blockers: string[]) {
  const fields = new Set<string>()
  blockers.forEach((blocker) => {
    const field = getCompletionBlockerFocusField(type, [blocker])
    if (field) fields.add(field)
  })
  return fields
}

function formatCompletionBlockerNotice(blockers: string[]) {
  if (blockers.length === 0) return ""
  const visibleBlockers = blockers.slice(0, 3).join(", ")
  const hiddenCount = blockers.length - 3
  return `필수값을 확인하세요: ${visibleBlockers}${hiddenCount > 0 ? ` 외 ${hiddenCount}개` : ""}`
}

function blurActiveElementBeforeDialog() {
  if (typeof document === "undefined") return
  const activeElement = document.activeElement
  if (activeElement instanceof HTMLElement) activeElement.blur()
}

function dateLabel(value: string) {
  const date = toDateKey(value)
  if (!date) return "-"

  const time = timeLabel(value)
  return time ? `${date} ${time}` : date
}

function getDueAtDisplayLabel(type: OpsTaskType) {
  return type === "general" ? "예정일" : "다음 처리일"
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

  addTaskScheduleItem(items, getDueAtDisplayLabel(task.type), task.dueAt)

  if (task.type === "registration") {
    addTaskScheduleItem(items, "문의", task.registration?.inquiryAt)
    addTaskScheduleItem(items, "전화상담", task.registration?.phoneConsultationAt)
    addTaskScheduleItem(items, "방문상담", task.registration?.visitConsultationAt)
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
    addTaskScheduleItem(items, "응시", task.wordRetest?.testAt)
  }

  return items.sort((left, right) => (
    left.date.localeCompare(right.date) ||
    left.label.localeCompare(right.label, "ko")
  ))
}

function hasTaskSchedule(task: OpsTask) {
  return getTaskScheduleItems(task).length > 0
}

function hasTaskOrganizationIssue(task: OpsTask, completionBlockers: string[] = EMPTY_COMPLETION_BLOCKERS) {
  return !task.assigneeId || !hasTaskSchedule(task) || completionBlockers.length > 0
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

function getPrimaryTaskScheduleDate(task: OpsTask, todayKey: string) {
  return getPrimaryTaskScheduleItem(task, todayKey)?.date || ""
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
      return "상태 변경"
    case "created":
      return "생성"
    case "updated":
      return "수정"
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

function getTaskOrganizationFixes(task: OpsTask, completionBlockers: string[] = EMPTY_COMPLETION_BLOCKERS) {
  if (isClosedOpsTask(task)) return []

  return [
    !task.assigneeId ? "담당 지정" : "",
    !hasTaskSchedule(task) ? "예정 지정" : "",
    completionBlockers.length > 0 ? "완료 전 정리" : "",
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

  if (task.type === "general" && schedule.label === "예정") {
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

function isOpenTask(task: OpsTask) {
  return task.status !== "done" && task.status !== "canceled"
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
    task.secondaryAssigneeLabel,
    task.requestedByLabel,
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

const TODO_PRIORITY_ORDER: Record<OpsTaskPriority, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
}

function getTodoDueOrder(task: OpsTask, todayKey: string) {
  const dueDate = getPrimaryTaskScheduleDate(task, todayKey)
  if (!dueDate) return 3
  if (dueDate < todayKey) return 0
  if (dueDate === todayKey) return 1
  return 2
}

function todoDueSortKey(task: OpsTask, todayKey: string) {
  const schedule = getPrimaryTaskScheduleItem(task, todayKey)
  if (!schedule) return ""
  return dateTimeInputValue(schedule.value) || schedule.date
}

function sortTodoTasks(tasks: OpsTask[], todayKey: string) {
  return [...tasks].sort((left, right) => {
    const leftDueOrder = getTodoDueOrder(left, todayKey)
    const rightDueOrder = getTodoDueOrder(right, todayKey)
    if (leftDueOrder !== rightDueOrder) return leftDueOrder - rightDueOrder

    const leftDue = todoDueSortKey(left, todayKey)
    const rightDue = todoDueSortKey(right, todayKey)
    if (leftDue && rightDue && leftDue !== rightDue) return leftDue.localeCompare(rightDue)

    const priorityDiff = TODO_PRIORITY_ORDER[left.priority] - TODO_PRIORITY_ORDER[right.priority]
    if (priorityDiff !== 0) return priorityDiff

    return String(right.createdAt || right.updatedAt).localeCompare(String(left.createdAt || left.updatedAt))
  })
}

function getTodoBoardColumnKey(
  task: OpsTask,
  todayKey: string,
  currentUserId: string,
  currentUserLabel: string,
): TodoBoardColumn["key"] {
  const dueDate = getPrimaryTaskScheduleDate(task, todayKey)
  if ((dueDate && dueDate < todayKey) || hasOpsTaskOverdueCalendarDate(task, todayKey)) return "overdue"
  if (hasOpsTaskCalendarDate(task, todayKey)) return "today"
  if (hasOpsTaskFutureCalendarDate(task, todayKey)) return "upcoming"
  if (isOpsTaskAssignedToUser(task, currentUserId, currentUserLabel)) return "mine"
  return "unsorted"
}

function buildTodoBoardColumns(
  tasks: OpsTask[],
  todayKey: string,
  currentUserId: string,
  currentUserLabel: string,
): TodoBoardColumn[] {
  const columns: TodoBoardColumn[] = [
    { key: "overdue", label: "지연", tasks: [] },
    { key: "today", label: "오늘", tasks: [] },
    { key: "mine", label: "내 담당", tasks: [] },
    { key: "upcoming", label: "예정", tasks: [] },
    { key: "unsorted", label: "미정리", tasks: [] },
  ]
  const columnByKey = new Map(columns.map((column) => [column.key, column]))

  for (const task of sortTodoTasks(tasks.filter((task) => isOpsTaskActionable(task, { today: todayKey })), todayKey)) {
    const column = columnByKey.get(getTodoBoardColumnKey(task, todayKey, currentUserId, currentUserLabel))
    column?.tasks.push(task)
  }

  return columns
}

function dateTimeValueFromDateKey(dateKey: string, dayOffset = 0) {
  const date = new Date(`${dateKey}T00:00:00`)
  if (Number.isNaN(date.getTime())) return ""
  date.setDate(date.getDate() + dayOffset)
  date.setHours(9, 0, 0, 0)
  return quickDateTimeFromDate(date)
}

function moveTodoTaskToBoardColumn(
  task: OpsTask,
  columnKey: TodoBoardColumn["key"],
  { todayKey, currentUserId }: { todayKey: string; currentUserId: string },
): OpsTaskInput {
  const input = formFromTask(task)

  if (columnKey === "overdue") {
    return { ...input, dueAt: dateTimeValueFromDateKey(todayKey, -1) }
  }
  if (columnKey === "today") {
    return { ...input, dueAt: dateTimeValueFromDateKey(todayKey) }
  }
  if (columnKey === "upcoming") {
    return { ...input, dueAt: dateTimeValueFromDateKey(todayKey, 1) }
  }
  if (columnKey === "mine") {
    return {
      ...input,
      dueAt: "",
      assigneeId: currentUserId || input.assigneeId,
    }
  }

  return {
    ...input,
    dueAt: "",
    assigneeId: "",
    secondaryAssigneeId: "",
  }
}

function getOperationProcessStageKey(task: OpsTask, workspace: OperationProcessWorkspaceKey) {
  const config = OPERATION_PROCESS_BOARD_CONFIGS[workspace]
  if (workspace === "registration") {
    const pipelineStatus = task.registration?.pipelineStatus || REGISTRATION_PIPELINE_STATUSES[0]?.value || ""
    return config.stages.some((stage) => stage.key === pipelineStatus) ? pipelineStatus : config.stages[0]?.key || ""
  }

  if (task.status === "requested") return "requested"
  if (task.status === "done" || task.status === "canceled") return "done"
  return "in_progress"
}

function getOperationProcessStatusForStage(workspace: OperationProcessWorkspaceKey, stageKey: string): OpsTaskStatus | undefined {
  return OPERATION_PROCESS_BOARD_CONFIGS[workspace].stages.find((stage) => stage.key === stageKey)?.status
}

function buildOperationProcessBoardColumns(
  tasks: OpsTask[],
  workspace: OperationProcessWorkspaceKey,
): OperationProcessBoardColumn[] {
  const columns = OPERATION_PROCESS_BOARD_CONFIGS[workspace].stages.map((stage) => ({
    ...stage,
    tasks: [] as OpsTask[],
  }))
  const columnByKey = new Map(columns.map((column) => [column.key, column]))

  for (const task of sortWorkspaceTasks(tasks)) {
    const column = columnByKey.get(getOperationProcessStageKey(task, workspace))
    column?.tasks.push(task)
  }

  return columns
}

function operationProcessText(value: unknown) {
  return String(value || "").trim() || "-"
}

function operationProcessBoolean(value: unknown) {
  return value ? "완료" : "미완료"
}

function getOperationProcessHumanId(task: OpsTask) {
  const shortId = String(task.id || "").split("-")[0]?.slice(0, 8)
  return shortId ? `#${shortId}` : "-"
}

function getWithdrawalLessonProgressRate(withdrawal?: OpsWithdrawalDetail) {
  const completedLessonHours = getWithdrawalSettlementNumber(withdrawal?.completedLessonHours)
  const fourWeekLessonHours = getWithdrawalSettlementNumber(withdrawal?.fourWeekLessonHours)
  if (!Number.isFinite(completedLessonHours) || !Number.isFinite(fourWeekLessonHours) || fourWeekLessonHours <= 0) return "-"
  return `${Math.round((completedLessonHours / fourWeekLessonHours) * 100)}%`
}

function getOperationProcessCellValue(task: OpsTask, column: OperationProcessDatabaseColumn, todayKey: string) {
  switch (column.key) {
    case "id":
      return getOperationProcessHumanId(task)
    case "stage":
      return task.type === "registration"
        ? REGISTRATION_PIPELINE_STATUSES.find((status) => status.value === task.registration?.pipelineStatus)?.label || task.registration?.pipelineStatus || "-"
        : getTaskStatusLabel(task.status)
    case "connection":
      return "-"
    case "visitConsultationRoom":
      return "-"
    case "transferTimetableRosterUpdated":
      return operationProcessBoolean(task.transfer?.timetableRosterUpdated)
    case "makeeduTransferDone":
      return operationProcessBoolean(task.transfer?.makeeduTransferDone)
    case "transferFeeSettled":
      return task.transfer?.feeProcessed && task.transfer?.textbookFeeProcessed ? "완료" : "미완료"
    case "lessonProgressRate":
      return getWithdrawalLessonProgressRate(task.withdrawal)
    case "withdrawalTimetableRosterUpdated":
      return operationProcessBoolean(task.withdrawal?.timetableRosterUpdated)
    case "makeeduWithdrawalDone":
      return operationProcessBoolean(task.withdrawal?.makeeduWithdrawalDone)
    case "withdrawalFeeSettled":
      return task.withdrawal?.feeProcessed && task.withdrawal?.textbookFeeProcessed ? "완료" : "미완료"
    case "blockers":
      return ""
    case "actions":
      return ""
    default:
      if (column.field) {
        const editValue = getOperationProcessCellEditValue(task, column.field)
        return getOperationProcessInlineEditType(column.field) === "date" ? dateLabel(editValue) : operationProcessText(editValue)
      }
      return todayKey ? "-" : "-"
  }
}

function getOperationProcessCellEditValue(task: OpsTask, field: OperationProcessCellField) {
  const [scope, key = ""] = field.split(".")
  switch (field) {
    case "task.title":
      return task.title || ""
    case "task.studentName":
      return task.studentName || ""
    case "task.subject":
      return task.subject || ""
    case "task.memo":
      return task.memo || ""
    case "task.assignee":
      return task.assigneeLabel || ""
    case "task.dueAt":
      return task.dueAt || ""
    case "withdrawal.class":
      return task.className || ""
    default:
      if (scope === "registration") return String((task.registration as Record<string, unknown> | undefined)?.[key] || "")
      if (scope === "transfer") return String((task.transfer as Record<string, unknown> | undefined)?.[key] || "")
      if (scope === "withdrawal") return String((task.withdrawal as Record<string, unknown> | undefined)?.[key] || "")
      return ""
  }
}

function getOperationProcessInlineEditType(field?: OperationProcessCellField): OperationProcessInlineEditType | null {
  if (!field) return null
  if (field === "task.dueAt" || field.endsWith("At") || field.endsWith("Date")) {
    return "date"
  }
  return "text"
}

function applyOperationProcessCellEdit(input: OpsTaskInput, field: OperationProcessCellField, value: string): OpsTaskInput {
  const next = cloneForm(input)
  if (field === "task.title") return { ...next, title: value }
  if (field === "task.studentName") return { ...next, studentName: value, studentId: value.trim() ? next.studentId : "" }
  if (field === "task.subject") return { ...next, subject: value }
  if (field === "task.memo") return { ...next, memo: value }
  if (field === "task.dueAt") return { ...next, dueAt: value }
  if (field === "withdrawal.class") return { ...next, className: value, classId: value.trim() ? next.classId : "" }
  const [scope, key = ""] = field.split(".")
  if (scope === "registration" && key) return { ...next, registration: { ...(next.registration || {}), [key]: value } }
  if (scope === "transfer" && key) return { ...next, transfer: { ...(next.transfer || {}), [key]: value } }
  if (scope === "withdrawal" && key) return { ...next, withdrawal: { ...(next.withdrawal || {}), [key]: value } }
  return next
}

function getOperationProcessCellFocusTarget(
  workspace: OperationProcessWorkspaceKey,
  field: OperationProcessCellField,
): { step: FormDetailStepKey; field: string; message: string } {
  if (field === "task.title") return { step: getDefaultFormDetailStep(workspace), field: "task.title", message: "이름 입력" }
  if (field === "task.studentName") {
    const step = workspace === "registration" ? "registration_contact" : workspace === "transfer" ? "transfer_basic" : "withdrawal_basic"
    return { step, field: `${workspace}.student`, message: "학생 입력" }
  }
  if (field === "task.assignee") return { step: getDefaultFormDetailStep(workspace), field: "task.assignee", message: "담당 입력" }
  if (field === "task.dueAt") return { step: getDefaultFormDetailStep(workspace), field: "task.dueAt", message: "다음 처리일 입력" }
  if (field.startsWith("registration.levelTest")) return { step: "registration_test", field, message: "레벨테스트 입력" }
  if (field.startsWith("registration.classStart") || field === "registration.class") return { step: "registration_start", field, message: "수업 연결" }
  if (field.startsWith("registration.")) return { step: "registration_contact", field, message: "등록 정보 입력" }
  if (field.startsWith("transfer.from") || field.startsWith("transfer.to")) return { step: "transfer_schedule", field, message: "전반 일정 입력" }
  if (field.startsWith("transfer.")) return { step: "transfer_basic", field, message: "전반 정보 입력" }
  if (field === "withdrawal.customerReason" || field === "withdrawal.teacherOpinion" || field === "withdrawal.undistributedTextbooks" || field === "task.memo") {
    return { step: "withdrawal_reason", field, message: "퇴원 사유 입력" }
  }
  if (field.startsWith("withdrawal.")) return { step: "withdrawal_basic", field, message: "퇴원 정보 입력" }
  return { step: getDefaultFormDetailStep(workspace), field, message: "정보 입력" }
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

function getTodoViewForDueAt(dueAt: string | undefined, todayKey: string): TodoViewKey {
  const dueDate = toDateKey(dueAt)
  if (!dueDate) return "inbox"
  return dueDate <= todayKey ? "today" : "upcoming"
}

function hasOpsTaskFutureCalendarDate(task: OpsTask, todayKey: string) {
  const targetDate = toDateKey(todayKey)
  if (!targetDate || !isOpsTaskActionable(task, { today: targetDate })) return false
  return getOpsTaskCalendarItems([task]).some((item) => item.date > targetDate)
}

function normalizeQuickAddLookup(value: string) {
  return value.trim().replace(/\s+/g, "").toLowerCase()
}

function normalizeQuickAddMemoToken(value: string) {
  if ((value.startsWith("@") || value.startsWith("#")) && value.length > 1) return value.slice(1)
  return value
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

function isTeacherWordRetest(task: OpsTask, currentUserId: string, currentUserLabel: string) {
  return isOpsTaskAssignedToUser(task, currentUserId, currentUserLabel)
}

function isWordRetestInTeacherQueue(task: OpsTask, queue: WordRetestTeacherQueueMode) {
  if (task.type !== "word_retest") return false
  if (queue === "all") return isOpenTask(task) || isWordRetestRerequestable(task)
  if (queue === "active") return isOpenTask(task)
  if (queue === "rerequest") return isWordRetestRerequestable(task)
  return false
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

function SelectField({
  label,
  value,
  onChange,
  children,
  completionField,
  required = false,
  invalid = false,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  children: ReactNode
  completionField?: string
  required?: boolean
  invalid?: boolean
}) {
  const fieldId = useId()
  const requiredLabel = (
    <>
      {label}
      {required && <span aria-hidden="true" className="ml-0.5 text-destructive">*</span>}
    </>
  )

  return (
    <div className="grid min-w-0 gap-1.5 text-sm font-medium">
      <label htmlFor={fieldId}>{requiredLabel}</label>
      <select
        id={fieldId}
        aria-label={label}
        aria-required={required || undefined}
        aria-invalid={invalid || undefined}
        data-completion-field={completionField}
        data-required-missing={invalid ? "true" : undefined}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={[
          "h-9 w-full min-w-0 rounded-md border px-3 text-sm shadow-xs outline-none focus:ring-2",
          invalid
            ? "border-destructive/60 bg-destructive/5 text-foreground focus:border-destructive focus:ring-destructive/25"
            : "bg-background focus:border-ring focus:ring-ring/40",
        ].join(" ")}
      >
        {children}
      </select>
    </div>
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

function LinkedSelect({
  label,
  value,
  options,
  onChange,
  manualLabel,
  onManualSelect,
  completionField,
  autoFocus,
  required = false,
  invalid = false,
}: {
  label: string
  value: string
  options: LinkedSelectOption[]
  onChange: (value: string) => void
  manualLabel?: string
  onManualSelect?: (query?: string) => void
  completionField?: string
  autoFocus?: boolean
  required?: boolean
  invalid?: boolean
}) {
  const fieldId = useId()
  const queryId = useId()
  const [linkedQuery, setLinkedQuery] = useState("")
  const shouldShowLinkedSearch = options.length > LINKED_SELECT_SEARCH_THRESHOLD
  const normalizedLinkedQuery = linkedQuery.trim().toLowerCase()
  const selectedOption = options.find((option) => option.id === value)
  const matchedOptions = useMemo(() => {
    if (!shouldShowLinkedSearch || !normalizedLinkedQuery) return []
    return options.filter((option) => optionSearchText(option).includes(normalizedLinkedQuery))
  }, [normalizedLinkedQuery, options, shouldShowLinkedSearch])
  const filteredOptions = useMemo(() => {
    const shouldDeferLinkedOptions = shouldShowLinkedSearch && !normalizedLinkedQuery
    if (shouldDeferLinkedOptions) return selectedOption ? [selectedOption] : []

    const nextOptions = shouldShowLinkedSearch && normalizedLinkedQuery ? matchedOptions : options

    const limitedOptions = normalizedLinkedQuery ? nextOptions.slice(0, LINKED_SELECT_QUERY_OPTION_LIMIT) : nextOptions
    if (!selectedOption || limitedOptions.some((option) => option.id === selectedOption.id)) return limitedOptions
    return [selectedOption, ...limitedOptions]
  }, [matchedOptions, normalizedLinkedQuery, options, selectedOption, shouldShowLinkedSearch])
  const quickSelectOption = useMemo(() => {
    if (!shouldShowLinkedSearch || !normalizedLinkedQuery) return undefined
    const exactOption = matchedOptions.find((option) => optionExactSearchParts(option).includes(normalizedLinkedQuery))
    return exactOption || (matchedOptions.length === 1 ? matchedOptions[0] : undefined)
  }, [matchedOptions, normalizedLinkedQuery, shouldShowLinkedSearch])
  const emptyOptionLabel = shouldShowLinkedSearch && !normalizedLinkedQuery
    ? `${label} 검색 후 선택`
    : shouldShowLinkedSearch && normalizedLinkedQuery && matchedOptions.length === 0
      ? "검색 결과 없음"
      : "선택"
  const canQuickManualSelect = Boolean(onManualSelect && shouldShowLinkedSearch && normalizedLinkedQuery && matchedOptions.length === 0)
  const manualOptionLabel = canQuickManualSelect
    ? `${manualLabel || "직접 입력"}: ${linkedQuery.trim()}`
    : manualLabel || "직접 입력"
  const requiredLabel = (
    <>
      {label}
      {required && <span aria-hidden="true" className="ml-0.5 text-destructive">*</span>}
    </>
  )
  const controlClassName = [
    "h-9 w-full min-w-0 rounded-md border px-3 text-sm shadow-xs outline-none focus:ring-2",
    invalid
      ? "border-destructive/60 bg-destructive/5 text-foreground focus:border-destructive focus:ring-destructive/25"
      : "bg-background focus:border-ring focus:ring-ring/40",
  ].join(" ")

  function handleManualSelect(manualQuery = linkedQuery.trim()) {
    onChange("")
    onManualSelect?.(manualQuery)
    setLinkedQuery("")
  }

  function handleLinkedChange(nextValue: string) {
    if (nextValue === LINKED_SELECT_MANUAL_VALUE) {
      handleManualSelect()
      return
    }
    onChange(nextValue)
    setLinkedQuery("")
  }

  function handleLinkedQueryKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return
    if (quickSelectOption) {
      event.preventDefault()
      handleLinkedChange(quickSelectOption.id)
      return
    }
    if (canQuickManualSelect) {
      event.preventDefault()
      handleManualSelect(linkedQuery.trim())
    }
  }

  return (
    <div className="grid min-w-0 gap-1.5 text-sm font-medium">
      <label htmlFor={fieldId}>{requiredLabel}</label>
      {shouldShowLinkedSearch ? (
        <Input
          id={queryId}
          type="search"
          value={linkedQuery}
          placeholder={`${label} 검색`}
          aria-label={`${label} 검색`}
          autoComplete="off"
          autoFocus={autoFocus}
          aria-invalid={invalid || undefined}
          data-required-missing={invalid ? "true" : undefined}
          className={[
            "h-9 min-w-0",
            invalid ? "border-destructive/60 bg-destructive/5 focus-visible:ring-destructive/25" : "",
          ].filter(Boolean).join(" ")}
          onChange={(event) => setLinkedQuery(event.target.value)}
          onKeyDown={handleLinkedQueryKeyDown}
        />
      ) : null}
      <select
        id={fieldId}
        aria-label={label}
        aria-describedby={shouldShowLinkedSearch ? queryId : undefined}
        aria-required={required || undefined}
        aria-invalid={invalid || undefined}
        data-completion-field={completionField}
        data-required-missing={invalid ? "true" : undefined}
        value={value}
        autoFocus={autoFocus && !shouldShowLinkedSearch}
        onChange={(event) => handleLinkedChange(event.target.value)}
        className={controlClassName}
      >
        <option value="">{emptyOptionLabel}</option>
        {onManualSelect && <option value={LINKED_SELECT_MANUAL_VALUE}>{manualOptionLabel}</option>}
        {filteredOptions.map((option) => (
          <option key={option.id} value={option.id}>
            {option.meta ? `${option.label} · ${option.meta}` : option.label}
          </option>
        ))}
      </select>
    </div>
  )
}

function ProfileSelect({
  label = "담당자",
  value,
  profiles,
  onChange,
  completionField,
  required = false,
  invalid = false,
}: {
  label?: string
  value: string
  profiles: OpsProfileOption[]
  onChange: (value: string) => void
  completionField?: string
  required?: boolean
  invalid?: boolean
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
      completionField={completionField}
      required={required}
      invalid={invalid}
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
  completionField,
  required = false,
  invalid = false,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: string
  placeholder?: string
  inputMode?: "none" | "text" | "tel" | "url" | "email" | "numeric" | "decimal" | "search"
  autoFocus?: boolean
  completionField?: string
  required?: boolean
  invalid?: boolean
}) {
  const fieldId = useId()
  const handleInputChange = (value: string) => onChange(value)
  const requiredLabel = (
    <>
      {label}
      {required && <span aria-hidden="true" className="ml-0.5 text-destructive">*</span>}
    </>
  )

  return (
    <label htmlFor={fieldId} className="grid min-w-0 gap-1.5 text-sm font-medium">
      <span>{requiredLabel}</span>
      <Input
        id={fieldId}
        type={type}
        value={value}
        aria-required={required || undefined}
        aria-invalid={invalid || undefined}
        data-completion-field={completionField}
        data-required-missing={invalid ? "true" : undefined}
        className={[
          "min-w-0",
          invalid ? "border-destructive/60 bg-destructive/5 focus-visible:ring-destructive/25" : "",
        ].filter(Boolean).join(" ")}
        placeholder={placeholder}
        inputMode={inputMode}
        autoFocus={autoFocus}
        onChange={(event) => handleInputChange(event.target.value)}
        onInput={(event) => handleInputChange(event.currentTarget.value)}
      />
    </label>
  )
}

function CheckField({
  label,
  checked,
  completionField,
  onChange,
  required = false,
  invalid = false,
}: {
  label: string
  checked: boolean
  completionField?: string
  onChange: (value: boolean) => void
  required?: boolean
  invalid?: boolean
}) {
  const requiredLabel = (
    <>
      {label}
      {required && <span aria-hidden="true" className="ml-0.5 text-destructive">*</span>}
    </>
  )

  return (
    <label className={[
      "flex min-w-0 items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium",
      invalid ? "border-destructive/60 bg-destructive/5 text-destructive" : "",
    ].filter(Boolean).join(" ")}>
      <input
        type="checkbox"
        checked={checked}
        aria-required={required || undefined}
        aria-invalid={invalid || undefined}
        data-completion-field={completionField}
        data-required-missing={invalid ? "true" : undefined}
        onChange={(event) => onChange(event.target.checked)}
        className="size-4 accent-primary"
      />
      <span className="min-w-0 truncate">{requiredLabel}</span>
    </label>
  )
}

function ClassPlanInlineSummary({
  label = "수업계획",
  classItem,
  className = "",
}: {
  label?: string
  classItem?: OpsClassOption
  className?: string
}) {
  if (!classItem) return null

  const hasMissingTextbooks = Number(classItem.textbookIds?.length || 0) <= 0
  const hasMissingSessions = Number(classItem.sessionCount || 0) <= 0
  const hasUnplannedSessions = Number(classItem.unplannedSessionCount || 0) > 0
  const classPlanRiskLabel = hasMissingSessions
    ? "회차 미생성"
    : hasMissingTextbooks
      ? "교재 미연결"
      : hasUnplannedSessions
        ? "진도 미배정"
        : "계획 완료"

  return (
    <div className={["flex min-w-0 flex-wrap items-center gap-1.5 rounded-md border bg-muted/35 px-3 py-2 text-xs text-muted-foreground", className].filter(Boolean).join(" ")}>
      <span className="font-medium text-foreground">{label}</span>
      <span>{classItem.sessionCount}회</span>
      <Badge variant={classPlanRiskLabel === "계획 완료" ? "secondary" : "outline"} className="h-5 rounded px-1.5 text-[11px]">
        {classPlanRiskLabel}
      </Badge>
      {classItem.sessionCount > 0 ? (
        <Badge variant="secondary" className="h-5 rounded px-1.5 text-[11px]">
          배정 {classItem.plannedSessionCount}
        </Badge>
      ) : null}
      {hasUnplannedSessions ? (
        <Badge variant="outline" className="h-5 rounded px-1.5 text-[11px]">
          미배정 {classItem.unplannedSessionCount}
        </Badge>
      ) : null}
    </div>
  )
}

function getWithdrawalSessionNumber(value: unknown) {
  const match = String(value || "").replace(/,/g, "").match(/\d+(?:\.\d+)?/)
  if (!match) return Number.NaN
  const number = Number(match[0])
  return Number.isFinite(number) && number > 0 ? number : Number.NaN
}

function getClassPlanSelectedSession(classItem: OpsClassOption | undefined, sessionNumberValue: number) {
  if (!classItem || !Number.isFinite(sessionNumberValue) || !Array.isArray(classItem.planSessions) || classItem.planSessions.length === 0) return null
  return classItem.planSessions.find((session) => Number(session.sessionOrder) === sessionNumberValue) || null
}

function getRegistrationStartSessionRiskLabel(classItem: OpsClassOption | undefined, classStartSession: unknown) {
  if (!classItem) return ""

  const totalSessions = Number(classItem.sessionCount || 0)
  if (totalSessions <= 0) return "회차 미생성"

  const selectedSessionNumber = getWithdrawalSessionNumber(classStartSession)
  if (!Number.isFinite(selectedSessionNumber)) return "시작회차 입력 필요"

  const selectedSession = getClassPlanSelectedSession(classItem, selectedSessionNumber)
  if (Array.isArray(classItem.planSessions) && classItem.planSessions.length > 0) {
    if (!selectedSession) return "시작회차 없음"
    if (selectedSession.planned === false) return "진도 미배정 회차"
  }

  if (selectedSessionNumber > totalSessions) return "시작회차 초과"

  const plannedSessions = Number(classItem.plannedSessionCount || 0)
  if (plannedSessions > 0 && selectedSessionNumber > plannedSessions) return "진도 미배정 회차"

  return "회차 확인"
}

function getRegistrationPrincipalAnalysisRiskLabel(registration: NonNullable<OpsTaskInput["registration"]>) {
  return String(registration.principalReviewNote || "").trim() ? "분석 확인" : "분석 입력 필요"
}

function getRegistrationPrincipalPlacementRiskLabel(registration: NonNullable<OpsTaskInput["registration"]>) {
  return registration.principalPlacementChecked ? "반배정 확인" : "반배정 확인 필요"
}

function getRegistrationRosterRiskLabel(
  student: OpsStudentOption | undefined,
  classItem: OpsClassOption | undefined,
  studentName?: string,
) {
  if (!classItem) return ""
  if (student && hasRosterLink(student, classItem)) return "이미 명단 연결"
  if (student) return "명단 추가 예정"
  if (String(studentName || "").trim()) return "학생 생성 후 명단 추가"
  return "학생 입력 필요"
}

function getRegistrationTextbookIssueRiskLabel(classTextbooks: OpsTextbookOption[], selectedTextbookId = "") {
  if (selectedTextbookId || classTextbooks.length === 1) return "교재 청구 준비"
  if (classTextbooks.length <= 0) return "수업계획 교재 필요"
  return "교재 선택 필요"
}

function RegistrationPrincipalPlacementSummary({
  registration,
  studentName,
}: {
  registration: NonNullable<OpsTaskInput["registration"]>
  studentName?: string
}) {
  const valueOrDash = (value: unknown) => String(value || "").trim() || "-"
  const analysisRiskLabel = getRegistrationPrincipalAnalysisRiskLabel(registration)
  const placementRiskLabel = getRegistrationPrincipalPlacementRiskLabel(registration)

  return (
    <div className="grid gap-2 rounded-md border bg-muted/25 p-3 text-xs md:col-span-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-medium text-foreground">원장 분석 기준</span>
        <Badge variant={analysisRiskLabel === "분석 확인" ? "secondary" : "outline"} className="h-5 rounded px-1.5 text-[11px]">
          {analysisRiskLabel}
        </Badge>
        <Badge variant={placementRiskLabel === "반배정 확인" ? "secondary" : "outline"} className="h-5 rounded px-1.5 text-[11px]">
          {placementRiskLabel}
        </Badge>
      </div>
      <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 gap-y-2">
        <span className="text-muted-foreground">학생</span>
        <span className="min-w-0 truncate">{valueOrDash(studentName)}</span>

        <span className="text-muted-foreground">레벨테스트</span>
        <span className="min-w-0 truncate">{dateLabel(registration.levelTestAt || "")}</span>

        <span className="text-muted-foreground">레벨테스트 결과</span>
        <span className="min-w-0 truncate">{valueOrDash(registration.levelTestResult)}</span>

        <span className="text-muted-foreground">원장 분석</span>
        <span className="min-w-0 truncate">{valueOrDash(registration.principalReviewNote)}</span>

        <span className="text-muted-foreground">반배정</span>
        <span className="min-w-0 truncate">{registration.principalPlacementChecked ? "원장 반배정 완료" : "원장 반배정 대기"}</span>
      </div>
    </div>
  )
}

function RegistrationClassStartSummary({
  registration,
  student,
  studentName,
  classItem,
  classTextbooks,
  selectedTextbookId = "",
}: {
  registration: NonNullable<OpsTaskInput["registration"]>
  student?: OpsStudentOption
  studentName?: string
  classItem?: OpsClassOption
  classTextbooks: OpsTextbookOption[]
  selectedTextbookId?: string
}) {
  if (!classItem) return null

  const valueOrDash = (value: unknown) => String(value || "").trim() || "-"
  const riskLabel = getRegistrationStartSessionRiskLabel(classItem, registration.classStartSession)
  const rosterRiskLabel = getRegistrationRosterRiskLabel(student, classItem, studentName)
  const textbookIssueRiskLabel = getRegistrationTextbookIssueRiskLabel(classTextbooks, selectedTextbookId)
  const textbookList = classTextbooks.map((textbook) => textbook.label).join(", ") || "교재 연결 없음"
  const plannedSessions = Number(classItem.plannedSessionCount || 0)
  const totalSessions = Number(classItem.sessionCount || 0)
  const sessionSummary = totalSessions > 0
    ? `${totalSessions}회 중 배정 ${plannedSessions}회`
    : "회차 미생성"

  return (
    <div className="grid gap-2 rounded-md border bg-muted/25 p-3 text-xs md:col-span-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-medium text-foreground">등록 시작 기준</span>
        <Badge variant={riskLabel === "회차 확인" ? "secondary" : "outline"} className="h-5 rounded px-1.5 text-[11px]">
          {riskLabel}
        </Badge>
        <Badge variant={rosterRiskLabel === "이미 명단 연결" || rosterRiskLabel === "명단 추가 예정" ? "secondary" : "outline"} className="h-5 rounded px-1.5 text-[11px]">
          {rosterRiskLabel}
        </Badge>
        <Badge variant={textbookIssueRiskLabel === "교재 청구 준비" ? "secondary" : "outline"} className="h-5 rounded px-1.5 text-[11px]">
          {textbookIssueRiskLabel}
        </Badge>
      </div>
      <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 gap-y-2">
        <span className="text-muted-foreground">수업명단</span>
        <span className="min-w-0 truncate">{valueOrDash(student?.label || studentName)}</span>

        <span className="text-muted-foreground">수업</span>
        <span className="min-w-0 truncate">{classItem.label}</span>

        <span className="text-muted-foreground">선생님</span>
        <span className="min-w-0 truncate">{valueOrDash(classItem.teacher)}</span>

        <span className="text-muted-foreground">수업계획 회차</span>
        <span className="min-w-0 truncate">{sessionSummary}</span>

        <span className="text-muted-foreground">수업 시작회차</span>
        <span className="min-w-0 truncate">{valueOrDash(registration.classStartSession)}</span>

        <span className="text-muted-foreground">수업 교재</span>
        <span className="min-w-0 truncate">{textbookList}</span>

        <span className="text-muted-foreground">교재 청구</span>
        <span className="min-w-0 truncate">{textbookIssueRiskLabel}</span>
      </div>
    </div>
  )
}

function getWithdrawalSessionRiskLabel(classItem: OpsClassOption | undefined, withdrawalSession: unknown) {
  if (!classItem) return ""

  const totalSessions = Number(classItem.sessionCount || 0)
  if (totalSessions <= 0) return "회차 미생성"

  const selectedSessionNumber = getWithdrawalSessionNumber(withdrawalSession)
  if (!Number.isFinite(selectedSessionNumber)) return "퇴원회차 입력 필요"

  const selectedSession = getClassPlanSelectedSession(classItem, selectedSessionNumber)
  if (Array.isArray(classItem.planSessions) && classItem.planSessions.length > 0) {
    if (!selectedSession) return "퇴원회차 없음"
    if (selectedSession.planned === false) return "진도 미배정 회차"
  }

  if (selectedSessionNumber > totalSessions) return "퇴원회차 초과"

  const plannedSessions = Number(classItem.plannedSessionCount || 0)
  if (plannedSessions > 0 && selectedSessionNumber > plannedSessions) return "진도 미배정 회차"

  return "회차 확인"
}

function getTransferClassPlanRiskLabel(classItem: OpsClassOption | undefined, sessionValue: unknown) {
  if (!classItem) return ""

  const totalSessions = Number(classItem.sessionCount || 0)
  if (totalSessions <= 0) return "회차 미생성"

  const selectedSessionNumber = getWithdrawalSessionNumber(sessionValue)
  if (!Number.isFinite(selectedSessionNumber)) return "회차 입력 필요"

  const selectedSession = getClassPlanSelectedSession(classItem, selectedSessionNumber)
  if (Array.isArray(classItem.planSessions) && classItem.planSessions.length > 0) {
    if (!selectedSession) return "회차 없음"
    if (selectedSession.planned === false) return "진도 미배정 회차"
  }

  if (selectedSessionNumber > totalSessions) return "회차 초과"

  const plannedSessions = Number(classItem.plannedSessionCount || 0)
  if (plannedSessions > 0 && selectedSessionNumber > plannedSessions) return "진도 미배정 회차"

  return "회차 확인"
}

function getWithdrawalSettlementNumber(value: unknown) {
  const match = String(value || "").replace(/,/g, "").match(/-?\d+(?:\.\d+)?/)
  if (!match) return Number.NaN
  const number = Number(match[0])
  return Number.isFinite(number) ? number : Number.NaN
}

function getWithdrawalSettlementRiskLabel(withdrawal: NonNullable<OpsTaskInput["withdrawal"]>) {
  const completedLessonHours = getWithdrawalSettlementNumber(withdrawal.completedLessonHours)
  const fourWeekLessonHours = getWithdrawalSettlementNumber(withdrawal.fourWeekLessonHours)

  if (
    !Number.isFinite(completedLessonHours) ||
    completedLessonHours < 0 ||
    !Number.isFinite(fourWeekLessonHours) ||
    fourWeekLessonHours <= 0
  ) {
    return "수업시수 입력 필요"
  }

  if (completedLessonHours > fourWeekLessonHours) return "수업시수 충돌"

  return "수업시수 확인"
}

function getWithdrawalRosterRiskLabel(student: OpsStudentOption | undefined, classItem: OpsClassOption | undefined) {
  if (!student) return "학생 선택 필요"
  if (!classItem) return "수업 선택 필요"
  return hasRosterLink(student, classItem) ? "명단 확인" : "명단 연결 필요"
}

function getWordRetestRosterRiskLabel(student: OpsStudentOption | undefined, classItem: OpsClassOption | undefined) {
  if (!student) return "학생 선택 필요"
  if (!classItem) return "수업 선택 필요"
  return hasRosterLink(student, classItem) ? "명단 확인" : "명단 연결 필요"
}

function getWithdrawalCompletionHandoffLabels(student: OpsStudentOption | undefined, classItem: OpsClassOption | undefined) {
  return {
    roster: student && classItem && hasRosterLink(student, classItem) ? "명단 제거 예정" : "명단 확인 필요",
    status: student ? "퇴원 처리 예정" : "학생 선택 필요",
  }
}

function WithdrawalClassSettlementSummary({
  withdrawal,
  student,
  classItem,
  classTextbooks,
}: {
  withdrawal: NonNullable<OpsTaskInput["withdrawal"]>
  student?: OpsStudentOption
  classItem?: OpsClassOption
  classTextbooks: OpsTextbookOption[]
}) {
  if (!classItem) return null

  const valueOrDash = (value: unknown) => String(value || "").trim() || "-"
  const riskLabel = getWithdrawalSessionRiskLabel(classItem, withdrawal.withdrawalSession)
  const settlementRiskLabel = getWithdrawalSettlementRiskLabel(withdrawal)
  const rosterRiskLabel = getWithdrawalRosterRiskLabel(student, classItem)
  const handoffLabels = getWithdrawalCompletionHandoffLabels(student, classItem)
  const textbookList = classTextbooks.map((textbook) => textbook.label).join(", ") || "교재 연결 없음"
  const plannedSessions = Number(classItem.plannedSessionCount || 0)
  const totalSessions = Number(classItem.sessionCount || 0)
  const sessionSummary = totalSessions > 0
    ? `${totalSessions}회 중 배정 ${plannedSessions}회`
    : "회차 미생성"
  const hoursSummary = [
    valueOrDash(withdrawal.completedLessonHours),
    valueOrDash(withdrawal.fourWeekLessonHours),
  ].join(" / ")

  return (
    <div className="grid gap-2 rounded-md border bg-muted/25 p-3 text-xs md:col-span-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-medium text-foreground">퇴원 정산 기준</span>
        <Badge variant={riskLabel === "회차 확인" ? "secondary" : "outline"} className="h-5 rounded px-1.5 text-[11px]">
          {riskLabel}
        </Badge>
        <Badge variant={settlementRiskLabel === "수업시수 확인" ? "secondary" : "outline"} className="h-5 rounded px-1.5 text-[11px]">
          {settlementRiskLabel}
        </Badge>
        <Badge variant={rosterRiskLabel === "명단 확인" ? "secondary" : "outline"} className="h-5 rounded px-1.5 text-[11px]">
          {rosterRiskLabel}
        </Badge>
      </div>
      <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 gap-y-2">
        <span className="text-muted-foreground">수업명단</span>
        <span className="min-w-0 truncate">{valueOrDash(student?.label)}</span>

        <span className="text-muted-foreground">수업</span>
        <span className="min-w-0 truncate">{classItem.label}</span>

        <span className="text-muted-foreground">선생님</span>
        <span className="min-w-0 truncate">{valueOrDash(withdrawal.teacherName || classItem.teacher)}</span>

        <span className="text-muted-foreground">수업계획 회차</span>
        <span className="min-w-0 truncate">{sessionSummary}</span>

        <span className="text-muted-foreground">퇴원회차</span>
        <span className="min-w-0 truncate">{valueOrDash(withdrawal.withdrawalSession)}</span>

        <span className="text-muted-foreground">진행/4주 기준</span>
        <span className="min-w-0 truncate">{hoursSummary}</span>

        <span className="text-muted-foreground">수업 교재</span>
        <span className="min-w-0 truncate">{textbookList}</span>

        <span className="text-muted-foreground">미배부 교재</span>
        <span className="min-w-0 truncate">{valueOrDash(withdrawal.undistributedTextbooks)}</span>

        <span className="text-muted-foreground">완료 반영</span>
        <span className="flex min-w-0 flex-wrap items-center gap-1">
          <Badge variant={handoffLabels.roster === "명단 제거 예정" ? "secondary" : "outline"} className="h-5 rounded px-1.5 text-[11px]">
            {handoffLabels.roster}
          </Badge>
          <Badge variant={handoffLabels.status === "퇴원 처리 예정" ? "secondary" : "outline"} className="h-5 rounded px-1.5 text-[11px]">
            {handoffLabels.status}
          </Badge>
        </span>
      </div>
    </div>
  )
}

function getTransferScheduleRiskLabel(transfer: NonNullable<OpsTaskInput["transfer"]>) {
  const fromDate = toDateKey(transfer.fromClassEndDate)
  const toDate = toDateKey(transfer.toClassStartDate)
  if (fromDate && toDate && toDate < fromDate) return "일정 충돌"

  const fromSession = getWithdrawalSessionNumber(transfer.fromClassEndSession)
  const toSession = getWithdrawalSessionNumber(transfer.toClassStartSession)
  if (!Number.isFinite(fromSession) || !Number.isFinite(toSession)) return "회차 입력 필요"
  if (toSession <= fromSession) return "회차 충돌"
  if (toSession > fromSession + 1) return "회차 공백"
  return "회차 연결"
}

function getTransferRosterRiskLabels(
  student: OpsStudentOption | undefined,
  fromClass: OpsClassOption | undefined,
  toClass: OpsClassOption | undefined,
) {
  return {
    from: !student
      ? "학생 선택 필요"
      : !fromClass
        ? "전 수업 선택 필요"
        : hasRosterLink(student, fromClass)
          ? "전 명단 확인"
          : "전 명단 연결 필요",
    to: !student
      ? "학생 선택 필요"
      : !toClass
        ? "후 수업 선택 필요"
        : hasRosterLink(student, toClass)
          ? "후 명단 이미 있음"
          : "후 명단 추가 예정",
  }
}

function getOperationClassPlanRiskLabel(completionBlockers: string[] = []) {
  const hasGeneric = completionBlockers.some((blocker) => blocker.startsWith("수업계획 "))
  const hasFrom = completionBlockers.some((blocker) => blocker.startsWith("전 수업계획 "))
  const hasTo = completionBlockers.some((blocker) => blocker.startsWith("후 수업계획 "))

  if (hasFrom && hasTo) return "전/후 수업계획 확인"
  if (hasFrom) return "전 수업계획 확인"
  if (hasTo) return "후 수업계획 확인"
  if (hasGeneric) return "수업계획 확인"
  return ""
}

function getOperationRowRiskSummary(task: OpsTask, completionBlockers: string[] = []) {
  const valueOrDash = (value: unknown) => String(value || "").trim() || "-"
  const classPlanRiskLabel = getOperationClassPlanRiskLabel(completionBlockers)

  if (task.type === "withdrawal" && task.withdrawal) {
    const withdrawal = task.withdrawal
    const withdrawalSession = String(withdrawal.withdrawalSession || "").trim()
    const undistributedTextbooks = String(withdrawal.undistributedTextbooks || "").trim()

    return {
      headingLabel: "퇴원 정산",
      primaryLabel: withdrawalSession ? `퇴원회차 ${withdrawalSession}` : "퇴원회차 입력 필요",
      secondaryLabel: getWithdrawalSettlementRiskLabel(withdrawal),
      tertiaryLabel: undistributedTextbooks ? `미배부 ${undistributedTextbooks}` : "미배부 확인",
      quaternaryLabel: classPlanRiskLabel,
    }
  }

  if (task.type === "transfer" && task.transfer) {
    const transfer = task.transfer
    const transferDates = [transfer.fromClassEndDate, transfer.toClassStartDate]
      .map(valueOrDash)
      .join(" → ")

    return {
      headingLabel: "전반 회차",
      primaryLabel: getTransferScheduleRiskLabel(transfer),
      secondaryLabel: [transfer.fromClassEndSession, transfer.toClassStartSession].map(valueOrDash).join(" → "),
      tertiaryLabel: transferDates === "- → -" ? "일정 입력 필요" : transferDates,
      quaternaryLabel: classPlanRiskLabel,
    }
  }

  return null
}

function TransferClassComparisonSummary({
  transfer,
  student,
  fromClass,
  toClass,
  fromTextbooks,
  toTextbooks,
}: {
  transfer: NonNullable<OpsTaskInput["transfer"]>
  student?: OpsStudentOption
  fromClass?: OpsClassOption
  toClass?: OpsClassOption
  fromTextbooks: OpsTextbookOption[]
  toTextbooks: OpsTextbookOption[]
}) {
  if (!fromClass && !toClass) return null

  const valueOrDash = (value: unknown) => String(value || "").trim() || "-"
  const textbookList = (items: OpsTextbookOption[]) => items.map((item) => item.label).join(", ") || "교재 연결 없음"
  const fromSchedule = [transfer.fromClassEndDate, transfer.fromClassEndSession].map(valueOrDash).join(" · ")
  const toSchedule = [transfer.toClassStartDate, transfer.toClassStartSession].map(valueOrDash).join(" · ")
  const scheduleRiskLabel = getTransferScheduleRiskLabel(transfer)
  const fromClassPlanRiskLabel = getTransferClassPlanRiskLabel(fromClass, transfer.fromClassEndSession)
  const toClassPlanRiskLabel = getTransferClassPlanRiskLabel(toClass, transfer.toClassStartSession)
  const rosterRiskLabels = getTransferRosterRiskLabels(student, fromClass, toClass)
  const classPlanSummary = (classItem?: OpsClassOption) => {
    if (!classItem) return "-"
    const totalSessions = Number(classItem.sessionCount || 0)
    const plannedSessions = Number(classItem.plannedSessionCount || 0)
    return totalSessions > 0 ? `${totalSessions}회 중 배정 ${plannedSessions}회` : "회차 미생성"
  }

  return (
    <div className="grid gap-2 rounded-md border bg-muted/25 p-3 text-xs md:col-span-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-medium text-foreground">전반 비교</span>
        <span className="text-muted-foreground">전반 일정 기준</span>
        <Badge variant={scheduleRiskLabel === "회차 연결" ? "secondary" : "outline"} className="h-5 rounded px-1.5 text-[11px]">
          {scheduleRiskLabel}
        </Badge>
      </div>
      <div className="grid grid-cols-[5.5rem_minmax(0,1fr)_minmax(0,1fr)] gap-x-3 gap-y-2">
        <span />
        <span className="font-medium text-muted-foreground">전 수업</span>
        <span className="font-medium text-muted-foreground">후 수업</span>

        <span className="text-muted-foreground">수업명</span>
        <span className="min-w-0 truncate">{valueOrDash(transfer.fromClassName || fromClass?.label)}</span>
        <span className="min-w-0 truncate">{valueOrDash(transfer.toClassName || toClass?.label)}</span>

        <span className="text-muted-foreground">명단</span>
        <span className="flex min-w-0 flex-wrap items-center gap-1">
          <span className="min-w-0 truncate"><span className="sr-only">전 수업 명단 </span>{valueOrDash(student?.label)}</span>
          <Badge variant={rosterRiskLabels.from === "전 명단 확인" ? "secondary" : "outline"} className="h-5 rounded px-1.5 text-[11px]">
            {rosterRiskLabels.from}
          </Badge>
        </span>
        <span className="flex min-w-0 flex-wrap items-center gap-1">
          <span className="min-w-0 truncate"><span className="sr-only">후 수업 명단 </span>{valueOrDash(student?.label)}</span>
          <Badge variant={["후 명단 추가 예정", "후 명단 이미 있음"].includes(rosterRiskLabels.to) ? "secondary" : "outline"} className="h-5 rounded px-1.5 text-[11px]">
            {rosterRiskLabels.to}
          </Badge>
        </span>

        <span className="text-muted-foreground">선생님</span>
        <span className="min-w-0 truncate">{valueOrDash(transfer.fromTeacherName || fromClass?.teacher)}</span>
        <span className="min-w-0 truncate">{valueOrDash(transfer.toTeacherName || toClass?.teacher)}</span>

        <span className="text-muted-foreground">종료/시작</span>
        <span className="min-w-0 truncate">{fromSchedule}</span>
        <span className="min-w-0 truncate">{toSchedule}</span>

        <span className="text-muted-foreground">수업계획 회차</span>
        <span className="flex min-w-0 flex-wrap items-center gap-1">
          <span className="min-w-0 truncate">{classPlanSummary(fromClass)}</span>
          {fromClassPlanRiskLabel ? (
            <Badge variant={fromClassPlanRiskLabel === "회차 확인" ? "secondary" : "outline"} className="h-5 rounded px-1.5 text-[11px]">
              {fromClassPlanRiskLabel}
            </Badge>
          ) : null}
        </span>
        <span className="flex min-w-0 flex-wrap items-center gap-1">
          <span className="min-w-0 truncate">{classPlanSummary(toClass)}</span>
          {toClassPlanRiskLabel ? (
            <Badge variant={toClassPlanRiskLabel === "회차 확인" ? "secondary" : "outline"} className="h-5 rounded px-1.5 text-[11px]">
              {toClassPlanRiskLabel}
            </Badge>
          ) : null}
        </span>

        <span className="text-muted-foreground">교재</span>
        <span className="min-w-0 truncate"><span className="sr-only">전 수업 교재 </span>{textbookList(fromTextbooks)}</span>
        <span className="min-w-0 truncate"><span className="sr-only">후 수업 교재 </span>{textbookList(toTextbooks)}</span>

        <span className="text-muted-foreground">미배부</span>
        <span className="min-w-0 truncate"><span className="sr-only">전 미배부 교재 </span>{valueOrDash(transfer.fromUndistributedTextbooks)}</span>
        <span className="min-w-0 truncate"><span className="sr-only">후 미배부 교재 </span>{valueOrDash(transfer.toUndistributedTextbooks)}</span>
      </div>
    </div>
  )
}

type RegistrationDuplicateCandidate = {
  id: string
  label: string
  meta?: string
  reason?: string
  reasons?: string[]
}

type CompletionChecklistItem<Key extends string = string> = {
  key: Key
  label: string
  phase: string
  order: number
  checked: boolean
  auto?: boolean
}

type RegistrationCompletionChecklistItem = CompletionChecklistItem<Extract<keyof NonNullable<OpsTaskInput["registration"]>, string>>
type WithdrawalCompletionChecklistItem = CompletionChecklistItem<Extract<keyof NonNullable<OpsTaskInput["withdrawal"]>, string>>
type TransferCompletionChecklistItem = CompletionChecklistItem<Extract<keyof NonNullable<OpsTaskInput["transfer"]>, string>>

function formatRegistrationDuplicateCandidateDetail(candidate: RegistrationDuplicateCandidate) {
  const reasons = Array.isArray(candidate.reasons) && candidate.reasons.length > 0
    ? candidate.reasons
    : [candidate.reason].filter(Boolean)
  return [...reasons, candidate.meta].filter(Boolean).join(" · ")
}

function RegistrationDuplicateCandidatePanel({
  candidates,
  selectedStudentId,
  onSelect,
}: {
  candidates: RegistrationDuplicateCandidate[]
  selectedStudentId: string
  onSelect: (studentId: string) => void
}) {
  if (candidates.length === 0) return null

  return (
    <section aria-label="기존 학생 후보" className="grid gap-2 rounded-md border bg-muted/30 p-3">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <div className="grid min-w-0 gap-0.5">
          <div className="text-xs font-medium text-foreground">기존 학생 후보</div>
          <div className="text-[11px] text-muted-foreground">등록 완료 전에 후보를 확인하고 기존 학생이면 연결하세요.</div>
        </div>
        <Badge variant="outline" className="shrink-0">{candidates.length}명</Badge>
      </div>
      <div className="grid gap-1.5">
        {candidates.map((candidate) => {
          const selected = candidate.id === selectedStudentId
          return (
            <div key={candidate.id} className="flex min-w-0 items-center gap-2 rounded-md bg-background px-2 py-1.5 text-sm">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{candidate.label}</div>
                <div className="truncate text-xs text-muted-foreground">{formatRegistrationDuplicateCandidateDetail(candidate)}</div>
              </div>
              <Button type="button" size="sm" variant={selected ? "secondary" : "outline"} className="h-8 shrink-0" disabled={selected} onClick={() => onSelect(candidate.id)}>
                {selected ? "연결됨" : "연결"}
              </Button>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function RegistrationCompletionChecklist({
  items,
  requiredFields,
  updateRegistration,
}: {
  items: RegistrationCompletionChecklistItem[]
  requiredFields: Set<string>
  updateRegistration: (key: keyof NonNullable<OpsTaskInput["registration"]>, value: string | boolean) => void
}) {
  const checkedCount = items.filter((item) => item.checked).length

  return (
    <div className="grid gap-2">
      <div className="flex min-w-0 items-center justify-between gap-3 text-xs">
        <span className="font-medium text-foreground">완료 체크</span>
        <span className="shrink-0 text-muted-foreground">{checkedCount}/{items.length}</span>
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        {items.map((item) => {
          const fieldName = `registration.${String(item.key)}`
          const invalid = requiredFields.has(fieldName)
          return (
            <label
              key={item.key}
              className={[
                "flex min-w-0 items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors",
                invalid
                  ? "border-destructive/60 bg-destructive/5 text-destructive"
                  : item.checked
                    ? "border-primary/35 bg-primary/5"
                    : "bg-background",
              ].join(" ")}
            >
              <input
                type="checkbox"
                checked={item.checked}
                aria-required={invalid || undefined}
                aria-invalid={invalid || undefined}
                data-completion-field={fieldName}
                data-required-missing={invalid ? "true" : undefined}
                onChange={(event) => updateRegistration(item.key, event.target.checked)}
                className="size-4 shrink-0 accent-primary"
              />
              <span className="min-w-0 truncate">
                {item.label}
                {invalid && <span aria-hidden="true" className="ml-0.5 text-destructive">*</span>}
              </span>
            </label>
          )
        })}
      </div>
    </div>
  )
}

function CompletionChecklist({
  items,
  children,
}: {
  items: CompletionChecklistItem[]
  children: ReactNode
}) {
  const manualItems = items.filter((item) => !item.auto)
  const checkedCount = manualItems.filter((item) => item.checked).length

  return (
    <div className="grid gap-2">
      <div className="flex min-w-0 items-center justify-between gap-3 text-xs">
        <span className="font-medium text-foreground">완료 체크</span>
        <span className="shrink-0 text-muted-foreground">{checkedCount}/{manualItems.length}</span>
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        {children}
      </div>
    </div>
  )
}

function CompletionChecklistItemField<Key extends string>({
  item,
  onChange,
  completionPrefix,
  requiredFields,
}: {
  item: CompletionChecklistItem<Key>
  onChange: (key: Key, value: boolean) => void
  completionPrefix?: string
  requiredFields: Set<string>
}) {
  const fieldName = completionPrefix ? `${completionPrefix}.${String(item.key)}` : ""
  const invalid = Boolean(fieldName && requiredFields.has(fieldName))

  if (item.auto) {
    return null
  }

  return (
    <label
      className={[
        "flex min-w-0 items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors",
        invalid
          ? "border-destructive/60 bg-destructive/5 text-destructive"
          : item.checked
            ? "border-primary/35 bg-primary/5"
            : "bg-background",
      ].join(" ")}
    >
      <input
        type="checkbox"
        checked={item.checked}
        aria-required={invalid || undefined}
        aria-invalid={invalid || undefined}
        data-completion-field={fieldName || undefined}
        data-required-missing={invalid ? "true" : undefined}
        onChange={(event) => onChange(item.key, event.target.checked)}
        className="size-4 shrink-0 accent-primary"
      />
      <span className="min-w-0 truncate">
        {item.label}
        {invalid && <span aria-hidden="true" className="ml-0.5 text-destructive">*</span>}
      </span>
    </label>
  )
}

function WithdrawalCompletionChecklist({
  items,
  requiredFields,
  updateWithdrawal,
}: {
  items: WithdrawalCompletionChecklistItem[]
  requiredFields: Set<string>
  updateWithdrawal: (key: keyof NonNullable<OpsTaskInput["withdrawal"]>, value: string | boolean) => void
}) {
  return (
    <CompletionChecklist items={items}>
      {items.map((item) => (
        <CompletionChecklistItemField
          key={item.key}
          item={item}
          completionPrefix="withdrawal"
          requiredFields={requiredFields}
          onChange={(_key, value) => updateWithdrawal(item.key, value)}
        />
      ))}
    </CompletionChecklist>
  )
}

function TransferCompletionChecklist({
  items,
  requiredFields,
  updateTransfer,
}: {
  items: TransferCompletionChecklistItem[]
  requiredFields: Set<string>
  updateTransfer: (key: keyof NonNullable<OpsTaskInput["transfer"]>, value: string | boolean) => void
}) {
  return (
    <CompletionChecklist items={items}>
      {items.map((item) => (
        <CompletionChecklistItemField
          key={item.key}
          item={item}
          completionPrefix="transfer"
          requiredFields={requiredFields}
          onChange={(_key, value) => updateTransfer(item.key, value)}
        />
      ))}
    </CompletionChecklist>
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

function TodoPriorityBadge({ priority }: { priority: OpsTaskPriority }) {
  if (priority === "normal") return null

  const className =
    priority === "urgent"
      ? "border-red-200 bg-red-50 text-red-700"
      : priority === "high"
        ? "border-orange-200 bg-orange-50 text-orange-700"
        : "border-slate-200 bg-slate-50 text-slate-600"

  return (
    <Badge variant="outline" className={className}>
      {getTaskPriorityLabel(priority)}
    </Badge>
  )
}

function getNextTaskStatusAction(task: Pick<OpsTask, "status" | "type">): { status: OpsTaskStatus; label: string } | null {
  if (task.status === "canceled") return { status: "requested", label: "다시 열기" }

  if (task.type === "general") {
    if (task.status === "done") return { status: "requested", label: "다시 열기" }
    if (task.status === "on_hold") return { status: "in_progress", label: "재개" }
    return { status: "done", label: "완료" }
  }

  if (task.status === "requested") return { status: "confirmed", label: "확인" }
  if (task.status === "confirmed") return { status: "in_progress", label: "진행" }
  if (task.status === "in_progress") return { status: "done", label: "완료" }
  if (task.status === "on_hold") return { status: "in_progress", label: "재개" }
  return null
}

function canEditTaskDetails(task: Pick<OpsTask, "type" | "status">) {
  return task.type === "general" || task.status !== "done"
}

function getRegistrationPipelinePrefix(value?: string) {
  const match = String(value || "").trim().match(/^\d(?:-\d)?\./)
  return match?.[0] || ""
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

function getNextRegistrationPipelineAction(task: Pick<OpsTask, "type" | "status" | "registration">): { pipelineStatus: string; label: string } | null {
  if (task.type !== "registration" || task.status === "done" || task.status === "canceled") return null

  const currentPipelineStatus = task.registration?.pipelineStatus || REGISTRATION_PIPELINE_STATUSES[0]?.value || ""
  const currentPrefix = getRegistrationPipelinePrefix(currentPipelineStatus) || "0."
  const nextPrefix = REGISTRATION_PIPELINE_NEXT_PREFIXES[currentPrefix]
  if (!nextPrefix) return null

  const pipelineStatus = findRegistrationPipelineStatus(nextPrefix)
  if (!pipelineStatus) return null

  return {
    pipelineStatus,
    label: `다음: ${getCompactRegistrationPipelineLabel(pipelineStatus)}`,
  }
}

function getSecondaryTaskStatusOptions(task: Pick<OpsTask, "status" | "type">) {
  if (task.status === "done" || task.status === "canceled") return []
  if (task.type === "general") return []

  return OPS_TASK_STATUSES.filter((status) => (
    ["on_hold", "canceled"].includes(status.value) &&
    status.value !== task.status &&
    status.value !== getNextTaskStatusAction(task)?.status
  ))
}

function shouldShowDetailStatusBadge(task: Pick<OpsTask, "type" | "status">) {
  return task.type !== "general" || isClosedOpsTask(task)
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
  if (input.type !== "registration") return input

  const pipelineStatus = input.registration?.pipelineStatus || REGISTRATION_PIPELINE_STATUSES[0]?.value || "0. 등록 문의"
  const nextStatus: OpsTaskStatus = pipelineStatus.startsWith("7.")
    ? "done"
    : pipelineStatus.startsWith("8.") || pipelineStatus.startsWith("9.")
      ? "canceled"
      : pipelineStatus.startsWith("0.")
        ? "requested"
        : "in_progress"
  const nextCompletedAt = nextStatus === "done"
    ? input.completedAt || new Date().toISOString()
    : ""

  return {
    ...input,
    status: nextStatus,
    completedAt: nextCompletedAt,
    registration: {
      ...(input.registration || {}),
      pipelineStatus,
    },
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
    const normalized = token.toLowerCase()
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
      labels.push(normalizeQuickAddMemoToken(token))
      return
    }
    if (pendingDueLookup) {
      pendingDueLookup = false
      if (applyDateToken(token)) return
    }
    if (pendingAssigneeLookup) {
      pendingAssigneeLookup = false
      applyAssignee(token)
      return
    }
    const memoDirective = getQuickAddMemoDirective(token)
    if (memoDirective) {
      collectingQuickAddMemo = true
      if (memoDirective.value) labels.push(normalizeQuickAddMemoToken(memoDirective.value))
      return
    }
    const dueDirective = getQuickAddDueDirective(token)
    if (dueDirective) {
      if (dueDirective.value) applyDateToken(dueDirective.value)
      else pendingDueLookup = true
      return
    }
    const assigneeDirective = getQuickAddAssigneeDirective(token)
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
    if (["p1", "!!", "!1", "긴급", "급함", "최우선"].includes(normalized)) {
      priority = "urgent"
      return
    }
    if (["p2", "!2", "중요"].includes(normalized)) {
      priority = "high"
      return
    }
    if (["p3", "!3", "보통"].includes(normalized)) {
      priority = "normal"
      return
    }
    if (["p4", "!4", "낮음"].includes(normalized)) {
      priority = "low"
      return
    }
    if ((token.startsWith("@") || token.startsWith("#")) && token.length > 1) {
      labels.push(normalizeQuickAddMemoToken(token))
      return
    }
    if (token.startsWith("+") && token.length > 1) {
      const assigneeName = token.slice(1)
      applyAssignee(assigneeName)
      return
    }
    pendingMeridiem = ""
    pendingWeekdayModifier = ""
    titleTokens.push(token)
  })

  return {
    title: titleTokens.join(" ").trim(),
    assigneeId,
    dueAt,
    priority,
    memo: labels.length > 0 ? labels.join(" ") : "",
  }
}

export function OpsTaskWorkspace({ workspace = "todo" }: { workspace?: WorkspaceKey }) {
  const scopedTaskType = WORKSPACE_TASK_TYPE[workspace]
  const isTodoWorkspace = workspace === "todo"
  const isRegistrationWorkspace = workspace === "registration"
  const isWordRetestWorkspace = workspace === "word_retest"
  const supportsProcessView = isOperationProcessWorkspace(workspace)
  const workspaceTaskType = isTodoWorkspace ? "general" : scopedTaskType
  const workspaceIncludesManagementOptions = true
  const workspaceLoadOptions = {
    taskType: workspaceTaskType,
    includeManagementOptions: workspaceIncludesManagementOptions,
  }
  const initialWorkspaceData = getCachedOpsTaskWorkspaceData(workspaceLoadOptions)
  const searchParams = useSearchParams()
  const { user, canManageAll, isAdmin, isStaff, isTeacher } = useAuth()
  const [data, setData] = useState<OpsTaskWorkspaceData | null>(() => initialWorkspaceData)
  const [loading, setLoading] = useState(() => !initialWorkspaceData)
  const [view, setView] = useState<ViewKey>(() => supportsProcessView ? "process" : "all")
  const [todoView, setTodoView] = useState<TodoViewKey>("inbox")
  const [todoFilter, setTodoFilter] = useState<TodoFilterKey>("all")
  const [taskFocus, setTaskFocus] = useState<TaskFocus>("none")
  const [registrationPipeline, setRegistrationPipeline] = useState(REGISTRATION_PIPELINE_ALL)
  const [query, setQuery] = useState("")
  const [quickAddText, setQuickAddText] = useState("")
  const [showClosed, setShowClosed] = useState(false)
  const [wordRetestMode, setWordRetestMode] = useState<WordRetestMode>("assistant")
  const [wordRetestBranch, setWordRetestBranch] = useState<WordRetestBranchMode>("all")
  const [wordRetestQueue, setWordRetestQueue] = useState<WordRetestQueueMode>("all")
  const [wordRetestTeacherQueue, setWordRetestTeacherQueue] = useState<WordRetestTeacherQueueMode>("all")
  const [formOpen, setFormOpen] = useState(false)
  const [formDetailStep, setFormDetailStep] = useState<FormDetailStepKey>("registration_contact")
  const [detailOpen, setDetailOpen] = useState(false)
  const [editingTask, setEditingTask] = useState<OpsTask | null>(null)
  const [selectedTask, setSelectedTask] = useState<OpsTask | null>(null)
  const [form, setForm] = useState<OpsTaskInput>(() => cloneForm())
  const formBaselineRef = useRef(serializeOpsTaskInput(form))
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState("")
  const [formCompletionBlockers, setFormCompletionBlockers] = useState<string[]>([])
  const [formCompletionIntent, setFormCompletionIntent] = useState<FormCompletionIntent | null>(null)
  const [completionFocusRequest, setCompletionFocusRequest] = useState(0)
  const [confirmingFormClose, setConfirmingFormClose] = useState(false)
  const [notice, setNotice] = useState("")
  const [commentBody, setCommentBody] = useState("")
  const [attachmentName, setAttachmentName] = useState("")
  const [attachmentLink, setAttachmentLink] = useState("")
  const [deleteTarget, setDeleteTarget] = useState<OpsTask | null>(null)
  const [statusUndo, setStatusUndo] = useState<StatusUndoState | null>(null)
  const formMemoId = useId()
  const formChecklistId = useId()
  const attachmentNameId = useId()
  const attachmentLinkId = useId()
  const quickAddInputRef = useRef<HTMLInputElement | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const pendingCompletionFocusRef = useRef("")
  const deferredQuery = useDeferredValue(query)

  const currentUserId = user?.id || ""
  const currentUserLabel = useMemo(
    () => [user?.name, user?.email, user?.loginId].map((value) => String(value || "").trim()).find(Boolean) || "",
    [user?.email, user?.loginId, user?.name],
  )
  const canDelete = canManageAll || isStaff
  const canDeleteTask = useCallback(
    (task: OpsTask) => {
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
  const formCompletionBlockerTarget: CompletionBlockerTaskTarget = {
    id: editingTask?.id || "form-completion",
    title: form.title || workspaceLabel,
    type: form.type,
    classId: form.classId,
    registration: form.registration,
    withdrawal: form.withdrawal,
    transfer: form.transfer,
  }

  const reload = useCallback(async (force = false, showPending = true) => {
    const loadOptions = { taskType: workspaceTaskType, includeManagementOptions: workspaceIncludesManagementOptions }
    if (showPending && (force || !getCachedOpsTaskWorkspaceData(loadOptions))) setLoading(true)
    const nextData = await loadOpsTaskWorkspaceData({ ...loadOptions, force })
    setData(nextData)
    setLoading(false)
  }, [workspaceIncludesManagementOptions, workspaceTaskType])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    const nextView = searchParams.get("view")
    const nextFocus = searchParams.get("focus")
    const nextTodoRouteState = isTodoWorkspace ? getTodoRouteState(searchParams) : null
    if (nextTodoRouteState) {
      setTodoView(nextTodoRouteState.list)
      setTodoFilter(nextTodoRouteState.filter || "all")
    } else if (!isTodoWorkspace && nextView && isViewKey(nextView)) {
      setView(nextView === "process" && !supportsProcessView ? "all" : nextView)
    } else if (!isTodoWorkspace) {
      setView(supportsProcessView ? "process" : "all")
    }
    if (nextFocus && isTaskFocus(nextFocus)) {
      setTaskFocus(nextFocus)
    }
  }, [isTodoWorkspace, searchParams, supportsProcessView])

  useEffect(() => {
    if (!isWordRetestWorkspace) return
    setWordRetestMode(isTeacher && !isStaff ? "teacher" : "assistant")
  }, [isStaff, isTeacher, isWordRetestWorkspace])

  useEffect(() => {
    if (!formOpen || !pendingCompletionFocusRef.current) return
    const fieldName = pendingCompletionFocusRef.current
    const timeoutId = window.setTimeout(() => {
      const target = document.querySelector<HTMLElement>(`[data-completion-field="${fieldName}"]`)
      if (!target) return
      target.focus({ preventScroll: true })
      target.scrollIntoView({ block: "center", inline: "nearest" })
      pendingCompletionFocusRef.current = ""
    }, 0)
    return () => window.clearTimeout(timeoutId)
  }, [completionFocusRequest, formDetailStep, formOpen])

  const syncView = (nextView: ViewKey, nextFocus: TaskFocus = "none") => {
    setView(nextView)
    setTaskFocus(nextFocus)
    setRegistrationPipeline(REGISTRATION_PIPELINE_ALL)

    const searchParams = new URLSearchParams(window.location.search)
    searchParams.set("view", nextView)
    searchParams.delete("list")
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
    if (nextView !== "filters") setTodoFilter("all")
    const searchParams = new URLSearchParams(window.location.search)
    searchParams.set("list", nextView)
    searchParams.delete("view")
    searchParams.delete("focus")
    if (nextView !== "filters") searchParams.delete("filter")
    const queryString = searchParams.toString()
    window.history.replaceState(null, "", `${window.location.pathname}${queryString ? `?${queryString}` : ""}`)
  }

  const syncTodoFilter = (nextFilter: TodoFilterKey) => {
    setTodoView("filters")
    setTodoFilter(nextFilter)
    const searchParams = new URLSearchParams(window.location.search)
    searchParams.set("list", "filters")
    searchParams.delete("view")
    searchParams.delete("focus")
    if (nextFilter === "all") {
      searchParams.delete("filter")
    } else {
      searchParams.set("filter", nextFilter)
    }
    const queryString = searchParams.toString()
    window.history.replaceState(null, "", `${window.location.pathname}${queryString ? `?${queryString}` : ""}`)
  }

  const syncTaskDeepLink = useCallback((nextTaskId: string | null) => {
    const searchParams = new URLSearchParams(window.location.search)
    if (nextTaskId) {
      searchParams.set("taskId", nextTaskId)
    } else {
      searchParams.delete("taskId")
    }
    const queryString = searchParams.toString()
    window.history.replaceState(null, "", `${window.location.pathname}${queryString ? `?${queryString}` : ""}`)
  }, [])

  const tasks = data?.tasks || EMPTY_TASKS
  const students = data?.students || EMPTY_STUDENT_OPTIONS
  const classes = data?.classes || EMPTY_CLASS_OPTIONS
  const textbooks = data?.textbooks || EMPTY_TEXTBOOK_OPTIONS
  const teachers = data?.teachers || EMPTY_TEACHER_OPTIONS
  const automationRules = data ? data.automationRules : EMPTY_AUTOMATION_RULES
  const notificationChannels = data ? data.notificationChannels : EMPTY_NOTIFICATION_CHANNELS
  const currentUserTeacher = useMemo(
    () => getCurrentUserTeacherOption(teachers, currentUserId, user?.email || ""),
    [currentUserId, teachers, user?.email],
  )
  const optionIndexes = useMemo(() => buildOpsTaskOptionIndexes(students, classes, textbooks, teachers), [students, classes, textbooks, teachers])
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
  useEffect(() => {
    const deepLinkedTaskId = searchParams.get("taskId") || ""
    if (!deepLinkedTaskId || !data) return
    const deepLinkedTask = taskById.get(deepLinkedTaskId)
    if (!deepLinkedTask) {
      syncTaskDeepLink(null)
      return
    }
    setSelectedTask(deepLinkedTask)
    setDetailOpen(true)
  }, [data, searchParams, syncTaskDeepLink, taskById])
  const profileLabelById = useMemo(
    () => new Map((data?.profiles || []).map((profile) => [profile.id, profile.label])),
    [data?.profiles],
  )
  const todoScopedTasks = useMemo(() => tasks.filter((task) => task.type === "general"), [tasks])
  const scopedTasks = useMemo(
    () => isTodoWorkspace ? todoScopedTasks : tasks.filter((task) => task.type === scopedTaskType),
    [isTodoWorkspace, scopedTaskType, tasks, todoScopedTasks],
  )
  const summary = useMemo(
    () => summarizeOpsTasks(scopedTasks, { currentUserId, currentUserLabel }),
    [currentUserId, currentUserLabel, scopedTasks],
  )
  const operationNeedsConfirmation = useMemo(() => {
    return scopedTasks.filter((task) => isOpenTask(task) && confirmationByTaskId.get(task.id) === true)
  }, [confirmationByTaskId, scopedTasks])
  const operationCompletionBlockersByTaskId = useMemo(() => buildOperationCompletionBlockerMap(
    scopedTasks,
    students,
    classes,
    textbooks,
    teachers,
    optionIndexes,
  ), [classes, optionIndexes, scopedTasks, students, teachers, textbooks])
  const operationNeedsOrganization = useMemo(() => {
    return scopedTasks.filter((task) => isOpenTask(task) && hasTaskOrganizationIssue(task, operationCompletionBlockersByTaskId.get(task.id) || EMPTY_COMPLETION_BLOCKERS))
  }, [operationCompletionBlockersByTaskId, scopedTasks])
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
  const wordRetestNow = useMemo(() => new Date(), [])
  const wordRetestExecutionOptions = useMemo(
    () => ({ today: todayKey, now: wordRetestNow }),
    [todayKey, wordRetestNow],
  )
  const wordRetestBranchCounts = useMemo(() => {
    const counts = Object.fromEntries(WORD_RETEST_BRANCH_ITEMS.map((item) => [item.key, 0])) as Record<WordRetestBranchMode, number>
    for (const task of scopedTasks) {
      counts.all += 1
      if (isWordRetestInBranchQueue(task, "본관")) counts["본관"] += 1
      if (isWordRetestInBranchQueue(task, "별관")) counts["별관"] += 1
    }
    return counts
  }, [scopedTasks])
  const wordRetestQueueCounts = useMemo(() => {
    const counts = Object.fromEntries(WORD_RETEST_QUEUE_ITEMS.map((item) => [item.key, 0])) as Record<WordRetestQueueMode, number>
    const branchTasks = scopedTasks.filter((task) => isWordRetestInBranchQueue(task, wordRetestBranch))
    for (const task of branchTasks) {
      const stage = getWordRetestExecutionStage(task, wordRetestExecutionOptions) as WordRetestQueueMode
      counts.all += 1
      if (stage in counts) counts[stage] += 1
    }
    return counts
  }, [scopedTasks, wordRetestBranch, wordRetestExecutionOptions])
  const wordRetestTeacherQueueCounts = useMemo(() => {
    const counts = Object.fromEntries(WORD_RETEST_TEACHER_QUEUE_ITEMS.map((item) => [item.key, 0])) as Record<WordRetestTeacherQueueMode, number>
    const teacherTasks = scopedTasks.filter((task) => isTeacherWordRetest(task, currentUserId, currentUserLabel))
    for (const task of teacherTasks) {
      const active = isOpenTask(task)
      const rerequestable = isWordRetestRerequestable(task)
      if (active || rerequestable) counts.all += 1
      if (active) counts.active += 1
      if (rerequestable) counts.rerequest += 1
    }
    return counts
  }, [currentUserId, currentUserLabel, scopedTasks])
  const todoCounts = useMemo(() => {
    const actionableTodoTasks = scopedTasks.filter((task) => isOpsTaskActionable(task, { today: todayKey }))
    return {
      inbox: actionableTodoTasks.filter((task) => !hasTaskSchedule(task)).length,
      today: actionableTodoTasks.filter((task) => hasOpsTaskCalendarDate(task, todayKey)).length,
      upcoming: actionableTodoTasks.filter((task) => hasOpsTaskFutureCalendarDate(task, todayKey)).length,
      mine: actionableTodoTasks.filter((task) => isOpsTaskAssignedToUser(task, currentUserId, currentUserLabel)).length,
      board: actionableTodoTasks.length,
      calendar: getOpsTaskCalendarItems(actionableTodoTasks).length,
      filters: actionableTodoTasks.filter((task) => {
        const dueDate = toDateKey(task.dueAt)
        return (
          (Boolean(dueDate) && dueDate < todayKey) ||
          hasOpsTaskOverdueCalendarDate(task, todayKey) ||
          isOpsTaskAssignedToUser(task, currentUserId, currentUserLabel) ||
          task.priority === "urgent" ||
          task.priority === "high" ||
          hasTaskOrganizationIssue(task, operationCompletionBlockersByTaskId.get(task.id) || EMPTY_COMPLETION_BLOCKERS) ||
          confirmationByTaskId.get(task.id) === true
        )
      }).length,
      recurring: actionableTodoTasks.filter((task) => task.automationSourceType === "recurring").length,
      automations: actionableTodoTasks.filter((task) => Boolean(task.automationSourceKey)).length,
      completed: scopedTasks.filter((task) => isClosedOpsTask(task)).length,
    }
  }, [confirmationByTaskId, currentUserId, currentUserLabel, operationCompletionBlockersByTaskId, scopedTasks, todayKey])
  const registrationPipelineCountTasks = useMemo(() => {
    if (!isRegistrationWorkspace) return EMPTY_TASKS

    return scopedTasks
      .filter((task) => showClosed || isOpenTask(task))
      .filter((task) => matchesSearch(task, deferredQuery))
  }, [deferredQuery, isRegistrationWorkspace, scopedTasks, showClosed])
  const hasQuery = query.trim().length > 0

  const visibleTasks = useMemo(() => {
    const todoTaskSource = scopedTasks
    const nextTasks = todoTaskSource
      .filter((task) => {
        if (isTodoWorkspace) {
          const dueDate = toDateKey(task.dueAt)
          if (hasQuery) return todoView === "completed" ? isClosedOpsTask(task) && !isOpsTaskActionable(task, { today: todayKey }) : isOpsTaskActionable(task, { today: todayKey })
          if (todoView === "inbox") return isOpsTaskActionable(task, { today: todayKey }) && !hasTaskSchedule(task)
          if (todoView === "today") return hasOpsTaskCalendarDate(task, todayKey)
          if (todoView === "upcoming") return hasOpsTaskFutureCalendarDate(task, todayKey)
          if (todoView === "mine") return isOpsTaskActionable(task, { today: todayKey }) && isOpsTaskAssignedToUser(task, currentUserId, currentUserLabel)
          if (todoView === "board") return isOpsTaskActionable(task, { today: todayKey })
          if (todoView === "calendar") return isOpsTaskActionable(task, { today: todayKey })
          if (todoView === "recurring") return isOpsTaskActionable(task, { today: todayKey }) && task.automationSourceType === "recurring"
          if (todoView === "automations") return isOpsTaskActionable(task, { today: todayKey }) && Boolean(task.automationSourceKey)
          if (todoView === "filters") {
            if (!isOpsTaskActionable(task, { today: todayKey })) return false
            if (todoFilter === "overdue") return (Boolean(dueDate) && dueDate < todayKey) || hasOpsTaskOverdueCalendarDate(task, todayKey)
            if (todoFilter === "priority") return task.priority === "urgent" || task.priority === "high"
            if (todoFilter === "unassigned") return hasTaskOrganizationIssue(task, operationCompletionBlockersByTaskId.get(task.id) || EMPTY_COMPLETION_BLOCKERS)
            if (todoFilter === "confirmation") return confirmationByTaskId.get(task.id) === true
            return true
          }
          return isClosedOpsTask(task)
        }

        const wordRetestExecutionStage = isWordRetestWorkspace && wordRetestMode === "assistant"
          ? getWordRetestExecutionStage(task, wordRetestExecutionOptions)
          : "all"
        const isWordRetestAssistantExecutionTask = isWordRetestWorkspace && wordRetestMode === "assistant" && isWordRetestInExecutionQueue(task, wordRetestQueue, wordRetestExecutionOptions)
        const isWordRetestTeacherRerequestTask = isWordRetestWorkspace && wordRetestMode === "teacher" && isWordRetestRerequestable(task)
        if (!showClosed && !isOpenTask(task) && !isWordRetestAssistantExecutionTask && !isWordRetestTeacherRerequestTask) return false
        if (isRegistrationWorkspace && registrationPipeline !== REGISTRATION_PIPELINE_ALL) {
          if ((task.registration?.pipelineStatus || REGISTRATION_PIPELINE_STATUSES[0]?.value) !== registrationPipeline) return false
        }
        if (taskFocus === "today" && !hasOpsTaskCalendarDate(task, todayKey)) return false
        if (taskFocus === "overdue") {
          if (!hasOpsTaskOverdueCalendarDate(task, todayKey)) return false
        }
        if (taskFocus === "confirmation" && confirmationByTaskId.get(task.id) !== true) return false
        if (taskFocus === "mine" && !isOpsTaskAssignedToUser(task, currentUserId, currentUserLabel)) return false
        if (taskFocus === "unassigned" && !hasTaskOrganizationIssue(task, operationCompletionBlockersByTaskId.get(task.id) || EMPTY_COMPLETION_BLOCKERS)) return false
        if (isWordRetestWorkspace) {
          if (wordRetestMode === "assistant" && !isWordRetestInBranchQueue(task, wordRetestBranch)) return false
          if (wordRetestMode === "teacher" && !isTeacherWordRetest(task, currentUserId, currentUserLabel)) return false
          if (wordRetestMode === "teacher" && !isWordRetestInTeacherQueue(task, wordRetestTeacherQueue)) return false
          if (wordRetestMode === "assistant" && !isWordRetestInExecutionQueue(task, wordRetestQueue, wordRetestExecutionOptions)) return false
        }
        if (view === "calendar" || view === "all" || view === "status" || view === "assignee") return true
        return true
      })
      .filter((task) => matchesSearch(task, deferredQuery))
    if (!isTodoWorkspace) return isWordRetestWorkspace && wordRetestMode === "assistant" ? sortWordRetestExecutionQueue(nextTasks, wordRetestExecutionOptions) : nextTasks
    if (todoView === "calendar") return nextTasks
    return todoView === "completed" ? sortCompletedTodoTasks(nextTasks) : sortTodoTasks(nextTasks, todayKey)
  }, [confirmationByTaskId, currentUserId, currentUserLabel, deferredQuery, hasQuery, isRegistrationWorkspace, isTodoWorkspace, isWordRetestWorkspace, operationCompletionBlockersByTaskId, registrationPipeline, scopedTasks, showClosed, taskFocus, todayKey, todoFilter, todoView, view, wordRetestBranch, wordRetestExecutionOptions, wordRetestMode, wordRetestQueue, wordRetestTeacherQueue])

  const calendarItems = useMemo(
    () => {
      return loadCalendarRows(visibleTasks)
    },
    [visibleTasks],
  )
  const visibleCompletionBlockersByTaskId = useMemo(() => {
    const nextMap: OperationCompletionBlockerMap = new Map()
    visibleTasks.forEach((task) => {
      nextMap.set(task.id, operationCompletionBlockersByTaskId.get(task.id) || EMPTY_COMPLETION_BLOCKERS)
    })
    return nextMap
  }, [operationCompletionBlockersByTaskId, visibleTasks])
  const todoBoardColumns = useMemo(
    () => buildTodoBoardColumns(visibleTasks, todayKey, currentUserId, currentUserLabel),
    [currentUserId, currentUserLabel, todayKey, visibleTasks],
  )
  const operationProcessBoardColumns = useMemo(
    () => isOperationProcessWorkspace(workspace) ? buildOperationProcessBoardColumns(visibleTasks, workspace) : [],
    [visibleTasks, workspace],
  )
  const operationViewTabs = useMemo(
    () => supportsProcessView ? OPERATION_VIEW_TABS : OPERATION_VIEW_TABS.filter((tab) => tab.key !== "process"),
    [supportsProcessView],
  )
  const dueTodayValue = useMemo(() => quickDateTimeInputValue(0), [])
  const dueTomorrowValue = useMemo(() => quickDateTimeInputValue(1), [])
  const quickAddPreviewItems = useMemo<QuickAddPreviewItem[]>(() => {
    if (!isTodoWorkspace || !quickAddText.trim()) return []

    const parsed = parseTodoistQuickAdd(quickAddText, data?.profiles || [], {
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
  }, [currentUserId, currentUserLabel, data?.profiles, dueTodayValue, dueTomorrowValue, isTodoWorkspace, profileLabelById, quickAddText, todayKey])
  const isTodoFilteredEmpty = isTodoWorkspace && todoView === "filters" && todoFilter !== "all"
  const isTodoAutomationView = isTodoWorkspace && (todoView === "recurring" || todoView === "automations")
  const isFilteredEmpty = hasQuery || isTodoFilteredEmpty || (!isTodoWorkspace && taskFocus !== "none") || (isRegistrationWorkspace && registrationPipeline !== REGISTRATION_PIPELINE_ALL)
  const showEmptyCreate = !isTodoWorkspace && !loading && !isFilteredEmpty && visibleTasks.length === 0
  const showToolbarCreate = !isTodoWorkspace && !showEmptyCreate
  const canOpenCreate = isTodoWorkspace || !loading
  const createActionDisabled = saving || !canOpenCreate
  const showClosedToggle = !isTodoWorkspace && (todoCounts.completed > 0 || showClosed)
  const hasSearchableScopedTasks = isTodoWorkspace
    ? todoCounts.board > 0
    : scopedTasks.some((task) => showClosed || isOpenTask(task))
  const showSearch = hasQuery || visibleTasks.length > 0 || hasSearchableScopedTasks
  const emptyActionLabel = `${workspaceLabel} 추가`
  const emptyTaskLabel = isTodoWorkspace
    ? getTodoEmptyLabel(todoView, isFilteredEmpty)
    : isFilteredEmpty
      ? "조건에 맞는 항목 없음"
      : `${workspaceLabel} 없음`
  const emptyCalendarLabel = isFilteredEmpty ? "조건에 맞는 일정 없음" : "일정 없음"
  const hasLoadBlocker = Boolean(data && !data.schemaReady)
  const shouldHideEmptySurface = !loading && visibleTasks.length === 0 && (hasLoadBlocker || Boolean(message && !formOpen && !detailOpen))
  const isTemplateForm = form.type !== "general"
  const showTemplateDueAt = isTemplateForm && form.type !== "word_retest"
  const formRequiredFields = useMemo(
    () => buildRequiredCompletionFieldSet(form.type, formCompletionBlockers),
    [form.type, formCompletionBlockers],
  )
  const isFormDirty = formOpen && serializeOpsTaskInput(form) !== formBaselineRef.current
  const formDialogTitle = editingTask
    ? form.type === "general"
      ? "할 일 수정"
      : `${getTaskTypeLabel(form.type)} 수정`
    : isTemplateForm
      ? `${getTaskTypeLabel(form.type)} 추가`
      : isTodoWorkspace
        ? "할 일 추가"
        : `${workspaceLabel} 추가`

  function openCreate(type: OpsTaskType = scopedTaskType) {
    if (!canOpenCreate) return
    const defaultAssigneeId = currentUserId || ""
    const defaultDueAt = taskFocus === "today" ? dueTodayValue : ""
    const wordRetestTeacherDefaults = type === "word_retest" && currentUserTeacher
      ? {
          assigneeId: currentUserTeacher.profileId || defaultAssigneeId,
          wordRetest: {
            teacherId: currentUserTeacher.id,
            teacherName: currentUserTeacher.label,
          },
        }
      : {}
    const nextForm = cloneForm({ ...EMPTY_FORM, type, assigneeId: defaultAssigneeId, dueAt: defaultDueAt, ...wordRetestTeacherDefaults })
    blurActiveElementBeforeDialog()
    setEditingTask(null)
    setForm(nextForm)
    formBaselineRef.current = serializeOpsTaskInput(nextForm)
    setFormDetailStep(getDefaultFormDetailStep(type))
    setMessage("")
    setFormCompletionBlockers([])
    setFormCompletionIntent(null)
    pendingCompletionFocusRef.current = ""
    setConfirmingFormClose(false)
    setNotice("")
    setStatusUndo(null)
    setFormOpen(true)
  }

  function queueCompletionBlockerFocus(type: OpsTaskType, blockers: string[]) {
    const fieldName = getCompletionBlockerFocusField(type, blockers)
    if (!fieldName) return
    pendingCompletionFocusRef.current = fieldName
    setCompletionFocusRequest((request) => request + 1)
  }

  function openEdit(task: OpsTask, blockers: string[] = [], completionIntent: FormCompletionIntent | null = null) {
    const inferredCompletionIntent = completionIntent || getCompletionIntentForBlockedEdit(task, blockers)
    const nextForm = applyFormCompletionIntent(formFromTask(task), inferredCompletionIntent)
    blurActiveElementBeforeDialog()
    setDetailOpen(false)
    syncTaskDeepLink(null)
    setEditingTask(task)
    setForm(nextForm)
    formBaselineRef.current = serializeOpsTaskInput(nextForm)
    setFormDetailStep(getCompletionBlockerFormStep(task.type, blockers) || getDefaultFormDetailStep(task.type))
    setMessage(blockers.length > 0 ? formatCompletionBlockerNotice(blockers) : "")
    setFormCompletionBlockers(blockers)
    queueCompletionBlockerFocus(task.type, blockers)
    setFormCompletionIntent(inferredCompletionIntent)
    setConfirmingFormClose(false)
    setNotice("")
    setStatusUndo(null)
    setFormOpen(true)
  }

  function openOrganizationFix(task: OpsTask, field: TaskOrganizationFixField) {
    const nextForm = formFromTask(task)
    blurActiveElementBeforeDialog()
    setDetailOpen(false)
    syncTaskDeepLink(null)
    setEditingTask(task)
    setForm(nextForm)
    formBaselineRef.current = serializeOpsTaskInput(nextForm)
    setFormDetailStep(getDefaultFormDetailStep(task.type))
    setMessage(field === "task.assignee" ? "담당 지정" : "예정 지정")
    setFormCompletionBlockers([])
    pendingCompletionFocusRef.current = field
    setCompletionFocusRequest((request) => request + 1)
    setFormCompletionIntent(null)
    setConfirmingFormClose(false)
    setNotice("")
    setStatusUndo(null)
    setFormOpen(true)
  }

  function openProcessCellEdit(task: OpsTask, field: OperationProcessCellField) {
    if (!isOperationProcessWorkspace(workspace)) {
      openEdit(task)
      return
    }

    const target = getOperationProcessCellFocusTarget(workspace, field)
    const nextForm = formFromTask(task)
    blurActiveElementBeforeDialog()
    setDetailOpen(false)
    syncTaskDeepLink(null)
    setEditingTask(task)
    setForm(nextForm)
    formBaselineRef.current = serializeOpsTaskInput(nextForm)
    setFormDetailStep(target.step)
    setMessage(target.message)
    setFormCompletionBlockers([])
    pendingCompletionFocusRef.current = target.field
    setCompletionFocusRequest((request) => request + 1)
    setFormCompletionIntent(null)
    setConfirmingFormClose(false)
    setNotice("")
    setStatusUndo(null)
    setFormOpen(true)
  }

  async function commitProcessCellEdit(task: OpsTask, field: OperationProcessCellField, value: string) {
    const currentValue = getOperationProcessCellEditValue(task, field)
    const nextValue = value.trim()
    if (nextValue === currentValue) return

    const editedInput = applyOperationProcessCellEdit(formFromTask(task), field, nextValue)
    const payload = normalizeFormForSubmit({
      ...editedInput,
      studentId: field === "task.studentName" && nextValue !== task.studentName ? "" : editedInput.studentId,
    })
    if (serializeOpsTaskInput(payload) === serializeOpsTaskInput(formFromTask(task))) return

    setSaving(true)
    setMessage("")
    setNotice("")
    setStatusUndo(null)
    try {
      await updateOpsTask(task.id, payload)
      const syncedTask = await loadOpsTaskById(task.id)
      replaceTaskInState(syncedTask || buildLocalTaskFromInput(task.id, payload, task))
      setNotice("셀을 저장했습니다.")
    } catch (error) {
      setMessage(getOpsTaskActionErrorMessage(error, "셀을 저장하지 못했습니다."))
      throw error
    } finally {
      setSaving(false)
    }
  }

  function openWordRetestRerequest(task: OpsTask) {
    const draft = buildWordRetestRerequestDraft(task, { nextTestAt: dueTomorrowValue })
    if (!draft) return
    const nextForm = cloneForm(draft as OpsTaskInput)
    blurActiveElementBeforeDialog()
    setDetailOpen(false)
    syncTaskDeepLink(null)
    setEditingTask(null)
    setForm(nextForm)
    formBaselineRef.current = serializeOpsTaskInput(nextForm)
    setFormDetailStep(getDefaultFormDetailStep("word_retest"))
    setMessage("")
    setFormCompletionBlockers([])
    setFormCompletionIntent(null)
    setConfirmingFormClose(false)
    setNotice("")
    setStatusUndo(null)
    setFormOpen(true)
  }

  function openDetail(task: OpsTask) {
    blurActiveElementBeforeDialog()
    setSelectedTask(task)
    setDetailOpen(true)
    syncTaskDeepLink(task.id)
    setMessage("")
    setFormCompletionBlockers([])
    setFormCompletionIntent(null)
    setNotice("")
    setStatusUndo(null)
    setCommentBody("")
    setAttachmentName("")
    setAttachmentLink("")
  }

  function handleDetailOpenChange(nextOpen: boolean) {
    setDetailOpen(nextOpen)
    if (!nextOpen) syncTaskDeepLink(null)
  }

  function closeForm() {
    if (saving) return
    if (isFormDirty) {
      setConfirmingFormClose(true)
      return
    }
    setFormOpen(false)
    setFormCompletionIntent(null)
  }

  function discardFormAndClose() {
    setConfirmingFormClose(false)
    setFormOpen(false)
    setFormCompletionIntent(null)
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

  const applyTaskPatch = (taskId: string, patch: Partial<OpsTask>) => {
    setData((current) => current ? {
      ...current,
      tasks: sortWorkspaceTasks(current.tasks.map((task) => task.id === taskId ? { ...task, ...patch } : task)),
    } : current)
    setSelectedTask((current) => current?.id === taskId ? { ...current, ...patch } : current)
  }

  const prependTask = (task: OpsTask) => {
    setData((current) => {
      const workspaceData = current || emptyOpsTaskWorkspaceData

      return {
        ...workspaceData,
        tasks: sortWorkspaceTasks([task, ...workspaceData.tasks]),
      }
    })
  }

  const replaceTaskInState = (nextTask: OpsTask) => {
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
  }

  const updateTaskInState = (taskId: string, updater: (task: OpsTask) => OpsTask) => {
    setData((current) => current ? {
      ...current,
      tasks: sortWorkspaceTasks(current.tasks.map((task) => task.id === taskId ? updater(task) : task)),
    } : current)
    setSelectedTask((current) => current?.id === taskId ? updater(current) : current)
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
    setData((current) => current ? {
      ...current,
      tasks: current.tasks.filter((task) => task.id !== taskId),
    } : current)
    setSelectedTask((current) => current?.id === taskId ? null : current)
  }

  const buildLocalTaskFromInput = (taskId: string, input: OpsTaskInput, existing?: OpsTask): OpsTask => {
    const timestamp = new Date().toISOString()
    const assigneeId = input.assigneeId || ""
    const secondaryAssigneeId = input.secondaryAssigneeId || ""
    const status = input.status || existing?.status || "requested"

    return {
      id: taskId,
      title: input.title,
      type: input.type,
      status,
      priority: input.priority || existing?.priority || "normal",
      requestedBy: existing?.requestedBy || currentUserId,
      requestedByLabel: existing?.requestedByLabel || currentUserLabel,
      assigneeId,
      assigneeLabel: profileLabelById.get(assigneeId) || "",
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
      dueAt: input.dueAt || "",
      completedAt: pickInputCompletedAt(input, existing),
      memo: input.memo || "",
      checklistItems: normalizeTaskChecklistItems(input.checklistItems),
      automationRuleId: input.automationRuleId || existing?.automationRuleId || "",
      automationSourceType: input.automationSourceType || existing?.automationSourceType || "",
      automationSourceId: input.automationSourceId || existing?.automationSourceId || "",
      automationSourceKey: input.automationSourceKey || existing?.automationSourceKey || "",
      automationGeneratedAt: input.automationGeneratedAt || existing?.automationGeneratedAt || "",
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
    const parsed = parseTodoistQuickAdd(quickAddText, data?.profiles || [], {
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
    const quickDueAt = parsed.dueAt || (todoView === "today" ? dueTodayValue : "")
    const quickPriority = parsed.priority || "normal"
    const quickAssigneeId = parsed.assigneeId || ""
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
        assigneeId: quickAssigneeId,
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
        assigneeId: quickAssigneeId,
        assigneeLabel: profileLabelById.get(quickAssigneeId) || "",
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
        dueAt: quickDueAt,
        completedAt: "",
        memo: quickMemo,
        checklistItems: [],
        automationRuleId: "",
        automationSourceType: "",
        automationSourceId: "",
        automationSourceKey: "",
        automationGeneratedAt: "",
        createdAt,
        updatedAt: createdAt,
        comments: [],
        attachments: [],
        events: [],
      })
      const nextTodoView = getTodoViewForDueAt(quickDueAt, todayKey)
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

  const submitForm = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const nextTitle = form.title.trim() || buildFallbackTaskTitle(form)
    if (!nextTitle) {
      setMessage(form.type === "general" ? "할 일을 입력하세요." : "학생명이나 수업명 중 하나를 입력하세요.")
      setNotice("")
      setStatusUndo(null)
      return
    }

    setSaving(true)
    setMessage("")
    setNotice("")
    setStatusUndo(null)
    try {
      const wasEditing = Boolean(editingTask)
      const inputWithCompletionIntent = applyFormCompletionIntent({ ...form, title: nextTitle }, formCompletionIntent)
      const payload = normalizeFormForSubmit(inputWithCompletionIntent)
      const completionBlockers = getOperationCompletionBlockers(
        payload,
        data?.students || EMPTY_STUDENT_OPTIONS,
        data?.classes || EMPTY_CLASS_OPTIONS,
        data?.textbooks || EMPTY_TEXTBOOK_OPTIONS,
        data?.teachers || EMPTY_TEACHER_OPTIONS,
        optionIndexes,
      )
      if (completionBlockers.length > 0) {
        setFormDetailStep(getCompletionBlockerFormStep(payload.type, completionBlockers) || getDefaultFormDetailStep(payload.type))
        setMessage(formatCompletionBlockerNotice(completionBlockers))
        queueCompletionBlockerFocus(payload.type, completionBlockers)
        setFormCompletionBlockers(completionBlockers)
        setSaving(false)
        return
      }
      let taskId = editingTask?.id || ""
      if (editingTask) {
        await updateOpsTask(editingTask.id, payload)
      } else {
        taskId = await createOpsTask(payload)
      }
      setFormOpen(false)
      setFormCompletionBlockers([])
      setFormCompletionIntent(null)
      setConfirmingFormClose(false)
      const syncedTask = await loadOpsTaskById(taskId)
      const nextTask = syncedTask || buildLocalTaskFromInput(taskId, payload, editingTask || undefined)
      if (wasEditing) {
        replaceTaskInState(nextTask)
      } else {
        prependTask(nextTask)
        setQuery("")
      }
      const itemLabel = payload.type === "general" ? "할 일" : getTaskTypeLabel(payload.type)
      setNotice(wasEditing ? `${itemLabel}을 수정했습니다.` : `${itemLabel}을 추가했습니다.`)
    } catch (error) {
      setMessage(getOpsTaskActionErrorMessage(error, "저장하지 못했습니다."))
    } finally {
      setSaving(false)
    }
  }

  const handleCreateAutomationRule = async (input: OpsTaskAutomationRuleInput) => {
    setSaving(true)
    setMessage("")
    setNotice("")
    setStatusUndo(null)
    try {
      await createOpsTaskAutomationRule(input)
      await reload(true, false)
      setNotice("자동화 규칙을 저장했습니다.")
    } catch (error) {
      setMessage(getOpsTaskActionErrorMessage(error, "자동화 규칙을 저장하지 못했습니다."))
    } finally {
      setSaving(false)
    }
  }

  const handleUpdateAutomationRule = async (ruleId: string, input: OpsTaskAutomationRuleInput) => {
    setSaving(true)
    setMessage("")
    setNotice("")
    setStatusUndo(null)
    try {
      await updateOpsTaskAutomationRule(ruleId, input)
      await reload(true, false)
      setNotice("자동화 규칙을 변경했습니다.")
    } catch (error) {
      setMessage(getOpsTaskActionErrorMessage(error, "자동화 규칙을 변경하지 못했습니다."))
    } finally {
      setSaving(false)
    }
  }

  const handleCreateNotificationChannel = async (input: OpsTaskNotificationChannelInput) => {
    setSaving(true)
    setMessage("")
    setNotice("")
    setStatusUndo(null)
    try {
      await createOpsTaskNotificationChannel(input)
      await reload(true, false)
      setNotice("Google Chat 채널을 저장했습니다.")
    } catch (error) {
      setMessage(getOpsTaskActionErrorMessage(error, "Google Chat 채널을 저장하지 못했습니다."))
    } finally {
      setSaving(false)
    }
  }

  const handleUpdateNotificationChannel = async (channelId: string, input: OpsTaskNotificationChannelInput) => {
    setSaving(true)
    setMessage("")
    setNotice("")
    setStatusUndo(null)
    try {
      await updateOpsTaskNotificationChannel(channelId, input)
      await reload(true, false)
      setNotice("Google Chat 채널을 변경했습니다.")
    } catch (error) {
      setMessage(getOpsTaskActionErrorMessage(error, "Google Chat 채널을 변경하지 못했습니다."))
    } finally {
      setSaving(false)
    }
  }

  const handleTestNotificationChannel = async (channelId: string) => {
    setSaving(true)
    setMessage("")
    setNotice("")
    setStatusUndo(null)
    try {
      if (!supabase) throw new Error("Supabase 연결 설정이 필요합니다.")
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
      const session = sessionData.session
      if (sessionError || !session?.access_token) {
        throw new Error("로그인 상태를 다시 확인하세요.")
      }
      const response = await fetch("/api/ops-task-notification-channels/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ channelId }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok || result?.ok === false) {
        throw new Error(String(result?.errorMessage || result?.error || "Google Chat 테스트 알림을 보내지 못했습니다."))
      }
      await reload(true, false)
      setNotice("Google Chat 테스트 알림을 보냈습니다.")
    } catch (error) {
      setMessage(getOpsTaskActionErrorMessage(error, "Google Chat 테스트 알림을 보내지 못했습니다."))
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

  const changeStatus = async (task: OpsTask, status: OpsTaskStatus) => {
    setSaving(true)
    setMessage("")
    setNotice("")
    setStatusUndo(null)
    try {
      await updateOpsTaskStatus(task, status)
      const shouldRefreshSyncedTask = status === "done" || task.type === "registration" || task.type === "word_retest"
      const syncedTask = shouldRefreshSyncedTask ? await loadOpsTaskById(task.id) : null
      if (syncedTask) {
        replaceTaskInState(syncedTask)
      } else {
        applyTaskPatch(task.id, {
          status,
          completedAt: status === "done" ? new Date().toISOString() : "",
        })
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
      setNotice("상태를 변경했습니다.")
    } catch (error) {
      setMessage(getOpsTaskActionErrorMessage(error, "상태를 바꾸지 못했습니다."))
    } finally {
      setSaving(false)
    }
  }

  const changeTaskChecklistItem = async (task: OpsTask, itemId: string, checked: boolean) => {
    const checklistItems = normalizeTaskChecklistItems(task.checklistItems)
    const nextChecklistItems = checklistItems.map((item) => (
      item.id === itemId ? { ...item, checked } : item
    ))
    const payload = {
      ...formFromTask(task),
      checklistItems: nextChecklistItems,
    }
    setSaving(true)
    setMessage("")
    setNotice("")
    try {
      await updateOpsTask(task.id, payload)
      const syncedTask = await loadOpsTaskById(task.id)
      replaceTaskInState(syncedTask || { ...task, checklistItems: nextChecklistItems, updatedAt: new Date().toISOString() })
      setNotice("체크리스트를 저장했습니다.")
    } catch (error) {
      setMessage(getOpsTaskActionErrorMessage(error, "체크리스트를 저장하지 못했습니다."))
    } finally {
      setSaving(false)
    }
  }

  async function changeWordRetestAssistantAction(task: OpsTask, action: WordRetestAssistantQuickAction) {
    if (action.kind === "edit_scores") {
      openEdit(task, ["점수"])
      return
    }
    if (action.kind === "quick_score" && !isWordRetestScoreValue(action.score)) {
      setMessage("점수는 0~100 숫자로 입력하세요.")
      return
    }

    const actionPatch = buildWordRetestAssistantActionPatch(task, action)
    if (!actionPatch) {
      setMessage("처리할 실행 값이 없습니다.")
      return
    }
    const payload = normalizeFormForSubmit({
      ...formFromTask(task),
      status: actionPatch.status,
      wordRetest: actionPatch.wordRetest,
    })

    setSaving(true)
    setMessage("")
    setNotice("")
    setStatusUndo(null)
    try {
      await updateOpsTask(task.id, payload)
      const syncedTask = await loadOpsTaskById(task.id)
      replaceTaskInState(syncedTask || buildLocalTaskFromInput(task.id, payload, task))
      setNotice(`${action.label} 처리했습니다.`)
    } catch (error) {
      setMessage(getOpsTaskActionErrorMessage(error, `${action.label} 처리하지 못했습니다.`))
    } finally {
      setSaving(false)
    }
  }

  const changeRegistrationPipeline = async (task: OpsTask, pipelineStatus: string) => {
    const payload = normalizeFormForSubmit({
      ...formFromTask(task),
      registration: {
        ...(task.registration || {}),
        pipelineStatus,
      },
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
      openEdit(task, completionBlockers, { registrationPipelineStatus: pipelineStatus })
      return
    }

    setSaving(true)
    setMessage("")
    setNotice("")
    setStatusUndo(null)
    try {
      await updateOpsTask(task.id, payload)
      const syncedTask = await loadOpsTaskById(task.id)
      replaceTaskInState(syncedTask || buildLocalTaskFromInput(task.id, payload, task))
      setNotice("등록 단계를 변경했습니다.")
    } catch (error) {
      setMessage(getOpsTaskActionErrorMessage(error, "등록 단계를 변경하지 못했습니다."))
    } finally {
      setSaving(false)
    }
  }

  async function changeOperationProcessStage(task: OpsTask, stageKey: string) {
    if (task.type === "registration") {
      await changeRegistrationPipeline(task, stageKey)
      return
    }
    if ((task.type !== "withdrawal" && task.type !== "transfer") || !isOperationProcessWorkspace(workspace)) return

    const nextStatus = getOperationProcessStatusForStage(workspace, stageKey)
    if (!nextStatus || nextStatus === task.status) return
    if (nextStatus === "done") {
      const completionBlockers = operationCompletionBlockersByTaskId.get(task.id) || EMPTY_COMPLETION_BLOCKERS
      if (completionBlockers.length > 0) {
        openEdit(task, completionBlockers, { status: nextStatus })
        return
      }
    }

    await changeStatus(task, nextStatus)
  }

  const handleTodoBoardMove = async (task: OpsTask, columnKey: TodoBoardColumn["key"]) => {
    const currentColumnKey = getTodoBoardColumnKey(task, todayKey, currentUserId, currentUserLabel)
    if (currentColumnKey === columnKey) return

    const payload = normalizeFormForSubmit(moveTodoTaskToBoardColumn(task, columnKey, { todayKey, currentUserId }))
    if (serializeOpsTaskInput(payload) === serializeOpsTaskInput(formFromTask(task))) return

    setSaving(true)
    setMessage("")
    setNotice("")
    setStatusUndo(null)
    try {
      await updateOpsTask(task.id, payload)
      const syncedTask = await loadOpsTaskById(task.id)
      replaceTaskInState(syncedTask || buildLocalTaskFromInput(task.id, payload, task))
      setNotice("할 일을 보드에서 이동했습니다.")
    } catch (error) {
      setMessage(getOpsTaskActionErrorMessage(error, "할 일을 보드에서 이동하지 못했습니다."))
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
      setNotice("상태 변경을 되돌렸습니다.")
    } catch (error) {
      setMessage(getOpsTaskActionErrorMessage(error, "상태를 되돌리지 못했습니다."))
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
    blurActiveElementBeforeDialog()
    setDetailOpen(false)
    setFormOpen(false)
    setMessage("")
    setFormCompletionBlockers([])
    setNotice("")
    setStatusUndo(null)
    setDeleteTarget(task)
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

  const selectedTaskFresh = selectedTask ? taskById.get(selectedTask.id) || selectedTask : null
  const deleteTargetRemovesCompletedOperation = deleteTarget ? deleteTarget.type !== "general" && isClosedOpsTask(deleteTarget) : false
  const nextAction = selectedTaskFresh ? getNextTaskStatusAction(selectedTaskFresh) : null
  const selectedRegistrationAction = selectedTaskFresh ? getNextRegistrationPipelineAction(selectedTaskFresh) : null
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
  const nextActionBlocked = nextAction?.status === "done" && completionBlockers.length > 0
  const detailPrimaryAction = selectedRegistrationAction || nextAction
  const detailPrimaryActionBlocked = selectedRegistrationAction
    ? selectedRegistrationAction.pipelineStatus.startsWith("7.") && completionBlockers.length > 0
    : nextActionBlocked
  const detailBlockedActionLabel = getCompletionBlockerActionLabel(completionBlockers)
  const selectedTaskCanEdit = selectedTaskFresh ? canEditTaskDetails(selectedTaskFresh) : false
  const selectedTaskChecklistItems = selectedTaskFresh ? selectedTaskFresh.checklistItems : []
  const selectedWordRetestRerequestable = selectedTaskFresh ? isWordRetestRerequestable(selectedTaskFresh) : false
  const selectedWordRetestAssistantActions = selectedTaskFresh && isWordRetestWorkspace && wordRetestMode === "assistant" && selectedTaskFresh.type === "word_retest"
    ? getWordRetestAssistantQuickActions(selectedTaskFresh, wordRetestExecutionOptions) as WordRetestAssistantQuickAction[]
    : []
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

  useEffect(() => {
    if (!isTodoWorkspace) return

    const handleShortcut = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || formOpen || detailOpen || deleteTarget) return

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
  }, [deleteTarget, detailOpen, focusQuickAdd, focusSearch, formOpen, isTodoWorkspace])

  return (
    <div className="flex flex-col gap-4 px-3 pb-6 sm:px-4 lg:px-6">
      {!isTodoWorkspace && visibleOperationMetrics.length > 0 && (
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

      <div className="flex flex-col gap-2 rounded-lg border bg-card p-3 shadow-xs">
        <div className={isTodoWorkspace ? "flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start" : "flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between"}>
          <div className={`${HORIZONTAL_TAB_BAR_CLASS} ${isTodoWorkspace ? "flex-1" : "w-full lg:flex-1"}`} role="tablist" aria-label={isTodoWorkspace ? "할 일 목록" : `${workspaceLabel} 보기`}>
            {isTodoWorkspace
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
              : operationViewTabs.map((tab) => (
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
          <div className={isTodoWorkspace ? "flex shrink-0 flex-wrap items-center justify-end gap-2" : "flex flex-wrap items-center gap-2 lg:shrink-0 lg:justify-end"}>
            {!isTodoWorkspace && taskFocus !== "none" && (
              <Button type="button" variant="secondary" size="sm" onClick={() => syncView(view)}>
                <X className="size-4" />
                {TASK_FOCUS_LABELS[taskFocus]} 해제
              </Button>
            )}
            {showClosedToggle && (
              <Button type="button" variant="outline" size="sm" aria-pressed={showClosed} onClick={() => setShowClosed((value) => !value)}>
                <Check className="size-4" />
                {showClosed ? "완료 숨김" : "완료 보기"}
              </Button>
            )}
            <Button type="button" variant="outline" size="sm" onClick={() => void reload(true)} disabled={loading} aria-label="새로고침" className="size-8 px-0">
              <RefreshCw className="size-4" />
              <span className="sr-only">새로고침</span>
            </Button>
            {showToolbarCreate && (
              <Button type="button" size="sm" onClick={() => openCreate(scopedTaskType)} disabled={createActionDisabled}>
                <Plus className="size-4" />
                {isTodoWorkspace ? "할 일 추가" : `${workspaceLabel} 추가`}
              </Button>
            )}
          </div>
        </div>

        {isTodoWorkspace && !isTodoAutomationView && (
          <div className="grid gap-2">
            <form onSubmit={submitQuickAdd} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md border bg-background p-2">
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
                placeholder="할 일 추가"
                data-testid="todo-quick-add-input"
                className="h-10 border-0 shadow-none focus-visible:ring-0"
              />
              <Button
                type="submit"
                size="sm"
                aria-label="할 일 추가"
                disabled={saving || !quickAddText.trim()}
                className="size-10 shrink-0 px-0 sm:w-auto sm:px-3"
                data-testid="todo-quick-add-submit"
              >
                <Plus className="size-4" />
                <span className="sr-only sm:not-sr-only">추가</span>
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

        {showSearch && (
        <div className="relative">
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
        )}

        {isWordRetestWorkspace && (
          <div className="inline-flex w-fit rounded-md border bg-background p-1">
            <button
              type="button"
              aria-pressed={wordRetestMode === "teacher"}
              aria-label="담당 선생님 보기"
              onClick={() => setWordRetestMode("teacher")}
              className={[
                "rounded px-3 py-1.5 text-sm font-medium",
                wordRetestMode === "teacher" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
              ].join(" ")}
            >
              선생님
            </button>
            <button
              type="button"
              aria-pressed={wordRetestMode === "assistant"}
              aria-label="조교 선생님 보기"
              onClick={() => setWordRetestMode("assistant")}
              className={[
                "rounded px-3 py-1.5 text-sm font-medium",
                wordRetestMode === "assistant" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
              ].join(" ")}
            >
              조교
            </button>
          </div>
        )}

        {isWordRetestWorkspace && wordRetestMode === "assistant" && (
          <div className="grid gap-2">
            <WordRetestBranchBar
              value={wordRetestBranch}
              counts={wordRetestBranchCounts}
              onChange={setWordRetestBranch}
            />
            <WordRetestQueueBar
              value={wordRetestQueue}
              counts={wordRetestQueueCounts}
              onChange={setWordRetestQueue}
            />
          </div>
        )}

        {isWordRetestWorkspace && wordRetestMode === "teacher" && (
          <WordRetestTeacherQueueBar
            value={wordRetestTeacherQueue}
            counts={wordRetestTeacherQueueCounts}
            onChange={setWordRetestTeacherQueue}
          />
        )}

        {isTodoWorkspace && todoView === "filters" && (
          <TodoFilterBar
            value={todoFilter}
            tasks={scopedTasks}
            todayKey={todayKey}
            completionBlockersByTaskId={operationCompletionBlockersByTaskId}
            confirmationByTaskId={confirmationByTaskId}
            onChange={syncTodoFilter}
          />
        )}

        {isRegistrationWorkspace && (
          <RegistrationPipelineFilter
            value={registrationPipeline}
            tasks={registrationPipelineCountTasks}
            onChange={setRegistrationPipeline}
          />
        )}

        {data && !data.schemaReady && (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {data?.error || "할 일 DB 마이그레이션을 적용하세요."}
          </div>
        )}
        {notice && !detailOpen && (
          <div role="status" aria-live="polite" className="flex flex-col gap-2 rounded-md border border-primary/25 bg-primary/5 px-3 py-2 text-sm font-medium text-primary sm:flex-row sm:items-center sm:justify-between">
            <span>{notice}</span>
            {statusUndo && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void undoStatusChange()}
                disabled={saving}
                aria-label={`${statusUndo.title} 상태 변경 되돌리기`}
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
        ) : shouldHideEmptySurface ? null : isTodoWorkspace && todoView === "board" ? (
          <TodoBoard
            columns={todoBoardColumns}
            todayKey={todayKey}
            onOpen={openDetail}
            onEdit={openEdit}
            onOrganizationFix={openOrganizationFix}
            onStatusChange={(task, status) => void changeStatus(task, status)}
            onRegistrationPipelineAdvance={(task, pipelineStatus) => void changeRegistrationPipeline(task, pipelineStatus)}
            onTodoBoardMove={(task, columnKey) => void handleTodoBoardMove(task, columnKey)}
            statusActionDisabled={saving}
            onCreate={focusQuickAdd}
            emptyLabel={emptyTaskLabel}
            showOperationSourceLink={isTodoWorkspace}
            completionBlockersByTaskId={visibleCompletionBlockersByTaskId}
          />
        ) : isTodoWorkspace && todoView === "recurring" ? (
          <AutomationRulePanel
            kind="recurring"
            rules={automationRules}
            channels={notificationChannels}
            profiles={data?.profiles || []}
            saving={saving}
            onCreate={handleCreateAutomationRule}
            onUpdate={handleUpdateAutomationRule}
          />
        ) : isTodoWorkspace && todoView === "automations" ? (
          <div className="grid gap-5">
            <NotificationChannelPanel
              channels={notificationChannels}
              saving={saving}
              onCreate={handleCreateNotificationChannel}
              onUpdate={handleUpdateNotificationChannel}
              onTest={handleTestNotificationChannel}
            />
            <AutomationRulePanel
              kind="trigger"
              rules={automationRules}
              channels={notificationChannels}
              profiles={data?.profiles || []}
              saving={saving}
              onCreate={handleCreateAutomationRule}
              onUpdate={handleUpdateAutomationRule}
            />
          </div>
        ) : (isTodoWorkspace && todoView === "calendar") || (!isTodoWorkspace && view === "calendar") ? (
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
        ) : !isTodoWorkspace && view === "process" && isOperationProcessWorkspace(workspace) ? (
          <OperationProcessBoard
            workspace={workspace}
            columns={operationProcessBoardColumns}
            todayKey={todayKey}
            onOpen={openDetail}
            onEdit={openEdit}
            onProcessCellEdit={openProcessCellEdit}
            onProcessCellCommit={(task, field, value) => commitProcessCellEdit(task, field, value)}
            onProcessStageChange={(task, stageKey) => void changeOperationProcessStage(task, stageKey)}
            statusActionDisabled={saving}
            onCreate={() => openCreate(scopedTaskType)}
            emptyLabel={emptyTaskLabel}
            emptyActionLabel={emptyActionLabel}
            showEmptyAction={showEmptyCreate}
            completionBlockersByTaskId={visibleCompletionBlockersByTaskId}
          />
        ) : !isTodoWorkspace && view === "status" ? (
          <GroupedTaskList
            groups={groupOpsTasksByStatus(visibleTasks).filter((group) => group.tasks.length > 0)}
            todayKey={todayKey}
            onOpen={openDetail}
            onEdit={openEdit}
            onOrganizationFix={openOrganizationFix}
            onStatusChange={(task, status) => void changeStatus(task, status)}
            onRegistrationPipelineAdvance={(task, pipelineStatus) => void changeRegistrationPipeline(task, pipelineStatus)}
            onWordRetestRerequest={(task) => openWordRetestRerequest(task)}
            wordRetestTeacherMode={isWordRetestWorkspace && wordRetestMode === "teacher"}
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
            onOrganizationFix={openOrganizationFix}
            onStatusChange={(task, status) => void changeStatus(task, status)}
            onRegistrationPipelineAdvance={(task, pipelineStatus) => void changeRegistrationPipeline(task, pipelineStatus)}
            onWordRetestRerequest={(task) => openWordRetestRerequest(task)}
            wordRetestTeacherMode={isWordRetestWorkspace && wordRetestMode === "teacher"}
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
            onOrganizationFix={openOrganizationFix}
            onStatusChange={(task, status) => void changeStatus(task, status)}
            onRegistrationPipelineAdvance={(task, pipelineStatus) => void changeRegistrationPipeline(task, pipelineStatus)}
            onWordRetestAssistantAction={(task, action) => void changeWordRetestAssistantAction(task, action)}
            onWordRetestRerequest={(task) => openWordRetestRerequest(task)}
            wordRetestAssistantMode={isWordRetestWorkspace && wordRetestMode === "assistant"}
            wordRetestTeacherMode={isWordRetestWorkspace && wordRetestMode === "teacher"}
            wordRetestExecutionOptions={wordRetestExecutionOptions}
            statusActionDisabled={saving}
            onCreate={isTodoWorkspace ? focusQuickAdd : () => openCreate(scopedTaskType)}
            emptyLabel={emptyTaskLabel}
            emptyActionLabel={emptyActionLabel}
            showEmptyAction={showEmptyCreate}
            showType={false}
            showOperationSourceLink={isTodoWorkspace}
            completionBlockersByTaskId={visibleCompletionBlockersByTaskId}
          />
        )}
      </div>

      <Dialog open={formOpen} onOpenChange={handleFormOpenChange}>
        <DialogContent className={[
          "flex max-h-[calc(100dvh-1rem)] min-h-0 flex-col overflow-hidden p-0 sm:max-h-[92vh]",
          isTemplateForm ? "sm:max-w-3xl" : "sm:max-w-xl",
        ].join(" ")}>
          <DialogHeader className="shrink-0 border-b bg-background px-6 py-4 pr-12">
            <DialogTitle>{formDialogTitle}</DialogTitle>
            <DialogDescription className="sr-only">
              운영 업무를 입력하고 저장합니다.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitForm} onKeyDown={handleFormKeyDown} className="flex min-h-0 flex-1 flex-col">
            <div data-testid="ops-task-form-scroll-body" className="grid min-h-0 flex-1 gap-4 overflow-x-hidden overflow-y-auto overscroll-contain px-6 py-4">
              {message && !isTemplateForm && (
                <div role="alert" className="rounded-md border border-destructive/30 px-3 py-2 text-sm whitespace-pre-line text-destructive">
                  {message}
                </div>
              )}

            {form.type === "registration" && (!isTemplateForm || editingTask) && (
              <SelectField
                label="진행상태"
                value={form.registration?.pipelineStatus || REGISTRATION_PIPELINE_STATUSES[0]?.value || "0. 등록 문의"}
                onChange={(value) => updateRegistration("pipelineStatus", value)}
              >
                {REGISTRATION_PIPELINE_STATUSES.map((status) => (
                  <option key={status.value} value={status.value}>{status.label}</option>
                ))}
              </SelectField>
            )}

            {!isTemplateForm && (
              <>
                <div className="grid gap-3">
                  <TextField
                    label="제목"
                    value={form.title}
                    placeholder="무엇을 해야 하나요?"
                    autoFocus={!editingTask}
                    completionField="task.title"
                    onChange={(value) => updateForm("title", value)}
                  />
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <ProfileSelect
                    value={form.assigneeId || ""}
                    profiles={data?.profiles || []}
                    onChange={(value) => updateForm("assigneeId", value)}
                    completionField="task.assignee"
                  />
                  <TextField label="예정일" type="date" value={dateInputValue(form.dueAt)} completionField="task.dueAt" onChange={(value) => updateForm("dueAt", value)} />
                </div>

                <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted/45 px-3 py-2">
                  {currentUserId && (
                    <Button
                      type="button"
                      variant={form.assigneeId === currentUserId ? "default" : "outline"}
                      size="sm"
                      onClick={() => updateForm("assigneeId", currentUserId)}
                    >
                      <UserRound className="size-4" />
                      나에게
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant={dateInputValue(form.dueAt) === dateInputValue(dueTodayValue) ? "default" : "outline"}
                    size="sm"
                    onClick={() => updateForm("dueAt", toDateKey(dueTodayValue))}
                  >
                    <CalendarDays className="size-4" />
                    오늘
                  </Button>
                  <Button
                    type="button"
                    variant={dateInputValue(form.dueAt) === dateInputValue(dueTomorrowValue) ? "default" : "outline"}
                    size="sm"
                    onClick={() => updateForm("dueAt", toDateKey(dueTomorrowValue))}
                  >
                    <CalendarDays className="size-4" />
                    내일
                  </Button>
                  {form.dueAt && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => updateForm("dueAt", "")}>
                      예정일 지우기
                    </Button>
                  )}
                </div>

                <label htmlFor={formMemoId} className="grid gap-1.5 text-sm font-medium">
                  <span>메모</span>
                  <Textarea
                    id={formMemoId}
                    value={form.memo || ""}
                    onChange={(event) => updateForm("memo", event.target.value)}
                    placeholder="메모"
                    className="min-h-24"
                  />
                </label>
                <label htmlFor={formChecklistId} className="grid gap-1.5 text-sm font-medium">
                  <span>체크리스트</span>
                  <Textarea
                    id={formChecklistId}
                    value={formatTaskChecklistText(form.checklistItems)}
                    onChange={(event) => updateForm("checklistItems", parseTaskChecklistText(event.target.value, form.checklistItems))}
                    placeholder="한 줄에 하나씩 입력"
                    className="min-h-20"
                  />
                </label>
              </>
            )}

            {isTemplateForm && (
              <section className="grid gap-3 rounded-lg border p-3">
                <TypeSpecificFields
                  step="all"
                  form={form}
                  students={data?.students || EMPTY_STUDENT_OPTIONS}
                  classes={data?.classes || EMPTY_CLASS_OPTIONS}
                  teachers={data?.teachers || EMPTY_TEACHER_OPTIONS}
                  textbooks={data?.textbooks || EMPTY_TEXTBOOK_OPTIONS}
                  dueTodayValue={dueTodayValue}
                  dueTomorrowValue={dueTomorrowValue}
                  requiredFields={formRequiredFields}
                  updateForm={updateForm}
                  updateRegistration={updateRegistration}
                  updateWithdrawal={updateWithdrawal}
                  updateTransfer={updateTransfer}
                  updateWordRetest={updateWordRetest}
                />
              </section>
            )}

            {isTemplateForm && (
              <section className="grid gap-3 rounded-lg border bg-muted/20 p-3">
                <div className={showTemplateDueAt ? "grid gap-3 md:grid-cols-2" : "grid gap-3"}>
                  <ProfileSelect
                    value={form.assigneeId || ""}
                    profiles={data?.profiles || []}
                    onChange={(value) => updateForm("assigneeId", value)}
                    completionField="task.assignee"
                    required={formRequiredFields.has("task.assignee")}
                    invalid={formRequiredFields.has("task.assignee")}
                  />
                  {showTemplateDueAt && (
                    <TextField label={getDueAtDisplayLabel(form.type)} type="datetime-local" value={dateTimeInputValue(form.dueAt)} completionField="task.dueAt" required={formRequiredFields.has("task.dueAt")} invalid={formRequiredFields.has("task.dueAt")} onChange={(value) => updateForm("dueAt", value)} />
                  )}
                </div>
                {editingTask && (
                  <TextField
                    label="제목 직접 지정"
                    value={form.title}
                    placeholder="제목"
                    completionField="task.title"
                    required={formRequiredFields.has("task.title")}
                    invalid={formRequiredFields.has("task.title")}
                    onChange={(value) => updateForm("title", value)}
                  />
                )}
              </section>
            )}
            </div>
            <div className="flex shrink-0 flex-col gap-2 border-t bg-background px-6 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:flex-row sm:items-center sm:justify-end">
              {message && isTemplateForm && (
                <div role="alert" className="min-w-0 text-sm font-medium text-destructive sm:mr-auto">
                  {message}
                </div>
              )}
              {confirmingFormClose && (
                <div role="alert" className="flex w-full items-center justify-between gap-2 rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2 text-sm font-medium text-destructive sm:mr-auto sm:w-auto">
                  <span>입력 중</span>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmingFormClose(false)}>
                    계속 작성
                  </Button>
                </div>
              )}
              {formCompletionBlockers.length > 0 && (
                (() => {
                  const firstBlocker = formCompletionBlockers[0]
                  const firstBlockerHref = getClassPlanBlockerHref(formCompletionBlockerTarget, firstBlocker)
                  if (firstBlockerHref) {
                    return (
                      <Button asChild variant="outline" className="w-full sm:w-auto">
                        <a
                          href={firstBlockerHref}
                          aria-label={`${getCompletionBlockerActionLabel(formCompletionBlockers)} 수업계획에서 바로 수정`}
                        >
                          {getCompletionBlockerActionLabel(formCompletionBlockers)}
                        </a>
                      </Button>
                    )
                  }

                  return (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setFormDetailStep(getCompletionBlockerFormStep(form.type, [firstBlocker]) || getDefaultFormDetailStep(form.type))
                        queueCompletionBlockerFocus(form.type, [firstBlocker])
                      }}
                      aria-label={`${getCompletionBlockerActionLabel(formCompletionBlockers)} 바로 입력`}
                      className="w-full sm:w-auto"
                    >
                      {getCompletionBlockerActionLabel(formCompletionBlockers)}
                    </Button>
                  )
                })()
              )}
              <Button type="button" variant={confirmingFormClose ? "destructive" : "outline"} onClick={confirmingFormClose ? discardFormAndClose : closeForm} className="w-full sm:w-auto">
                {confirmingFormClose ? "버리고 닫기" : "닫기"}
              </Button>
              <Button type="submit" disabled={saving} className="w-full sm:w-auto">{saving ? "저장 중" : getFormCompletionIntentSubmitLabel(formCompletionIntent)}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={detailOpen} onOpenChange={handleDetailOpenChange}>
        <DialogContent className={[
          "max-h-[calc(100dvh-1rem)] scroll-pb-24 overflow-x-hidden overflow-y-auto overscroll-contain sm:max-h-[92vh]",
          selectedTaskFresh?.type === "general" ? "sm:max-w-2xl" : "sm:max-w-5xl",
        ].join(" ")}>
          <DialogHeader>
            <DialogTitle>{selectedTaskFresh?.title || "상세"}</DialogTitle>
            <DialogDescription className="sr-only">
              선택한 운영 업무의 처리 상태를 확인합니다.
            </DialogDescription>
          </DialogHeader>
          {notice && (
            <div role="status" aria-live="polite" className="flex flex-col gap-2 rounded-md border border-primary/25 bg-primary/5 px-3 py-2 text-sm font-medium text-primary sm:flex-row sm:items-center sm:justify-between">
              <span>{notice}</span>
              {statusUndo && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void undoStatusChange()}
                  disabled={saving}
                  aria-label={`${statusUndo.title} 상태 변경 되돌리기`}
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
            <div className={selectedTaskFresh.type === "general" ? "grid gap-4" : "grid gap-4 lg:grid-cols-[1.15fr_0.85fr]"}>
              <div className="flex flex-col gap-3 rounded-lg border p-4">
                <div className="flex flex-wrap items-center gap-2">
                  {selectedTaskFresh.type !== "general" && <TaskTypeBadge type={selectedTaskFresh.type} />}
                  {shouldShowDetailStatusBadge(selectedTaskFresh) && <TaskStatusBadge status={selectedTaskFresh.status} />}
                  {selectedTaskFresh.type === "general" ? (
                    <TodoPriorityBadge priority={selectedTaskFresh.priority} />
                  ) : (
                    <Badge variant="outline">{getTaskPriorityLabel(selectedTaskFresh.priority)}</Badge>
                  )}
                  {selectedTaskFresh.campus && <Badge variant="secondary">{selectedTaskFresh.campus}</Badge>}
                  {selectedTaskFresh.subject && <Badge variant="secondary">{selectedTaskFresh.subject}</Badge>}
                </div>
                <dl className="grid gap-3 text-sm md:grid-cols-2">
                  {selectedTaskFresh.type !== "general" && selectedTaskFresh.studentName && <Info label="학생" value={selectedTaskFresh.studentName} />}
                  {selectedTaskFresh.type !== "general" && selectedTaskFresh.className && <Info label="수업" value={selectedTaskFresh.className} />}
                  {selectedTaskFresh.type !== "general" && selectedTaskFresh.textbookTitle && <Info label="교재" value={selectedTaskFresh.textbookTitle} />}
                  {(selectedTaskFresh.type !== "general" || selectedTaskFresh.assigneeLabel) && (
                    <Info label="담당" value={selectedTaskFresh.assigneeLabel || "미지정"} />
                  )}
                  {selectedTaskFresh.dueAt && <Info label={getDueAtDisplayLabel(selectedTaskFresh.type)} value={dateLabel(selectedTaskFresh.dueAt)} />}
                  {selectedTaskFresh.completedAt && <Info label="완료" value={dateLabel(selectedTaskFresh.completedAt)} />}
                </dl>
                <CompletionBlockerActionPanel
                  task={selectedTaskFresh}
                  blockers={completionBlockers}
                  onSelect={(blocker) => openEdit(selectedTaskFresh, [blocker])}
                />
                <TaskChecklistPanel
                  task={selectedTaskFresh}
                  items={selectedTaskChecklistItems}
                  disabled={saving || !canEditTaskDetails(selectedTaskFresh)}
                  onChecklistItemChange={(itemId, checked) => void changeTaskChecklistItem(selectedTaskFresh, itemId, checked)}
                />
                {selectedTaskFresh.type !== "general" && <TypeDetail task={selectedTaskFresh} />}
                {selectedTaskFresh.type !== "general" && <AutoSyncResultSummary task={selectedTaskFresh} />}
                {selectedTaskFresh.memo && <p className="rounded-md bg-muted p-3 text-sm">{selectedTaskFresh.memo}</p>}
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                  {selectedWordRetestAssistantActions.length > 0 && (
                    <WordRetestAssistantActionControls
                      task={selectedTaskFresh}
                      actions={selectedWordRetestAssistantActions}
                      onAction={(action) => void changeWordRetestAssistantAction(selectedTaskFresh, action)}
                      disabled={saving}
                    />
                  )}
                  {selectedWordRetestAssistantActions.length === 0 && detailPrimaryAction && (
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
                  {getSecondaryTaskStatusOptions(selectedTaskFresh)
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
                  {selectedWordRetestRerequestable && (
                    <Button type="button" variant="outline" size="sm" onClick={() => openWordRetestRerequest(selectedTaskFresh)} className="w-full sm:w-auto">
                      미응시 재요청
                    </Button>
                  )}
                  {selectedTaskCanEdit && (
                    <Button type="button" variant="outline" size="sm" onClick={() => openEdit(selectedTaskFresh)} className="w-full sm:w-auto">
                      수정
                    </Button>
                  )}
                  {canDeleteTask(selectedTaskFresh) && (
                    <Button type="button" variant="destructive" size="sm" onClick={() => requestRemoveTask(selectedTaskFresh)} className="w-full sm:w-auto">
                      <Trash2 className="size-4" />
                      삭제
                    </Button>
                  )}
                </div>
              </div>

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
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
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
  students,
  classes,
  teachers,
  textbooks,
  dueTodayValue,
  dueTomorrowValue,
  requiredFields,
  updateForm,
  updateRegistration,
  updateWithdrawal,
  updateTransfer,
  updateWordRetest,
}: {
  step: FormDetailRenderStep
  form: OpsTaskInput
  students: OpsStudentOption[]
  classes: OpsClassOption[]
  teachers: OpsTeacherOption[]
  textbooks: OpsTextbookOption[]
  dueTodayValue: string
  dueTomorrowValue: string
  requiredFields: Set<string>
  updateForm: <Key extends keyof OpsTaskInput>(key: Key, value: OpsTaskInput[Key]) => void
  updateRegistration: (key: keyof NonNullable<OpsTaskInput["registration"]>, value: string | boolean) => void
  updateWithdrawal: (key: keyof NonNullable<OpsTaskInput["withdrawal"]>, value: string | boolean) => void
  updateTransfer: (key: keyof NonNullable<OpsTaskInput["transfer"]>, value: string | boolean) => void
  updateWordRetest: (key: keyof NonNullable<OpsTaskInput["wordRetest"]>, value: string) => void
}) {
  const registration = form.registration || {}
  const withdrawal = form.withdrawal || {}
  const transfer = form.transfer || {}
  const wordRetest = form.wordRetest || {}
  const wordRetestAbsent = isWordRetestAbsent(wordRetest)
  const findStudent = (id: string) => students.find((student) => student.id === id)
  const findClass = (id: string) => classes.find((classItem) => classItem.id === id)
  const findTeacher = (id: string) => teachers.find((teacher) => teacher.id === id)
  const findTextbook = (id: string) => textbooks.find((textbook) => textbook.id === id)
  const selectedWordRetestStudent = form.type === "word_retest" ? findStudent(form.studentId || "") : undefined
  const selectedWordRetestClassId = form.type === "word_retest" ? form.classId || "" : ""
  const selectedWordRetestClass = form.type === "word_retest" ? findClass(selectedWordRetestClassId) : undefined
  const selectedWordRetestTeacherId = form.type === "word_retest" ? wordRetest.teacherId || "" : ""
  const selectedRegistrationStudent = form.type === "registration" ? findStudent(form.studentId || "") : undefined
  const selectedRegistrationClass = form.type === "registration" ? findClass(form.classId || "") : undefined
  const selectedWithdrawalStudent = form.type === "withdrawal" ? findStudent(form.studentId || "") : undefined
  const selectedWithdrawalClass = form.type === "withdrawal" ? findClass(form.classId || "") : undefined
  const selectedTransferStudent = form.type === "transfer" ? findStudent(form.studentId || "") : undefined
  const selectedTransferFromClass = form.type === "transfer" ? findClass(transfer.fromClassId || "") : undefined
  const selectedTransferToClass = form.type === "transfer" ? findClass(transfer.toClassId || form.classId || "") : undefined
  const registrationDuplicateCandidates = form.type === "registration" ? getRegistrationDuplicateStudentCandidates(form, students) : []
  const wordRetestClassOptions = getWordRetestClassOptions(classes, selectedWordRetestStudent, selectedWordRetestClassId)
  const wordRetestTeacherOptions = getWordRetestTeacherOptions(teachers, selectedWordRetestTeacherId)
  const registrationTextbookOptions = form.type === "registration"
    ? getClassScopedTextbookOptions(textbooks, selectedRegistrationClass, form.textbookId || "")
    : textbooks
  const wordRetestTextbookOptions = form.type === "word_retest"
    ? getClassScopedTextbookOptions(textbooks, selectedWordRetestClass, form.textbookId || "")
    : textbooks
  const [manualLinkedFields, setManualLinkedFields] = useState<Record<string, boolean>>({})
  const requiredFieldProps = (field: string) => {
    const required = requiredFields.has(field)
    return { required, invalid: required }
  }

  function openManualField(field: string, manualValue = "") {
    setManualLinkedFields((current) => ({ ...current, [field]: true }))
    const nextManualValue = manualValue.trim()
    if (!nextManualValue) return
    if (field === "registrationClass") updateForm("className", nextManualValue)
    if (field === "registrationTextbook") updateForm("textbookTitle", nextManualValue)
    if (field === "withdrawalStudent") updateForm("studentName", nextManualValue)
    if (field === "withdrawalClass") updateForm("className", nextManualValue)
    if (field === "transferStudent") updateForm("studentName", nextManualValue)
    if (field === "transferFromClass") updateTransfer("fromClassName", nextManualValue)
    if (field === "transferToClass") updateTransfer("toClassName", nextManualValue)
    if (field === "wordRetestStudent") {
      updateWordRetest("studentName", nextManualValue)
      updateForm("studentName", nextManualValue)
    }
    if (field === "wordRetestClass") {
      updateWordRetest("className", nextManualValue)
      updateForm("className", nextManualValue)
    }
    if (field === "wordRetestTeacher") updateWordRetest("teacherName", nextManualValue)
    if (field === "wordRetestTextbook") {
      updateWordRetest("textbookName", nextManualValue)
      updateForm("textbookTitle", nextManualValue)
    }
  }

  function applyRegistrationWorkflowPreset(preset: string) {
    const patch = buildRegistrationWorkflowPresetPatch(preset, {
      dueTodayValue,
      dueTomorrowValue,
      inquiryNowValue: dateTimeInputValueFromDate(new Date()),
    }) as Partial<NonNullable<OpsTaskInput["registration"]>>
    if (patch.pipelineStatus) updateRegistration("pipelineStatus", patch.pipelineStatus)
    if (patch.inquiryAt) updateRegistration("inquiryAt", patch.inquiryAt)
    if (patch.inquiryChannel) updateRegistration("inquiryChannel", patch.inquiryChannel)
    if (patch.levelTestAt) updateRegistration("levelTestAt", patch.levelTestAt)
    if (patch.phoneConsultationAt) updateRegistration("phoneConsultationAt", patch.phoneConsultationAt)
    if (patch.visitConsultationAt) updateRegistration("visitConsultationAt", patch.visitConsultationAt)
    if (patch.consultationAt) updateRegistration("consultationAt", patch.consultationAt)
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

  function getClassTextbookOptions(classItem?: OpsClassOption) {
    if (!classItem) return []
    const seen = new Set<string>()
    return classItem.textbookIds
      .map((id) => findTextbook(id))
      .filter((textbook): textbook is OpsTextbookOption => {
        if (!textbook || seen.has(textbook.id)) return false
        seen.add(textbook.id)
        return true
      })
  }

  function findClassPrimaryTextbook(classItem: OpsClassOption) {
    const classTextbooks = getClassTextbookOptions(classItem)
    return classTextbooks.length === 1 ? classTextbooks[0]?.id || "" : ""
  }

  function findClassBranch(classItem: OpsClassOption) {
    const roomText = `${classItem.room || ""} ${classItem.meta || ""}`
    if (roomText.includes("별관")) return "별관"
    if (roomText.includes("본관")) return "본관"
    return ""
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
      if (options.fillWithdrawalClass) selectClass("", { fillWithdrawal: true })
      if (options.fillTransferFromClass) selectClass("", { fillTransferFrom: true })
      if (options.fillWordRetestClass) selectClass("", { fillWordRetest: true })
      return
    }
    if (!student) return

    updateForm("studentName", student.label)
    const classId = findStudentPrimaryClass(student)
    const wordRetestClassId = findStudentPrimaryClass(student, { wordRetestOnly: true })
    if (options.fillRegistration) {
      updateRegistration("schoolGrade", student.grade || registration.schoolGrade || "")
      updateRegistration("schoolName", student.school || registration.schoolName || "")
      updateRegistration("studentPhone", student.contact || registration.studentPhone || "")
      updateRegistration("parentPhone", student.parentContact || registration.parentPhone || "")
    }
    if (options.fillWithdrawalClass) {
      updateWithdrawal("schoolGrade", withdrawal.schoolGrade || student.grade)
    }
    const shouldRefreshWithdrawalClass = options.fillWithdrawalClass && classId && form.classId !== classId
    if (shouldRefreshWithdrawalClass) selectClass(classId, { fillWithdrawal: true })
    const shouldRefreshTransferFromClass = options.fillTransferFromClass && classId && transfer.fromClassId !== classId
    if (shouldRefreshTransferFromClass) selectClass(classId, { fillTransferFrom: true })
    if (options.fillWordRetest) {
      updateWordRetest("studentName", student.label)
    }
    const shouldRefreshWordRetestClass = options.fillWordRetestClass && wordRetestClassId && form.classId !== wordRetestClassId
    if (shouldRefreshWordRetestClass) selectClass(wordRetestClassId, { fillWordRetest: true })
  }

  const registrationClassTextbooks = form.type === "registration" ? getClassTextbookOptions(selectedRegistrationClass) : []
  const withdrawalClassTextbooks = form.type === "withdrawal" ? getClassTextbookOptions(selectedWithdrawalClass) : []
  const registrationCompletionChecklistItems = form.type === "registration" ? getRegistrationCompletionChecklistItems(registration) as RegistrationCompletionChecklistItem[] : []
  const withdrawalCompletionChecklistItems = form.type === "withdrawal" ? getWithdrawalCompletionChecklistItems(withdrawal) as WithdrawalCompletionChecklistItem[] : []
  const transferCompletionChecklistItems = form.type === "transfer" ? getTransferCompletionChecklistItems(transfer) as TransferCompletionChecklistItem[] : []
  const operationTodayKey = toDateKey(dueTodayValue)
  const transferFromClassTextbooks = form.type === "transfer" ? getClassTextbookOptions(selectedTransferFromClass) : []
  const transferToClassTextbooks = form.type === "transfer" ? getClassTextbookOptions(selectedTransferToClass) : []

  if (step === "all") {
    const steps = getFormDetailTabs(form.type)
    if (steps.length === 0) return null

    return (
      <div aria-label={`${getTaskTypeLabel(form.type)} 입력 정보`} className="grid gap-4">
        {steps.map((tab, index) => (
          <div key={tab.key} className={index === 0 ? "grid gap-3" : "grid gap-3 border-t pt-4"}>
            <TypeSpecificFields
              step={tab.key}
              form={form}
              students={students}
              classes={classes}
              teachers={teachers}
              textbooks={textbooks}
              dueTodayValue={dueTodayValue}
              dueTomorrowValue={dueTomorrowValue}
              requiredFields={requiredFields}
              updateForm={updateForm}
              updateRegistration={updateRegistration}
              updateWithdrawal={updateWithdrawal}
              updateTransfer={updateTransfer}
              updateWordRetest={updateWordRetest}
            />
          </div>
        ))}
      </div>
    )
  }

  function keepManualTeacherName(currentTeacherName: string | undefined, previousClass?: OpsClassOption) {
    const current = currentTeacherName || ""
    if (previousClass?.teacher && current === previousClass.teacher) return ""
    return current
  }

  function getClassDerivedTeacherName(classItem: OpsClassOption, currentTeacherName: string | undefined, previousClass?: OpsClassOption) {
    return classItem.teacher || keepManualTeacherName(currentTeacherName, previousClass)
  }

  function applyWithdrawalClassPlanPatch(classItem?: OpsClassOption) {
    const withdrawalClassItem = classItem || selectedWithdrawalClass
    const withdrawalTextbooks = classItem ? getClassTextbookOptions(classItem) : withdrawalClassTextbooks
    const patch = (buildWithdrawalClassPlanPatch as BuildWithdrawalClassPlanPatch)({ withdrawal, classItem: withdrawalClassItem, classTextbooks: withdrawalTextbooks })
    if (patch.withdrawalSession) updateWithdrawal("withdrawalSession", patch.withdrawalSession)
    if (patch.completedLessonHours) updateWithdrawal("completedLessonHours", patch.completedLessonHours)
    if (patch.fourWeekLessonHours) updateWithdrawal("fourWeekLessonHours", patch.fourWeekLessonHours)
    if (patch.undistributedTextbooks) updateWithdrawal("undistributedTextbooks", patch.undistributedTextbooks)
  }

  function applyWithdrawalWorkflowPreset(preset: string) {
    const patch = (buildWithdrawalWorkflowPresetPatch as BuildWithdrawalWorkflowPresetPatch)(preset, {
      dueTodayValue,
      withdrawal,
      classItem: selectedWithdrawalClass,
      classTextbooks: withdrawalClassTextbooks,
    })
    if (patch.withdrawalDate) updateWithdrawal("withdrawalDate", patch.withdrawalDate)
    if (patch.withdrawalSession) updateWithdrawal("withdrawalSession", patch.withdrawalSession)
    if (patch.completedLessonHours) updateWithdrawal("completedLessonHours", patch.completedLessonHours)
    if (patch.fourWeekLessonHours) updateWithdrawal("fourWeekLessonHours", patch.fourWeekLessonHours)
    if (patch.undistributedTextbooks) updateWithdrawal("undistributedTextbooks", patch.undistributedTextbooks)
  }

  function applyWordRetestWorkflowPreset(preset: string) {
    const patch = (buildWordRetestWorkflowPresetPatch as BuildWordRetestWorkflowPresetPatch)(preset, {
      dueTodayValue,
      dueTomorrowValue,
    })
    if (patch.testAt) updateWordRetest("testAt", patch.testAt)
    if (patch.branch) updateWordRetest("branch", patch.branch)
  }

  function applyTransferWorkflowPreset(preset: string) {
    const patch = (buildTransferWorkflowPresetPatch as BuildTransferWorkflowPresetPatch)(preset, {
      dueTodayValue,
      dueTomorrowValue,
      transfer,
      fromClass: selectedTransferFromClass,
      toClass: selectedTransferToClass,
      fromTextbooks: transferFromClassTextbooks,
      toTextbooks: transferToClassTextbooks,
    })
    if (patch.fromClassEndDate) updateTransfer("fromClassEndDate", patch.fromClassEndDate)
    if (patch.toClassStartDate) updateTransfer("toClassStartDate", patch.toClassStartDate)
    if (patch.fromClassEndSession) updateTransfer("fromClassEndSession", patch.fromClassEndSession)
    if (patch.toClassStartSession) updateTransfer("toClassStartSession", patch.toClassStartSession)
    if (patch.fromUndistributedTextbooks) updateTransfer("fromUndistributedTextbooks", patch.fromUndistributedTextbooks)
    if (patch.toUndistributedTextbooks) updateTransfer("toUndistributedTextbooks", patch.toUndistributedTextbooks)
  }

  function applyTransferScheduleDefaults() {
    const defaults = buildTransferScheduleDefaults({
      transfer,
      fromClass: selectedTransferFromClass,
      toClass: selectedTransferToClass,
    }) as TransferScheduleDefaults
    if (defaults.fromClassEndSession) updateTransfer("fromClassEndSession", defaults.fromClassEndSession)
    if (defaults.toClassStartSession) updateTransfer("toClassStartSession", defaults.toClassStartSession)
  }

  function applyTransferTextbookDefaults() {
    const defaults = (buildTransferTextbookDefaults as BuildTransferTextbookDefaults)({
      transfer,
      fromTextbooks: transferFromClassTextbooks,
      toTextbooks: transferToClassTextbooks,
    })
    if (defaults.fromUndistributedTextbooks) updateTransfer("fromUndistributedTextbooks", defaults.fromUndistributedTextbooks)
    if (defaults.toUndistributedTextbooks) updateTransfer("toUndistributedTextbooks", defaults.toUndistributedTextbooks)
  }

  function applyTransferClassPlanPatch(
    classItem?: OpsClassOption,
    options: { fillTransferFrom?: boolean; fillTransferTo?: boolean } = {},
  ) {
    const nextTransfer = {
      ...transfer,
      ...(options.fillTransferFrom && classItem ? {
        fromClassId: classItem.id,
        fromClassName: classItem.label,
        fromTeacherName: getClassDerivedTeacherName(classItem, transfer.fromTeacherName, selectedTransferFromClass),
      } : {}),
      ...(options.fillTransferTo && classItem ? {
        toClassId: classItem.id,
        toClassName: classItem.label,
        toTeacherName: getClassDerivedTeacherName(classItem, transfer.toTeacherName, selectedTransferToClass),
      } : {}),
    }
    const fromClass = options.fillTransferFrom ? classItem : selectedTransferFromClass
    const toClass = options.fillTransferTo ? classItem : selectedTransferToClass
    const patch = (buildTransferClassPlanPatch as BuildTransferClassPlanPatch)({
      transfer: nextTransfer,
      fromClass,
      toClass,
      fromTextbooks: fromClass ? getClassTextbookOptions(fromClass) : transferFromClassTextbooks,
      toTextbooks: toClass ? getClassTextbookOptions(toClass) : transferToClassTextbooks,
    })
    if (patch.fromClassEndSession) updateTransfer("fromClassEndSession", patch.fromClassEndSession)
    if (patch.toClassStartSession) updateTransfer("toClassStartSession", patch.toClassStartSession)
    if (patch.fromUndistributedTextbooks) updateTransfer("fromUndistributedTextbooks", patch.fromUndistributedTextbooks)
    if (patch.toUndistributedTextbooks) updateTransfer("toUndistributedTextbooks", patch.toUndistributedTextbooks)
  }

  const selectClass = (classId: string, options: { fillRegistration?: boolean; fillTransferFrom?: boolean; fillTransferTo?: boolean; fillWordRetest?: boolean; fillWithdrawal?: boolean } = {}) => {
    const classItem = findClass(classId)
    const shouldUpdatePrimaryClass = !options.fillTransferFrom || options.fillTransferTo
    if (shouldUpdatePrimaryClass) updateForm("classId", classId)
    if (!classId) {
      if (shouldUpdatePrimaryClass) updateForm("className", "")
      if (options.fillRegistration) selectTextbook("")
      if (options.fillWordRetest) {
        updateWordRetest("className", "")
        updateWordRetest("branch", "")
        selectTextbook("", { fillWordRetest: true })
      }
      if (options.fillTransferFrom) {
        updateTransfer("fromClassId", "")
        updateTransfer("fromClassName", "")
        updateTransfer("fromTeacherName", "")
      }
      if (options.fillTransferTo) {
        updateTransfer("toClassId", "")
        updateTransfer("toClassName", "")
        updateTransfer("toTeacherName", "")
      }
      if (options.fillWithdrawal) updateWithdrawal("teacherName", "")
      return
    }
    if (!classItem) return

    if (shouldUpdatePrimaryClass) {
      updateForm("className", classItem.label)
      updateForm("subject", classItem.subject)
    }
    const textbookId = findClassPrimaryTextbook(classItem)
    const classTextbookIds = classItem.textbookIds || []
    const shouldSyncPrimaryTextbook = options.fillRegistration || options.fillWordRetest
    const shouldRefreshPrimaryTextbook = shouldUpdatePrimaryClass && shouldSyncPrimaryTextbook && textbookId && (!form.textbookId || !classTextbookIds.includes(form.textbookId))
    if (shouldRefreshPrimaryTextbook) selectTextbook(textbookId)
    if (options.fillRegistration) {
      updateRegistration("schoolGrade", registration.schoolGrade || classItem.grade)
    }
    if (options.fillTransferFrom) {
      updateTransfer("fromClassId", classItem.id)
      updateTransfer("fromClassName", classItem.label)
      updateTransfer("fromTeacherName", getClassDerivedTeacherName(classItem, transfer.fromTeacherName, selectedTransferFromClass))
    }
    if (options.fillTransferTo) {
      updateTransfer("toClassId", classItem.id)
      updateTransfer("toClassName", classItem.label)
      updateTransfer("toTeacherName", getClassDerivedTeacherName(classItem, transfer.toTeacherName, selectedTransferToClass))
    }
    if (options.fillTransferFrom || options.fillTransferTo) applyTransferClassPlanPatch(classItem, options)
    if (options.fillWordRetest) {
      updateWordRetest("className", classItem.label)
      const branch = findClassBranch(classItem)
      if (branch) updateWordRetest("branch", branch)
      if (classItem.teacher) {
        const teacher = findTeacherByName(classItem.teacher)
        if (teacher && !wordRetest.teacherId) selectTeacher(teacher.id)
        else updateWordRetest("teacherName", wordRetest.teacherName || classItem.teacher)
      }
      if (textbookId && !wordRetest.textbookName) selectTextbook(textbookId, { fillWordRetest: true })
    }
    if (options.fillWithdrawal) {
      updateWithdrawal("schoolGrade", withdrawal.schoolGrade || classItem.grade)
      updateWithdrawal("teacherName", getClassDerivedTeacherName(classItem, withdrawal.teacherName, selectedWithdrawalClass))
    }
    if (options.fillWithdrawal) applyWithdrawalClassPlanPatch(classItem)
  }

  const selectTeacher = (teacherId: string) => {
    const teacher = findTeacher(teacherId)
    const previousTeacher = findTeacher(wordRetest.teacherId || "")
    const previousTeacherProfileId = previousTeacher?.profileId || ""
    updateWordRetest("teacherId", teacherId)
    if (!teacherId) {
      updateWordRetest("teacherName", "")
      if (previousTeacherProfileId && form.assigneeId === previousTeacherProfileId) updateForm("assigneeId", "")
      return
    }
    if (!teacher) return
    updateWordRetest("teacherName", teacher.label)
    if (teacher.profileId) updateForm("assigneeId", teacher.profileId)
    else if (previousTeacherProfileId && form.assigneeId === previousTeacherProfileId) updateForm("assigneeId", "")
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
    if (step === "registration_contact") {
      return (
        <section className="grid gap-3">
          <OperationQuickPresetBar
            items={[
              { label: "오늘 문의", onClick: () => applyRegistrationWorkflowPreset("inquiry_today") },
              { label: "전화 문의", onClick: () => applyRegistrationWorkflowPreset("phone_inquiry_today") },
              { label: "채널톡", onClick: () => applyRegistrationWorkflowPreset("chat_inquiry_today") },
              { label: "바로 방문", onClick: () => applyRegistrationWorkflowPreset("walk_in_inquiry_today") },
            ]}
          />
          <div className="grid gap-3 md:grid-cols-3">
            <SelectField label="문의 채널" value={registration.inquiryChannel || ""} onChange={(value) => updateRegistration("inquiryChannel", value)}>
              <option value="">미지정</option>
              {["전화", "채널톡", "선생님 전화", "바로 방문", "인스타"].map((item) => <option key={item} value={item}>{item}</option>)}
            </SelectField>
            <TextField label="문의일시" type="datetime-local" value={dateTimeInputValue(registration.inquiryAt)} onChange={(value) => updateRegistration("inquiryAt", value)} />
            <TextField label="학생명" value={form.studentName || ""} autoFocus completionField="registration.studentName" {...requiredFieldProps("registration.studentName")} onChange={(value) => updateForm("studentName", value)} />
            <TextField label="학년" value={registration.schoolGrade || ""} onChange={(value) => updateRegistration("schoolGrade", value)} />
            <TextField label="학교" value={registration.schoolName || ""} onChange={(value) => updateRegistration("schoolName", value)} />
            <TextField label="학부모 전화" value={registration.parentPhone || ""} inputMode="tel" onChange={(value) => updateRegistration("parentPhone", value)} />
            <TextField label="학생 전화" value={registration.studentPhone || ""} inputMode="tel" onChange={(value) => updateRegistration("studentPhone", value)} />
          </div>
          <RegistrationDuplicateCandidatePanel
            candidates={registrationDuplicateCandidates}
            selectedStudentId={form.studentId || ""}
            onSelect={(studentId) => selectStudent(studentId, { fillRegistration: true })}
          />
        </section>
      )
    }

    if (step === "registration_test") {
      return (
        <section className="grid gap-3">
          <OperationQuickPresetBar
            items={[
              { label: "오늘 레벨테스트", onClick: () => applyRegistrationWorkflowPreset("level_test_today") },
              { label: "내일 레벨테스트", onClick: () => applyRegistrationWorkflowPreset("level_test_tomorrow") },
              { label: "오늘 전화상담", onClick: () => applyRegistrationWorkflowPreset("phone_consult_today") },
              { label: "오늘 방문상담", onClick: () => applyRegistrationWorkflowPreset("visit_consult_today") },
              { label: "오늘 상담", onClick: () => applyRegistrationWorkflowPreset("consult_today") },
              { label: "내일 상담", onClick: () => applyRegistrationWorkflowPreset("consult_tomorrow") },
              { label: "본관", onClick: () => updateRegistration("levelTestPlace", "본관") },
              { label: "별관", onClick: () => updateRegistration("levelTestPlace", "별관") },
            ]}
          />
          <div className="grid gap-3 md:grid-cols-3">
            <TextField label="전화상담일시" type="datetime-local" value={dateTimeInputValue(registration.phoneConsultationAt)} onChange={(value) => updateRegistration("phoneConsultationAt", value)} />
            <TextField label="방문상담일시" type="datetime-local" value={dateTimeInputValue(registration.visitConsultationAt)} onChange={(value) => updateRegistration("visitConsultationAt", value)} />
            <TextField label="상담일시" type="datetime-local" value={dateTimeInputValue(registration.consultationAt)} onChange={(value) => updateRegistration("consultationAt", value)} />
            <TextField label="상담 담당자" value={registration.counselor || ""} onChange={(value) => updateRegistration("counselor", value)} />
            <TextField label="레벨테스트 일시" type="datetime-local" value={dateTimeInputValue(registration.levelTestAt)} completionField="registration.levelTestAt" {...requiredFieldProps("registration.levelTestAt")} onChange={(value) => updateRegistration("levelTestAt", value)} />
            <SelectField label="레벨테스트 장소" value={registration.levelTestPlace || ""} onChange={(value) => updateRegistration("levelTestPlace", value)}>
              <option value="">미지정</option>
              <option value="본관">본관</option>
              <option value="별관">별관</option>
            </SelectField>
            <TextField label="레벨테스트 결과" value={registration.levelTestResult || ""} completionField="registration.levelTestResult" {...requiredFieldProps("registration.levelTestResult")} onChange={(value) => updateRegistration("levelTestResult", value)} />
            <TextField label="원장 분석" value={registration.principalReviewNote || ""} completionField="registration.principalReviewNote" {...requiredFieldProps("registration.principalReviewNote")} onChange={(value) => updateRegistration("principalReviewNote", value)} />
          </div>
          <TextField label="레벨테스트 자료 Drive 링크" value={registration.levelTestMaterialLink || ""} inputMode="url" onChange={(value) => updateRegistration("levelTestMaterialLink", value)} />
        </section>
      )
    }

    if (step === "registration_start") {
      return (
        <section className="grid gap-3">
          <OperationQuickPresetBar
            items={[
              { label: "등록 신청", onClick: () => applyRegistrationWorkflowPreset("registration_request") },
              { label: "수납 진행", onClick: () => applyRegistrationWorkflowPreset("payment_in_progress") },
              { label: "오늘 시작일", onClick: () => updateRegistration("classStartDate", dateInputValue(dueTodayValue)) },
              { label: "내일 시작일", onClick: () => updateRegistration("classStartDate", dateInputValue(dueTomorrowValue)) },
            ]}
          />
          <div className="grid gap-3 md:grid-cols-2">
            <LinkedSelect
              label="기존 학생 연결"
              value={form.studentId || ""}
              options={students}
              completionField="registration.student"
              {...requiredFieldProps("registration.student")}
              onChange={(value) => {
                if (value) {
                  selectStudent(value, { fillRegistration: true })
                  return
                }
                updateForm("studentId", "")
              }}
            />
            <CheckField
              label="원장 반배정"
              checked={Boolean(registration.principalPlacementChecked)}
              completionField="registration.principalPlacementChecked"
              {...requiredFieldProps("registration.principalPlacementChecked")}
              onChange={(value) => updateRegistration("principalPlacementChecked", value)}
            />
            <RegistrationPrincipalPlacementSummary
              registration={registration}
              studentName={form.studentName}
            />
            <LinkedSelect label="수업" value={form.classId || ""} options={classes} completionField="registration.class" {...requiredFieldProps("registration.class")} onChange={(value) => selectClass(value, { fillRegistration: true })} onManualSelect={(query) => openManualField("registrationClass", query)} />
            <LinkedSelect label="교재" value={form.textbookId || ""} options={registrationTextbookOptions} completionField="registration.textbook" {...requiredFieldProps("registration.textbook")} onChange={(value) => selectTextbook(value)} onManualSelect={(query) => openManualField("registrationTextbook", query)} />
            {shouldShowManualField("registrationClass", form.classId, form.className) && <TextField label="수업명" value={form.className || ""} onChange={(value) => updateForm("className", value)} />}
            {shouldShowManualField("registrationTextbook", form.textbookId, form.textbookTitle) && <TextField label="교재명" value={form.textbookTitle || ""} onChange={(value) => updateForm("textbookTitle", value)} />}
            <ClassPlanInlineSummary classItem={selectedRegistrationClass} className="md:col-span-2" />
            <RegistrationClassStartSummary
              registration={registration}
              student={selectedRegistrationStudent}
              studentName={form.studentName}
              classItem={selectedRegistrationClass}
              classTextbooks={registrationClassTextbooks}
              selectedTextbookId={form.textbookId}
            />
            {selectedRegistrationClass ? (
              <div className="flex min-w-0 flex-wrap items-center gap-1.5 rounded-md border bg-muted/30 px-3 py-2 text-xs md:col-span-2">
                <span className="font-medium text-foreground">수업교재</span>
                {registrationClassTextbooks.length > 0 ? (
                  registrationClassTextbooks.map((textbook) => (
                    <button
                      key={textbook.id}
                      type="button"
                      aria-pressed={form.textbookId === textbook.id}
                      onClick={() => selectTextbook(textbook.id)}
                      className={[
                        "h-6 rounded border px-2 text-xs transition-colors",
                        form.textbookId === textbook.id
                          ? "border-primary bg-primary text-primary-foreground"
                          : "bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
                      ].join(" ")}
                    >
                      {textbook.label}
                    </button>
                  ))
                ) : (
                  <span className="rounded border border-dashed bg-background px-2 py-1 text-muted-foreground">교재 연결 없음</span>
                )}
              </div>
            ) : null}
            <TextField label="수업시작일" type="date" value={dateInputValue(registration.classStartDate)} completionField="registration.classStartDate" {...requiredFieldProps("registration.classStartDate")} onChange={(value) => updateRegistration("classStartDate", value)} />
            <TextField label="수업시작회차" value={registration.classStartSession || ""} completionField="registration.classStartSession" {...requiredFieldProps("registration.classStartSession")} onChange={(value) => updateRegistration("classStartSession", value)} />
          </div>
          <TextField label="요청 사항" value={registration.requestNote || ""} onChange={(value) => updateRegistration("requestNote", value)} />
        </section>
      )
    }

    if (step === "registration_checks") {
      return (
        <section className="grid gap-3">
          <RegistrationDuplicateCandidatePanel
            candidates={registrationDuplicateCandidates}
            selectedStudentId={form.studentId || ""}
            onSelect={(studentId) => selectStudent(studentId, { fillRegistration: true })}
          />
          <RegistrationCompletionChecklist
            items={registrationCompletionChecklistItems}
            requiredFields={requiredFields}
            updateRegistration={updateRegistration}
          />
        </section>
      )
    }

    return null
  }

  if (form.type === "withdrawal") {
    if (step === "withdrawal_basic") {
      return (
        <section className="grid gap-3">
          <OperationQuickPresetBar
            items={[
              { label: "오늘 퇴원/정산", onClick: () => applyWithdrawalWorkflowPreset("today_with_class_plan") },
              { label: "오늘 퇴원", onClick: () => updateWithdrawal("withdrawalDate", dateInputValue(dueTodayValue)) },
              { label: "내일 퇴원", onClick: () => updateWithdrawal("withdrawalDate", dateInputValue(dueTomorrowValue)) },
            ]}
          />
          <div className="grid gap-3 md:grid-cols-3">
            <LinkedSelect label="학생" value={form.studentId || ""} options={students} autoFocus completionField="withdrawal.student" {...requiredFieldProps("withdrawal.student")} onChange={(value) => selectStudent(value, { fillWithdrawalClass: true })} onManualSelect={(query) => openManualField("withdrawalStudent", query)} />
            <LinkedSelect label="수업" value={form.classId || ""} options={classes} completionField="withdrawal.class" {...requiredFieldProps("withdrawal.class")} onChange={(value) => selectClass(value, { fillWithdrawal: true })} onManualSelect={(query) => openManualField("withdrawalClass", query)} />
            {shouldShowManualField("withdrawalStudent", form.studentId, form.studentName) && <TextField label="학생명" value={form.studentName || ""} autoFocus onChange={(value) => updateForm("studentName", value)} />}
            {shouldShowManualField("withdrawalClass", form.classId, form.className) && <TextField label="수업명" value={form.className || ""} onChange={(value) => updateForm("className", value)} />}
            <ClassPlanInlineSummary classItem={selectedWithdrawalClass} className="md:col-span-3" />
            <WithdrawalClassSettlementSummary
              withdrawal={withdrawal}
              student={selectedWithdrawalStudent}
              classItem={selectedWithdrawalClass}
              classTextbooks={withdrawalClassTextbooks}
            />
            {(form.studentId || form.classId || withdrawal.schoolGrade) && (
              <TextField label="학년" value={withdrawal.schoolGrade || ""} onChange={(value) => updateWithdrawal("schoolGrade", value)} />
            )}
            {(form.classId || withdrawal.teacherName) && (
              <TextField label="선생님" value={withdrawal.teacherName || ""} completionField="withdrawal.teacherName" {...requiredFieldProps("withdrawal.teacherName")} onChange={(value) => updateWithdrawal("teacherName", value)} />
            )}
            <TextField label="퇴원일" type="date" value={dateInputValue(withdrawal.withdrawalDate)} completionField="withdrawal.withdrawalDate" {...requiredFieldProps("withdrawal.withdrawalDate")} onChange={(value) => updateWithdrawal("withdrawalDate", value)} />
            <TextField label="퇴원회차" value={withdrawal.withdrawalSession || ""} completionField="withdrawal.withdrawalSession" {...requiredFieldProps("withdrawal.withdrawalSession")} onChange={(value) => updateWithdrawal("withdrawalSession", value)} />
            <TextField label="진행 수업시수" value={withdrawal.completedLessonHours || ""} inputMode="decimal" completionField="withdrawal.completedLessonHours" {...requiredFieldProps("withdrawal.completedLessonHours")} onChange={(value) => updateWithdrawal("completedLessonHours", value)} />
            <TextField label="4주 기준 수업시수" value={withdrawal.fourWeekLessonHours || ""} inputMode="decimal" completionField="withdrawal.fourWeekLessonHours" {...requiredFieldProps("withdrawal.fourWeekLessonHours")} onChange={(value) => updateWithdrawal("fourWeekLessonHours", value)} />
            <TextField label="미배부 교재" value={withdrawal.undistributedTextbooks || ""} completionField="withdrawal.undistributedTextbooks" {...requiredFieldProps("withdrawal.undistributedTextbooks")} onChange={(value) => updateWithdrawal("undistributedTextbooks", value)} />
          </div>
        </section>
      )
    }

    if (step === "withdrawal_reason") {
      return (
        <section className="grid gap-3">
        <TextField label="고객 퇴원사유" value={withdrawal.customerReason || ""} onChange={(value) => updateWithdrawal("customerReason", value)} />
        <TextField label="선생님 의견" value={withdrawal.teacherOpinion || ""} completionField="withdrawal.teacherOpinion" {...requiredFieldProps("withdrawal.teacherOpinion")} onChange={(value) => updateWithdrawal("teacherOpinion", value)} />
        </section>
      )
    }

    if (step === "withdrawal_checks") {
      return (
        <section className="grid gap-3">
          <WithdrawalCompletionChecklist
            items={withdrawalCompletionChecklistItems}
            requiredFields={requiredFields}
            updateWithdrawal={updateWithdrawal}
          />
        </section>
      )
    }

    return null
  }

  if (form.type === "transfer") {
    if (step === "transfer_basic") {
      return (
        <div className="grid gap-3 md:grid-cols-2">
          <OperationQuickPresetBar
            items={[
              {
                label: "오늘 종료/내일 시작",
                onClick: () => {
                  updateTransfer("fromClassEndDate", dateInputValue(dueTodayValue))
                  updateTransfer("toClassStartDate", dateInputValue(dueTomorrowValue))
                },
              },
              { label: "오늘 종료", onClick: () => updateTransfer("fromClassEndDate", dateInputValue(dueTodayValue)) },
              { label: "내일 시작", onClick: () => updateTransfer("toClassStartDate", dateInputValue(dueTomorrowValue)) },
            ]}
            className="md:col-span-2"
          />
          <LinkedSelect label="학생" value={form.studentId || ""} options={students} autoFocus completionField="transfer.student" {...requiredFieldProps("transfer.student")} onChange={(value) => selectStudent(value, { fillTransferFromClass: true })} onManualSelect={(query) => openManualField("transferStudent", query)} />
          {shouldShowManualField("transferStudent", form.studentId, form.studentName) && <TextField label="학생명" value={form.studentName || ""} autoFocus onChange={(value) => updateForm("studentName", value)} />}
          <TextField label="전반사유" value={transfer.transferReason || ""} onChange={(value) => updateTransfer("transferReason", value)} />
          <TextField label="전 선생님" value={transfer.fromTeacherName || ""} completionField="transfer.fromTeacherName" {...requiredFieldProps("transfer.fromTeacherName")} onChange={(value) => updateTransfer("fromTeacherName", value)} />
          <TextField label="후 선생님" value={transfer.toTeacherName || ""} completionField="transfer.toTeacherName" {...requiredFieldProps("transfer.toTeacherName")} onChange={(value) => updateTransfer("toTeacherName", value)} />
        </div>
      )
    }

    if (step === "transfer_schedule") {
      return (
        <div className="grid gap-3 md:grid-cols-2">
          <OperationQuickPresetBar
            items={[
              { label: "오늘 전반/회차", onClick: () => applyTransferWorkflowPreset("today_to_tomorrow_with_class_plan") },
              {
                label: "오늘 종료/내일 시작",
                onClick: () => {
                  updateTransfer("fromClassEndDate", dateInputValue(dueTodayValue))
                  updateTransfer("toClassStartDate", dateInputValue(dueTomorrowValue))
                },
              },
              { label: "오늘 종료", onClick: () => updateTransfer("fromClassEndDate", dateInputValue(dueTodayValue)) },
              { label: "내일 시작", onClick: () => updateTransfer("toClassStartDate", dateInputValue(dueTomorrowValue)) },
              { label: "수업계획 회차", onClick: applyTransferScheduleDefaults },
              { label: "교재 기준", onClick: applyTransferTextbookDefaults },
            ]}
            className="md:col-span-2"
          />
          <LinkedSelect label="전 수업" value={transfer.fromClassId || ""} options={classes} completionField="transfer.fromClass" {...requiredFieldProps("transfer.fromClass")} onChange={(value) => selectClass(value, { fillTransferFrom: true })} onManualSelect={(query) => openManualField("transferFromClass", query)} />
          <LinkedSelect label="후 수업" value={transfer.toClassId || form.classId || ""} options={classes} completionField="transfer.toClass" {...requiredFieldProps("transfer.toClass")} onChange={(value) => selectClass(value, { fillTransferTo: true })} onManualSelect={(query) => openManualField("transferToClass", query)} />
          <ClassPlanInlineSummary label="전 수업계획" classItem={selectedTransferFromClass} />
          <ClassPlanInlineSummary label="후 수업계획" classItem={selectedTransferToClass} />
          <TransferClassComparisonSummary
            transfer={transfer}
            student={selectedTransferStudent}
            fromClass={selectedTransferFromClass}
            toClass={selectedTransferToClass}
            fromTextbooks={transferFromClassTextbooks}
            toTextbooks={transferToClassTextbooks}
          />
          {shouldShowManualField("transferFromClass", transfer.fromClassId, transfer.fromClassName) && <TextField label="전 수업명" value={transfer.fromClassName || ""} onChange={(value) => updateTransfer("fromClassName", value)} />}
          {shouldShowManualField("transferToClass", transfer.toClassId || form.classId, transfer.toClassName) && <TextField label="후 수업명" value={transfer.toClassName || ""} onChange={(value) => updateTransfer("toClassName", value)} />}
          <TextField label="전 수업 종료일" type="date" value={dateInputValue(transfer.fromClassEndDate)} completionField="transfer.fromClassEndDate" {...requiredFieldProps("transfer.fromClassEndDate")} onChange={(value) => updateTransfer("fromClassEndDate", value)} />
          <TextField label="후 수업 시작일" type="date" value={dateInputValue(transfer.toClassStartDate)} completionField="transfer.toClassStartDate" {...requiredFieldProps("transfer.toClassStartDate")} onChange={(value) => updateTransfer("toClassStartDate", value)} />
          <TextField label="전 수업 종료회차" value={transfer.fromClassEndSession || ""} completionField="transfer.fromClassEndSession" {...requiredFieldProps("transfer.fromClassEndSession")} onChange={(value) => updateTransfer("fromClassEndSession", value)} />
          <TextField label="후 수업 시작회차" value={transfer.toClassStartSession || ""} completionField="transfer.toClassStartSession" {...requiredFieldProps("transfer.toClassStartSession")} onChange={(value) => updateTransfer("toClassStartSession", value)} />
          <TextField label="전 미배부 교재" value={transfer.fromUndistributedTextbooks || ""} completionField="transfer.fromUndistributedTextbooks" {...requiredFieldProps("transfer.fromUndistributedTextbooks")} onChange={(value) => updateTransfer("fromUndistributedTextbooks", value)} />
          <TextField label="후 미배부 교재" value={transfer.toUndistributedTextbooks || ""} completionField="transfer.toUndistributedTextbooks" {...requiredFieldProps("transfer.toUndistributedTextbooks")} onChange={(value) => updateTransfer("toUndistributedTextbooks", value)} />
        </div>
      )
    }

    if (step === "transfer_checks") {
      return (
        <section className="grid gap-3">
          <TransferCompletionChecklist
            items={transferCompletionChecklistItems}
            requiredFields={requiredFields}
            updateTransfer={updateTransfer}
          />
        </section>
      )
    }

    return null
  }

  if (form.type === "word_retest") {
    if (step === "word_retest_basic") {
      return (
        <div className="grid gap-3 md:grid-cols-3">
          <OperationQuickPresetBar
            items={[
              { label: "오늘 본관", onClick: () => applyWordRetestWorkflowPreset("today_main") },
              { label: "오늘 별관", onClick: () => applyWordRetestWorkflowPreset("today_annex") },
              { label: "내일 본관", onClick: () => applyWordRetestWorkflowPreset("tomorrow_main") },
              { label: "내일 별관", onClick: () => applyWordRetestWorkflowPreset("tomorrow_annex") },
            ]}
            className="md:col-span-3"
          />
          <LinkedSelect label="학생" value={form.studentId || ""} options={students} autoFocus completionField="wordRetest.student" {...requiredFieldProps("wordRetest.student")} onChange={(value) => selectStudent(value, { fillWordRetest: true, fillWordRetestClass: true })} onManualSelect={(query) => openManualField("wordRetestStudent", query)} />
          <LinkedSelect label="수업" value={form.classId || ""} options={wordRetestClassOptions} completionField="wordRetest.class" {...requiredFieldProps("wordRetest.class")} onChange={(value) => selectClass(value, { fillWordRetest: true })} onManualSelect={(query) => openManualField("wordRetestClass", query)} />
          <LinkedSelect label="선생님" value={wordRetest.teacherId || ""} options={wordRetestTeacherOptions} completionField="wordRetest.teacher" {...requiredFieldProps("wordRetest.teacher")} onChange={(value) => selectTeacher(value)} onManualSelect={(query) => openManualField("wordRetestTeacher", query)} />
          <TextField label="응시일시" type="datetime-local" value={dateTimeInputValue(wordRetest.testAt)} completionField="wordRetest.testAt" {...requiredFieldProps("wordRetest.testAt")} onChange={(value) => updateWordRetest("testAt", value)} />
          <SelectField label="지점" value={wordRetest.branch || "본관"} completionField="wordRetest.branch" {...requiredFieldProps("wordRetest.branch")} onChange={(value) => updateWordRetest("branch", value)}>
            <option value="본관">본관</option>
            <option value="별관">별관</option>
          </SelectField>
          {shouldShowManualField("wordRetestTeacher", wordRetest.teacherId, wordRetest.teacherName) && <TextField label="선생님명" value={wordRetest.teacherName || ""} onChange={(value) => updateWordRetest("teacherName", value)} />}
          {shouldShowManualField("wordRetestClass", form.classId, wordRetest.className) && <TextField label="수업명" value={wordRetest.className || ""} onChange={(value) => {
            updateWordRetest("className", value)
            updateForm("className", value)
          }} />}
          {shouldShowManualField("wordRetestStudent", form.studentId, wordRetest.studentName) && <TextField label="학생명" value={wordRetest.studentName || ""} onChange={(value) => {
            updateWordRetest("studentName", value)
            updateForm("studentName", value)
          }} />}
          <WordRetestRequestHandoffSummary
            input={form}
            student={selectedWordRetestStudent}
            classItem={selectedWordRetestClass}
            teacher={findTeacher(wordRetest.teacherId || "")}
            today={operationTodayKey}
          />
        </div>
      )
    }

    if (step === "word_retest_scope") {
      return (
        <div className="grid gap-3 md:grid-cols-3">
          <LinkedSelect label="교재" value={form.textbookId || ""} options={wordRetestTextbookOptions} completionField="wordRetest.textbook" {...requiredFieldProps("wordRetest.textbook")} onChange={(value) => selectTextbook(value, { fillWordRetest: true })} onManualSelect={(query) => openManualField("wordRetestTextbook", query)} />
          {shouldShowManualField("wordRetestTextbook", form.textbookId, wordRetest.textbookName) && <TextField label="교재명" value={wordRetest.textbookName || ""} onChange={(value) => updateWordRetest("textbookName", value)} />}
          <TextField label="단원" value={wordRetest.unit || ""} completionField="wordRetest.unit" {...requiredFieldProps("wordRetest.unit")} onChange={(value) => updateWordRetest("unit", value)} />
          <TextField label="요청사항" value={wordRetest.requestNote || ""} onChange={(value) => updateWordRetest("requestNote", value)} />
        </div>
      )
    }

    if (step === "word_retest_scores") {
      return (
        <div className="grid gap-3 md:grid-cols-3">
          <WordRetestStatusControls
            value={wordRetest.retestStatus || "not_started"}
            onChange={(value) => {
              updateWordRetest("retestStatus", value)
              if (value === "absent") {
                updateWordRetest("firstScore", "")
                updateWordRetest("secondScore", "")
                updateWordRetest("thirdScore", "")
              }
            }}
          />
          {wordRetestAbsent ? (
            <div className="flex min-h-10 items-center rounded-md border bg-muted/40 px-3 text-sm font-medium text-muted-foreground md:col-span-2">
              점수 없음
            </div>
          ) : (
            <>
              <TextField label="1차 점수" value={wordRetest.firstScore || ""} inputMode="numeric" completionField="wordRetest.firstScore" {...requiredFieldProps("wordRetest.firstScore")} onChange={(value) => updateWordRetest("firstScore", value)} />
              <TextField label="2차 점수" value={wordRetest.secondScore || ""} inputMode="numeric" onChange={(value) => updateWordRetest("secondScore", value)} />
              <TextField label="3차 점수" value={wordRetest.thirdScore || ""} inputMode="numeric" onChange={(value) => updateWordRetest("thirdScore", value)} />
            </>
          )}
        </div>
      )
    }

    return null
  }

  return null
}

function OperationQuickPresetBar({
  items,
  className = "",
}: {
  items: Array<{ label: string; onClick: () => void }>
  className?: string
}) {
  if (items.length === 0) return null

  return (
    <div aria-label="빠른 입력" className={`flex min-w-0 flex-wrap gap-1.5 rounded-md border bg-muted/25 p-1.5 ${className}`}>
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          onClick={item.onClick}
          className="inline-flex h-7 shrink-0 items-center rounded-sm border bg-background px-2 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

function automationRuleToInput(
  rule: OpsTaskAutomationRule,
  overrides: Partial<OpsTaskAutomationRuleInput> = {},
): OpsTaskAutomationRuleInput {
  return {
    name: rule.name,
    kind: rule.kind,
    target: rule.target,
    triggerKey: rule.triggerKey,
    enabled: rule.enabled,
    recurrence: rule.recurrence,
    conditions: rule.conditions,
    action: rule.action,
    assignee: rule.assignee,
    due: rule.due,
    notification: rule.notification,
    notificationChannelId: rule.notificationChannelId,
    ...overrides,
  }
}

function notificationChannelToInput(
  channel: OpsTaskNotificationChannel,
  overrides: Partial<OpsTaskNotificationChannelInput> = {},
): OpsTaskNotificationChannelInput {
  return {
    name: channel.name,
    teamKey: channel.teamKey,
    description: channel.description,
    webhookSecretRef: channel.webhookSecretRef,
    webhookUrlLast4: channel.webhookUrlLast4,
    isActive: channel.isActive,
    ...overrides,
  }
}

function getAutomationRuleActionTitle(rule: OpsTaskAutomationRule) {
  const title = String(rule.action.title || rule.action.taskTitle || "").trim()
  return title || rule.name
}

function getAutomationRuleMetaLabel(rule: OpsTaskAutomationRule) {
  if (rule.kind === "recurring") {
    const frequency = String(rule.recurrence.frequency || "")
    const frequencyLabel = AUTOMATION_RECURRENCE_OPTIONS.find((option) => option.value === frequency)?.label || "반복"
    const generationMode = String(rule.recurrence.generationMode || rule.recurrence.generation_mode || "")
    const generationLabel = AUTOMATION_GENERATION_MODE_OPTIONS.find((option) => option.value === generationMode)?.label || ""
    const dueTime = String(rule.recurrence.dueTime || rule.due.dueTime || "").trim()
    return [frequencyLabel, generationLabel, dueTime].filter(Boolean).join(" · ")
  }

  const triggerLabel = TRIGGER_AUTOMATION_OPTIONS.find((option) => option.triggerKey === rule.triggerKey)?.label || rule.triggerKey
  const offsetDays = Number(rule.due.offsetDays || 0)
  const dueLabel = offsetDays > 0 ? `${offsetDays}일 이내` : "당일"
  return [triggerLabel, dueLabel].filter(Boolean).join(" · ")
}

function formatAutomationDateLabel(value: string) {
  if (!value) return "없음"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value.slice(0, 16)
  return date.toLocaleString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function getAutomationRunStatusLabel(value: string) {
  switch (value) {
    case "created":
      return "생성"
    case "updated":
      return "갱신"
    case "skipped":
      return "건너뜀"
    case "failed":
      return "실패"
    default:
      return "대기"
  }
}

function getAutomationDeliveryStatusLabel(value: string) {
  switch (value) {
    case "pending":
      return "대기"
    case "sent":
      return "전송"
    case "failed":
      return "실패"
    case "skipped":
      return "건너뜀"
    default:
      return "없음"
  }
}

function getGoogleChatWebhookEnvKey(teamKey: string) {
  const normalized = teamKey.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "")
  return normalized ? `GOOGLE_CHAT_WEBHOOK_${normalized}` : "GOOGLE_CHAT_WEBHOOK_TEAM"
}

async function copyGoogleChatEnvKey(envKey: string) {
  const value = envKey.trim()
  if (!value) return false
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)
      return true
    }
  } catch {
    // Fall through to the textarea fallback for browsers that block clipboard writes.
  }
  if (typeof document === "undefined") return false
  const textarea = document.createElement("textarea")
  textarea.value = value
  textarea.setAttribute("readonly", "")
  textarea.style.position = "fixed"
  textarea.style.opacity = "0"
  document.body.appendChild(textarea)
  textarea.select()
  const copied = document.execCommand("copy")
  document.body.removeChild(textarea)
  return copied
}

function parseAutomationChecklist(value: string) {
  return value
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function getAutomationRelatedRouteLabel(value: string) {
  return AUTOMATION_RELATED_ROUTE_OPTIONS.find((option) => option.value === value)?.label || "할 일"
}

function getAutomationAssigneePreviewLabel(strategy: string, profileId: string, profiles: OpsProfileOption[]) {
  if (profileId) return profiles.find((profile) => profile.id === profileId)?.label || "고정 담당자"
  return AUTOMATION_ASSIGNEE_STRATEGIES.find((option) => option.value === strategy)?.label || "미정"
}

function getAutomationChannelPreviewLabel(channelId: string, channels: OpsTaskNotificationChannel[]) {
  if (!channelId) return "알림 없음"
  const channel = channels.find((item) => item.id === channelId)
  return channel ? `${channel.name} · ${getGoogleChatWebhookEnvKey(channel.teamKey)}` : "채널 확인 필요"
}

function buildAutomationConditionFilters(input: {
  campus: string
  subject: string
  grade: string
  team: string
  status: string
}) {
  return Object.fromEntries(
    Object.entries(input)
      .map(([key, value]) => [key, value.trim()] as const)
      .filter(([, value]) => value && value !== "all"),
  )
}

function getAutomationConditionPreviewLabel(filters: Record<string, string>) {
  const labels = [
    filters.campus ? `캠퍼스 ${filters.campus}` : "",
    filters.subject ? `과목 ${filters.subject}` : "",
    filters.grade ? `학년 ${filters.grade}` : "",
    filters.team ? `팀 ${filters.team}` : "",
    filters.status ? `상태 ${AUTOMATION_STATUS_CONDITION_OPTIONS.find((option) => option.value === filters.status)?.label || filters.status}` : "",
  ].filter(Boolean)
  return labels.length > 0 ? labels.join(" · ") : "조건 없음"
}

function getAutomationDuplicatePolicyLabel(value: string) {
  return AUTOMATION_DUPLICATE_POLICY_OPTIONS.find((option) => option.value === value)?.label || "기존 업무 유지"
}

function getTriggerDueBasisLabel(value: string) {
  return TRIGGER_DUE_BASIS_OPTIONS.find((option) => option.value === value)?.label || "이벤트 발생일"
}

function buildRecurringAutomationPreview(input: {
  title: string
  frequency: string
  weekday: string
  monthDay: string
  dueTime: string
  generationMode: string
  createLeadDays: string
  endDate: string
  priority: string
  assigneeId: string
  channelId: string
  checklist: string
  relatedRoute: string
  conditionFilters?: Record<string, string>
  duplicatePolicy?: string
}, profiles: OpsProfileOption[], channels: OpsTaskNotificationChannel[]) {
  const frequency = AUTOMATION_RECURRENCE_OPTIONS.find((option) => option.value === input.frequency)?.label || "반복"
  const schedule = input.frequency === "weekly"
    ? `${frequency} ${AUTOMATION_WEEKDAY_OPTIONS.find((option) => option.value === input.weekday)?.label || "월"}`
    : input.frequency === "last_weekday"
      ? `매월 마지막 ${AUTOMATION_WEEKDAY_OPTIONS.find((option) => option.value === input.weekday)?.label || "금"}`
    : input.frequency === "monthly"
      ? `${frequency} ${input.monthDay || "1"}일`
      : frequency
  const leadLabel = AUTOMATION_CREATE_LEAD_OPTIONS.find((option) => option.value === input.createLeadDays)?.label || `${input.createLeadDays || 0}일 전`
  const generationLabel = AUTOMATION_GENERATION_MODE_OPTIONS.find((option) => option.value === input.generationMode)?.label || "정해진 시점 자동 생성"
  return {
    title: input.title.trim() || "생성될 업무 제목 필요",
    schedule,
    due: `${leadLabel} 생성 · ${generationLabel} · ${input.dueTime || "09:00"} 마감${input.endDate ? ` · ${input.endDate} 종료` : ""}`,
    assignee: getAutomationAssigneePreviewLabel("fixed", input.assigneeId, profiles),
    priority: getTaskPriorityLabel(input.priority as OpsTaskPriority),
    checklistItems: parseAutomationChecklist(input.checklist),
    relatedRouteLabel: getAutomationRelatedRouteLabel(input.relatedRoute),
    notification: getAutomationChannelPreviewLabel(input.channelId, channels),
    conditionLabel: getAutomationConditionPreviewLabel(input.conditionFilters || {}),
    duplicatePolicyLabel: "",
  }
}

function buildTriggerAutomationPreview(input: {
  title: string
  triggerKey: string
  offsetDays: string
  dueBasis: string
  dueTime: string
  priority: string
  assigneeStrategy: string
  assigneeId: string
  channelId: string
  checklist: string
  relatedRoute: string
  conditionFilters: Record<string, string>
  duplicatePolicy: string
}, profiles: OpsProfileOption[], channels: OpsTaskNotificationChannel[]) {
  const triggerLabel = TRIGGER_AUTOMATION_OPTIONS.find((option) => option.triggerKey === input.triggerKey)?.label || input.triggerKey
  const offsetDays = Number.parseInt(input.offsetDays, 10) || 0
  return {
    title: input.title.trim() || "생성될 업무 제목 필요",
    schedule: triggerLabel,
    due: `${getTriggerDueBasisLabel(input.dueBasis)} 기준 ${offsetDays > 0 ? `${offsetDays}일 이내` : "당일"} · ${input.dueTime || "09:00"} 마감`,
    assignee: getAutomationAssigneePreviewLabel(input.assigneeStrategy, input.assigneeId, profiles),
    priority: getTaskPriorityLabel(input.priority as OpsTaskPriority),
    checklistItems: parseAutomationChecklist(input.checklist),
    relatedRouteLabel: getAutomationRelatedRouteLabel(input.relatedRoute),
    notification: getAutomationChannelPreviewLabel(input.channelId, channels),
    conditionLabel: getAutomationConditionPreviewLabel(input.conditionFilters),
    duplicatePolicyLabel: getAutomationDuplicatePolicyLabel(input.duplicatePolicy),
  }
}

function AutomationRulePreview({
  preview,
}: {
  preview: ReturnType<typeof buildRecurringAutomationPreview>
}) {
  return (
    <section className="grid gap-2 border-t pt-3 text-xs md:col-span-4">
      <div className="font-medium text-foreground">예상 생성 결과</div>
      <div className="grid gap-2 md:grid-cols-3">
        <div className="min-w-0">
          <div className="text-muted-foreground">업무</div>
          <div className="truncate font-medium">{preview.title}</div>
        </div>
        <div className="min-w-0">
          <div className="text-muted-foreground">일정</div>
          <div className="truncate">{preview.schedule} · {preview.due}</div>
        </div>
        <div className="min-w-0">
          <div className="text-muted-foreground">담당/알림</div>
          <div className="truncate">{preview.assignee} · {preview.notification}</div>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Badge variant="outline" className="rounded px-1.5 text-[11px]">{preview.priority}</Badge>
        <Badge variant="outline" className="rounded px-1.5 text-[11px]">{preview.relatedRouteLabel}</Badge>
        {preview.conditionLabel && preview.conditionLabel !== "조건 없음" && (
          <Badge variant="outline" className="rounded px-1.5 text-[11px]">{preview.conditionLabel}</Badge>
        )}
        {preview.duplicatePolicyLabel && (
          <Badge variant="outline" className="rounded px-1.5 text-[11px]">{preview.duplicatePolicyLabel}</Badge>
        )}
        {preview.checklistItems.length > 0 && (
          <Badge variant="secondary" className="rounded px-1.5 text-[11px]">체크리스트 {preview.checklistItems.length}</Badge>
        )}
      </div>
      <div className="text-muted-foreground">자동화 규칙 저장 전에 실제 만들어질 업무를 확인합니다.</div>
    </section>
  )
}

function AutomationRuleHistory({ rule }: { rule: OpsTaskAutomationRule }) {
  const runs = rule.status.recentRuns
  const deliveries = rule.status.recentDeliveries
  if (runs.length === 0 && deliveries.length === 0) return null

  return (
    <details className="text-xs text-muted-foreground md:col-span-5">
      <summary className="cursor-pointer py-1 font-medium text-foreground">실행 이력</summary>
      <div className="grid gap-2 pt-2 md:grid-cols-2">
        <div className="grid gap-1">
          <div className="font-medium text-foreground">실행 이력</div>
          {runs.length === 0 ? (
            <div>기록 없음</div>
          ) : runs.map((run) => (
            <div key={run.id || run.sourceKey} className="grid gap-0.5 rounded border px-2 py-1.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant={run.status === "failed" ? "destructive" : "outline"} className="rounded px-1.5 text-[11px]">
                  {getAutomationRunStatusLabel(run.status)}
                </Badge>
                <span>{formatAutomationDateLabel(run.ranAt)}</span>
                {run.scheduledFor && <span>예정 {run.scheduledFor}</span>}
              </div>
              <div className="truncate">sourceKey {run.sourceKey || "-"}</div>
              {(run.taskTitle || run.errorMessage) && (
                <div className="truncate">{run.taskTitle || run.errorMessage}</div>
              )}
            </div>
          ))}
        </div>
        <div className="grid gap-1">
          <div className="font-medium text-foreground">전송 이력</div>
          {deliveries.length === 0 ? (
            <div>기록 없음</div>
          ) : deliveries.map((delivery) => (
            <div key={delivery.id} className="grid gap-0.5 rounded border px-2 py-1.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant={delivery.status === "failed" ? "destructive" : "outline"} className="rounded px-1.5 text-[11px]">
                  {getAutomationDeliveryStatusLabel(delivery.status)}
                </Badge>
                <span>{formatAutomationDateLabel(delivery.lastAttemptAt)}</span>
              </div>
              {delivery.nextRetryAt && <div>nextRetryAt {formatAutomationDateLabel(delivery.nextRetryAt)}</div>}
              {delivery.errorMessage && <div className="truncate">{delivery.errorMessage}</div>}
            </div>
          ))}
        </div>
      </div>
    </details>
  )
}

function AutomationRulePanel({
  kind,
  rules,
  channels,
  profiles,
  saving,
  onCreate,
  onUpdate,
}: {
  kind: OpsTaskAutomationRule["kind"]
  rules: OpsTaskAutomationRule[]
  channels: OpsTaskNotificationChannel[]
  profiles: OpsProfileOption[]
  saving: boolean
  onCreate: (input: OpsTaskAutomationRuleInput) => Promise<void> | void
  onUpdate: (ruleId: string, input: OpsTaskAutomationRuleInput) => Promise<void> | void
}) {
  const visibleRules = rules.filter((rule) => rule.kind === kind)
  const activeChannels = channels.filter((channel) => channel.isActive)
  const defaultChannelId = activeChannels[0]?.id || channels[0]?.id || ""
  const isRecurring = kind === "recurring"
  const selectedTrigger = TRIGGER_AUTOMATION_OPTIONS[0]
  const [recurringName, setRecurringName] = useState("매일 마감 점검")
  const [recurringTitle, setRecurringTitle] = useState("오늘 마감 업무 점검")
  const [recurringFrequency, setRecurringFrequency] = useState("daily")
  const [recurringWeekday, setRecurringWeekday] = useState("1")
  const [recurringMonthDay, setRecurringMonthDay] = useState("1")
  const [recurringDueTime, setRecurringDueTime] = useState("09:00")
  const [recurringGenerationMode, setRecurringGenerationMode] = useState("scheduled")
  const [recurringCreateLeadDays, setRecurringCreateLeadDays] = useState("0")
  const [recurringEndDate, setRecurringEndDate] = useState("")
  const [recurringPriority, setRecurringPriority] = useState<OpsTaskPriority>("normal")
  const [recurringChecklist, setRecurringChecklist] = useState("")
  const [recurringRelatedRoute, setRecurringRelatedRoute] = useState("/admin/tasks")
  const [recurringAssigneeId, setRecurringAssigneeId] = useState("")
  const [recurringChannelId, setRecurringChannelId] = useState(defaultChannelId)
  const [triggerKey, setTriggerKey] = useState(selectedTrigger.triggerKey)
  const [triggerTarget, setTriggerTarget] = useState(selectedTrigger.target)
  const [triggerName, setTriggerName] = useState(`${selectedTrigger.label} 후속`)
  const [triggerTitle, setTriggerTitle] = useState(selectedTrigger.defaultTitle)
  const [triggerOffsetDays, setTriggerOffsetDays] = useState(selectedTrigger.offsetDays)
  const [triggerDueBasis, setTriggerDueBasis] = useState(selectedTrigger.dueBasis)
  const [triggerDueTime, setTriggerDueTime] = useState("09:00")
  const [triggerPriority, setTriggerPriority] = useState<OpsTaskPriority>("normal")
  const [triggerChecklist, setTriggerChecklist] = useState("")
  const [triggerRelatedRoute, setTriggerRelatedRoute] = useState("/admin/registration")
  const [triggerAssigneeStrategy, setTriggerAssigneeStrategy] = useState(selectedTrigger.assigneeStrategy)
  const [triggerAssigneeId, setTriggerAssigneeId] = useState("")
  const [triggerChannelId, setTriggerChannelId] = useState(defaultChannelId)
  const [triggerCampus, setTriggerCampus] = useState("all")
  const [triggerSubject, setTriggerSubject] = useState("")
  const [triggerGrade, setTriggerGrade] = useState("")
  const [triggerTeam, setTriggerTeam] = useState("")
  const [triggerStatus, setTriggerStatus] = useState("all")
  const [triggerDuplicatePolicy, setTriggerDuplicatePolicy] = useState("automation_source_key")
  const triggerConditionFilters = buildAutomationConditionFilters({
    campus: triggerCampus,
    subject: triggerSubject,
    grade: triggerGrade,
    team: triggerTeam,
    status: triggerStatus,
  })
  const recurringPreview = buildRecurringAutomationPreview({
    title: recurringTitle,
    frequency: recurringFrequency,
    weekday: recurringWeekday,
    monthDay: recurringMonthDay,
    dueTime: recurringDueTime,
    generationMode: recurringGenerationMode,
    createLeadDays: recurringCreateLeadDays,
    endDate: recurringEndDate,
    priority: recurringPriority,
    assigneeId: recurringAssigneeId,
    channelId: recurringChannelId,
    checklist: recurringChecklist,
    relatedRoute: recurringRelatedRoute,
  }, profiles, channels)
  const triggerPreview = buildTriggerAutomationPreview({
    title: triggerTitle,
    triggerKey,
    offsetDays: triggerOffsetDays,
    dueBasis: triggerDueBasis,
    dueTime: triggerDueTime,
    priority: triggerPriority,
    assigneeStrategy: triggerAssigneeStrategy,
    assigneeId: triggerAssigneeId,
    channelId: triggerChannelId,
    checklist: triggerChecklist,
    relatedRoute: triggerRelatedRoute,
    conditionFilters: triggerConditionFilters,
    duplicatePolicy: triggerDuplicatePolicy,
  }, profiles, channels)

  useEffect(() => {
    if (recurringChannelId || !defaultChannelId) return
    setRecurringChannelId(defaultChannelId)
  }, [defaultChannelId, recurringChannelId])

  useEffect(() => {
    if (triggerChannelId || !defaultChannelId) return
    setTriggerChannelId(defaultChannelId)
  }, [defaultChannelId, triggerChannelId])

  function handleTriggerChange(nextTriggerKey: string) {
    const option = TRIGGER_AUTOMATION_OPTIONS.find((item) => item.triggerKey === nextTriggerKey) || TRIGGER_AUTOMATION_OPTIONS[0]
    setTriggerKey(option.triggerKey)
    setTriggerTarget(option.target)
    setTriggerName(`${option.label} 후속`)
    setTriggerTitle(option.defaultTitle)
    setTriggerOffsetDays(option.offsetDays)
    setTriggerDueBasis(option.dueBasis)
    setTriggerAssigneeStrategy(option.assigneeStrategy)
    if (option.target === "transfer") setTriggerRelatedRoute("/admin/transfer")
    else if (option.target === "withdrawal") setTriggerRelatedRoute("/admin/withdrawal")
    else if (option.target === "word_retest") setTriggerRelatedRoute("/admin/word-retests")
    else if (option.target === "curriculum") setTriggerRelatedRoute("/admin/curriculum")
    else if (option.target === "academic_calendar") setTriggerRelatedRoute("/admin/academic-calendar")
    else if (!option.target) setTriggerRelatedRoute("/admin/tasks")
    else setTriggerRelatedRoute("/admin/registration")
  }

  async function submitRecurringRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const title = recurringTitle.trim()
    if (!title) return
    const monthDay = Math.min(31, Math.max(1, Number.parseInt(recurringMonthDay, 10) || 1))
    const channel = channels.find((item) => item.id === recurringChannelId)
    await onCreate({
      name: recurringName.trim() || title,
      kind: "recurring",
      target: "todo",
      enabled: true,
      recurrence: {
        frequency: recurringFrequency,
        weekdays: recurringFrequency === "weekly" ? [Number.parseInt(recurringWeekday, 10) || 1] : [],
        monthDay: recurringFrequency === "monthly" ? monthDay : null,
        weekday: recurringFrequency === "last_weekday" ? Number.parseInt(recurringWeekday, 10) || 5 : null,
        generationMode: recurringGenerationMode,
        createLeadDays: Number.parseInt(recurringCreateLeadDays, 10) || 0,
        endDate: recurringEndDate || null,
        dueTime: recurringDueTime,
      },
      conditions: {},
      action: {
        type: "create_task",
        title,
        priority: recurringPriority,
        checklist: parseAutomationChecklist(recurringChecklist),
        relatedRoute: recurringRelatedRoute,
      },
      assignee: {
        strategy: recurringAssigneeId ? "fixed" : "unassigned",
        profileId: recurringAssigneeId,
      },
      due: { basis: "occurrence_date", offsetDays: 0, dueTime: recurringDueTime },
      notification: { channelId: recurringChannelId, teamKey: channel?.teamKey || "" },
      notificationChannelId: recurringChannelId,
    })
    setRecurringTitle("")
  }

  async function submitTriggerRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const title = triggerTitle.trim()
    if (!title) return
    const channel = channels.find((item) => item.id === triggerChannelId)
    await onCreate({
      name: triggerName.trim() || `${TRIGGER_AUTOMATION_OPTIONS.find((item) => item.triggerKey === triggerKey)?.label || "업무"} 후속`,
      kind: "trigger",
      target: triggerTarget,
      triggerKey,
      enabled: true,
      recurrence: {},
      conditions: {
        event: triggerKey,
        duplicatePolicy: triggerDuplicatePolicy,
        filters: buildAutomationConditionFilters({
          campus: triggerCampus,
          subject: triggerSubject,
          grade: triggerGrade,
          team: triggerTeam,
          status: triggerStatus,
        }),
        skipStateBoardMirroring: true,
      },
      action: {
        type: "create_follow_up_task",
        title,
        priority: triggerPriority,
        checklist: parseAutomationChecklist(triggerChecklist),
        relatedRoute: triggerRelatedRoute,
      },
      assignee: {
        strategy: triggerAssigneeStrategy,
        profileId: triggerAssigneeStrategy === "fixed" ? triggerAssigneeId : "",
      },
      due: {
        basis: triggerDueBasis,
        offsetDays: Number.parseInt(triggerOffsetDays, 10) || 0,
        dueTime: triggerDueTime,
      },
      notification: { channelId: triggerChannelId, teamKey: channel?.teamKey || "" },
      notificationChannelId: triggerChannelId,
    })
  }

  return (
    <section className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{isRecurring ? "반복 업무 템플릿" : "트리거 기반 규칙"}</h2>
        <Badge variant="secondary" className="rounded px-2 py-0.5 text-xs">{visibleRules.length}개</Badge>
      </div>
      {isRecurring ? (
        <form onSubmit={submitRecurringRule} className="grid gap-3 rounded-md border bg-background p-3 md:grid-cols-4">
          <TextField label="규칙명" value={recurringName} onChange={setRecurringName} />
          <TextField label="할 일 제목" value={recurringTitle} onChange={setRecurringTitle} />
          <SelectField label="주기" value={recurringFrequency} onChange={setRecurringFrequency}>
            {AUTOMATION_RECURRENCE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </SelectField>
          <TextField label="시간" type="time" value={recurringDueTime} onChange={setRecurringDueTime} />
          <SelectField label="생성 방식" value={recurringGenerationMode} onChange={setRecurringGenerationMode}>
            {AUTOMATION_GENERATION_MODE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </SelectField>
          {(recurringFrequency === "weekly" || recurringFrequency === "last_weekday") && (
            <SelectField label="요일" value={recurringWeekday} onChange={setRecurringWeekday}>
              {AUTOMATION_WEEKDAY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </SelectField>
          )}
          {recurringFrequency === "monthly" && (
            <TextField label="매월 일자" value={recurringMonthDay} inputMode="numeric" onChange={setRecurringMonthDay} />
          )}
          <SelectField label="생성 시점" value={recurringCreateLeadDays} onChange={setRecurringCreateLeadDays}>
            {AUTOMATION_CREATE_LEAD_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </SelectField>
          <TextField label="종료일" type="date" value={recurringEndDate} onChange={setRecurringEndDate} />
          <SelectField label="우선순위" value={recurringPriority} onChange={(value) => setRecurringPriority(value as OpsTaskPriority)}>
            {AUTOMATION_PRIORITY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </SelectField>
          <SelectField label="관련 메뉴" value={recurringRelatedRoute} onChange={setRecurringRelatedRoute}>
            {AUTOMATION_RELATED_ROUTE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </SelectField>
          <ProfileSelect label="담당자" value={recurringAssigneeId} profiles={profiles} onChange={setRecurringAssigneeId} />
          <SelectField label="알림 채널" value={recurringChannelId} onChange={setRecurringChannelId}>
            <option value="">없음</option>
            {channels.map((channel) => (
              <option key={channel.id} value={channel.id}>{channel.name}</option>
            ))}
          </SelectField>
          <label className="grid min-w-0 gap-1.5 text-sm font-medium md:col-span-2">
            <span>체크리스트</span>
            <Textarea
              value={recurringChecklist}
              onChange={(event) => setRecurringChecklist(event.target.value)}
              placeholder="한 줄에 하나씩 입력"
              className="min-h-20"
            />
          </label>
          <AutomationRulePreview preview={recurringPreview} />
          <div className="flex items-end md:col-span-4">
            <Button type="submit" disabled={saving || !recurringTitle.trim()} className="w-full sm:w-auto">
              <Plus className="size-4" />
              저장
            </Button>
          </div>
        </form>
      ) : (
        <form onSubmit={submitTriggerRule} className="grid gap-3 rounded-md border bg-background p-3 md:grid-cols-4">
          <SelectField label="트리거" value={triggerKey} onChange={handleTriggerChange}>
            {TRIGGER_AUTOMATION_OPTIONS.map((option) => (
              <option key={option.triggerKey} value={option.triggerKey}>{option.label}</option>
            ))}
          </SelectField>
          <TextField label="규칙명" value={triggerName} onChange={setTriggerName} />
          <TextField label="할 일 제목" value={triggerTitle} onChange={setTriggerTitle} />
          <TextField label="며칠 이내" value={triggerOffsetDays} inputMode="numeric" onChange={setTriggerOffsetDays} />
          <SelectField label="기준일" value={triggerDueBasis} onChange={setTriggerDueBasis}>
            {TRIGGER_DUE_BASIS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </SelectField>
          <TextField label="시간" type="time" value={triggerDueTime} onChange={setTriggerDueTime} />
          <SelectField label="우선순위" value={triggerPriority} onChange={(value) => setTriggerPriority(value as OpsTaskPriority)}>
            {AUTOMATION_PRIORITY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </SelectField>
          <SelectField label="관련 메뉴" value={triggerRelatedRoute} onChange={setTriggerRelatedRoute}>
            {AUTOMATION_RELATED_ROUTE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </SelectField>
          <SelectField label="담당 배정" value={triggerAssigneeStrategy} onChange={setTriggerAssigneeStrategy}>
            {AUTOMATION_ASSIGNEE_STRATEGIES.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </SelectField>
          {triggerAssigneeStrategy === "fixed" && (
            <SelectField label="고정 담당자" value={triggerAssigneeId} onChange={setTriggerAssigneeId}>
              <option value="">선택</option>
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>{profile.label}</option>
              ))}
            </SelectField>
          )}
          <SelectField label="알림 채널" value={triggerChannelId} onChange={setTriggerChannelId}>
            <option value="">없음</option>
            {channels.map((channel) => (
              <option key={channel.id} value={channel.id}>{channel.name}</option>
            ))}
          </SelectField>
          <fieldset className="grid gap-3 rounded-md border p-3 md:col-span-4 md:grid-cols-6">
            <legend className="px-1 text-sm font-medium">추가 조건</legend>
            <SelectField label="캠퍼스 조건" value={triggerCampus} onChange={setTriggerCampus}>
              <option value="all">전체</option>
              <option value="본관">본관</option>
              <option value="별관">별관</option>
            </SelectField>
            <TextField label="과목 조건" value={triggerSubject} onChange={setTriggerSubject} placeholder="전체" />
            <TextField label="학년 조건" value={triggerGrade} onChange={setTriggerGrade} placeholder="전체" />
            <TextField label="담당팀 조건" value={triggerTeam} onChange={setTriggerTeam} placeholder="전체" />
            <SelectField label="상태 조건" value={triggerStatus} onChange={setTriggerStatus}>
              {AUTOMATION_STATUS_CONDITION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </SelectField>
            <SelectField label="중복 처리" value={triggerDuplicatePolicy} onChange={setTriggerDuplicatePolicy}>
              {AUTOMATION_DUPLICATE_POLICY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </SelectField>
          </fieldset>
          <label className="grid min-w-0 gap-1.5 text-sm font-medium md:col-span-2">
            <span>체크리스트</span>
            <Textarea
              value={triggerChecklist}
              onChange={(event) => setTriggerChecklist(event.target.value)}
              placeholder="한 줄에 하나씩 입력"
              className="min-h-20"
            />
          </label>
          <AutomationRulePreview preview={triggerPreview} />
          <div className="flex items-end">
            <Button type="submit" disabled={saving || !triggerTitle.trim()} className="w-full sm:w-auto">
              <Plus className="size-4" />
              저장
            </Button>
          </div>
        </form>
      )}
      <div className="overflow-hidden rounded-md border">
        {visibleRules.length === 0 ? (
          <div className="px-3 py-8 text-center text-sm text-muted-foreground">저장된 규칙 없음</div>
        ) : visibleRules.map((rule) => (
          <div key={rule.id} className="grid gap-2 border-b px-3 py-3 text-sm last:border-b-0 md:grid-cols-[minmax(0,1fr)_150px_150px_150px_96px] md:items-center">
            <div className="min-w-0">
              <div className="truncate font-medium">{rule.name}</div>
              <div className="mt-1 truncate text-xs text-muted-foreground">{getAutomationRuleActionTitle(rule)}</div>
              {rule.status.lastTaskTitle && (
                <div className="mt-1 truncate text-xs text-muted-foreground">최근 생성 {rule.status.lastTaskTitle}</div>
              )}
            </div>
            <div className="text-xs text-muted-foreground">{getAutomationRuleMetaLabel(rule)}</div>
            <div className="text-xs text-muted-foreground">
              <div>최근 {getAutomationRunStatusLabel(rule.status.lastRunStatus)}</div>
              <div>{formatAutomationDateLabel(rule.status.lastRunAt)}</div>
            </div>
            <div className="text-xs text-muted-foreground">
              <div>{isRecurring ? `다음 ${formatAutomationDateLabel(rule.status.nextRunAt)}` : `알림 ${getAutomationDeliveryStatusLabel(rule.status.lastDeliveryStatus)}`}</div>
              {(rule.status.pendingDeliveryCount > 0 || rule.status.failedDeliveryCount > 0) && (
                <div>대기 {rule.status.pendingDeliveryCount} · 실패 {rule.status.failedDeliveryCount}</div>
              )}
            </div>
            <Button
              type="button"
              variant={rule.enabled ? "outline" : "secondary"}
              size="sm"
              disabled={saving}
              onClick={() => void onUpdate(rule.id, automationRuleToInput(rule, { enabled: !rule.enabled }))}
            >
              {rule.enabled ? "끄기" : "켜기"}
            </Button>
            <AutomationRuleHistory rule={rule} />
          </div>
        ))}
      </div>
    </section>
  )
}

function NotificationChannelPanel({
  channels,
  saving,
  onCreate,
  onUpdate,
  onTest,
}: {
  channels: OpsTaskNotificationChannel[]
  saving: boolean
  onCreate: (input: OpsTaskNotificationChannelInput) => Promise<void> | void
  onUpdate: (channelId: string, input: OpsTaskNotificationChannelInput) => Promise<void> | void
  onTest: (channelId: string) => Promise<void> | void
}) {
  const [name, setName] = useState("운영팀")
  const [teamKey, setTeamKey] = useState("ops")
  const [webhookUrl, setWebhookUrl] = useState("")
  const [copiedEnvKey, setCopiedEnvKey] = useState("")
  const selectedPresetTeamKey = GOOGLE_CHAT_CHANNEL_PRESETS.some((preset) => preset.teamKey === teamKey) ? teamKey : ""
  const webhookEnvKey = getGoogleChatWebhookEnvKey(teamKey)

  function applyChannelPreset(nextTeamKey: string) {
    const preset = GOOGLE_CHAT_CHANNEL_PRESETS.find((item) => item.teamKey === nextTeamKey)
    if (!preset) return
    setName(preset.name)
    setTeamKey(preset.teamKey)
  }

  async function submitChannel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!name.trim() || !teamKey.trim()) return
    await onCreate({
      name: name.trim(),
      teamKey: teamKey.trim(),
      webhookUrl: webhookUrl.trim(),
      isActive: true,
    })
    setWebhookUrl("")
  }

  return (
    <section className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Google Chat 채널</h2>
        <Badge variant="secondary" className="rounded px-2 py-0.5 text-xs">{channels.length}개</Badge>
      </div>
      <form onSubmit={submitChannel} className="grid gap-3 rounded-md border bg-background p-3 md:grid-cols-[150px_150px_120px_minmax(220px,1fr)_minmax(220px,1fr)_auto] md:items-end">
        <SelectField label="팀방" value={selectedPresetTeamKey} onChange={applyChannelPreset}>
          <option value="">직접 입력</option>
          {GOOGLE_CHAT_CHANNEL_PRESETS.map((preset) => (
            <option key={preset.teamKey} value={preset.teamKey}>{preset.name}</option>
          ))}
        </SelectField>
        <TextField label="채널명" value={name} onChange={setName} />
        <TextField label="팀 키" value={teamKey} onChange={setTeamKey} />
        <TextField label="Webhook URL" value={webhookUrl} onChange={setWebhookUrl} />
        <div className="grid gap-1">
          <div className="text-xs font-medium text-muted-foreground">환경변수</div>
          <div className="flex min-w-0 items-center gap-1 rounded border bg-muted/40 px-2 py-1.5">
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">{webhookEnvKey}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={async () => {
                if (await copyGoogleChatEnvKey(webhookEnvKey)) setCopiedEnvKey(webhookEnvKey)
              }}
            >
              {copiedEnvKey === webhookEnvKey ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              {copiedEnvKey === webhookEnvKey ? "복사됨" : "환경변수 복사"}
            </Button>
          </div>
        </div>
        <Button type="submit" disabled={saving || !name.trim() || !teamKey.trim()} className="w-full sm:w-auto">
          <Plus className="size-4" />
          저장
        </Button>
      </form>
      <div className="overflow-hidden rounded-md border">
        {channels.length === 0 ? (
          <div className="px-3 py-8 text-center text-sm text-muted-foreground">저장된 채널 없음</div>
        ) : channels.map((channel) => (
          <div key={channel.id} className="grid gap-2 border-b px-3 py-3 text-sm last:border-b-0 md:grid-cols-[minmax(0,1fr)_150px_210px_120px_88px_88px] md:items-center">
            <div className="min-w-0">
              <div className="truncate font-medium">{channel.name}</div>
              <div className="mt-1 truncate text-xs text-muted-foreground">{channel.webhookSecretRef}</div>
            </div>
            <div className="text-xs text-muted-foreground">{channel.teamKey}</div>
            <div className="flex min-w-0 items-center gap-1">
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">{getGoogleChatWebhookEnvKey(channel.teamKey)}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={async () => {
                  if (await copyGoogleChatEnvKey(getGoogleChatWebhookEnvKey(channel.teamKey))) setCopiedEnvKey(getGoogleChatWebhookEnvKey(channel.teamKey))
                }}
              >
                {copiedEnvKey === getGoogleChatWebhookEnvKey(channel.teamKey) ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                {copiedEnvKey === getGoogleChatWebhookEnvKey(channel.teamKey) ? "복사됨" : "환경변수 복사"}
              </Button>
            </div>
            <div className="text-xs text-muted-foreground">{channel.webhookUrlLast4 ? `끝 ${channel.webhookUrlLast4}` : "URL 미등록"}</div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={saving || !channel.isActive}
              onClick={() => void onTest(channel.id)}
            >
              테스트
            </Button>
            <Button
              type="button"
              variant={channel.isActive ? "outline" : "secondary"}
              size="sm"
              disabled={saving}
              onClick={() => void onUpdate(channel.id, notificationChannelToInput(channel, { isActive: !channel.isActive }))}
            >
              {channel.isActive ? "끄기" : "켜기"}
            </Button>
          </div>
        ))}
      </div>
    </section>
  )
}

function RegistrationPipelineFilter({
  value,
  tasks,
  onChange,
}: {
  value: string
  tasks: OpsTask[]
  onChange: (value: string) => void
}) {
  const counts = new Map<string, number>()
  tasks.forEach((task) => {
    const status = task.registration?.pipelineStatus || REGISTRATION_PIPELINE_STATUSES[0]?.value || "0. 등록 문의"
    counts.set(status, (counts.get(status) || 0) + 1)
  })
  const visibleStatuses = REGISTRATION_PIPELINE_STATUSES.filter((status) => (
    value === status.value || (counts.get(status.value) || 0) > 0
  ))
  const countedStatusCount = visibleStatuses.filter((status) => (counts.get(status.value) || 0) > 0).length

  if (value === REGISTRATION_PIPELINE_ALL && countedStatusCount <= 1) return null

  return (
    <div className={HORIZONTAL_CHIP_BAR_CLASS} aria-label="등록 진행상태">
      <button
        type="button"
        onClick={() => onChange(REGISTRATION_PIPELINE_ALL)}
        aria-pressed={value === REGISTRATION_PIPELINE_ALL}
        className={[
          "shrink-0 rounded px-3 py-1.5 text-sm font-medium",
          value === REGISTRATION_PIPELINE_ALL ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
        ].join(" ")}
      >
        전체 {tasks.length > 0 && <span className="ml-1 text-xs opacity-80">{tasks.length}</span>}
      </button>
      {visibleStatuses.map((status) => (
        <button
          key={status.value}
          type="button"
          onClick={() => onChange(status.value)}
          aria-pressed={value === status.value}
          className={[
            "shrink-0 rounded px-3 py-1.5 text-sm font-medium",
            value === status.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
          ].join(" ")}
        >
          {getCompactRegistrationPipelineLabel(status.value)} {(counts.get(status.value) || 0) > 0 && <span className="ml-1 text-xs opacity-80">{counts.get(status.value) || 0}</span>}
        </button>
      ))}
    </div>
  )
}

function WordRetestRequestHandoffSummary({
  input,
  student,
  classItem,
  teacher,
  today,
}: {
  input: OpsTaskInput
  student?: OpsStudentOption
  classItem?: OpsClassOption
  teacher?: OpsTeacherOption
  today: string
}) {
  const wordRetest = input.wordRetest || {}
  const executionSummary = getWordRetestExecutionSummary(input, { today })
  const rosterRiskLabel = getWordRetestRosterRiskLabel(student, classItem)
  const valueOrDash = (value: unknown) => String(value || "").trim() || "-"
  const executionLabel = executionSummary?.testAtLabel ? executionSummary.stageLabel : "응시일시 필요"
  const scopeLabel = executionSummary?.scopeLabel || "범위 입력 필요"
  const branchLabel = executionSummary?.branchLabel || wordRetest.branch || "지점 선택 필요"
  const teacherLabel = executionSummary?.teacherLabel || teacher?.label || wordRetest.teacherName || "선생님 선택 필요"

  return (
    <section aria-label="단어 재시험 실행 기준" className="grid gap-2 rounded-md border bg-muted/25 p-3 text-xs md:col-span-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-medium text-foreground">단어 재시험 실행 기준</span>
        <Badge variant={executionSummary?.testAtLabel ? "secondary" : "outline"} className="h-5 rounded px-1.5 text-[11px]">
          {executionLabel}
        </Badge>
        <Badge variant={rosterRiskLabel === "명단 확인" ? "secondary" : "outline"} className="h-5 rounded px-1.5 text-[11px]">
          {rosterRiskLabel}
        </Badge>
      </div>
      <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 gap-y-2 sm:grid-cols-[6rem_minmax(0,1fr)_6rem_minmax(0,1fr)]">
        <span className="text-muted-foreground">실행 큐</span>
        <span className="min-w-0 truncate">{executionLabel}</span>

        <span className="text-muted-foreground">명단</span>
        <span className="flex min-w-0 flex-wrap items-center gap-1">
          <span className="min-w-0 truncate">{valueOrDash(student?.label || input.studentName || wordRetest.studentName)}</span>
          <Badge variant={rosterRiskLabel === "명단 확인" ? "secondary" : "outline"} className="h-5 rounded px-1.5 text-[11px]">
            {rosterRiskLabel}
          </Badge>
        </span>

        <span className="text-muted-foreground">응시일시</span>
        <span className="min-w-0 truncate">{executionSummary?.testAtLabel || "응시일시 필요"}</span>

        <span className="text-muted-foreground">지점</span>
        <span className="min-w-0 truncate">{branchLabel}</span>

        <span className="text-muted-foreground">선생님</span>
        <span className="min-w-0 truncate">{teacherLabel}</span>

        <span className="text-muted-foreground">범위</span>
        <span className="min-w-0 truncate">{scopeLabel}</span>
      </div>
    </section>
  )
}

function WordRetestQueueBar({
  value,
  counts,
  onChange,
}: {
  value: WordRetestQueueMode
  counts: Record<WordRetestQueueMode, number>
  onChange: (value: WordRetestQueueMode) => void
}) {
  return (
    <div aria-label="단어 재시험 실행 큐" className={WORD_RETEST_QUEUE_BAR_CLASS}>
      {WORD_RETEST_QUEUE_ITEMS.map((item) => (
        <button
          key={item.key}
          type="button"
          aria-pressed={value === item.key}
          onClick={() => onChange(item.key)}
          className={[
            "inline-flex h-8 shrink-0 items-center gap-1.5 rounded px-2.5 text-sm font-medium transition-colors",
            value === item.key
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          ].join(" ")}
        >
          <span>{item.label}</span>
          <span className={value === item.key ? "text-primary-foreground/80" : "text-muted-foreground"}>
            {counts[item.key] || 0}
          </span>
        </button>
      ))}
    </div>
  )
}

function WordRetestTeacherQueueBar({
  value,
  counts,
  onChange,
}: {
  value: WordRetestTeacherQueueMode
  counts: Record<WordRetestTeacherQueueMode, number>
  onChange: (value: WordRetestTeacherQueueMode) => void
}) {
  return (
    <div aria-label="선생님 단어 재시험 큐" className={WORD_RETEST_QUEUE_BAR_CLASS}>
      {WORD_RETEST_TEACHER_QUEUE_ITEMS.map((item) => (
        <button
          key={item.key}
          type="button"
          aria-pressed={value === item.key}
          onClick={() => onChange(item.key)}
          className={[
            "inline-flex h-8 shrink-0 items-center gap-1.5 rounded px-2.5 text-sm font-medium transition-colors",
            value === item.key
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          ].join(" ")}
        >
          <span>{item.label}</span>
          <span className={value === item.key ? "text-primary-foreground/80" : "text-muted-foreground"}>
            {counts[item.key] || 0}
          </span>
        </button>
      ))}
    </div>
  )
}

function WordRetestBranchBar({
  value,
  counts,
  onChange,
}: {
  value: WordRetestBranchMode
  counts: Record<WordRetestBranchMode, number>
  onChange: (value: WordRetestBranchMode) => void
}) {
  return (
    <div aria-label="단어 재시험 지점" className={WORD_RETEST_QUEUE_BAR_CLASS}>
      {WORD_RETEST_BRANCH_ITEMS.map((item) => (
        <button
          key={item.key}
          type="button"
          aria-pressed={value === item.key}
          onClick={() => onChange(item.key)}
          className={[
            "inline-flex h-8 shrink-0 items-center gap-1.5 rounded px-2.5 text-sm font-medium transition-colors",
            value === item.key
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          ].join(" ")}
        >
          <span>{item.label}</span>
          <span className={value === item.key ? "text-primary-foreground/80" : "text-muted-foreground"}>
            {counts[item.key] || 0}
          </span>
        </button>
      ))}
    </div>
  )
}

function WordRetestStatusControls({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div aria-label="단어 재시험 상태" className="flex min-w-0 flex-wrap gap-1.5 rounded-md border bg-background p-1 md:col-span-3">
      {WORD_RETEST_STATUSES.map((status) => (
        <button
          key={status.value}
          type="button"
          aria-pressed={value === status.value}
          onClick={() => onChange(status.value)}
          className={[
            "inline-flex h-8 shrink-0 items-center rounded px-2.5 text-sm font-medium transition-colors",
            value === status.value
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          ].join(" ")}
        >
          {status.label}
        </button>
      ))}
    </div>
  )
}

function TodoFilterBar({
  value,
  tasks,
  todayKey,
  completionBlockersByTaskId = EMPTY_COMPLETION_BLOCKERS_BY_TASK_ID,
  confirmationByTaskId = EMPTY_CONFIRMATION_BY_TASK_ID,
  onChange,
}: {
  value: TodoFilterKey
  tasks: OpsTask[]
  todayKey: string
  completionBlockersByTaskId?: OperationCompletionBlockerMap
  confirmationByTaskId?: OperationConfirmationMap
  onChange: (value: TodoFilterKey) => void
}) {
  const activeFilterRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    activeFilterRef.current?.scrollIntoView({ block: "nearest", inline: "center" })
  }, [value])

  const actionableFilterTasks = tasks.filter((task) => isOpsTaskActionable(task, { today: todayKey }))
  const counts: Record<TodoFilterKey, number> = {
    all: actionableFilterTasks.length,
    overdue: actionableFilterTasks.filter((task) => {
      const dueDate = toDateKey(task.dueAt)
      return (Boolean(dueDate) && dueDate < todayKey) || hasOpsTaskOverdueCalendarDate(task, todayKey)
    }).length,
    priority: actionableFilterTasks.filter((task) => task.priority === "urgent" || task.priority === "high").length,
    unassigned: actionableFilterTasks.filter((task) => hasTaskOrganizationIssue(task, completionBlockersByTaskId.get(task.id) || EMPTY_COMPLETION_BLOCKERS)).length,
    confirmation: actionableFilterTasks.filter((task) => confirmationByTaskId.get(task.id) === true).length,
  }

  return (
    <div className={HORIZONTAL_CHIP_BAR_CLASS} aria-label="할 일 필터">
      {TODO_FILTER_TABS.map((filter) => (
          <button
            key={filter.key}
            ref={value === filter.key ? activeFilterRef : undefined}
            type="button"
            onClick={() => onChange(filter.key)}
            aria-pressed={value === filter.key}
            className={[
            "shrink-0 rounded px-3 py-1.5 text-sm font-medium",
            value === filter.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
          ].join(" ")}
        >
          {filter.label}
          {counts[filter.key] > 0 && <span className="ml-1 text-xs opacity-80">{counts[filter.key]}</span>}
        </button>
      ))}
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

function TaskListSkeleton({ showType }: { showType: boolean }) {
  const gridClass = showType
    ? "md:grid-cols-[88px_88px_minmax(220px,1fr)_120px_120px_120px_150px]"
    : "md:grid-cols-[48px_minmax(260px,1fr)_140px_140px]"

  return (
    <div className="overflow-hidden rounded-md border" aria-label="불러오는 중">
      <div className={`hidden border-b bg-muted/40 px-3 py-2 md:grid ${gridClass}`}>
        {Array.from({ length: showType ? 7 : 4 }).map((_, index) => (
          <span key={index} className="h-3 w-16 rounded bg-muted" />
        ))}
      </div>
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className={`grid gap-2 border-b px-3 py-3 last:border-b-0 md:items-center md:gap-0 ${gridClass}`}>
          <span className="size-6 rounded-full bg-muted" />
          {showType && <span className="h-5 w-14 rounded bg-muted" />}
          <span className="grid gap-1.5">
            <span className="h-4 w-3/4 rounded bg-muted" />
            <span className="h-3 w-1/2 rounded bg-muted md:hidden" />
          </span>
          <span className="h-4 w-20 rounded bg-muted" />
          {showType && <span className="h-4 w-20 rounded bg-muted" />}
          <span className="h-4 w-24 rounded bg-muted" />
          {showType && <span className="h-8 w-24 rounded bg-muted md:justify-self-end" />}
        </div>
      ))}
    </div>
  )
}

function getOperationProcessNextAction(
  task: OpsTask,
  workspace: OperationProcessWorkspaceKey,
  columns: OperationProcessBoardColumn[],
): { stageKey: string; label: string } | null {
  if (workspace === "registration") {
    const nextRegistrationAction = getNextRegistrationPipelineAction(task)
    return nextRegistrationAction
      ? { stageKey: nextRegistrationAction.pipelineStatus, label: nextRegistrationAction.label }
      : null
  }
  if (task.status === "done" || task.status === "canceled") return null

  const currentStageKey = getOperationProcessStageKey(task, workspace)
  const currentIndex = columns.findIndex((column) => column.key === currentStageKey)
  const nextColumn = columns[currentIndex >= 0 ? currentIndex + 1 : 0]
  return nextColumn ? { stageKey: nextColumn.key, label: `다음: ${nextColumn.label}` } : null
}

function OperationProcessBoard({
  workspace,
  columns,
  todayKey,
  onOpen,
  onEdit,
  onProcessCellEdit,
  onProcessCellCommit,
  onProcessStageChange,
  statusActionDisabled,
  onCreate,
  emptyLabel,
  emptyActionLabel,
  showEmptyAction,
  completionBlockersByTaskId = EMPTY_COMPLETION_BLOCKERS_BY_TASK_ID,
}: {
  workspace: OperationProcessWorkspaceKey
  columns: OperationProcessBoardColumn[]
  todayKey: string
  onOpen: (task: OpsTask) => void
  onEdit: (task: OpsTask, blockers?: string[], intent?: FormCompletionIntent | null) => void
  onProcessCellEdit: (task: OpsTask, field: OperationProcessCellField) => void
  onProcessCellCommit: (task: OpsTask, field: OperationProcessCellField, value: string) => Promise<void>
  onProcessStageChange: (task: OpsTask, stageKey: string) => void
  statusActionDisabled: boolean
  onCreate: () => void
  emptyLabel: string
  emptyActionLabel: string
  showEmptyAction: boolean
  completionBlockersByTaskId?: OperationCompletionBlockerMap
}) {
  const total = columns.reduce((sum, column) => sum + column.tasks.length, 0)
  const baseColumns = OPERATION_PROCESS_DATABASE_COLUMNS[workspace]
  const [columnOrder, setColumnOrder] = useState<OperationProcessColumnKey[]>(() => baseColumns.map((column) => column.key))
  const [columnWidths, setColumnWidths] = useState<Record<OperationProcessColumnKey, number>>(
    () => Object.fromEntries(baseColumns.map((column) => [column.key, column.width])) as Record<OperationProcessColumnKey, number>,
  )
  const [draggingColumnKey, setDraggingColumnKey] = useState<OperationProcessColumnKey | null>(null)
  const orderedDatabaseColumns = useMemo(() => {
    const columnByKey = new Map(baseColumns.map((column) => [column.key, column]))
    const ordered = columnOrder
      .map((key) => columnByKey.get(key))
      .filter((column): column is OperationProcessDatabaseColumn => Boolean(column))
    const missing = baseColumns.filter((column) => !columnOrder.includes(column.key))
    return [...ordered, ...missing]
  }, [baseColumns, columnOrder])
  const gridTemplateColumns = orderedDatabaseColumns
    .map((column) => `${columnWidths[column.key] || column.width}px`)
    .join(" ")

  function reorderProcessColumn(sourceKey: OperationProcessColumnKey, targetKey: OperationProcessColumnKey) {
    if (sourceKey === targetKey) return
    setColumnOrder((current) => {
      const next = current.length > 0 ? [...current] : baseColumns.map((column) => column.key)
      const index = next.indexOf(sourceKey)
      const targetIndex = next.indexOf(targetKey)
      if (index < 0 || targetIndex < 0 || index === targetIndex) return current
      const [column] = next.splice(index, 1)
      next.splice(targetIndex, 0, column)
      return next
    })
  }

  function startProcessColumnResize(columnKey: OperationProcessColumnKey, startX: number, startWidth: number) {
    function handleMouseMove(event: MouseEvent) {
      const nextWidth = Math.max(84, Math.min(420, startWidth + event.clientX - startX))
      setColumnWidths((current) => ({ ...current, [columnKey]: nextWidth }))
    }

    function handleMouseUp() {
      window.removeEventListener("mousemove", handleMouseMove)
      window.removeEventListener("mouseup", handleMouseUp)
    }

    window.addEventListener("mousemove", handleMouseMove)
    window.addEventListener("mouseup", handleMouseUp, { once: true })
  }

  function startProcessColumnDrag(columnKey: OperationProcessColumnKey, startX: number, startY: number) {
    let didDrag = false

    function handleMouseMove(event: MouseEvent) {
      if (!didDrag && Math.hypot(event.clientX - startX, event.clientY - startY) < 6) return
      didDrag = true
      setDraggingColumnKey(columnKey)
      const targetElement = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest("[data-operation-process-column]")
      const targetKey = targetElement?.getAttribute("data-operation-process-column") as OperationProcessColumnKey | null
      if (targetKey) reorderProcessColumn(columnKey, targetKey)
    }

    function handleMouseUp() {
      window.removeEventListener("mousemove", handleMouseMove)
      window.removeEventListener("mouseup", handleMouseUp)
      setDraggingColumnKey(null)
    }

    window.addEventListener("mousemove", handleMouseMove)
    window.addEventListener("mouseup", handleMouseUp, { once: true })
  }

  function handleProcessColumnDragStart(event: DragEvent<HTMLDivElement>, columnKey: OperationProcessColumnKey) {
    setDraggingColumnKey(columnKey)
    event.dataTransfer.effectAllowed = "move"
    event.dataTransfer.setData("text/plain", columnKey)
  }

  function handleProcessColumnDragOver(event: DragEvent<HTMLDivElement>, columnKey: OperationProcessColumnKey) {
    if (!draggingColumnKey || draggingColumnKey === columnKey) return
    event.preventDefault()
    event.dataTransfer.dropEffect = "move"
  }

  function handleProcessColumnDrop(event: DragEvent<HTMLDivElement>, columnKey: OperationProcessColumnKey) {
    event.preventDefault()
    const sourceKey = (event.dataTransfer.getData("text/plain") || draggingColumnKey) as OperationProcessColumnKey
    reorderProcessColumn(sourceKey, columnKey)
    setDraggingColumnKey(null)
  }

  if (total === 0) {
    return (
      <EmptyTaskState
        icon={<Kanban className="size-5" />}
        label={emptyLabel}
        actionLabel={emptyActionLabel}
        onCreate={onCreate}
        showAction={showEmptyAction}
      />
    )
  }

  return (
    <div aria-label="프로세스 보드" className="grid min-w-0 gap-3">
      {columns.map((column) => (
        <section key={column.key} className="min-w-0 overflow-hidden rounded-lg border bg-muted/20">
          <div className="flex min-w-0 items-center justify-between gap-3 border-b bg-background px-3 py-2.5">
            <h3 className="truncate text-sm font-semibold">{column.label}</h3>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
              {column.tasks.length}
            </span>
          </div>
          <OperationProcessTable
            workspace={workspace}
            tasks={column.tasks}
            columns={orderedDatabaseColumns}
            processColumns={columns}
            gridTemplateColumns={gridTemplateColumns}
            columnWidths={columnWidths}
            todayKey={todayKey}
            onOpen={onOpen}
            onEdit={onEdit}
            onProcessCellEdit={onProcessCellEdit}
            onProcessCellCommit={onProcessCellCommit}
            onProcessStageChange={onProcessStageChange}
            draggingColumnKey={draggingColumnKey}
            onProcessColumnDragStart={handleProcessColumnDragStart}
            onProcessColumnDragOver={handleProcessColumnDragOver}
            onProcessColumnDrop={handleProcessColumnDrop}
            onProcessColumnDragEnd={() => setDraggingColumnKey(null)}
            onProcessColumnMouseDragStart={startProcessColumnDrag}
            onProcessColumnResizeStart={startProcessColumnResize}
            statusActionDisabled={statusActionDisabled}
            completionBlockersByTaskId={completionBlockersByTaskId}
          />
        </section>
      ))}
    </div>
  )
}

function OperationProcessTable({
  workspace,
  tasks,
  columns,
  processColumns,
  gridTemplateColumns,
  columnWidths,
  todayKey,
  onOpen,
  onEdit,
  onProcessCellEdit,
  onProcessCellCommit,
  onProcessStageChange,
  draggingColumnKey,
  onProcessColumnDragStart,
  onProcessColumnDragOver,
  onProcessColumnDrop,
  onProcessColumnDragEnd,
  onProcessColumnMouseDragStart,
  onProcessColumnResizeStart,
  statusActionDisabled,
  completionBlockersByTaskId,
}: {
  workspace: OperationProcessWorkspaceKey
  tasks: OpsTask[]
  columns: OperationProcessDatabaseColumn[]
  processColumns: OperationProcessBoardColumn[]
  gridTemplateColumns: string
  columnWidths: Record<OperationProcessColumnKey, number>
  todayKey: string
  onOpen: (task: OpsTask) => void
  onEdit: (task: OpsTask, blockers?: string[], intent?: FormCompletionIntent | null) => void
  onProcessCellEdit: (task: OpsTask, field: OperationProcessCellField) => void
  onProcessCellCommit: (task: OpsTask, field: OperationProcessCellField, value: string) => Promise<void>
  onProcessStageChange: (task: OpsTask, stageKey: string) => void
  draggingColumnKey: OperationProcessColumnKey | null
  onProcessColumnDragStart: (event: DragEvent<HTMLDivElement>, columnKey: OperationProcessColumnKey) => void
  onProcessColumnDragOver: (event: DragEvent<HTMLDivElement>, columnKey: OperationProcessColumnKey) => void
  onProcessColumnDrop: (event: DragEvent<HTMLDivElement>, columnKey: OperationProcessColumnKey) => void
  onProcessColumnDragEnd: () => void
  onProcessColumnMouseDragStart: (columnKey: OperationProcessColumnKey, startX: number, startY: number) => void
  onProcessColumnResizeStart: (columnKey: OperationProcessColumnKey, startX: number, startWidth: number) => void
  statusActionDisabled: boolean
  completionBlockersByTaskId: OperationCompletionBlockerMap
}) {
  if (tasks.length === 0) {
    return (
      <div className="p-2">
        <div className="flex min-h-14 items-center justify-center rounded-md border border-dashed bg-background/65 px-2 text-xs text-muted-foreground">
          비어 있음
        </div>
      </div>
    )
  }

  return (
    <div aria-label="프로세스 데이터베이스" className="overflow-x-auto p-2">
      <div className="min-w-max overflow-hidden rounded-md border bg-background">
        <div
          role="row"
          className="grid border-b bg-muted/35 text-xs font-semibold text-muted-foreground"
          style={{ gridTemplateColumns }}
        >
          {columns.map((column) => (
            <OperationProcessHeaderCell
              key={column.key}
              column={column}
              width={columnWidths[column.key] || column.width}
              dragging={draggingColumnKey === column.key}
              onDragStart={onProcessColumnDragStart}
              onDragOver={onProcessColumnDragOver}
              onDrop={onProcessColumnDrop}
              onDragEnd={onProcessColumnDragEnd}
              onMouseDragStart={onProcessColumnMouseDragStart}
              onResizeStart={onProcessColumnResizeStart}
            />
          ))}
        </div>
        <div role="rowgroup" className="divide-y">
          {tasks.map((task) => {
            const completionBlockers = completionBlockersByTaskId.get(task.id) || EMPTY_COMPLETION_BLOCKERS

            return (
              <div
                key={task.id}
                role="row"
                className="grid min-h-11 items-stretch text-sm transition-colors hover:bg-muted/20"
                style={{ gridTemplateColumns }}
              >
                {columns.map((column) => (
                  <OperationProcessCell
                    key={`${task.id}:${column.key}`}
                    task={task}
                    workspace={workspace}
                    column={column}
                    processColumns={processColumns}
                    todayKey={todayKey}
                    completionBlockers={completionBlockers}
                    statusActionDisabled={statusActionDisabled}
                    onOpen={onOpen}
                    onEdit={onEdit}
                    onProcessCellEdit={onProcessCellEdit}
                    onProcessCellCommit={onProcessCellCommit}
                    onProcessStageChange={onProcessStageChange}
                  />
                ))}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function OperationProcessHeaderCell({
  column,
  width,
  dragging,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onMouseDragStart,
  onResizeStart,
}: {
  column: OperationProcessDatabaseColumn
  width: number
  dragging: boolean
  onDragStart: (event: DragEvent<HTMLDivElement>, columnKey: OperationProcessColumnKey) => void
  onDragOver: (event: DragEvent<HTMLDivElement>, columnKey: OperationProcessColumnKey) => void
  onDrop: (event: DragEvent<HTMLDivElement>, columnKey: OperationProcessColumnKey) => void
  onDragEnd: () => void
  onMouseDragStart: (columnKey: OperationProcessColumnKey, startX: number, startY: number) => void
  onResizeStart: (columnKey: OperationProcessColumnKey, startX: number, startWidth: number) => void
}) {
  function handleResizePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function handleResizeMouseDown(event: ReactMouseEvent<HTMLDivElement>) {
    event.preventDefault()
    event.stopPropagation()
    onResizeStart(column.key, event.clientX, width)
  }

  return (
    <div
      data-operation-process-column={column.key}
      data-operation-process-dragging={dragging ? "true" : undefined}
      onDragStart={(event) => onDragStart(event, column.key)}
      onDragOver={(event) => onDragOver(event, column.key)}
      onDrop={(event) => onDrop(event, column.key)}
      onDragEnd={onDragEnd}
      onMouseDown={(event) => {
        if (event.button !== 0) return
        event.preventDefault()
        onMouseDragStart(column.key, event.clientX, event.clientY)
      }}
      className={[
        "group relative flex min-w-0 cursor-grab select-none items-center justify-between gap-2 border-r px-2 py-2 last:border-r-0 active:cursor-grabbing",
        dragging ? "bg-primary/10 text-foreground" : "",
      ].filter(Boolean).join(" ")}
      title={`${column.label} ${width}px`}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <GripVertical className="size-3.5 shrink-0 text-muted-foreground/70" aria-hidden="true" />
        <span className="truncate">{column.label}</span>
      </span>
      <span className="shrink-0 text-[10px] font-medium tabular-nums text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
        {width}px
      </span>
      <div
        role="separator"
        aria-label={`${column.label} 열 너비 조절`}
        data-operation-process-resize-handle={column.key}
        onPointerDown={handleResizePointerDown}
        onMouseDown={handleResizeMouseDown}
        className="absolute inset-y-0 right-0 w-2 cursor-col-resize touch-none after:absolute after:inset-y-1 after:right-0 after:w-px after:bg-border hover:after:bg-primary"
      />
    </div>
  )
}

function OperationProcessCell({
  task,
  workspace,
  column,
  processColumns,
  todayKey,
  completionBlockers,
  statusActionDisabled,
  onOpen,
  onEdit,
  onProcessCellEdit,
  onProcessCellCommit,
  onProcessStageChange,
}: {
  task: OpsTask
  workspace: OperationProcessWorkspaceKey
  column: OperationProcessDatabaseColumn
  processColumns: OperationProcessBoardColumn[]
  todayKey: string
  completionBlockers: string[]
  statusActionDisabled: boolean
  onOpen: (task: OpsTask) => void
  onEdit: (task: OpsTask, blockers?: string[], intent?: FormCompletionIntent | null) => void
  onProcessCellEdit: (task: OpsTask, field: OperationProcessCellField) => void
  onProcessCellCommit: (task: OpsTask, field: OperationProcessCellField, value: string) => Promise<void>
  onProcessStageChange: (task: OpsTask, stageKey: string) => void
}) {
  const nextAction = getOperationProcessNextAction(task, workspace, processColumns)
  const value = getOperationProcessCellValue(task, column, todayKey)
  const inlineEditType = getOperationProcessInlineEditType(column.field)
  const editValue = column.field ? getOperationProcessCellEditValue(task, column.field) : ""
  const [isEditing, setIsEditing] = useState(false)
  const [draftValue, setDraftValue] = useState(editValue)
  const [isCommitting, setIsCommitting] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!isEditing) setDraftValue(editValue)
  }, [editValue, isEditing])

  useEffect(() => {
    if (!isEditing) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [isEditing])

  async function commitInlineEdit() {
    if (!column.field || !inlineEditType) {
      setIsEditing(false)
      return
    }
    const nextValue = draftValue.trim()
    if (nextValue === editValue) {
      setIsEditing(false)
      return
    }
    setIsCommitting(true)
    setIsEditing(false)
    try {
      await onProcessCellCommit(task, column.field, nextValue)
    } finally {
      setIsCommitting(false)
    }
  }

  if (column.key === "stage") {
    return (
      <div data-operation-process-cell data-operation-process-column={column.key} className="min-w-0 border-r px-2 py-1.5 last:border-r-0">
        <select
          aria-label={`${task.title} 진행상태 변경`}
          value={getOperationProcessStageKey(task, workspace)}
          onChange={(event) => onProcessStageChange(task, event.currentTarget.value)}
          disabled={statusActionDisabled}
          className="h-8 w-full rounded-md border bg-background px-2 text-xs font-medium outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-ring"
        >
          {processColumns.map((stage) => (
            <option key={stage.key} value={stage.key}>{stage.label}</option>
          ))}
        </select>
      </div>
    )
  }

  if (column.key === "blockers") {
    return (
      <div data-operation-process-cell data-operation-process-column={column.key} className="min-w-0 border-r px-2 py-1.5 last:border-r-0">
        {completionBlockers.length > 0 ? (
          <button
            type="button"
            onClick={() => onEdit(task, completionBlockers)}
            className="inline-flex h-8 max-w-full items-center rounded-md border border-destructive/25 bg-destructive/5 px-2 text-xs font-medium text-destructive hover:bg-destructive/10"
          >
            <span className="truncate">필요 {completionBlockers.length}개 · {completionBlockers[0]}</span>
          </button>
        ) : (
          <span className="inline-flex h-8 items-center rounded-md bg-muted/45 px-2 text-xs font-medium text-muted-foreground">완료 가능</span>
        )}
      </div>
    )
  }

  if (column.key === "actions") {
    return (
      <div data-operation-process-cell data-operation-process-column={column.key} className="flex min-w-0 items-center gap-1 border-r px-2 py-1.5 last:border-r-0">
        {nextAction ? (
          <button
            type="button"
            onClick={() => onProcessStageChange(task, nextAction.stageKey)}
            disabled={statusActionDisabled}
            className="inline-flex h-8 shrink-0 items-center rounded-md bg-primary px-2 text-xs font-semibold text-primary-foreground disabled:opacity-50"
          >
            다음
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => onOpen(task)}
          className="inline-flex h-8 shrink-0 items-center rounded-md border px-2 text-xs font-medium hover:bg-muted"
        >
          열기
        </button>
      </div>
    )
  }

  if (inlineEditType && column.field && isEditing) {
    return (
      <div data-operation-process-cell data-operation-process-column={column.key} className="min-w-0 border-r px-1.5 py-1.5 last:border-r-0">
        <input
          ref={inputRef}
          type={inlineEditType}
          value={draftValue}
          data-operation-process-inline-input
          aria-label={`${task.title} ${column.label} 직접 입력`}
          disabled={isCommitting || statusActionDisabled}
          className="h-8 w-full min-w-0 rounded-md border bg-background px-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring disabled:opacity-60"
          onChange={(event) => setDraftValue(event.currentTarget.value)}
          onBlur={() => void commitInlineEdit()}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              void commitInlineEdit()
            }
            if (event.key === "Escape") {
              event.preventDefault()
              setDraftValue(editValue)
              setIsEditing(false)
            }
          }}
        />
      </div>
    )
  }

  return (
    <div data-operation-process-cell data-operation-process-column={column.key} className="min-w-0 border-r px-1.5 py-1.5 last:border-r-0">
      <button
        type="button"
        aria-label={`${task.title} ${column.label} 입력`}
        onClick={() => {
          if (inlineEditType) {
            setIsEditing(true)
            return
          }
          if (column.field) {
            onProcessCellEdit(task, column.field)
            return
          }
          onOpen(task)
        }}
        disabled={statusActionDisabled && Boolean(inlineEditType)}
        className="flex h-8 w-full min-w-0 items-center rounded-md px-1.5 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className={["truncate", value === "-" || value === "미지정" ? "text-muted-foreground" : ""].join(" ")}>
          {value}
        </span>
      </button>
    </div>
  )
}

function TodoBoard({
  columns,
  todayKey,
  onOpen,
  onEdit,
  onOrganizationFix,
  onStatusChange,
  onRegistrationPipelineAdvance,
  onTodoBoardMove,
  statusActionDisabled,
  onCreate,
  emptyLabel,
  showOperationSourceLink = false,
  completionBlockersByTaskId = EMPTY_COMPLETION_BLOCKERS_BY_TASK_ID,
}: {
  columns: TodoBoardColumn[]
  todayKey: string
  onOpen: (task: OpsTask) => void
  onEdit: (task: OpsTask, blockers?: string[]) => void
  onOrganizationFix: (task: OpsTask, field: TaskOrganizationFixField) => void
  onStatusChange: (task: OpsTask, status: OpsTaskStatus) => void
  onRegistrationPipelineAdvance: (task: OpsTask, pipelineStatus: string) => void
  onTodoBoardMove: (task: OpsTask, columnKey: TodoBoardColumn["key"]) => void
  statusActionDisabled: boolean
  onCreate: () => void
  emptyLabel: string
  showOperationSourceLink?: boolean
  completionBlockersByTaskId?: OperationCompletionBlockerMap
}) {
  const total = columns.reduce((sum, column) => sum + column.tasks.length, 0)
  const taskById = useMemo(
    () => new Map<string, OpsTask>(columns.flatMap((column) => column.tasks.map((task) => [task.id, task] as const))),
    [columns],
  )
  const todoBoardSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor),
  )

  function handleTodoBoardDragEnd(event: DragEndEvent) {
    const taskId = String(event.active.data.current?.taskId || event.active.id || "")
    const columnKey = String(event.over?.id || "") as TodoBoardColumn["key"]
    const task = taskById.get(taskId)
    const isKnownColumn = columns.some((column) => column.key === columnKey)
    if (!task || !isKnownColumn) return
    onTodoBoardMove(task, columnKey)
  }

  if (total === 0) {
    return (
      <EmptyTaskState
        icon={<Kanban className="size-5" />}
        label={emptyLabel}
        actionLabel="빠른 추가"
        onCreate={onCreate}
      />
    )
  }

  return (
    <DndContext sensors={todoBoardSensors} onDragEnd={handleTodoBoardDragEnd}>
      <div className="scroll-px-3 snap-x snap-mandatory overflow-x-auto pb-2" aria-label="할 일 보드">
        <div
          className="grid grid-flow-col auto-cols-[minmax(78vw,1fr)] gap-3 md:grid-flow-row md:auto-cols-auto md:grid-cols-[repeat(5,minmax(0,1fr))]"
        >
          {columns.map((column) => (
            <TodoBoardColumnSection key={column.key} column={column}>
              {column.tasks.length > 0 ? (
                column.tasks.map((task) => (
                  <TodoBoardCard
                    key={task.id}
                    task={task}
                    todayKey={todayKey}
                    onOpen={onOpen}
                    onEdit={onEdit}
                    onOrganizationFix={onOrganizationFix}
                    onStatusChange={onStatusChange}
                    onRegistrationPipelineAdvance={onRegistrationPipelineAdvance}
                    statusActionDisabled={statusActionDisabled}
                    showOperationSourceLink={showOperationSourceLink}
                    completionBlockers={completionBlockersByTaskId.get(task.id) || EMPTY_COMPLETION_BLOCKERS}
                  />
                ))
              ) : (
                <div className="flex min-h-20 items-center justify-center rounded-md border border-dashed bg-background/60 px-2 text-xs text-muted-foreground">
                  비어 있음
                </div>
              )}
            </TodoBoardColumnSection>
          ))}
        </div>
      </div>
    </DndContext>
  )
}

function TodoBoardColumnSection({ column, children }: { column: TodoBoardColumn; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: column.key })

  return (
    <section
      ref={setNodeRef}
      data-todo-board-column={column.key}
      data-todo-board-over={isOver ? "true" : "false"}
      className={[
        "min-w-0 snap-start rounded-lg border bg-muted/25 transition-colors",
        isOver ? "border-primary/50 bg-primary/5" : "",
      ].join(" ")}
    >
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <h3 className="truncate text-sm font-semibold">{column.label}</h3>
        <span className="rounded-full bg-background px-2 py-0.5 text-xs font-medium text-muted-foreground">
          {column.tasks.length}
        </span>
      </div>
      <div className="flex min-h-28 flex-col gap-2 p-2">
        {children}
      </div>
    </section>
  )
}

function TodoBoardCard({
  task,
  todayKey,
  onOpen,
  onEdit,
  onOrganizationFix,
  onStatusChange,
  onRegistrationPipelineAdvance,
  statusActionDisabled,
  showOperationSourceLink,
  completionBlockers,
}: {
  task: OpsTask
  todayKey: string
  onOpen: (task: OpsTask) => void
  onEdit: (task: OpsTask, blockers?: string[]) => void
  onOrganizationFix: (task: OpsTask, field: TaskOrganizationFixField) => void
  onStatusChange: (task: OpsTask, status: OpsTaskStatus) => void
  onRegistrationPipelineAdvance: (task: OpsTask, pipelineStatus: string) => void
  statusActionDisabled: boolean
  showOperationSourceLink: boolean
  completionBlockers: string[]
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    data: { taskId: task.id },
  })
  const dragStyle: CSSProperties = {
    transform: transform ? CSS.Translate.toString(transform) : undefined,
    zIndex: isDragging ? 20 : undefined,
  }
  const nextAction = getNextTaskStatusAction(task)
  const nextRegistrationAction = getNextRegistrationPipelineAction(task)
  const primaryOperationAction = nextRegistrationAction || nextAction
  const nextActionBlocked = nextAction?.status === "done" && completionBlockers.length > 0
  const primaryOperationActionBlocked = nextRegistrationAction
    ? nextRegistrationAction.pipelineStatus.startsWith("7.") && completionBlockers.length > 0
    : nextActionBlocked
  const operationWorkspaceHref = getOperationWorkspaceHref(task)
  const taskMeta = [task.studentName, task.className, task.assigneeLabel].filter(Boolean).join(" · ")
  const registrationPrincipalQueueSummary = task.type === "registration" ? getRegistrationPrincipalQueueSummary(task) : null
  const operationRowRiskSummary = getOperationRowRiskSummary(task, completionBlockers)
  const wordRetestExecutionSummary = task.type === "word_retest"
    ? getWordRetestExecutionSummary(task, { today: todayKey })
    : null
  const shouldShowBoardConfirmationRequestChip = task.type !== "general" && task.status === "requested"
  const organizationFixes = getTaskOrganizationFixes(task, completionBlockers)
  const needsAssigneeFix = task.type !== "general" && organizationFixes.includes("담당 지정")
  const needsScheduleFix = task.type !== "general" && organizationFixes.includes("예정 지정")
  const automationSourceLabel = getOpsAutomationSourceLabel(task)
  const checklistProgressLabel = getTaskChecklistProgressLabel(task.checklistItems)

  return (
    <article
      ref={setNodeRef}
      style={dragStyle}
      data-todo-board-card={task.id}
      className={[
        "rounded-md border bg-background p-3 text-sm shadow-xs transition-[box-shadow,opacity,transform]",
        isDragging ? "opacity-80 shadow-lg" : "",
      ].join(" ")}
    >
      <div className="flex items-start gap-2">
        {task.type === "general" ? (
          <button
            type="button"
            aria-label={`${task.title} 완료`}
            onClick={() => onStatusChange(task, "done")}
            disabled={statusActionDisabled}
            className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-muted-foreground/40 hover:border-primary hover:text-primary"
          />
        ) : (
          <TaskStatusBadge status={task.status} />
        )}
        <button type="button" onClick={() => onOpen(task)} className="min-w-0 flex-1 text-left hover:text-primary">
          <span className="block truncate font-semibold">{task.title}</span>
          {taskMeta && <span className="mt-1 block truncate text-xs text-muted-foreground">{taskMeta}</span>}
        </button>
        <button
          type="button"
          aria-label={`${task.title} 드래그`}
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" aria-hidden="true" />
        </button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {task.type !== "general" && <TaskTypeBadge type={task.type} />}
        {automationSourceLabel && (
          <Badge variant="secondary" className="h-6 rounded px-2 text-[11px]">
            {automationSourceLabel}
          </Badge>
        )}
        {showOperationSourceLink && operationWorkspaceHref && (
          <Button asChild variant="outline" size="sm" className="h-7 px-2 text-xs">
            <a href={operationWorkspaceHref} aria-label={`${task.title} 원천 업무 화면 열기`}>
              <FileText className="size-3.5" />
              업무 화면
            </a>
          </Button>
        )}
        <TodoPriorityBadge priority={task.priority} />
        {checklistProgressLabel && (
          <Badge variant="outline" className="h-6 rounded px-2 text-[11px]">
            {checklistProgressLabel}
          </Badge>
        )}
        <TaskScheduleLabel task={task} todayKey={todayKey} />
        <AutoSyncInlineBadge task={task} />
      </div>
      {(needsAssigneeFix || needsScheduleFix) && (
        <div aria-label="미정리 수정" className="mt-2 flex flex-wrap gap-1.5">
          {needsAssigneeFix && (
            <button
              type="button"
              onClick={() => onOrganizationFix(task, "task.assignee")}
              aria-label={`${task.title}: 담당 지정`}
              className="inline-flex min-h-7 items-center rounded-full border bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
            >
              담당 지정
            </button>
          )}
          {needsScheduleFix && (
            <button
              type="button"
              onClick={() => onOrganizationFix(task, "task.dueAt")}
              aria-label={`${task.title}: 예정 지정`}
              className="inline-flex min-h-7 items-center rounded-full border bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
            >
              예정 지정
            </button>
          )}
        </div>
      )}
      {registrationPrincipalQueueSummary && (
        <div aria-label="등록 원장 배정 상태" className="mt-2 flex min-w-0 flex-wrap gap-1.5 text-xs text-muted-foreground">
          <span className="inline-flex max-w-full items-center rounded bg-muted px-1.5 py-0.5">
            {registrationPrincipalQueueSummary.testAtLabel}
          </span>
          <span className="inline-flex max-w-full items-center rounded bg-muted px-1.5 py-0.5">
            {registrationPrincipalQueueSummary.materialLabel}
          </span>
          <span className="inline-flex max-w-full items-center rounded bg-muted px-1.5 py-0.5">
            {registrationPrincipalQueueSummary.resultLabel}
          </span>
          <span className="inline-flex max-w-full items-center rounded bg-muted px-1.5 py-0.5 font-medium text-foreground">
            {registrationPrincipalQueueSummary.analysisLabel}
          </span>
          <span className="inline-flex max-w-full items-center rounded bg-muted px-1.5 py-0.5">
            {registrationPrincipalQueueSummary.placementLabel}
          </span>
        </div>
      )}
      {operationRowRiskSummary && (
        <div aria-label="전반 퇴원 처리 상태" className="mt-2 flex min-w-0 flex-wrap gap-1.5 text-xs text-muted-foreground">
          <span className="inline-flex max-w-full items-center rounded bg-muted px-1.5 py-0.5 font-medium text-foreground">
            {operationRowRiskSummary.headingLabel}
          </span>
          <span className="inline-flex max-w-full items-center rounded bg-muted px-1.5 py-0.5">
            {operationRowRiskSummary.primaryLabel}
          </span>
          <span className="inline-flex max-w-full items-center rounded bg-muted px-1.5 py-0.5">
            {operationRowRiskSummary.secondaryLabel}
          </span>
          <span className="inline-flex max-w-full items-center rounded bg-muted px-1.5 py-0.5">
            {operationRowRiskSummary.tertiaryLabel}
          </span>
          {operationRowRiskSummary.quaternaryLabel && (
            <span className="inline-flex max-w-full items-center rounded bg-muted px-1.5 py-0.5">
              {operationRowRiskSummary.quaternaryLabel}
            </span>
          )}
        </div>
      )}
      {wordRetestExecutionSummary && (
        <div aria-label="단어 재시험 실행 상태" className="mt-2 flex min-w-0 flex-wrap gap-1.5 text-xs text-muted-foreground">
          <span className="inline-flex max-w-full items-center rounded bg-muted px-1.5 py-0.5 font-medium text-foreground">
            {wordRetestExecutionSummary.stageLabel}
          </span>
          <span className="inline-flex max-w-full items-center rounded bg-muted px-1.5 py-0.5">
            {wordRetestExecutionSummary.scoreLabel}
          </span>
          {wordRetestExecutionSummary.branchLabel && (
            <span className="inline-flex max-w-full items-center rounded bg-muted px-1.5 py-0.5">
              {wordRetestExecutionSummary.branchLabel}
            </span>
          )}
          {wordRetestExecutionSummary.testAtLabel && (
            <span className="inline-flex max-w-full items-center rounded bg-muted px-1.5 py-0.5">
              {wordRetestExecutionSummary.testAtLabel}
            </span>
          )}
          {wordRetestExecutionSummary.teacherLabel && (
            <span className="inline-flex max-w-full items-center rounded bg-muted px-1.5 py-0.5">
              {wordRetestExecutionSummary.teacherLabel}
            </span>
          )}
          {wordRetestExecutionSummary.scopeLabel && (
            <span className="inline-flex max-w-full items-center rounded bg-muted px-1.5 py-0.5">
              {wordRetestExecutionSummary.scopeLabel}
            </span>
          )}
        </div>
      )}
      {shouldShowBoardConfirmationRequestChip && (
        <div aria-label="확인 필요 사유" className="mt-2">
          <button
            type="button"
            onClick={() => onOpen(task)}
            aria-label={`${task.title}: 요청 확인`}
            className="inline-flex min-h-7 items-center rounded-full border bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
          >
            요청 확인
          </button>
        </div>
      )}
      {completionBlockers.length > 0 && (
        <div aria-label="완료 전 필요한 입력" className="mt-2">
          <CompletionBlockerInlineChips
            task={task}
            blockers={completionBlockers}
            onSelect={(blocker) => onEdit(task, [blocker])}
            tone={primaryOperationActionBlocked ? "destructive" : "default"}
            showNeed
          />
        </div>
      )}
      {primaryOperationAction && task.type !== "general" && (
        <Button
          type="button"
          variant={primaryOperationActionBlocked ? "outline" : "secondary"}
          size="sm"
          className="mt-2 h-8 w-full"
          onClick={() => {
            if (nextRegistrationAction) {
              if (primaryOperationActionBlocked) {
                onEdit(task, completionBlockers)
                return
              }
              onRegistrationPipelineAdvance(task, nextRegistrationAction.pipelineStatus)
              return
            }
            if (nextAction) {
              if (primaryOperationActionBlocked) {
                onEdit(task, completionBlockers)
                return
              }
              onStatusChange(task, nextAction.status)
            }
          }}
          disabled={statusActionDisabled}
        >
          {primaryOperationActionBlocked ? getCompletionBlockerActionLabel(completionBlockers) : primaryOperationAction.label}
        </Button>
      )}
    </article>
  )
}

function WordRetestAssistantActionControls({
  task,
  actions,
  onAction,
  disabled = false,
}: {
  task: OpsTask
  actions: WordRetestAssistantQuickAction[]
  onAction: (action: WordRetestAssistantQuickAction) => void
  disabled?: boolean
}) {
  const [quickWordRetestScore, setQuickWordRetestScore] = useState("")
  const actionKeySignature = actions.map((action) => action.key).join("|")
  useEffect(() => {
    setQuickWordRetestScore("")
  }, [task.id, actionKeySignature])

  if (actions.length === 0) return null

  return (
    <>
      {actions.map((action) => (
        action.kind === "quick_score" ? (
          <form
            key={action.key}
            aria-label={`${task.title} 점수 빠른 입력`}
            className="flex min-w-0 items-center gap-1.5"
            onSubmit={(event) => {
              event.preventDefault()
              onAction({ ...action, score: quickWordRetestScore })
            }}
          >
            <Input
              aria-label={`${task.title}: 1차 점수 빠른 입력`}
              inputMode="numeric"
              value={quickWordRetestScore}
              onChange={(event) => setQuickWordRetestScore(event.target.value)}
              className="h-8 w-20 px-2 text-sm"
              placeholder="1차"
            />
            <Button
              type="submit"
              variant="default"
              size="sm"
              aria-label={`${task.title}: 점수 저장`}
              disabled={disabled || !quickWordRetestScore.trim()}
            >
              {action.label}
            </Button>
            {WORD_RETEST_QUICK_SCORE_PRESETS.map((score) => (
              <Button
                key={`${action.key}-${score}`}
                type="button"
                variant="outline"
                size="sm"
                aria-label={`${task.title}: ${score}점 바로 저장`}
                disabled={disabled}
                onClick={() => onAction({ ...action, score })}
              >
                {score}점
              </Button>
            ))}
          </form>
        ) : (
          <Button
            key={action.key}
            type="button"
            variant={action.status === "done" ? "default" : action.kind === "edit_scores" ? "default" : "outline"}
            size="sm"
            aria-label={`${task.title}: ${action.label}`}
            onClick={() => onAction(action)}
            disabled={disabled}
          >
            {action.label}
          </Button>
        )
      ))}
    </>
  )
}

function TaskList({
  tasks,
  todayKey,
  onOpen,
  onEdit,
  onOrganizationFix,
  onStatusChange,
  onRegistrationPipelineAdvance,
  onWordRetestAssistantAction,
  onWordRetestRerequest,
  wordRetestAssistantMode = false,
  wordRetestTeacherMode = false,
  wordRetestExecutionOptions,
  statusActionDisabled = false,
  onCreate,
  emptyLabel = "항목 없음",
  emptyActionLabel,
  showEmptyAction = true,
  showType = true,
  showOperationSourceLink = false,
  completionBlockersByTaskId = EMPTY_COMPLETION_BLOCKERS_BY_TASK_ID,
}: {
  tasks: OpsTask[]
  todayKey: string
  onOpen: (task: OpsTask) => void
  onEdit: (task: OpsTask, blockers?: string[]) => void
  onOrganizationFix: (task: OpsTask, field: TaskOrganizationFixField) => void
  onStatusChange: (task: OpsTask, status: OpsTaskStatus) => void
  onRegistrationPipelineAdvance: (task: OpsTask, pipelineStatus: string) => void
  onWordRetestAssistantAction?: (task: OpsTask, action: WordRetestAssistantQuickAction) => void
  onWordRetestRerequest?: (task: OpsTask) => void
  wordRetestAssistantMode?: boolean
  wordRetestTeacherMode?: boolean
  wordRetestExecutionOptions?: WordRetestExecutionOptions
  statusActionDisabled?: boolean
  onCreate: () => void
  emptyLabel?: string
  emptyActionLabel?: string
  showEmptyAction?: boolean
  showType?: boolean
  showOperationSourceLink?: boolean
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
  const gridClass = hasOperationRows
    ? showTypeColumn
      ? "md:grid-cols-[88px_88px_minmax(220px,1fr)_120px_120px_120px_150px]"
      : "md:grid-cols-[88px_minmax(220px,1fr)_120px_120px_120px_150px]"
    : "md:grid-cols-[48px_minmax(260px,1fr)_140px_140px]"

  return (
    <div className="overflow-hidden rounded-md border">
      {hasOperationRows && <div className={`hidden border-b bg-muted/50 px-3 py-2 text-xs font-medium text-muted-foreground md:grid ${gridClass}`}>
        <span>상태</span>
        {showTypeColumn && <span>유형</span>}
        <span>{isTodoList ? "할 일" : "업무"}</span>
        <span>담당</span>
        {hasOperationRows && <span>학생</span>}
        <span>예정</span>
        {hasOperationRows && <span className="text-right">작업</span>}
      </div>}
      {tasks.map((task) => (
        <TaskListRow
          key={task.id}
          task={task}
          todayKey={todayKey}
          onOpen={onOpen}
          onEdit={onEdit}
          onOrganizationFix={onOrganizationFix}
          onStatusChange={onStatusChange}
          onRegistrationPipelineAdvance={onRegistrationPipelineAdvance}
          onWordRetestAssistantAction={onWordRetestAssistantAction}
          onWordRetestRerequest={onWordRetestRerequest}
          wordRetestAssistantMode={wordRetestAssistantMode}
          wordRetestTeacherMode={wordRetestTeacherMode}
          wordRetestExecutionOptions={wordRetestExecutionOptions}
          statusActionDisabled={statusActionDisabled}
          showType={showTypeColumn}
          todoControls={!showType}
          showOperationColumns={hasOperationRows}
          showOperationSourceLink={showOperationSourceLink}
          completionBlockers={completionBlockersByTaskId.get(task.id) || EMPTY_COMPLETION_BLOCKERS}
        />
      ))}
    </div>
  )
}

function TaskListRow({
  task,
  todayKey,
  onOpen,
  onEdit,
  onOrganizationFix,
  onStatusChange,
  onRegistrationPipelineAdvance,
  onWordRetestAssistantAction,
  onWordRetestRerequest,
  wordRetestAssistantMode,
  wordRetestTeacherMode,
  wordRetestExecutionOptions,
  statusActionDisabled,
  showType,
  todoControls,
  showOperationColumns,
  showOperationSourceLink,
  completionBlockers,
}: {
  task: OpsTask
  todayKey: string
  onOpen: (task: OpsTask) => void
  onEdit: (task: OpsTask, blockers?: string[]) => void
  onOrganizationFix: (task: OpsTask, field: TaskOrganizationFixField) => void
  onStatusChange: (task: OpsTask, status: OpsTaskStatus) => void
  onRegistrationPipelineAdvance: (task: OpsTask, pipelineStatus: string) => void
  onWordRetestAssistantAction?: (task: OpsTask, action: WordRetestAssistantQuickAction) => void
  onWordRetestRerequest?: (task: OpsTask) => void
  wordRetestAssistantMode: boolean
  wordRetestTeacherMode: boolean
  wordRetestExecutionOptions?: WordRetestExecutionOptions
  statusActionDisabled: boolean
  showType: boolean
  todoControls: boolean
  showOperationColumns: boolean
  showOperationSourceLink: boolean
  completionBlockers: string[]
}) {
  const nextAction = getNextTaskStatusAction(task)
  const nextRegistrationAction = getNextRegistrationPipelineAction(task)
  const primaryOperationAction = nextRegistrationAction || nextAction
  const executionOptions = wordRetestExecutionOptions || { today: todayKey }
  const wordRetestAssistantActions = wordRetestAssistantMode && task.type === "word_retest"
    ? getWordRetestAssistantQuickActions(task, executionOptions) as WordRetestAssistantQuickAction[]
    : []
  const shouldShowWordRetestExecutionSummary = task.type === "word_retest" && (wordRetestAssistantMode || showOperationSourceLink)
  const wordRetestExecutionSummary = shouldShowWordRetestExecutionSummary
    ? getWordRetestExecutionSummary(task, executionOptions)
    : null
  const automationSourceLabel = getOpsAutomationSourceLabel(task)
  const shouldShowWordRetestRerequest = wordRetestTeacherMode && isWordRetestRerequestable(task)
  const registrationPrincipalQueueSummary = task.type === "registration" ? getRegistrationPrincipalQueueSummary(task) : null
  const operationRowRiskSummary = getOperationRowRiskSummary(task, completionBlockers)
  const operationWorkspaceHref = getOperationWorkspaceHref(task)
  const nextActionBlocked = nextAction?.status === "done" && completionBlockers.length > 0
  const primaryOperationActionBlocked = nextRegistrationAction
    ? nextRegistrationAction.pipelineStatus.startsWith("7.") && completionBlockers.length > 0
    : nextActionBlocked
  const isTodoRow = todoControls && task.type === "general"
  const isOperationRow = task.type !== "general"
  const shouldShowCompletionBlockerChips = isOperationRow && completionBlockers.length > 0
  const shouldShowConfirmationRequestChip = isOperationRow && task.status === "requested"
  const nextTodoStatus: OpsTaskStatus = isClosedOpsTask(task) ? "requested" : "done"
  const blockedActionLabel = getCompletionBlockerActionLabel(completionBlockers)
  const organizationFixes = getTaskOrganizationFixes(task, completionBlockers)
  const needsAssigneeFix = organizationFixes.includes("담당 지정")
  const needsScheduleFix = organizationFixes.includes("예정 지정")
  const checklistProgressLabel = getTaskChecklistProgressLabel(task.checklistItems)
  const gridClass = showType
    ? "md:grid-cols-[88px_88px_minmax(220px,1fr)_120px_120px_120px_150px]"
    : isOperationRow
      ? "md:grid-cols-[88px_minmax(220px,1fr)_120px_120px_120px_150px]"
      : "md:grid-cols-[48px_minmax(260px,1fr)_140px_140px]"
  const taskMeta = [
    task.type !== "general" && !showType ? getTaskTypeLabel(task.type) : "",
    task.type === "general" ? task.studentName : "",
    task.subject,
    task.campus,
    task.className,
    task.textbookTitle,
  ].filter(Boolean).join(" · ")

  return (
    <div
      className={`grid grid-cols-[auto_minmax(0,1fr)] gap-2 border-b px-3 py-3 text-sm transition-colors [contain-intrinsic-size:72px] [content-visibility:auto] last:border-b-0 hover:bg-muted/40 md:items-center md:gap-0 ${gridClass}`}
    >
      <span className="row-start-1">
        {isTodoRow ? (
          <button
            type="button"
            aria-label={`${task.title} ${isClosedOpsTask(task) ? "다시 열기" : "완료"}`}
            onClick={() => onStatusChange(task, nextTodoStatus)}
            disabled={statusActionDisabled}
            className={[
              "inline-flex size-8 items-center justify-center rounded-full border transition-colors active:scale-95 md:size-7",
              task.status === "done"
                ? "border-primary bg-primary text-primary-foreground"
                : "border-muted-foreground/40 bg-background hover:border-primary hover:text-primary",
            ].join(" ")}
          >
            {task.status === "done" && <Check className="size-4 md:size-3.5" />}
            {task.status === "canceled" && <X className="size-4 md:size-3.5" />}
          </button>
        ) : (
          <TaskStatusBadge status={task.status} />
        )}
      </span>
      {showType && <span><TaskTypeBadge type={task.type} /></span>}
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
          {automationSourceLabel && (
            <Badge variant="secondary" className="h-5 shrink-0 rounded px-1.5 text-[11px]">
              {automationSourceLabel}
            </Badge>
          )}
          {isTodoRow && <TodoPriorityBadge priority={task.priority} />}
          {checklistProgressLabel && (
            <Badge variant="outline" className="h-5 shrink-0 rounded px-1.5 text-[11px]">
              {checklistProgressLabel}
            </Badge>
          )}
          <AutoSyncInlineBadge task={task} />
        </span>
        {taskMeta && <span className="block truncate text-xs text-muted-foreground">{taskMeta}</span>}
        {registrationPrincipalQueueSummary && (
          <span aria-label="등록 원장 배정 상태" className="mt-1 flex min-w-0 flex-wrap gap-1.5 text-xs text-muted-foreground">
            <span className="inline-flex max-w-full items-center rounded bg-muted px-1.5 py-0.5">
              {registrationPrincipalQueueSummary.testAtLabel}
            </span>
            <span className="inline-flex max-w-full items-center rounded bg-muted px-1.5 py-0.5">
              {registrationPrincipalQueueSummary.materialLabel}
            </span>
            <span className="inline-flex max-w-full items-center rounded bg-muted px-1.5 py-0.5">
              {registrationPrincipalQueueSummary.resultLabel}
            </span>
            <span className="inline-flex max-w-full items-center rounded bg-muted px-1.5 py-0.5 font-medium text-foreground">
              {registrationPrincipalQueueSummary.analysisLabel}
            </span>
            <span className="inline-flex max-w-full items-center rounded bg-muted px-1.5 py-0.5">
              {registrationPrincipalQueueSummary.placementLabel}
            </span>
          </span>
        )}
        {operationRowRiskSummary && (
          <span aria-label="전반 퇴원 처리 상태" className="mt-1 flex min-w-0 flex-wrap gap-1.5 text-xs text-muted-foreground">
            <span className="inline-flex max-w-full items-center rounded bg-muted px-1.5 py-0.5 font-medium text-foreground">
              {operationRowRiskSummary.headingLabel}
            </span>
            <span className="inline-flex max-w-full items-center rounded bg-muted px-1.5 py-0.5">
              {operationRowRiskSummary.primaryLabel}
            </span>
            <span className="inline-flex max-w-full items-center rounded bg-muted px-1.5 py-0.5">
              {operationRowRiskSummary.secondaryLabel}
            </span>
            <span className="inline-flex max-w-full items-center rounded bg-muted px-1.5 py-0.5">
              {operationRowRiskSummary.tertiaryLabel}
            </span>
            {operationRowRiskSummary.quaternaryLabel && (
              <span className="inline-flex max-w-full items-center rounded bg-muted px-1.5 py-0.5">
                {operationRowRiskSummary.quaternaryLabel}
              </span>
            )}
          </span>
        )}
        {wordRetestExecutionSummary && (
          <span aria-label="단어 재시험 실행 상태" className="mt-1 flex min-w-0 flex-wrap gap-1.5 text-xs text-muted-foreground">
            <span className="inline-flex max-w-full items-center rounded bg-muted px-1.5 py-0.5 font-medium text-foreground">
              {wordRetestExecutionSummary.stageLabel}
            </span>
            <span className="inline-flex max-w-full items-center rounded bg-muted px-1.5 py-0.5">
              {wordRetestExecutionSummary.scoreLabel}
            </span>
            {wordRetestExecutionSummary.branchLabel && (
              <span className="inline-flex max-w-full items-center rounded bg-muted px-1.5 py-0.5">
                {wordRetestExecutionSummary.branchLabel}
              </span>
            )}
            {wordRetestExecutionSummary.testAtLabel && (
              <span className="inline-flex max-w-full items-center rounded bg-muted px-1.5 py-0.5">
                {wordRetestExecutionSummary.testAtLabel}
              </span>
            )}
            {wordRetestExecutionSummary.teacherLabel && (
              <span className="inline-flex max-w-full items-center rounded bg-muted px-1.5 py-0.5">
                {wordRetestExecutionSummary.teacherLabel}
              </span>
            )}
            {wordRetestExecutionSummary.scopeLabel && (
              <span className="inline-flex max-w-full items-center rounded bg-muted px-1.5 py-0.5">
                {wordRetestExecutionSummary.scopeLabel}
              </span>
            )}
          </span>
        )}
        {isTodoRow && (
          <span className="mt-1 flex flex-wrap gap-1.5 text-xs text-muted-foreground md:hidden">
            {task.assigneeLabel && <span>담당 {task.assigneeLabel}</span>}
            {task.assigneeLabel && hasTaskSchedule(task) && <span>·</span>}
            {hasTaskSchedule(task) && <span>예정 <TaskScheduleLabel task={task} todayKey={todayKey} /></span>}
          </span>
        )}
      </button>
      <span className={[isTodoRow ? "hidden md:block" : "", isOperationRow ? "col-span-full md:col-auto" : "", "min-w-0 text-muted-foreground md:text-foreground"].filter(Boolean).join(" ")}>
        {isOperationRow && <span className="mr-2 text-xs text-muted-foreground md:hidden">담당:</span>}
        {isOperationRow && needsAssigneeFix ? (
          <button
            type="button"
            onClick={() => onOrganizationFix(task, "task.assignee")}
            aria-label={`${task.title}: 담당 지정`}
            className="inline-flex min-h-7 items-center rounded-full border bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
          >
            담당 지정
          </button>
        ) : (
          <span className="truncate">{isTodoRow && !task.assigneeLabel ? null : task.assigneeLabel || "미지정"}</span>
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
            onClick={() => onOrganizationFix(task, "task.dueAt")}
            aria-label={`${task.title}: 예정 지정`}
            className="inline-flex min-h-7 items-center rounded-full border bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
          >
            예정 지정
          </button>
        ) : (
          isTodoRow && !hasTaskSchedule(task) ? null : <TaskScheduleLabel task={task} todayKey={todayKey} />
        )}
      </span>
      {isOperationRow && (
        <span className="col-span-full flex flex-wrap justify-start gap-1.5 md:col-auto md:justify-end">
          {showOperationSourceLink && operationWorkspaceHref && (
            <Button asChild variant="outline" size="sm">
              <a href={operationWorkspaceHref} aria-label={`${task.title} 원천 업무 화면 열기`}>
                <FileText className="size-4" />
                업무 화면
              </a>
            </Button>
          )}
          <WordRetestAssistantActionControls
            task={task}
            actions={wordRetestAssistantActions}
            onAction={(action) => onWordRetestAssistantAction?.(task, action)}
            disabled={statusActionDisabled}
          />
          {shouldShowWordRetestRerequest && (
            <Button
              type="button"
              variant="default"
              size="sm"
              aria-label={`${task.title}: 미응시 재요청`}
              onClick={() => onWordRetestRerequest?.(task)}
              disabled={statusActionDisabled}
            >
              미응시 재요청
            </Button>
          )}
          {primaryOperationAction && wordRetestAssistantActions.length === 0 && (
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
      {shouldShowConfirmationRequestChip && (
        <span aria-label="확인 필요 사유" className="col-span-full md:col-span-full">
          <button
            type="button"
            onClick={() => onOpen(task)}
            aria-label={`${task.title}: 요청 확인`}
            className="inline-flex min-h-7 items-center rounded-full border bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
          >
            요청 확인
          </button>
        </span>
      )}
      {shouldShowCompletionBlockerChips && (
        <span aria-label="완료 전 필요한 입력" className="col-span-full md:col-span-full">
          <CompletionBlockerInlineChips
            task={task}
            blockers={completionBlockers}
            onSelect={(blocker) => onEdit(task, [blocker])}
            className="md:pl-0"
            tone={primaryOperationActionBlocked ? "destructive" : "default"}
            showNeed
          />
        </span>
      )}
    </div>
  )
}

function GroupedTaskList({
  groups,
  todayKey,
  onOpen,
  onEdit,
  onOrganizationFix,
  onStatusChange,
  onRegistrationPipelineAdvance,
  onWordRetestRerequest,
  wordRetestTeacherMode = false,
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
  onOrganizationFix: (task: OpsTask, field: TaskOrganizationFixField) => void
  onStatusChange: (task: OpsTask, status: OpsTaskStatus) => void
  onRegistrationPipelineAdvance: (task: OpsTask, pipelineStatus: string) => void
  onWordRetestRerequest?: (task: OpsTask) => void
  wordRetestTeacherMode?: boolean
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
            onOrganizationFix={onOrganizationFix}
            onStatusChange={onStatusChange}
            onRegistrationPipelineAdvance={onRegistrationPipelineAdvance}
            onWordRetestRerequest={onWordRetestRerequest}
            wordRetestTeacherMode={wordRetestTeacherMode}
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
              const calendarRegistrationPrincipalQueueSummary = task?.type === "registration" ? getRegistrationPrincipalQueueSummary(task) : null
              const nextAction = task ? getNextTaskStatusAction(task) : null
              const nextRegistrationAction = task ? getNextRegistrationPipelineAction(task) : null
              const primaryCalendarAction = nextRegistrationAction || nextAction
              const completionBlockers = task ? completionBlockersByTaskId.get(task.id) || EMPTY_COMPLETION_BLOCKERS : EMPTY_COMPLETION_BLOCKERS
              const calendarOperationRowRiskSummary = task ? getOperationRowRiskSummary(task, completionBlockers) : null
              const calendarWordRetestExecutionSummary = task?.type === "word_retest" ? getWordRetestExecutionSummary(task, { today: todayKey }) : null
              const nextActionBlocked = nextAction?.status === "done" && completionBlockers.length > 0
              const primaryCalendarActionBlocked = nextRegistrationAction
                ? nextRegistrationAction.pipelineStatus.startsWith("7.") && completionBlockers.length > 0
                : nextActionBlocked
              const shouldShowCalendarCompletionBlockers = Boolean(task && task.type !== "general" && completionBlockers.length > 0)
              const shouldShowCalendarConfirmationRequestChip = Boolean(task && task.type !== "general" && task.status === "requested")
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
                    {calendarRegistrationPrincipalQueueSummary && (
                      <span aria-label="등록 원장 배정 상태" className="mt-1 flex min-w-0 flex-wrap gap-1">
                        <span className="inline-flex max-w-full items-center rounded bg-background/75 px-1.5 py-0.5 text-[11px] text-muted-foreground">
                          {calendarRegistrationPrincipalQueueSummary.testAtLabel}
                        </span>
                        <span className="inline-flex max-w-full items-center rounded bg-background/75 px-1.5 py-0.5 text-[11px] text-muted-foreground">
                          {calendarRegistrationPrincipalQueueSummary.materialLabel}
                        </span>
                        <span className="inline-flex max-w-full items-center rounded bg-background/75 px-1.5 py-0.5 text-[11px] text-muted-foreground">
                          {calendarRegistrationPrincipalQueueSummary.resultLabel}
                        </span>
                        <span className="inline-flex max-w-full items-center rounded bg-background/75 px-1.5 py-0.5 text-[11px] font-medium text-foreground">
                          {calendarRegistrationPrincipalQueueSummary.analysisLabel}
                        </span>
                        <span className="inline-flex max-w-full items-center rounded bg-background/75 px-1.5 py-0.5 text-[11px] text-muted-foreground">
                          {calendarRegistrationPrincipalQueueSummary.placementLabel}
                        </span>
                      </span>
                    )}
                    {calendarOperationRowRiskSummary && (
                      <span aria-label="전반 퇴원 처리 상태" className="mt-1 flex min-w-0 flex-wrap gap-1">
                        <span className="inline-flex max-w-full items-center rounded bg-background/75 px-1.5 py-0.5 text-[11px] font-medium text-foreground">
                          {calendarOperationRowRiskSummary.headingLabel}
                        </span>
                        <span className="inline-flex max-w-full items-center rounded bg-background/75 px-1.5 py-0.5 text-[11px] text-muted-foreground">
                          {calendarOperationRowRiskSummary.primaryLabel}
                        </span>
                        <span className="inline-flex max-w-full items-center rounded bg-background/75 px-1.5 py-0.5 text-[11px] text-muted-foreground">
                          {calendarOperationRowRiskSummary.secondaryLabel}
                        </span>
                        <span className="inline-flex max-w-full items-center rounded bg-background/75 px-1.5 py-0.5 text-[11px] text-muted-foreground">
                          {calendarOperationRowRiskSummary.tertiaryLabel}
                        </span>
                        {calendarOperationRowRiskSummary.quaternaryLabel && (
                          <span className="inline-flex max-w-full items-center rounded bg-background/75 px-1.5 py-0.5 text-[11px] text-muted-foreground">
                            {calendarOperationRowRiskSummary.quaternaryLabel}
                          </span>
                        )}
                      </span>
                    )}
                    {calendarWordRetestExecutionSummary && (
                      <span aria-label="단어 재시험 실행 상태" className="mt-1 flex min-w-0 flex-wrap gap-1">
                        <span className="inline-flex max-w-full items-center rounded bg-background/75 px-1.5 py-0.5 text-[11px] font-medium text-foreground">
                          {calendarWordRetestExecutionSummary.stageLabel}
                        </span>
                        <span className="inline-flex max-w-full items-center rounded bg-background/75 px-1.5 py-0.5 text-[11px] text-muted-foreground">
                          {calendarWordRetestExecutionSummary.scoreLabel}
                        </span>
                        {calendarWordRetestExecutionSummary.branchLabel && (
                          <span className="inline-flex max-w-full items-center rounded bg-background/75 px-1.5 py-0.5 text-[11px] text-muted-foreground">
                            {calendarWordRetestExecutionSummary.branchLabel}
                          </span>
                        )}
                        {calendarWordRetestExecutionSummary.testAtLabel && (
                          <span className="inline-flex max-w-full items-center rounded bg-background/75 px-1.5 py-0.5 text-[11px] text-muted-foreground">
                            {calendarWordRetestExecutionSummary.testAtLabel}
                          </span>
                        )}
                        {calendarWordRetestExecutionSummary.teacherLabel && (
                          <span className="inline-flex max-w-full items-center rounded bg-background/75 px-1.5 py-0.5 text-[11px] text-muted-foreground">
                            {calendarWordRetestExecutionSummary.teacherLabel}
                          </span>
                        )}
                        {calendarWordRetestExecutionSummary.scopeLabel && (
                          <span className="inline-flex max-w-full items-center rounded bg-background/75 px-1.5 py-0.5 text-[11px] text-muted-foreground">
                            {calendarWordRetestExecutionSummary.scopeLabel}
                          </span>
                        )}
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
                  {shouldShowCalendarConfirmationRequestChip && (
                    <div aria-label="확인 필요 사유" className="sm:col-span-2">
                      <button
                        type="button"
                        onClick={() => task && onOpen(task)}
                        aria-label={`${item.title}: 요청 확인`}
                        className="inline-flex min-h-7 items-center rounded-full border bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
                      >
                        요청 확인
                      </button>
                    </div>
                  )}
                  {shouldShowCalendarCompletionBlockers && (
                    <div aria-label="완료 전 필요한 입력" className="sm:col-span-2">
                      <CompletionBlockerInlineChips
                        task={task || { id: item.id, title: item.title }}
                        blockers={completionBlockers}
                        onSelect={(blocker) => task && onEdit(task, [blocker])}
                        tone={primaryCalendarActionBlocked ? "destructive" : "default"}
                        showNeed
                      />
                    </div>
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
  task: CompletionBlockerTaskTarget
  blockers: string[]
  onSelect: (blocker: string) => void
}) {
  if (blockers.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-sm" role="group" aria-label="완료 전 필요한 입력">
      {blockers.map((blocker) => {
        const needLabel = getCompletionBlockerNeedLabel(blocker)
        const classPlanHref = getClassPlanBlockerHref(task, blocker)
        const className = "inline-flex min-h-8 items-center rounded-md border bg-background px-2.5 py-1 text-xs font-medium text-foreground shadow-xs transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"

        return classPlanHref ? (
          <a
            key={blocker}
            href={classPlanHref}
            aria-label={`${task.title}: ${blocker} ${needLabel} 수업계획에서 바로 수정`}
            className={className}
          >
            {getCompletionBlockerActionLabel([blocker])}
          </a>
        ) : (
          <button
            key={blocker}
            type="button"
            onClick={() => onSelect(blocker)}
            aria-label={`${task.title}: ${blocker} ${needLabel} 해결하러 가기`}
            className={className}
          >
            {getCompletionBlockerActionLabel([blocker])}
          </button>
        )
      })}
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
  task: CompletionBlockerTaskTarget
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
        const classPlanHref = getClassPlanBlockerHref(task, blocker)
        const chipClassName = [
          "inline-flex min-h-7 items-center rounded-full border bg-background px-2 py-0.5 text-[11px] font-medium transition-colors",
          toneClass,
        ].join(" ")

        return classPlanHref ? (
          <a
            key={`${task.id}-${blocker}`}
            href={classPlanHref}
            aria-label={`${task.title}: ${blocker} ${needLabel} 수업계획에서 바로 수정`}
            className={chipClassName}
          >
            {getCompletionBlockerActionLabel([blocker])}
            {showNeed && <span className="ml-1 text-current/70">{needLabel}</span>}
          </a>
        ) : (
          <button
            key={`${task.id}-${blocker}`}
            type="button"
            onClick={() => onSelect(blocker)}
            aria-label={`${task.title}: ${blocker} ${needLabel} 해결하러 가기`}
            className={chipClassName}
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

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-medium">{value || "-"}</dd>
    </div>
  )
}

function TaskChecklistPanel({
  task,
  items,
  disabled,
  onChecklistItemChange,
}: {
  task: OpsTask
  items: OpsTaskChecklistItem[]
  disabled: boolean
  onChecklistItemChange: (itemId: string, checked: boolean) => void
}) {
  const checklistItems = normalizeTaskChecklistItems(items)
  if (checklistItems.length === 0) return null

  const doneCount = checklistItems.filter((item) => item.checked).length
  return (
    <section aria-label={`${task.title} 체크리스트`} className="grid gap-2 rounded-md border p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">체크리스트</h3>
        <Badge variant="outline" className="rounded px-1.5 text-[11px]">{doneCount}/{checklistItems.length}</Badge>
      </div>
      <div className="grid gap-1.5">
        {checklistItems.map((item) => (
          <label key={item.id} className="flex min-h-8 items-center gap-2 rounded-sm px-1 text-sm hover:bg-muted/50">
            <Checkbox
              checked={item.checked}
              disabled={disabled}
              onCheckedChange={(checked) => onChecklistItemChange(item.id, checked === true)}
              aria-label={`${item.label} 완료`}
            />
            <span className={item.checked ? "text-muted-foreground line-through" : ""}>{item.label}</span>
          </label>
        ))}
      </div>
    </section>
  )
}

function OptionalInfo({ label, value }: { label: string; value?: string | boolean }) {
  if (value === undefined || value === null || value === "" || value === false) return null
  return <Info label={label} value={value === true ? "완료" : String(value)} />
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
          <OptionalInfo label="문의 채널" value={registration.inquiryChannel} />
          <OptionalInfo label="문의일시" value={dateLabel(registration.inquiryAt || "")} />
          <OptionalInfo label="전화상담" value={dateLabel(registration.phoneConsultationAt || "")} />
          <OptionalInfo label="방문상담" value={dateLabel(registration.visitConsultationAt || "")} />
          <OptionalInfo label="상담" value={dateLabel(registration.consultationAt || "")} />
          <OptionalInfo label="상담 담당자" value={registration.counselor} />
          <OptionalInfo label="레벨테스트" value={dateLabel(registration.levelTestAt || "")} />
          <OptionalInfo label="레벨테스트 장소" value={registration.levelTestPlace} />
          <OptionalInfo label="레벨테스트 자료" value={registration.levelTestMaterialLink} />
          <OptionalInfo label="레벨테스트 결과" value={registration.levelTestResult} />
          <OptionalInfo label="원장 분석" value={registration.principalReviewNote} />
          <OptionalInfo label="수업 시작" value={dateInputValue(registration.classStartDate)} />
          <OptionalInfo label="수업 시작회차" value={registration.classStartSession} />
          <OptionalInfo label="요청 사항" value={registration.requestNote} />
        </dl>
        <OperationChecklistSummary
          autoItems={[
            { label: "교재 준비", checked: Boolean(registration.textbookReady) },
          ]}
          manualItems={[
            { label: "원장 반배정", checked: Boolean(registration.principalPlacementChecked) },
            { label: "입학안내문", checked: Boolean(registration.admissionNoticeSent) },
            { label: "수납", checked: Boolean(registration.paymentChecked) },
            { label: "메이크에듀 등록", checked: Boolean(registration.makeeduRegistered) },
            { label: "청구서 발송", checked: Boolean(registration.makeeduInvoiceSent) },
            { label: "교재 청구출고표", checked: Boolean(registration.textbookBillingIssued) },
          ]}
        />
      </div>
    )
  }
  if (task.type === "withdrawal" && task.withdrawal) {
    const withdrawal = task.withdrawal
    return (
      <div className="flex flex-col gap-3">
        <dl className="grid gap-3 rounded-md bg-muted/50 p-3 text-sm md:grid-cols-2">
          <OptionalInfo label="학년" value={withdrawal.schoolGrade} />
          <OptionalInfo label="선생님" value={withdrawal.teacherName} />
          <OptionalInfo label="퇴원일" value={dateInputValue(withdrawal.withdrawalDate)} />
          <OptionalInfo label="퇴원회차" value={withdrawal.withdrawalSession} />
          <OptionalInfo label="진행 수업시수" value={withdrawal.completedLessonHours} />
          <OptionalInfo label="4주 기준 수업시수" value={withdrawal.fourWeekLessonHours} />
          <OptionalInfo label="미배부 교재" value={withdrawal.undistributedTextbooks} />
          <OptionalInfo label="고객 퇴원사유" value={withdrawal.customerReason} />
          <OptionalInfo label="선생님 의견" value={withdrawal.teacherOpinion} />
        </dl>
        <OperationChecklistSummary
          autoItems={[
            { label: "시간표 명단 변경", checked: Boolean(withdrawal.timetableRosterUpdated) },
            { label: "학생 상태 변경", checked: Boolean(withdrawal.studentStatusUpdated) },
          ]}
          manualItems={[
            { label: "메이크에듀 퇴원처리", checked: Boolean(withdrawal.makeeduWithdrawalDone) },
            { label: "수업료 처리", checked: Boolean(withdrawal.feeProcessed) },
            { label: "교재비 처리", checked: Boolean(withdrawal.textbookFeeProcessed) },
          ]}
        />
      </div>
    )
  }
  if (task.type === "transfer" && task.transfer) {
    const transfer = task.transfer
    return (
      <div className="flex flex-col gap-3">
        <dl className="grid gap-3 rounded-md bg-muted/50 p-3 text-sm md:grid-cols-2">
          <OptionalInfo label="전반사유" value={transfer.transferReason} />
          <OptionalInfo label="전 수업" value={transfer.fromClassName} />
          <OptionalInfo label="후 수업" value={transfer.toClassName} />
          <OptionalInfo label="전 선생님" value={transfer.fromTeacherName} />
          <OptionalInfo label="후 선생님" value={transfer.toTeacherName} />
          <OptionalInfo label="전 수업 종료" value={dateInputValue(transfer.fromClassEndDate)} />
          <OptionalInfo label="후 수업 시작" value={dateInputValue(transfer.toClassStartDate)} />
          <OptionalInfo label="전 수업 종료회차" value={transfer.fromClassEndSession} />
          <OptionalInfo label="후 수업 시작회차" value={transfer.toClassStartSession} />
          <OptionalInfo label="전 미배부 교재" value={transfer.fromUndistributedTextbooks} />
          <OptionalInfo label="후 미배부 교재" value={transfer.toUndistributedTextbooks} />
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
        <OptionalInfo label="선생님" value={wordRetest.teacherName} />
        <OptionalInfo label="상태" value={getWordRetestStatusLabel(wordRetest.retestStatus || "")} />
        <OptionalInfo label="응시일시" value={dateLabel(wordRetest.testAt || "")} />
        <OptionalInfo label="교재/단원" value={[wordRetest.textbookName, wordRetest.unit].filter(Boolean).join(" · ")} />
        <OptionalInfo label="요청사항" value={wordRetest.requestNote} />
        <OptionalInfo label="1차 점수" value={wordRetest.firstScore} />
        <OptionalInfo label="2차 점수" value={wordRetest.secondScore} />
        <OptionalInfo label="3차 점수" value={wordRetest.thirdScore} />
      </dl>
    )
  }
  return null
}
