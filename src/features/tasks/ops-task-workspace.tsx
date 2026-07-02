"use client"

import { useSearchParams } from "next/navigation"
import { useCallback, useDeferredValue, useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode, type WheelEvent } from "react"
import { CalendarDays, Check, ChevronLeft, ChevronRight, Clock, FileText, Inbox, Plus, RefreshCw, Search, Trash2, UserRound, X } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Textarea } from "@/components/ui/textarea"
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
  loadOpsTaskById,
  loadOpsTaskWorkspaceData,
  summarizeOpsTasks,
  updateOpsTask,
  updateOpsTaskStatus,
  type OpsTaskAttachment,
  type OpsTaskEvent,
  type OpsClassOption,
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
} from "./ops-task-service"

type WorkspaceKey = "todo" | "registration" | "transfer" | "withdrawal" | "word_retest"
type ViewKey = "all" | "status" | "assignee" | "calendar"
type TodoViewKey = "inbox" | "sent" | "completed"
type TodoSortKey = "status" | "priority" | "due"
type TodoDueFilterKey = "all" | "overdue" | "today" | "upcoming" | "unscheduled"
type TodoSelectFilterKey = "all" | string

type WordRetestMode = "assistant" | "teacher"
type WordRetestBranchFilter = "all" | "본관" | "별관"
type WordRetestSelectFilterKey = "all" | string
type WordRetestScoreDraft = {
  firstScore: string
  secondScore: string
  thirdScore: string
}
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
type QuickAddPreviewItem = { key: string; label: string }
type WordRetestPrimaryAction =
  | { kind: "status"; status: OpsTaskStatus; label: string }
  | { kind: "edit"; label: string; blockers?: string[] }
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
const LINKED_SELECT_SEARCH_THRESHOLD = 12
const LINKED_SELECT_QUERY_OPTION_LIMIT = 50
const LINKED_SELECT_MANUAL_VALUE = "__manual__"
const HORIZONTAL_CHIP_BAR_CLASS = "flex gap-1.5 overflow-x-auto rounded-md border bg-background p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
const HORIZONTAL_MUTED_CHIP_BAR_CLASS = "flex gap-1.5 overflow-x-auto rounded-md bg-muted/45 p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
const HORIZONTAL_TAB_BAR_CLASS = "flex min-w-0 flex-wrap gap-1 overflow-visible sm:flex-nowrap sm:overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
const TODO_TEAM_FILTER_UNASSIGNED = "__unassigned__"
const TODO_TEAM_OPTIONS = ["영어팀", "수학팀", "관리팀", "조교팀"] as const
const TODO_FORM_PRIORITY_ORDER: OpsTaskPriority[] = ["urgent", "high", "normal", "low"]
const TODO_FORM_PRIORITY_OPTIONS = TODO_FORM_PRIORITY_ORDER
  .map((value) => OPS_TASK_PRIORITIES.find((priority) => priority.value === value))
  .filter((priority): priority is (typeof OPS_TASK_PRIORITIES)[number] => Boolean(priority))
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
      { key: "registration_start", label: "수업등록" },
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

function isViewKey(value: string): value is ViewKey {
  return OPERATION_VIEW_TABS.some((tab) => tab.key === value)
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
  return [
    { checked: Boolean(registration?.admissionNoticeSent), label: "입학안내문" },
    { checked: Boolean(registration?.paymentChecked), label: "수납" },
    { checked: Boolean(registration?.makeeduRegistered), label: "메이크에듀 등록" },
    { checked: Boolean(registration?.makeeduInvoiceSent), label: "청구서 발송" },
    { checked: Boolean(registration?.textbookBillingIssued), label: "교재 청구출고표" },
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

function getWordRetestStatusLabel(value?: string) {
  const statusValue = String(value || "not_started").trim() || "not_started"
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

function hasWordRetestScoreDraft(draft: WordRetestScoreDraft) {
  return [draft.firstScore, draft.secondScore, draft.thirdScore].some((score) => Boolean(score.trim()))
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

function sortWordRetestTasksByTestAt(tasks: OpsTask[]) {
  return [...tasks].sort((left, right) => {
    const dateDiff = getWordRetestDateSortValue(left) - getWordRetestDateSortValue(right)
    if (dateDiff !== 0) return dateDiff
    return String(left.createdAt || left.updatedAt).localeCompare(String(right.createdAt || right.updatedAt))
  })
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
    if (!hasNewRegistrationStudent(input)) blockers.push("학생")
    if (hasLinkedRecord(input.studentId) && !findStudentOption(students, input.studentId, indexes)) blockers.push("학생")
    if (!hasLinkedRecord(input.classId)) blockers.push("수업")
    if (hasLinkedRecord(input.classId) && !findClassOption(classes, input.classId, indexes)) blockers.push("수업")
    if (!hasLinkedRecord(input.textbookId)) blockers.push("교재")
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
    if (!hasLinkedRecord(input.studentId)) blockers.push("학생")
    if (hasLinkedRecord(input.studentId) && !findStudentOption(students, input.studentId, indexes)) blockers.push("학생")
    if (!hasLinkedRecord(input.classId)) blockers.push("수업")
    if (hasLinkedRecord(input.classId) && !findClassOption(classes, input.classId, indexes)) blockers.push("수업")
    if (!hasLinkedRecord(wordRetest.teacherId)) blockers.push("선생님")
    if (hasLinkedRecord(wordRetest.teacherId) && !findTeacherOption(teachers, wordRetest.teacherId, indexes)) blockers.push("선생님")
    if (!String(wordRetest.branch || "").trim()) blockers.push("지점")
    if (!hasLinkedRecord(input.textbookId)) blockers.push("교재")
    if (hasLinkedRecord(input.textbookId) && !findTextbookOption(textbooks, input.textbookId, indexes)) blockers.push("교재")
    if (!String(wordRetest.testAt || "").trim()) blockers.push("응시일시")
    if (!String(wordRetest.unit || "").trim()) blockers.push("시험범위")
    if (shouldRequireWordRetestScore(wordRetest)) blockers.push("점수")
  }

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
  "수업": "수업 연결",
  "교재": "교재 연결",
  "전 수업": "전 수업 연결",
  "후 수업": "후 수업 연결",
  "다른 수업": "다른 수업 선택",
  "수업 명단": "수업 명단 확인",
  "전 수업 명단": "전 수업 명단 확인",
  "선생님": "선생님 연결",
  "수업시작일": "수업시작일 지정",
  "퇴원일": "퇴원일 지정",
  "전 수업 종료일": "전 수업 종료일 지정",
  "후 수업 시작일": "후 수업 시작일 지정",
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
  "시험범위": "시험범위 입력",
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
  "입학안내문",
  "수납",
  "메이크에듀 등록",
  "청구서 발송",
  "교재 청구출고표",
  "메이크에듀 퇴원처리",
  "메이크에듀 전반처리",
  "수업료 처리",
  "교재비 처리",
])

const INPUT_COMPLETION_BLOCKERS = new Set([
  "수업시작일",
  "퇴원일",
  "전 수업 종료일",
  "후 수업 시작일",
  "응시일시",
  "시험범위",
  "점수",
])

const CHOICE_COMPLETION_BLOCKERS = new Set(["다른 수업"])

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
    if (blockers.some((blocker) => ["학생"].includes(blocker))) return "registration_contact"
    if (blockers.some((blocker) => ["수업", "교재", "수업시작일"].includes(blocker))) return "registration_start"
    if (blockers.some((blocker) => ["입학안내문", "수납", "메이크에듀 등록", "청구서 발송", "교재 청구출고표"].includes(blocker))) return "registration_checks"
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
    if (blockers.some((blocker) => ["학생", "수업", "선생님", "응시일시", "수업 명단"].includes(blocker))) return "word_retest_basic"
    if (blockers.some((blocker) => ["교재", "시험범위"].includes(blocker))) return "word_retest_scope"
    if (blockers.some((blocker) => ["점수"].includes(blocker))) return "word_retest_scores"
  }

  return null
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
      return "상태 변경"
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

function dateTimeDateInputValue(value?: string) {
  const normalized = dateTimeInputValue(value)
  if (normalized) return normalized.slice(0, 10)
  return toDateKey(value || "")
}

function dateTimeTimeInputValue(value?: string) {
  const normalized = dateTimeInputValue(value)
  return normalized.includes("T") ? normalized.slice(11, 16) : ""
}

function buildLocalDateTimeValue(date: string, time: string) {
  const dateValue = toDateKey(date)
  if (!dateValue) return ""
  return `${dateValue}T${time || "09:00"}`
}

function normalizeTimeInput(value: string) {
  const raw = value.trim()
  const match = raw.match(/^(\d{1,2}):?(\d{2})$/)
  if (!match) return ""
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return ""
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
}

function formatTimeLabel(value: string) {
  const normalized = normalizeTimeInput(value)
  if (!normalized) return "--:--"
  const [hourRaw, minute] = normalized.split(":")
  const hour = Number(hourRaw)
  const period = hour < 12 ? "오전" : "오후"
  const hour12 = hour % 12 || 12
  return `${period} ${hour12}:${minute}`
}

const WORD_RETEST_TIME_OPTIONS = [
  "09:00",
  "09:30",
  "10:00",
  "10:30",
  "11:00",
  "11:30",
  "12:00",
  "12:30",
  "13:00",
  "13:30",
  "14:00",
  "14:30",
  "15:00",
  "15:30",
  "16:00",
  "16:30",
  "17:00",
  "17:30",
  "18:00",
  "18:30",
  "19:00",
  "19:30",
  "20:00",
  "20:30",
  "21:00",
  "21:30",
]

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

function SelectField({
  label,
  value,
  onChange,
  children,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  children: ReactNode
}) {
  const fieldId = useId()

  return (
    <div className="grid min-w-0 gap-1.5 text-sm font-medium">
      <label htmlFor={fieldId}>{label}</label>
      <select
        id={fieldId}
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 w-full min-w-0 rounded-md border bg-background px-3 text-sm shadow-xs outline-none focus:border-ring focus:ring-ring/40 focus:ring-2"
      >
        {children}
      </select>
    </div>
  )
}

type TaskListboxOption = {
  value: string
  label: string
}

const WORD_RETEST_BRANCH_OPTIONS: readonly TaskListboxOption[] = [
  { value: "본관", label: "본관" },
  { value: "별관", label: "별관" },
]

function TaskListboxField({
  label,
  value,
  options,
  onChange,
  emptyClassName = "text-muted-foreground",
}: {
  label: string
  value: string
  options: readonly TaskListboxOption[]
  onChange: (value: string) => void
  emptyClassName?: string
}) {
  const fieldId = useId()
  const listId = useId()
  const [listboxOpen, setListboxOpen] = useState(false)
  const selectedOption = options.find((option) => option.value === value)
  const selectedLabel = selectedOption?.label || options[0]?.label || "선택"

  function handleListboxSelect(nextValue: string) {
    onChange(nextValue)
    setListboxOpen(false)
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
      <label id={fieldId}>{label}</label>
      <button
        type="button"
        aria-labelledby={fieldId}
        aria-haspopup="listbox"
        aria-expanded={listboxOpen}
        aria-controls={listId}
        onClick={() => setListboxOpen((open) => !open)}
        className={[
          "flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-md border bg-background px-3 text-left text-sm shadow-xs outline-none transition",
          listboxOpen ? "border-ring ring-2 ring-ring/40" : "hover:border-foreground/30",
        ].join(" ")}
      >
        <span className={value ? "truncate text-foreground" : `truncate ${emptyClassName}`}>{selectedLabel}</span>
        <ChevronRight className={["size-4 shrink-0 text-muted-foreground transition-transform", listboxOpen ? "rotate-90" : ""].join(" ")} />
      </button>
      {listboxOpen && (
        <div
          id={listId}
          role="listbox"
          aria-labelledby={fieldId}
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-56 overflow-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-lg"
        >
          {options.map((option) => {
            const selected = option.value === value
            return (
              <button
                key={option.value || "__empty_listbox_value__"}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => handleListboxSelect(option.value)}
                className={[
                  "flex w-full items-center justify-between gap-2 rounded px-2.5 py-2 text-left text-sm outline-none transition-colors",
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
  manualLabel,
  onManualSelect,
  renderSelected,
  renderOption,
  listHeader,
}: {
  label: string
  value: string
  options: LinkedSelectOption[]
  onChange: (value: string) => void
  manualLabel?: string
  onManualSelect?: () => void
  renderSelected?: (option: LinkedSelectOption) => ReactNode
  renderOption?: (option: LinkedSelectOption) => ReactNode
  listHeader?: ReactNode
}) {
  const fieldId = useId()
  const queryId = useId()
  const listId = useId()
  const [linkedQuery, setLinkedQuery] = useState("")
  const [isLinkedSearchOpen, setIsLinkedSearchOpen] = useState(false)
  const shouldShowLinkedSearch = options.length > LINKED_SELECT_SEARCH_THRESHOLD
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
  const emptySearchResultLabel = "검색 결과 없음"

  function openLinkedSearch() {
    setIsLinkedSearchOpen(true)
  }

  function toggleLinkedSearch() {
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
      aria-expanded={isLinkedSearchOpen}
      aria-controls={listId}
      onClick={shouldShowLinkedSearch ? openLinkedSearch : toggleLinkedSearch}
      className={[
        "flex min-h-9 w-full min-w-0 items-center justify-between gap-2 rounded-md border bg-background px-3 py-1.5 text-left text-sm shadow-xs outline-none transition hover:border-foreground/30 focus:border-ring focus:ring-ring/40 focus:ring-2",
        isLinkedSearchOpen ? "border-ring ring-2 ring-ring/40" : "",
      ].join(" ")}
    >
      {selectedOption ? (
        <span className="min-w-0 flex-1 overflow-hidden text-foreground">
          {renderSelected ? renderSelected(selectedOption) : <span className="block truncate">{selectedLabel}</span>}
        </span>
      ) : (
        <span className="min-w-0 flex-1 truncate text-muted-foreground">선택</span>
      )}
      {shouldShowLinkedSearch ? (
        <Search className="size-4 shrink-0 text-muted-foreground" />
      ) : (
        <ChevronRight className={["size-4 shrink-0 text-muted-foreground transition-transform", isLinkedSearchOpen ? "rotate-90" : ""].join(" ")} />
      )}
    </button>
  )

  return (
    <Popover open={isLinkedSearchOpen} onOpenChange={setIsLinkedSearchOpen}>
      <div className="relative grid min-w-0 gap-1.5 text-sm font-medium">
        <label id={fieldId}>{label}</label>
        <PopoverAnchor asChild>{linkedSelectControl}</PopoverAnchor>
      </div>
      {isLinkedSearchOpen && (
        <PopoverContent
          id={listId}
          role="listbox"
          aria-labelledby={fieldId}
          align="start"
          side="bottom"
          sideOffset={4}
          collisionPadding={12}
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
            onWheel={handleLinkedListWheel}
          >
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
}: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: string
  placeholder?: string
  inputMode?: "none" | "text" | "tel" | "url" | "email" | "numeric" | "decimal" | "search"
  autoFocus?: boolean
}) {
  const fieldId = useId()
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
        onChange={(event) => handleInputChange(event.target.value)}
        onInput={(event) => handleInputChange(event.currentTarget.value)}
      />
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

function DateTimeField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  const fieldId = useId()
  const popoverId = useId()
  const manualDateInputId = useId()
  const manualTimeInputId = useId()
  const dateValue = dateTimeDateInputValue(value)
  const timeValue = dateTimeTimeInputValue(value)
  const [dateTimeOpen, setDateTimeOpen] = useState(false)
  const [calendarMonth, setCalendarMonth] = useState(() => getCalendarMonthDate(dateValue))
  const [manualDate, setManualDate] = useState(dateValue)
  const [manualTime, setManualTime] = useState(timeValue || "09:00")
  const calendarCells = useMemo(() => buildCalendarDateCells(calendarMonth), [calendarMonth])
  const buttonText = dateValue ? `${dateValue} ${timeValue ? formatTimeLabel(timeValue) : "--:--"}` : "연도. 월. 일.  --:--"

  function syncDraftValues() {
    setCalendarMonth(getCalendarMonthDate(dateValue))
    setManualDate(dateValue)
    setManualTime(timeValue || "09:00")
  }

  function handleDateTimeDateSelect(nextDate: string) {
    const nextTime = timeValue || manualTime || "09:00"
    onChange(buildLocalDateTimeValue(nextDate, nextTime))
    setManualDate(nextDate)
    setCalendarMonth(getCalendarMonthDate(nextDate))
  }

  function handleDateTimeTimeSelect(nextTime: string) {
    const normalized = normalizeTimeInput(nextTime)
    if (!normalized) return
    const nextDate = dateValue || manualDate || toDateKey(new Date())
    onChange(buildLocalDateTimeValue(nextDate, normalized))
    setManualDate(nextDate)
    setManualTime(normalized)
  }

  function applyManualDateTime() {
    const nextDate = toDateKey(manualDate)
    const nextTime = normalizeTimeInput(manualTime)
    if (!nextDate) {
      onChange("")
      setDateTimeOpen(false)
      return
    }
    onChange(buildLocalDateTimeValue(nextDate, nextTime || "09:00"))
    setCalendarMonth(getCalendarMonthDate(nextDate))
    setDateTimeOpen(false)
  }

  function handleManualDateTimeKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault()
      setDateTimeOpen(false)
      syncDraftValues()
      return
    }
    if (event.key !== "Enter") return
    event.preventDefault()
    applyManualDateTime()
  }

  function handleTimeListWheel(event: WheelEvent<HTMLDivElement>) {
    const target = event.currentTarget
    if (target.scrollHeight <= target.clientHeight) return
    const previousScrollTop = target.scrollTop
    target.scrollTop += event.deltaY
    if (target.scrollTop === previousScrollTop) return
    event.preventDefault()
    event.stopPropagation()
  }

  return (
    <Popover open={dateTimeOpen} onOpenChange={(open) => {
      setDateTimeOpen(open)
      if (open) syncDraftValues()
    }}>
      <div className="grid min-w-0 gap-1.5 text-sm font-medium">
        <label id={fieldId}>{label}</label>
        <span className="relative block min-w-0">
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-labelledby={fieldId}
              aria-haspopup="dialog"
              aria-expanded={dateTimeOpen}
              aria-controls={popoverId}
              className={[
                "flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-md border bg-background px-3 text-left text-sm shadow-xs outline-none transition hover:border-foreground/30 focus:border-ring focus:ring-ring/40 focus:ring-2",
                value ? "pr-20" : "",
                dateTimeOpen ? "border-ring ring-2 ring-ring/40" : "",
              ].filter(Boolean).join(" ")}
            >
              <span className={value ? "truncate text-foreground" : "truncate text-muted-foreground"}>{buttonText}</span>
              <span className={["flex shrink-0 items-center gap-1 text-muted-foreground", value ? "mr-7" : ""].join(" ")}>
                <CalendarDays className="size-4" />
                <Clock className="size-4" />
              </span>
            </button>
          </PopoverTrigger>
          {value && (
            <button
              type="button"
              aria-label={`${label} 지우기`}
              onClick={(event) => {
                event.stopPropagation()
                onChange("")
                setManualDate("")
                setManualTime("09:00")
              }}
              className="absolute right-2 top-1/2 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          )}
        </span>
      </div>
      {dateTimeOpen && (
        <PopoverContent
          id={popoverId}
          role="dialog"
          aria-labelledby={fieldId}
          align="start"
          sideOffset={6}
          collisionPadding={12}
          className="z-[120] w-[min(42rem,calc(100vw-1rem))] overflow-hidden p-0"
        >
          <div className="grid gap-0 md:grid-cols-[minmax(0,1fr)_14rem]">
            <div className="border-b md:border-b-0 md:border-r">
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
                  return (
                    <button
                      key={cell.dateKey}
                      type="button"
                      role="gridcell"
                      aria-selected={selected}
                      aria-label={`${cell.dateKey} 선택`}
                      onClick={() => handleDateTimeDateSelect(cell.dateKey)}
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
            </div>
            <div className="grid max-h-72 gap-1 overflow-y-auto overscroll-contain p-2" onWheel={handleTimeListWheel}>
              {WORD_RETEST_TIME_OPTIONS.map((time) => {
                const selected = time === timeValue
                return (
                  <button
                    key={time}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => handleDateTimeTimeSelect(time)}
                    className={[
                      "rounded-md px-2 py-1.5 text-left text-sm font-medium transition focus-visible:ring-2 focus-visible:ring-ring/40",
                      selected ? "bg-primary text-primary-foreground shadow-xs" : "text-foreground hover:bg-muted",
                    ].join(" ")}
                  >
                    {formatTimeLabel(time)}
                  </button>
                )
              })}
            </div>
          </div>
          <div className="grid border-t bg-muted/30 md:grid-cols-[minmax(0,1fr)_14rem]">
            <div className="border-b p-2 md:border-b-0 md:border-r">
              <label htmlFor={manualDateInputId} className="sr-only">직접 날짜 입력</label>
              <Input
                id={manualDateInputId}
                type="text"
                inputMode="numeric"
                value={manualDate}
                placeholder="YYYY-MM-DD"
                className="h-8 min-w-0"
                onChange={(event) => setManualDate(event.target.value)}
                onKeyDown={handleManualDateTimeKeyDown}
              />
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 p-2">
              <label htmlFor={manualTimeInputId} className="sr-only">직접 시간 입력</label>
              <Input
                id={manualTimeInputId}
                type="text"
                inputMode="numeric"
                value={manualTime}
                placeholder="HH:MM"
                className="h-8 min-w-0"
                onChange={(event) => setManualTime(event.target.value)}
                onKeyDown={handleManualDateTimeKeyDown}
              />
              <Button type="button" variant="outline" size="sm" onClick={applyManualDateTime} className="h-8 shrink-0 px-2.5">
                적용
              </Button>
            </div>
          </div>
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

function CheckField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex min-w-0 items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="size-4 accent-primary"
      />
      <span className="min-w-0 truncate">{label}</span>
    </label>
  )
}

function AutoSyncStatusField({ label, checked }: { label: string; checked: boolean }) {
  return (
    <div
      aria-label={`${label} 자동 반영 상태`}
      aria-readonly="true"
      className="flex min-w-0 items-center gap-2 rounded-md border border-dashed bg-muted/40 px-3 py-2 text-sm font-medium text-muted-foreground"
    >
      <span
        className={[
          "grid size-4 shrink-0 place-items-center rounded-full border text-[10px]",
          checked ? "border-primary bg-primary text-primary-foreground" : "bg-background",
        ].join(" ")}
      >
        {checked ? <Check className="size-3" /> : null}
      </span>
      <span className="min-w-0 truncate">{label}</span>
      <span className="ml-auto shrink-0 rounded bg-background px-1.5 py-0.5 text-xs">
        {checked ? "자동 완료" : "자동 대기"}
      </span>
    </div>
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
  if (task.status === "canceled") return { status: "requested", label: "다시 열기" }
  if (task.status === "done") return { status: "requested", label: "다시 열기" }
  if (task.status === "on_hold") return { status: "in_progress", label: "재개" }
  if (task.status === "requested") return { status: "confirmed", label: "확인" }
  if (task.status === "confirmed") return { status: "in_progress", label: "진행" }
  if (task.status === "in_progress") return { status: "review_requested", label: "검토 요청" }
  if (task.status === "review_requested") return { status: "done", label: "완료" }
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

function getWordRetestPrimaryAction(task: OpsTask, mode: WordRetestMode, completionBlockers: string[] = EMPTY_COMPLETION_BLOCKERS): WordRetestPrimaryAction | null {
  if (getWordRetestWorkspaceRole(task) === "completed") return null

  const wordRetest = task.wordRetest || {}
  const absent = isWordRetestAbsent(wordRetest)

  if (mode === "assistant") {
    if (task.status === "requested" || task.status === "confirmed" || task.status === "on_hold") {
      return { kind: "status", status: "in_progress", label: "시험 시작" }
    }
    if (task.status === "in_progress") {
      if (absent || hasWordRetestScore(wordRetest)) return { kind: "status", status: "review_requested", label: "검토 요청" }
      return { kind: "edit", label: "점수 입력", blockers: ["점수"] }
    }
  }

  if (mode === "teacher" && task.status === "review_requested") {
    if (absent) return { kind: "edit", label: "응시일시 변경", blockers: ["응시일시"] }
    if (completionBlockers.length > 0) {
      return { kind: "edit", label: getCompletionBlockerActionLabel(completionBlockers), blockers: completionBlockers }
    }
    return { kind: "status", status: "done", label: "완료 확인" }
  }

  return null
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

export function OpsTaskWorkspace({ workspace = "todo" }: { workspace?: WorkspaceKey }) {
  const scopedTaskType = WORKSPACE_TASK_TYPE[workspace]
  const isTodoWorkspace = workspace === "todo"
  const isRegistrationWorkspace = workspace === "registration"
  const isWordRetestWorkspace = workspace === "word_retest"
  const workspaceLoadOptions = {
    taskType: scopedTaskType,
    includeManagementOptions: !isTodoWorkspace,
  }
  const initialWorkspaceData = getCachedOpsTaskWorkspaceData(workspaceLoadOptions)
  const searchParams = useSearchParams()
  const { user, canManageAll, isAdmin, isStaff, isTeacher } = useAuth()
  const [data, setData] = useState<OpsTaskWorkspaceData | null>(() => initialWorkspaceData)
  const [loading, setLoading] = useState(() => !initialWorkspaceData)
  const [view, setView] = useState<ViewKey>("all")
  const [todoView, setTodoView] = useState<TodoViewKey>("inbox")
  const [todoSort, setTodoSort] = useState<TodoSortKey>("due")
  const [requestedByFilter, setRequestedByFilter] = useState<TodoSelectFilterKey>("all")
  const [requestedTeamFilter, setRequestedTeamFilter] = useState<TodoSelectFilterKey>("all")
  const [assigneeFilter, setAssigneeFilter] = useState<TodoSelectFilterKey>("all")
  const [assigneeTeamFilter, setAssigneeTeamFilter] = useState<TodoSelectFilterKey>("all")
  const [taskFocus, setTaskFocus] = useState<TaskFocus>("none")
  const [registrationPipeline, setRegistrationPipeline] = useState(REGISTRATION_PIPELINE_ALL)
  const [query, setQuery] = useState("")
  const [quickAddText, setQuickAddText] = useState("")
  const [showClosed, setShowClosed] = useState(false)
  const [wordRetestMode, setWordRetestMode] = useState<WordRetestMode>("assistant")
  const [wordRetestBranchFilter, setWordRetestBranchFilter] = useState<WordRetestBranchFilter>("all")
  const [wordRetestTeacherFilter, setWordRetestTeacherFilter] = useState<WordRetestSelectFilterKey>("all")
  const [wordRetestClassFilter, setWordRetestClassFilter] = useState<WordRetestSelectFilterKey>("all")
  const [wordRetestScoreDrafts, setWordRetestScoreDrafts] = useState<Record<string, WordRetestScoreDraft>>({})
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
  const [confirmingFormClose, setConfirmingFormClose] = useState(false)
  const [notice, setNotice] = useState("")
  const [commentBody, setCommentBody] = useState("")
  const [attachmentName, setAttachmentName] = useState("")
  const [attachmentLink, setAttachmentLink] = useState("")
  const [deleteTarget, setDeleteTarget] = useState<OpsTask | null>(null)
  const [statusUndo, setStatusUndo] = useState<StatusUndoState | null>(null)
  const formMemoId = useId()
  const attachmentNameId = useId()
  const attachmentLinkId = useId()
  const quickAddInputRef = useRef<HTMLInputElement | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const deferredQuery = useDeferredValue(query)

  const currentUserId = user?.id || ""
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

  const reload = useCallback(async (force = false, showPending = true) => {
    const loadOptions = { taskType: scopedTaskType, includeManagementOptions: !isTodoWorkspace, includeTeacherOptions: true }
    if (showPending && (force || !getCachedOpsTaskWorkspaceData(loadOptions))) setLoading(true)
    const nextData = await loadOpsTaskWorkspaceData({ ...loadOptions, force })
    setData(nextData)
    setLoading(false)
  }, [isTodoWorkspace, scopedTaskType])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    const nextView = searchParams.get("view")
    const nextFocus = searchParams.get("focus")
    const nextWordRetestRole = searchParams.get("role") || ""
    const nextWordRetestBranch = searchParams.get("branch") || ""
    const nextTodoRouteState = isTodoWorkspace ? getTodoRouteState(searchParams) : null
    if (nextTodoRouteState) {
      setTodoView(nextTodoRouteState.list)
      setTodoSort(nextTodoRouteState.sort || (nextTodoRouteState.status ? "status" : "due"))
    } else if (isWordRetestWorkspace) {
      if (isWordRetestModeKey(nextWordRetestRole)) setWordRetestMode(nextWordRetestRole)
      if (isWordRetestBranchFilterKey(nextWordRetestBranch)) setWordRetestBranchFilter(nextWordRetestBranch)
    } else if (!isTodoWorkspace && nextView && isViewKey(nextView)) {
      setView(nextView)
    }
    if (nextFocus && isTaskFocus(nextFocus)) {
      setTaskFocus(nextFocus)
    }
  }, [isTodoWorkspace, isWordRetestWorkspace, searchParams])

  useEffect(() => {
    if (!isWordRetestWorkspace) return
    if (isWordRetestModeKey(searchParams.get("role") || "")) return
    setWordRetestMode(isTeacher && !isStaff ? "teacher" : "assistant")
  }, [isStaff, isTeacher, isWordRetestWorkspace, searchParams])

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
    const searchParams = new URLSearchParams(window.location.search)
    searchParams.set("list", nextView)
    searchParams.delete("view")
    searchParams.delete("focus")
    searchParams.delete("filter")
    const queryString = searchParams.toString()
    window.history.replaceState(null, "", `${window.location.pathname}${queryString ? `?${queryString}` : ""}`)
  }

  const syncWordRetestMode = (nextMode: WordRetestMode) => {
    setWordRetestMode(nextMode)
    setTaskFocus("none")
    const searchParams = new URLSearchParams(window.location.search)
    searchParams.set("role", nextMode)
    searchParams.delete("view")
    searchParams.delete("list")
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
  const profiles = data?.profiles || EMPTY_PROFILE_OPTIONS
  const students = data?.students || EMPTY_STUDENT_OPTIONS
  const classes = data?.classes || EMPTY_CLASS_OPTIONS
  const textbooks = data?.textbooks || EMPTY_TEXTBOOK_OPTIONS
  const teachers = data?.teachers || EMPTY_TEACHER_OPTIONS
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
  const wordRetestRoleContext = useMemo(
    () => (canManageAll || isStaff ? {} : currentUserContext),
    [canManageAll, currentUserContext, isStaff],
  )
  const branchScopedWordRetestTasks = useMemo(() => (
    scopedTasks.filter((task) => wordRetestBranchFilter === "all" || getWordRetestBranch(task) === wordRetestBranchFilter)
  ), [scopedTasks, wordRetestBranchFilter])
  const wordRetestRoleCounts = useMemo(() => {
    const openWordRetests = branchScopedWordRetestTasks.filter((task) => !isClosedOpsTask(task))
    return {
      assistant: openWordRetests.filter((task) => isWordRetestInAssistantQueue(task, wordRetestRoleContext)).length,
      teacher: openWordRetests.filter((task) => isWordRetestInTeacherQueue(task, wordRetestRoleContext)).length,
    }
  }, [branchScopedWordRetestTasks, wordRetestRoleContext])
  const wordRetestFilterSourceTasks = useMemo(() => (
    branchScopedWordRetestTasks.filter((task) => {
      if (!showClosed && !isOpenTask(task)) return false
      if (showClosed && isClosedOpsTask(task)) return true
      if (wordRetestMode === "assistant") return isWordRetestInAssistantQueue(task, wordRetestRoleContext)
      return isWordRetestInTeacherQueue(task, wordRetestRoleContext)
    })
  ), [branchScopedWordRetestTasks, showClosed, wordRetestMode, wordRetestRoleContext])
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
          if (todoView === "inbox") return isOpsTaskInUserInbox(task, currentUserContext) && isOpenTask(task)
          if (todoView === "sent") return isOpsTaskInUserSent(task, currentUserContext) && isOpenTask(task)
          return isClosedOpsTask(task)
        }

        if (!showClosed && !isOpenTask(task)) return false
        if (isRegistrationWorkspace && registrationPipeline !== REGISTRATION_PIPELINE_ALL) {
          if ((task.registration?.pipelineStatus || REGISTRATION_PIPELINE_STATUSES[0]?.value) !== registrationPipeline) return false
        }
        if (taskFocus === "today" && !hasOpsTaskCalendarDate(task, todayKey)) return false
        if (taskFocus === "overdue") {
          if (!hasOpsTaskOverdueCalendarDate(task, todayKey)) return false
        }
	        if (taskFocus === "confirmation" && confirmationByTaskId.get(task.id) !== true) return false
	        if (taskFocus === "mine" && !isOpsTaskAssignedToUser(task, currentUserId, currentUserLabel)) return false
	        if (taskFocus === "unassigned" && task.assigneeId && hasTaskSchedule(task)) return false
	        if (isWordRetestWorkspace) {
	          if (wordRetestBranchFilter !== "all" && getWordRetestBranch(task) !== wordRetestBranchFilter) return false
	          if (!matchesWordRetestFilter(getWordRetestTeacherFilterValue(task), wordRetestTeacherFilter)) return false
	          if (!matchesWordRetestFilter(getWordRetestClassFilterValue(task), wordRetestClassFilter)) return false
	          if (showClosed && isClosedOpsTask(task)) return true
	          if (wordRetestMode === "assistant") return isWordRetestInAssistantQueue(task, wordRetestRoleContext)
	          return isWordRetestInTeacherQueue(task, wordRetestRoleContext)
	        }
	        if (view === "calendar" || view === "all" || view === "status" || view === "assignee") return true
	        return true
      })
      .filter((task) => matchesSearch(task, deferredQuery))
      .filter((task) => !isTodoWorkspace || matchesTodoTeamFilters(task, {
        requestedByFilter,
        requestedTeamFilter,
        assigneeFilter,
        assigneeTeamFilter,
      }))
    if (isWordRetestWorkspace) return sortWordRetestTasksByTestAt(nextTasks)
    if (!isTodoWorkspace) return nextTasks
    if (todoView === "completed") return sortCompletedTodoTasks(nextTasks)
    if (todoSort === "status") return sortOpsTasksByWorkflowStatus(nextTasks, todayKey)
    if (todoSort === "priority") return sortOpsTasksByPriority(nextTasks, todayKey)
    return sortOpsTasksByWorkDate(nextTasks, todayKey)
  }, [assigneeFilter, assigneeTeamFilter, confirmationByTaskId, currentUserContext, currentUserId, currentUserLabel, deferredQuery, isRegistrationWorkspace, isTodoWorkspace, isWordRetestWorkspace, registrationPipeline, requestedByFilter, requestedTeamFilter, scopedTasks, showClosed, taskFocus, todayKey, todoSort, todoView, view, wordRetestBranchFilter, wordRetestClassFilter, wordRetestMode, wordRetestRoleContext, wordRetestTeacherFilter])

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
    wordRetestTeacherFilter !== "all" ||
    wordRetestClassFilter !== "all"
  )
  const isFilteredEmpty = hasQuery || isTodoFilteredEmpty || isWordRetestFilteredEmpty || (!isTodoWorkspace && taskFocus !== "none") || (isRegistrationWorkspace && registrationPipeline !== REGISTRATION_PIPELINE_ALL)
  const showEmptyCreate = !isTodoWorkspace && !loading && !isFilteredEmpty && visibleTasks.length === 0
  const showToolbarCreate = !isTodoWorkspace && !showEmptyCreate
  const canOpenCreate = isTodoWorkspace || !loading
  const createActionDisabled = saving || !canOpenCreate
  const showClosedToggle = !isTodoWorkspace && (todoCounts.completed > 0 || showClosed)
  const hasSearchableScopedTasks = isTodoWorkspace
    ? scopedTasks.length > 0
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
	  const formDetailTabs = useMemo(() => getFormDetailTabs(form.type), [form.type])
	  const isTemplateForm = form.type !== "general"
	  const isWordRetestForm = form.type === "word_retest"
	  const activeFormDetailStep = formDetailTabs.some((tab) => tab.key === formDetailStep)
	    ? formDetailStep
	    : getDefaultFormDetailStep(form.type)
	  const activeFormStepIndex = Math.max(0, formDetailTabs.findIndex((tab) => tab.key === activeFormDetailStep))
	  const previousFormDetailStep = formDetailTabs[activeFormStepIndex - 1]
	  const nextFormDetailStep = formDetailTabs[activeFormStepIndex + 1]
	  const shouldShowFormDetailTabs = isTemplateForm && !isWordRetestForm && formDetailTabs.length > 1
	  const formStepProgressLabel = shouldShowFormDetailTabs ? `${activeFormStepIndex + 1}/${formDetailTabs.length}` : ""
  const previousFormStepLabel = previousFormDetailStep ? `이전: ${previousFormDetailStep.label}` : ""
  const nextFormStepLabel = nextFormDetailStep ? `다음: ${nextFormDetailStep.label}` : ""
  const showTemplateDueAt = isTemplateForm && form.type !== "word_retest"
  const formRequestedAtLabel = dateLabel(editingTask?.createdAt || new Date().toISOString())
  const formRequestedByLabel = profileLabelById.get(form.requestedBy || "") || editingTask?.requestedByLabel || (form.requestedBy === currentUserId ? currentUserLabel : "") || "미지정"
  const formRequestedTeamLabel = form.requestedTeam || editingTask?.requestedTeam || currentUserTaskTeam || "미지정"
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
    const nextForm = cloneForm({
      ...EMPTY_FORM,
      type,
      requestedBy: currentUserId,
      requestedTeam: currentUserTaskTeam,
      assigneeId: defaultAssigneeId,
      assigneeTeam: defaultAssigneeTeam,
      dueAt: defaultDueAt,
      ...wordRetestDefaults,
    })
    blurActiveElementBeforeDialog()
    setEditingTask(null)
    setForm(nextForm)
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
    setMessage(blockers.length > 0 ? getCompletionBlockerActionLabel(blockers) : "")
    setFormCompletionBlockers(blockers)
    setFormCompletionIntent(inferredCompletionIntent)
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

  const updateWordRetestProgressStatus = (value: string) => {
    setMessage("")
    setFormCompletionBlockers([])
    setConfirmingFormClose(false)
    setForm((current) => ({
      ...current,
      wordRetest: {
        ...(current.wordRetest || {}),
        retestStatus: value,
        ...(value === "absent" ? { firstScore: "", secondScore: "", thirdScore: "" } : {}),
      },
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
      const formWithRequesterDefaults: OpsTaskInput = form.type === "general"
        ? {
          ...form,
          title: nextTitle,
          requestedBy: form.requestedBy || editingTask?.requestedBy || currentUserId,
          requestedTeam: form.requestedTeam || editingTask?.requestedTeam || currentUserTaskTeam,
        }
        : { ...form, title: nextTitle }
      const inputWithCompletionIntent = applyFormCompletionIntent(formWithRequesterDefaults, formCompletionIntent)
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
        setMessage(getCompletionBlockerActionLabel(completionBlockers))
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
	      setMessage(getOpsTaskActionErrorMessage(error, "단어 재시험 상태를 바꾸지 못했습니다."))
	    } finally {
	      setSaving(false)
	    }
	  }

	  const markWordRetestAbsent = async (task: OpsTask) => {
	    const wordRetest = task.wordRetest || {}
	    await updateWordRetestFlow(task, {
	      ...formFromTask(task),
	      status: "review_requested",
	      wordRetest: {
	        ...wordRetest,
	        retestStatus: "absent",
	        firstScore: "",
	        secondScore: "",
	        thirdScore: "",
	      },
	    }, "미응시로 담당선생님에게 보냈습니다.")
	  }

	  const requestWordRetestAgain = async (task: OpsTask) => {
	    const wordRetest = task.wordRetest || {}
	    await updateWordRetestFlow(task, {
	      ...formFromTask(task),
	      status: "requested",
	      completedAt: "",
	      wordRetest: {
	        ...wordRetest,
	        retestStatus: "not_started",
	        firstScore: "",
	        secondScore: "",
	        thirdScore: "",
	      },
	    }, "미응시 학생 재시험을 다시 요청했습니다.")
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
	    const hasDraftScore = hasWordRetestScoreDraft(draft)
	    const shouldRequestReview = task.status === "in_progress" && hasDraftScore
	    const nextRetestStatus = hasDraftScore
	      ? "done"
	      : wordRetest.retestStatus === "done" ? "in_progress" : wordRetest.retestStatus || "not_started"

	    await updateWordRetestFlow(task, {
	      ...formFromTask(task),
	      status: shouldRequestReview ? "review_requested" : task.status,
	      wordRetest: {
	        ...wordRetest,
	        ...draft,
	        retestStatus: nextRetestStatus,
	      },
	    }, shouldRequestReview ? "점수를 저장하고 담당선생님에게 검토 요청했습니다." : "점수를 저장했습니다.")
	    setWordRetestScoreDrafts((current) => {
	      const nextDrafts = { ...current }
	      delete nextDrafts[task.id]
	      return nextDrafts
	    })
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
	  const detailWordRetestPrimaryAction = selectedTaskFresh?.type === "word_retest"
	    ? getWordRetestPrimaryAction(selectedTaskFresh, wordRetestMode, completionBlockers)
	    : null
	  const nextActionBlocked = nextAction?.status === "done" && completionBlockers.length > 0
	  const detailPrimaryAction = selectedTaskFresh?.type === "word_retest" ? null : selectedRegistrationAction || nextAction
  const detailPrimaryActionBlocked = selectedRegistrationAction
    ? selectedRegistrationAction.pipelineStatus.startsWith("7.") && completionBlockers.length > 0
    : nextActionBlocked
  const detailBlockedActionLabel = getCompletionBlockerActionLabel(completionBlockers)
  const selectedTaskCanEdit = selectedTaskFresh ? canEditTaskDetails(selectedTaskFresh) : false
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
	          <div className={`${HORIZONTAL_TAB_BAR_CLASS} ${isTodoWorkspace ? "flex-1" : "w-full lg:flex-1"}`} role="tablist" aria-label={isTodoWorkspace ? "할 일 목록" : isWordRetestWorkspace ? "단어 재시험 역할" : `${workspaceLabel} 보기`}>
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
	          <div className="grid gap-2">
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
	            <WordRetestFilterBar
	              options={wordRetestFilterOptions}
	              teacherFilter={wordRetestTeacherFilter}
	              classFilter={wordRetestClassFilter}
	              onTeacherChange={setWordRetestTeacherFilter}
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
	        ) : shouldHideEmptySurface ? null : isWordRetestWorkspace ? (
	          <WordRetestTaskList
	            tasks={visibleTasks}
	            mode={wordRetestMode}
	            onOpen={openDetail}
	            onEdit={openEdit}
	            onStatusChange={(task, status) => void changeStatus(task, status)}
	            onMarkAbsent={(task) => void markWordRetestAbsent(task)}
	            onRetry={(task) => void requestWordRetestAgain(task)}
	            scoreDrafts={wordRetestScoreDrafts}
	            onScoreDraftChange={updateWordRetestScoreDraft}
	            onScoreSave={(task) => void saveWordRetestInlineScores(task)}
	            statusActionDisabled={saving}
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

      <Dialog open={formOpen} onOpenChange={handleFormOpenChange}>
        <DialogContent className={[
          "z-[80] max-h-[calc(100dvh-1rem)] scroll-pb-24 overflow-x-hidden overflow-y-auto overscroll-contain sm:max-h-[92vh]",
          isTemplateForm ? "sm:max-w-3xl" : "sm:min-h-[min(760px,92vh)] sm:max-w-2xl",
        ].join(" ")}>
          <DialogHeader className="-mx-6 -mt-6 border-b px-6 py-4">
            <DialogTitle>{formDialogTitle}</DialogTitle>
            <DialogDescription className="sr-only">
              운영 업무를 입력하고 저장합니다.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitForm} onKeyDown={handleFormKeyDown} className="grid gap-3">
            {message && !isTemplateForm && (
              <div role="alert" className="rounded-md border border-destructive/30 px-3 py-2 text-sm whitespace-pre-line text-destructive">
                {message}
              </div>
            )}

            {form.type === "registration" && editingTask && (
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
	                    {formCompletionBlockers.length > 0 && (
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
	                  onChange={updateWordRetestProgressStatus}
	                />
	                <TypeSpecificFields
	                  step="word_retest_basic"
	                  form={form}
	                  students={data?.students || EMPTY_STUDENT_OPTIONS}
	                  classes={data?.classes || EMPTY_CLASS_OPTIONS}
	                  teachers={data?.teachers || EMPTY_TEACHER_OPTIONS}
	                  textbooks={data?.textbooks || EMPTY_TEXTBOOK_OPTIONS}
	                  updateForm={updateForm}
	                  updateRegistration={updateRegistration}
	                  updateWithdrawal={updateWithdrawal}
	                  updateTransfer={updateTransfer}
	                  updateWordRetest={updateWordRetest}
	                />
	                <TypeSpecificFields
	                  step="word_retest_scope"
	                  form={form}
	                  students={data?.students || EMPTY_STUDENT_OPTIONS}
	                  classes={data?.classes || EMPTY_CLASS_OPTIONS}
	                  teachers={data?.teachers || EMPTY_TEACHER_OPTIONS}
	                  textbooks={data?.textbooks || EMPTY_TEXTBOOK_OPTIONS}
	                  updateForm={updateForm}
	                  updateRegistration={updateRegistration}
	                  updateWithdrawal={updateWithdrawal}
	                  updateTransfer={updateTransfer}
	                  updateWordRetest={updateWordRetest}
	                />
	                {editingTask && (
	                  <TypeSpecificFields
	                    step="word_retest_scores"
	                    form={form}
	                    students={data?.students || EMPTY_STUDENT_OPTIONS}
	                    classes={data?.classes || EMPTY_CLASS_OPTIONS}
	                    teachers={data?.teachers || EMPTY_TEACHER_OPTIONS}
	                    textbooks={data?.textbooks || EMPTY_TEXTBOOK_OPTIONS}
	                    updateForm={updateForm}
	                    updateRegistration={updateRegistration}
	                    updateWithdrawal={updateWithdrawal}
	                    updateTransfer={updateTransfer}
	                    updateWordRetest={updateWordRetest}
	                  />
	                )}
	              </section>
	            )}

	            {isTemplateForm && !isWordRetestForm && formDetailTabs.length > 0 && (
	              <section className="grid gap-3 rounded-lg border p-3">
	                {formStepProgressLabel && (
	                  <div className="flex items-center justify-between gap-2 px-1 text-xs font-medium text-muted-foreground">
                    <span>{getTaskTypeLabel(form.type)}</span>
                    <span>{formStepProgressLabel}</span>
                  </div>
                )}
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
                {message && (
                  <div role="alert" className="rounded-md border border-destructive/30 whitespace-pre-line bg-background px-3 py-2 text-sm text-destructive">
                    <span>{message}</span>
                    {formCompletionBlockers.length > 0 && (
                      <span className="mt-2 flex flex-wrap gap-1">
                        {formCompletionBlockers.map((blocker) => (
                          <button
                            key={blocker}
                            type="button"
                            onClick={() => setFormDetailStep(getCompletionBlockerFormStep(form.type, [blocker]) || activeFormDetailStep)}
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
                  students={data?.students || EMPTY_STUDENT_OPTIONS}
                  classes={data?.classes || EMPTY_CLASS_OPTIONS}
                  teachers={data?.teachers || EMPTY_TEACHER_OPTIONS}
                  textbooks={data?.textbooks || EMPTY_TEXTBOOK_OPTIONS}
                  updateForm={updateForm}
                  updateRegistration={updateRegistration}
                  updateWithdrawal={updateWithdrawal}
                  updateTransfer={updateTransfer}
                  updateWordRetest={updateWordRetest}
                />
              </section>
            )}

            {isTemplateForm && !isWordRetestForm && (
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
            <div className={[
              "-mx-6 -mb-6 flex flex-col gap-2 border-t bg-background px-6 py-4 sm:flex-row sm:items-center sm:justify-end",
            ].filter(Boolean).join(" ")}>
              {formCompletionBlockers.length > 0 && (
                (() => {
                  const firstBlocker = formCompletionBlockers[0]
                  return (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setFormDetailStep(getCompletionBlockerFormStep(form.type, [firstBlocker]) || activeFormDetailStep)}
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
              <Button type="button" variant={confirmingFormClose ? "destructive" : "outline"} onClick={confirmingFormClose ? discardFormAndClose : closeForm} className="w-full sm:w-auto">
                {confirmingFormClose ? "저장하지 않고 닫기" : "닫기"}
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
                {selectedTaskFresh.type === "general" ? (
                  <GeneralTaskDetailPanel task={selectedTaskFresh} />
                ) : selectedTaskFresh.type === "word_retest" ? (
                  <WordRetestDetailPanel task={selectedTaskFresh} />
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
                <CompletionBlockerActionPanel
                  task={selectedTaskFresh}
                  blockers={completionBlockers}
                  onSelect={(blocker) => openEdit(selectedTaskFresh, [blocker])}
                />
                {selectedTaskFresh.type !== "general" && selectedTaskFresh.type !== "word_retest" && <TypeDetail task={selectedTaskFresh} />}
                {selectedTaskFresh.type !== "general" && <AutoSyncResultSummary task={selectedTaskFresh} />}
	                {selectedTaskFresh.type !== "general" && selectedTaskFresh.type !== "word_retest" && selectedTaskFresh.memo && <p className="rounded-md bg-muted p-3 text-sm">{selectedTaskFresh.memo}</p>}
	                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
	                  {selectedTaskFresh.type === "word_retest" && (
	                    <>
	                      <WordRetestRoleActionButton
	                        task={selectedTaskFresh}
	                        action={detailWordRetestPrimaryAction}
	                        onEdit={openEdit}
	                        onStatusChange={(task, status) => void changeStatus(task, status)}
	                        disabled={saving}
	                      />
	                      {wordRetestMode === "assistant" && selectedTaskFresh.status === "in_progress" && !isWordRetestAbsent(selectedTaskFresh.wordRetest) && (
	                        <Button type="button" variant="outline" size="sm" onClick={() => void markWordRetestAbsent(selectedTaskFresh)} disabled={saving} className="w-full sm:w-auto">
	                          미응시
	                        </Button>
	                      )}
	                      {wordRetestMode === "teacher" && selectedTaskFresh.status === "review_requested" && isWordRetestAbsent(selectedTaskFresh.wordRetest) && (
	                        <Button type="button" variant="default" size="sm" onClick={() => void requestWordRetestAgain(selectedTaskFresh)} disabled={saving} className="w-full sm:w-auto">
	                          미응시 재요청
	                        </Button>
	                      )}
	                    </>
	                  )}
	                  {detailPrimaryAction && (
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
  updateForm,
  updateRegistration,
  updateWithdrawal,
  updateTransfer,
  updateWordRetest,
}: {
  step: FormDetailStepKey
  form: OpsTaskInput
  students: OpsStudentOption[]
  classes: OpsClassOption[]
  teachers: OpsTeacherOption[]
  textbooks: OpsTextbookOption[]
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
  const selectedWordRetestTeacher = form.type === "word_retest" ? findTeacher(selectedWordRetestTeacherId) : undefined
  const wordRetestStudentOptions = getWordRetestStudentOptions(students, selectedWordRetestClass, form.studentId || "")
  const wordRetestClassOptions = getWordRetestClassOptions(classes, selectedWordRetestStudent, selectedWordRetestClassId, selectedWordRetestTeacher)
  const wordRetestTeacherOptions = getWordRetestTeacherOptions(teachers, selectedWordRetestTeacherId)
  const [manualLinkedFields, setManualLinkedFields] = useState<Record<string, boolean>>({})
  const [wordRetestTextbookGradeFilter, setWordRetestTextbookGradeFilter] = useState("all")
  const wordRetestTextbookGradeFilters = useMemo(() => getWordRetestTextbookGradeFilters(textbooks), [textbooks])
  const wordRetestTextbookOptions = useMemo(() => getWordRetestTextbookOptions(
    textbooks,
    form.textbookId || "",
    wordRetestTextbookGradeFilter,
  ), [form.textbookId, textbooks, wordRetestTextbookGradeFilter])

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

  function findClassBranch(classItem: OpsClassOption) {
    const roomText = `${classItem.room || ""} ${classItem.meta || ""}`
    if (roomText.includes("별관")) return "별관"
    if (roomText.includes("본관")) return "본관"
    return ""
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

  const selectClass = (classId: string, options: { fillRegistration?: boolean; fillTransferFrom?: boolean; fillTransferTo?: boolean; fillWordRetest?: boolean; fillWithdrawal?: boolean } = {}) => {
    const classItem = findClass(classId)
    updateForm("classId", classId)
    if (!classId) {
      updateForm("className", "")
      if (options.fillWordRetest) updateWordRetest("className", "")
      if (options.fillTransferFrom) updateTransfer("fromClassName", "")
      if (options.fillTransferTo) updateTransfer("toClassName", "")
      return
    }
    if (!classItem) return

    updateForm("className", classItem.label)
    updateForm("subject", classItem.subject)
    const textbookId = findClassPrimaryTextbook(classItem)
    const primaryTextbook = textbookId ? findTextbook(textbookId) : undefined
    const shouldUsePrimaryTextbook = Boolean(primaryTextbook && (form.type !== "word_retest" || isWordRetestTextbookOption(primaryTextbook)))
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
    if (options.fillWithdrawal && classItem.teacher) {
      updateWithdrawal("schoolGrade", withdrawal.schoolGrade || classItem.grade)
      updateWithdrawal("teacherName", withdrawal.teacherName || classItem.teacher)
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
    if (step === "registration_contact") {
      return (
        <section className="grid gap-3">
          <div className="grid gap-3 md:grid-cols-3">
            <SelectField label="문의 채널" value={registration.inquiryChannel || ""} onChange={(value) => updateRegistration("inquiryChannel", value)}>
              <option value="">미지정</option>
              {["전화", "채널톡", "선생님 전화", "바로 방문", "인스타"].map((item) => <option key={item} value={item}>{item}</option>)}
            </SelectField>
            <TextField label="문의일시" type="datetime-local" value={dateTimeInputValue(registration.inquiryAt)} onChange={(value) => updateRegistration("inquiryAt", value)} />
            <TextField label="학생명" value={form.studentName || ""} autoFocus onChange={(value) => updateForm("studentName", value)} />
            <TextField label="학년" value={registration.schoolGrade || ""} onChange={(value) => updateRegistration("schoolGrade", value)} />
            <TextField label="학교" value={registration.schoolName || ""} onChange={(value) => updateRegistration("schoolName", value)} />
            <TextField label="학부모 전화" value={registration.parentPhone || ""} inputMode="tel" onChange={(value) => updateRegistration("parentPhone", value)} />
            <TextField label="학생 전화" value={registration.studentPhone || ""} inputMode="tel" onChange={(value) => updateRegistration("studentPhone", value)} />
            <LinkedSelect
              label="기존 학생 연결"
              value={form.studentId || ""}
              options={students}
              onChange={(value) => {
                if (value) {
                  selectStudent(value, { fillRegistration: true })
                  return
                }
                updateForm("studentId", "")
              }}
            />
          </div>
        </section>
      )
    }

    if (step === "registration_test") {
      return (
        <section className="grid gap-3">
          <div className="grid gap-3 md:grid-cols-3">
            <TextField label="전화상담일시" type="datetime-local" value={dateTimeInputValue(registration.phoneConsultationAt)} onChange={(value) => updateRegistration("phoneConsultationAt", value)} />
            <TextField label="방문상담일시" type="datetime-local" value={dateTimeInputValue(registration.visitConsultationAt)} onChange={(value) => updateRegistration("visitConsultationAt", value)} />
            <TextField label="상담일시" type="datetime-local" value={dateTimeInputValue(registration.consultationAt)} onChange={(value) => updateRegistration("consultationAt", value)} />
            <TextField label="상담 담당자" value={registration.counselor || ""} onChange={(value) => updateRegistration("counselor", value)} />
            <TextField label="레벨테스트 일시" type="datetime-local" value={dateTimeInputValue(registration.levelTestAt)} onChange={(value) => updateRegistration("levelTestAt", value)} />
            <SelectField label="레벨테스트 장소" value={registration.levelTestPlace || ""} onChange={(value) => updateRegistration("levelTestPlace", value)}>
              <option value="">미지정</option>
              <option value="본관">본관</option>
              <option value="별관">별관</option>
            </SelectField>
          </div>
          <TextField label="레벨테스트 자료 Drive 링크" value={registration.levelTestMaterialLink || ""} inputMode="url" onChange={(value) => updateRegistration("levelTestMaterialLink", value)} />
        </section>
      )
    }

    if (step === "registration_start") {
      return (
        <section className="grid gap-3">
          <div className="grid gap-3 md:grid-cols-2">
            <LinkedSelect label="수업" value={form.classId || ""} options={classes} onChange={(value) => selectClass(value, { fillRegistration: true })} onManualSelect={() => openManualField("registrationClass")} />
            <LinkedSelect label="교재" value={form.textbookId || ""} options={textbooks} onChange={(value) => selectTextbook(value)} onManualSelect={() => openManualField("registrationTextbook")} />
            {shouldShowManualField("registrationClass", form.classId, form.className) && <TextField label="수업명" value={form.className || ""} onChange={(value) => updateForm("className", value)} />}
            {shouldShowManualField("registrationTextbook", form.textbookId, form.textbookTitle) && <TextField label="교재명" value={form.textbookTitle || ""} onChange={(value) => updateForm("textbookTitle", value)} />}
            <TextField label="수업시작일" type="date" value={dateInputValue(registration.classStartDate)} onChange={(value) => updateRegistration("classStartDate", value)} />
            <TextField label="수업시작회차" value={registration.classStartSession || ""} onChange={(value) => updateRegistration("classStartSession", value)} />
          </div>
          <TextField label="요청 사항" value={registration.requestNote || ""} onChange={(value) => updateRegistration("requestNote", value)} />
        </section>
      )
    }

    if (step === "registration_checks") {
      return (
        <section className="grid gap-2 md:grid-cols-3">
          <AutoSyncStatusField label="교재 준비" checked={Boolean(registration.textbookReady)} />
          <CheckField label="입학안내문" checked={Boolean(registration.admissionNoticeSent)} onChange={(value) => updateRegistration("admissionNoticeSent", value)} />
          <CheckField label="수납" checked={Boolean(registration.paymentChecked)} onChange={(value) => updateRegistration("paymentChecked", value)} />
          <CheckField label="메이크에듀 등록" checked={Boolean(registration.makeeduRegistered)} onChange={(value) => updateRegistration("makeeduRegistered", value)} />
          <CheckField label="청구서 발송" checked={Boolean(registration.makeeduInvoiceSent)} onChange={(value) => updateRegistration("makeeduInvoiceSent", value)} />
          <CheckField label="교재 청구출고표" checked={Boolean(registration.textbookBillingIssued)} onChange={(value) => updateRegistration("textbookBillingIssued", value)} />
        </section>
      )
    }

    return null
  }

  if (form.type === "withdrawal") {
    if (step === "withdrawal_basic") {
      return (
        <div className="grid gap-3 md:grid-cols-3">
          <LinkedSelect label="학생" value={form.studentId || ""} options={students} onChange={(value) => selectStudent(value, { fillWithdrawalClass: true })} onManualSelect={() => openManualField("withdrawalStudent")} />
          <LinkedSelect label="수업" value={form.classId || ""} options={classes} onChange={(value) => selectClass(value, { fillWithdrawal: true })} onManualSelect={() => openManualField("withdrawalClass")} />
          {shouldShowManualField("withdrawalStudent", form.studentId, form.studentName) && <TextField label="학생명" value={form.studentName || ""} autoFocus onChange={(value) => updateForm("studentName", value)} />}
          {shouldShowManualField("withdrawalClass", form.classId, form.className) && <TextField label="수업명" value={form.className || ""} onChange={(value) => updateForm("className", value)} />}
          <TextField label="학년" value={withdrawal.schoolGrade || ""} onChange={(value) => updateWithdrawal("schoolGrade", value)} />
          <TextField label="선생님" value={withdrawal.teacherName || ""} onChange={(value) => updateWithdrawal("teacherName", value)} />
          <TextField label="퇴원일" type="date" value={dateInputValue(withdrawal.withdrawalDate)} onChange={(value) => updateWithdrawal("withdrawalDate", value)} />
          <TextField label="퇴원회차" value={withdrawal.withdrawalSession || ""} onChange={(value) => updateWithdrawal("withdrawalSession", value)} />
          <TextField label="진행 수업시수" value={withdrawal.completedLessonHours || ""} inputMode="decimal" onChange={(value) => updateWithdrawal("completedLessonHours", value)} />
          <TextField label="4주 기준 수업시수" value={withdrawal.fourWeekLessonHours || ""} inputMode="decimal" onChange={(value) => updateWithdrawal("fourWeekLessonHours", value)} />
        </div>
      )
    }

    if (step === "withdrawal_reason") {
      return (
        <section className="grid gap-3">
        <TextField label="고객 퇴원사유" value={withdrawal.customerReason || ""} onChange={(value) => updateWithdrawal("customerReason", value)} />
        <TextField label="선생님 의견" value={withdrawal.teacherOpinion || ""} onChange={(value) => updateWithdrawal("teacherOpinion", value)} />
        <TextField label="미배부 교재" value={withdrawal.undistributedTextbooks || ""} onChange={(value) => updateWithdrawal("undistributedTextbooks", value)} />
        </section>
      )
    }

    if (step === "withdrawal_checks") {
      return (
        <div className="grid gap-2 md:grid-cols-4">
          <AutoSyncStatusField label="시간표 명단 변경" checked={Boolean(withdrawal.timetableRosterUpdated)} />
          <CheckField label="메이크에듀 퇴원처리" checked={Boolean(withdrawal.makeeduWithdrawalDone)} onChange={(value) => updateWithdrawal("makeeduWithdrawalDone", value)} />
          <CheckField label="수업료 처리" checked={Boolean(withdrawal.feeProcessed)} onChange={(value) => updateWithdrawal("feeProcessed", value)} />
          <CheckField label="교재비 처리" checked={Boolean(withdrawal.textbookFeeProcessed)} onChange={(value) => updateWithdrawal("textbookFeeProcessed", value)} />
        </div>
      )
    }

    return null
  }

  if (form.type === "transfer") {
    if (step === "transfer_basic") {
      return (
        <div className="grid gap-3 md:grid-cols-2">
          <LinkedSelect label="학생" value={form.studentId || ""} options={students} onChange={(value) => selectStudent(value, { fillTransferFromClass: true })} onManualSelect={() => openManualField("transferStudent")} />
          {shouldShowManualField("transferStudent", form.studentId, form.studentName) && <TextField label="학생명" value={form.studentName || ""} autoFocus onChange={(value) => updateForm("studentName", value)} />}
          <TextField label="전반사유" value={transfer.transferReason || ""} onChange={(value) => updateTransfer("transferReason", value)} />
          <TextField label="전 선생님" value={transfer.fromTeacherName || ""} onChange={(value) => updateTransfer("fromTeacherName", value)} />
          <TextField label="후 선생님" value={transfer.toTeacherName || ""} onChange={(value) => updateTransfer("toTeacherName", value)} />
        </div>
      )
    }

    if (step === "transfer_schedule") {
      return (
        <div className="grid gap-3 md:grid-cols-2">
          <LinkedSelect label="전 수업" value={transfer.fromClassId || ""} options={classes} onChange={(value) => selectClass(value, { fillTransferFrom: true })} onManualSelect={() => openManualField("transferFromClass")} />
          <LinkedSelect label="후 수업" value={transfer.toClassId || form.classId || ""} options={classes} onChange={(value) => selectClass(value, { fillTransferTo: true })} onManualSelect={() => openManualField("transferToClass")} />
          {shouldShowManualField("transferFromClass", transfer.fromClassId, transfer.fromClassName) && <TextField label="전 수업명" value={transfer.fromClassName || ""} onChange={(value) => updateTransfer("fromClassName", value)} />}
          {shouldShowManualField("transferToClass", transfer.toClassId || form.classId, transfer.toClassName) && <TextField label="후 수업명" value={transfer.toClassName || ""} onChange={(value) => updateTransfer("toClassName", value)} />}
          <TextField label="전 수업 종료일" type="date" value={dateInputValue(transfer.fromClassEndDate)} onChange={(value) => updateTransfer("fromClassEndDate", value)} />
          <TextField label="후 수업 시작일" type="date" value={dateInputValue(transfer.toClassStartDate)} onChange={(value) => updateTransfer("toClassStartDate", value)} />
          <TextField label="전 수업 종료회차" value={transfer.fromClassEndSession || ""} onChange={(value) => updateTransfer("fromClassEndSession", value)} />
          <TextField label="후 수업 시작회차" value={transfer.toClassStartSession || ""} onChange={(value) => updateTransfer("toClassStartSession", value)} />
        </div>
      )
    }

    if (step === "transfer_checks") {
      return (
        <section className="grid gap-3">
        <TextField label="전 미배부 교재" value={transfer.fromUndistributedTextbooks || ""} onChange={(value) => updateTransfer("fromUndistributedTextbooks", value)} />
        <TextField label="후 미배부 교재" value={transfer.toUndistributedTextbooks || ""} onChange={(value) => updateTransfer("toUndistributedTextbooks", value)} />
        <div className="grid gap-2 md:grid-cols-4">
          <AutoSyncStatusField label="시간표 명단 변경" checked={Boolean(transfer.timetableRosterUpdated)} />
          <CheckField label="메이크에듀 전반처리" checked={Boolean(transfer.makeeduTransferDone)} onChange={(value) => updateTransfer("makeeduTransferDone", value)} />
          <CheckField label="수업료 처리" checked={Boolean(transfer.feeProcessed)} onChange={(value) => updateTransfer("feeProcessed", value)} />
          <CheckField label="교재비 처리" checked={Boolean(transfer.textbookFeeProcessed)} onChange={(value) => updateTransfer("textbookFeeProcessed", value)} />
        </div>
        </section>
      )
    }

    return null
  }

  if (form.type === "word_retest") {
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
            <LinkedSelect
              label="학생"
              value={form.studentId || ""}
              options={wordRetestStudentOptions}
              onChange={(value) => selectStudent(value, { fillWordRetest: true, fillWordRetestClass: true })}
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
            <DateTimeField label="응시일시" value={wordRetest.testAt || ""} onChange={(value) => updateWordRetest("testAt", value)} />
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
          <TextField label="메모" value={wordRetest.requestNote || ""} onChange={(value) => updateWordRetest("requestNote", value)} />
        </div>
      )
    }

    if (step === "word_retest_scores") {
      return (
        <div className="grid gap-3 md:grid-cols-3">
          {wordRetestAbsent ? (
            <div className="flex min-h-10 items-center rounded-md border bg-muted/40 px-3 text-sm font-medium text-muted-foreground md:col-span-3">
              점수 없음
            </div>
          ) : (
            <>
              <TextField label="1차 점수" value={wordRetest.firstScore || ""} inputMode="numeric" onChange={(value) => updateWordRetest("firstScore", value)} />
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

function WordRetestStatusBadge({ value }: { value?: string }) {
  const statusValue = String(value || "not_started").trim() || "not_started"
  const toneClass = statusValue === "done"
    ? "border-primary/25 bg-primary/10 text-primary"
    : statusValue === "absent"
      ? "border-destructive/25 bg-destructive/10 text-destructive"
      : statusValue === "in_progress"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : "border-muted-foreground/20 bg-muted/50 text-muted-foreground"

  return (
    <span className={["inline-flex h-7 items-center rounded-full border px-2.5 text-xs font-semibold", toneClass].join(" ")}>
      {getWordRetestStatusLabel(statusValue)}
    </span>
  )
}

function WordRetestProgressStepper({
  value,
  onChange,
  readOnly = false,
}: {
  value?: string
  onChange?: (value: string) => void
  readOnly?: boolean
}) {
  const currentValue = String(value || "not_started").trim() || "not_started"

  return (
    <div className="grid gap-2" aria-label="진행상태">
      <div className="flex items-center justify-between gap-2 px-1 text-xs font-medium text-muted-foreground">
        <span>진행상태</span>
        <span>{getWordRetestStatusLabel(currentValue)}</span>
      </div>
      <div className="grid gap-1.5 sm:grid-cols-4" role="group" aria-label="단어 재시험 진행상태">
        {WORD_RETEST_STATUSES.map((status, index) => {
          const active = status.value === currentValue
          return (
            <button
              key={status.value}
              type="button"
              aria-pressed={active}
              aria-disabled={readOnly}
              disabled={readOnly}
              onClick={() => onChange?.(status.value)}
              className={[
                "flex min-h-10 items-center gap-2 rounded-md border px-2.5 py-2 text-left text-sm font-medium transition",
                active ? "border-primary/45 bg-primary/10 text-primary shadow-xs" : "bg-background text-muted-foreground hover:border-primary/35 hover:text-foreground",
                readOnly ? "cursor-default hover:border-border hover:text-muted-foreground" : "",
              ].join(" ")}
            >
              <span className={[
                "grid size-5 shrink-0 place-items-center rounded-full border text-[11px]",
                active ? "border-primary bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
              ].join(" ")}>
                {index + 1}
              </span>
              <span className="truncate">{status.label}</span>
            </button>
          )
        })}
      </div>
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
  onMarkAbsent,
  onRetry,
  scoreDrafts,
  onScoreDraftChange,
  onScoreSave,
  statusActionDisabled = false,
  onCreate,
  emptyLabel = "단어 재시험 없음",
  emptyActionLabel = "단어 재시험 추가",
  showEmptyAction = true,
  completionBlockersByTaskId = EMPTY_COMPLETION_BLOCKERS_BY_TASK_ID,
}: {
  tasks: OpsTask[]
  mode: WordRetestMode
  onOpen: (task: OpsTask) => void
  onEdit: (task: OpsTask, blockers?: string[]) => void
  onStatusChange: (task: OpsTask, status: OpsTaskStatus) => void
  onMarkAbsent: (task: OpsTask) => void
  onRetry: (task: OpsTask) => void
  scoreDrafts: Record<string, WordRetestScoreDraft>
  onScoreDraftChange: (task: OpsTask, key: keyof WordRetestScoreDraft, value: string) => void
  onScoreSave: (task: OpsTask) => void
  statusActionDisabled?: boolean
  onCreate: () => void
  emptyLabel?: string
  emptyActionLabel?: string
  showEmptyAction?: boolean
  completionBlockersByTaskId?: OperationCompletionBlockerMap
}) {
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
    <div className="overflow-hidden rounded-md border">
      <div className="hidden border-b bg-muted/50 px-3 py-2 text-xs font-medium text-muted-foreground md:grid md:grid-cols-[132px_minmax(96px,0.8fr)_minmax(150px,1.1fr)_minmax(96px,0.75fr)_minmax(220px,1.35fr)_92px_150px] md:items-center md:gap-3">
        <span>응시일시</span>
        <span>학생</span>
        <span>교재</span>
        <span>시험범위</span>
        <span>점수</span>
        <span>상태</span>
        <span className="text-right">다음 액션</span>
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
          onMarkAbsent={onMarkAbsent}
          onRetry={onRetry}
          scoreDraft={scoreDrafts[task.id] || getWordRetestScoreDraft(task)}
          onScoreDraftChange={onScoreDraftChange}
          onScoreSave={onScoreSave}
          statusActionDisabled={statusActionDisabled}
        />
      ))}
    </div>
  )
}

function WordRetestTaskRow({
  task,
  mode,
  completionBlockers,
  onOpen,
  onEdit,
  onStatusChange,
  onMarkAbsent,
  onRetry,
  scoreDraft,
  onScoreDraftChange,
  onScoreSave,
  statusActionDisabled,
}: {
  task: OpsTask
  mode: WordRetestMode
  completionBlockers: string[]
  onOpen: (task: OpsTask) => void
  onEdit: (task: OpsTask, blockers?: string[]) => void
  onStatusChange: (task: OpsTask, status: OpsTaskStatus) => void
  onMarkAbsent: (task: OpsTask) => void
  onRetry: (task: OpsTask) => void
  scoreDraft: WordRetestScoreDraft
  onScoreDraftChange: (task: OpsTask, key: keyof WordRetestScoreDraft, value: string) => void
  onScoreSave: (task: OpsTask) => void
  statusActionDisabled: boolean
}) {
  const wordRetest = task.wordRetest || {}
  const primaryAction = getWordRetestPrimaryAction(task, mode, completionBlockers)
  const branch = getWordRetestBranch(task)
  const studentLabel = getWordRetestStudentLabel(task)
  const textbookLabel = getWordRetestTextbookLabel(task)
  const unitLabel = getWordRetestUnitLabel(task)
  const absent = isWordRetestAbsent(wordRetest)
  const canMarkAbsent = mode === "assistant" && task.status === "in_progress" && !absent
  const canRetryAbsent = mode === "teacher" && task.status === "review_requested" && absent

  return (
    <div className="grid gap-2 border-b px-3 py-3 text-sm last:border-b-0 hover:bg-muted/35 md:grid-cols-[132px_minmax(96px,0.8fr)_minmax(150px,1.1fr)_minmax(96px,0.75fr)_minmax(220px,1.35fr)_92px_150px] md:items-center md:gap-3">
      <span className="min-w-0">
        <span className="mr-2 text-xs text-muted-foreground md:hidden">응시일시</span>
        <span className="font-medium">{dateLabel(wordRetest.testAt || task.dueAt || "")}</span>
        <span className="mt-1 flex flex-wrap gap-1 md:hidden">
          <WordRetestStatusBadge value={wordRetest.retestStatus} />
          <Badge variant="secondary">{branch}</Badge>
        </span>
      </span>
      <button
        type="button"
        aria-label={`${studentLabel} 단어 재시험 상세 보기`}
        onClick={() => onOpen(task)}
        className="min-w-0 truncate text-left font-semibold hover:text-primary"
      >
        <span className="mr-2 text-xs font-normal text-muted-foreground md:hidden">학생</span>
        {studentLabel}
      </button>
      <span className="min-w-0 truncate">
        <span className="mr-2 text-xs text-muted-foreground md:hidden">교재</span>
        {textbookLabel}
      </span>
      <span className="min-w-0 truncate text-muted-foreground md:text-foreground">
        <span className="mr-2 text-xs text-muted-foreground md:hidden">시험범위</span>
        {unitLabel}
      </span>
      <span className="min-w-0">
        <span className="mr-2 text-xs text-muted-foreground md:hidden">점수</span>
        <WordRetestInlineScoreEditor
          task={task}
          draft={scoreDraft}
          disabled={statusActionDisabled || absent || isClosedOpsTask(task)}
          onDraftChange={onScoreDraftChange}
          onSave={onScoreSave}
        />
      </span>
      <span className="min-w-0">
        <span className="mr-2 text-xs text-muted-foreground md:hidden">상태</span>
        <WordRetestStatusBadge value={wordRetest.retestStatus} />
      </span>
      <span className="flex flex-wrap justify-start gap-1.5 md:justify-end">
        <WordRetestRoleActionButton
          task={task}
          action={primaryAction}
          onEdit={onEdit}
          onStatusChange={onStatusChange}
          disabled={statusActionDisabled}
        />
        {canMarkAbsent && (
          <Button type="button" variant="outline" size="sm" onClick={() => onMarkAbsent(task)} disabled={statusActionDisabled}>
            미응시
          </Button>
        )}
        {canRetryAbsent && (
          <Button type="button" variant="default" size="sm" onClick={() => onRetry(task)} disabled={statusActionDisabled}>
            미응시 재요청
          </Button>
        )}
      </span>
    </div>
  )
}

function WordRetestRoleActionButton({
  task,
  action,
  onEdit,
  onStatusChange,
  disabled,
}: {
  task: OpsTask
  action: WordRetestPrimaryAction | null
  onEdit: (task: OpsTask, blockers?: string[]) => void
  onStatusChange: (task: OpsTask, status: OpsTaskStatus) => void
  disabled: boolean
}) {
  if (!action) return null

  return (
    <Button
      type="button"
      variant={action.kind === "status" && action.status === "done" ? "default" : "outline"}
      size="sm"
      onClick={() => {
        if (action.kind === "edit") {
          onEdit(task, action.blockers || [])
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
        <WordRetestStatusBadge value={wordRetest.retestStatus} />
        <Badge variant="outline">{getWordRetestBranch(task)}</Badge>
        <Badge variant="secondary">{getWordRetestTeacherLabel(task)}</Badge>
        <Badge variant="secondary">{getWordRetestClassLabel(task)}</Badge>
      </div>
      <WordRetestProgressStepper value={wordRetest.retestStatus || "not_started"} readOnly />
      <dl className="grid gap-3 md:grid-cols-2">
        <DetailInfoTile label="응시일시" value={dateLabel(wordRetest.testAt || task.dueAt || "") === "-" ? "미지정" : dateLabel(wordRetest.testAt || task.dueAt || "")} />
        <DetailInfoTile label="학생" value={getWordRetestStudentLabel(task)} />
        <DetailInfoTile label="교재" value={getWordRetestTextbookLabel(task)} />
        <DetailInfoTile label="시험범위" value={getWordRetestUnitLabel(task)} />
        <DetailInfoTile label="점수" value={getWordRetestScoreSummary(task)} />
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
          <OptionalInfo label="전화상담" value={dateInputValue(registration.phoneConsultationAt)} />
          <OptionalInfo label="방문상담" value={dateInputValue(registration.visitConsultationAt)} />
          <OptionalInfo label="레벨테스트" value={dateInputValue(registration.levelTestAt)} />
          <OptionalInfo label="수업 시작" value={dateInputValue(registration.classStartDate)} />
        </dl>
        <OperationChecklistSummary
          autoItems={[
            { label: "교재 준비", checked: Boolean(registration.textbookReady) },
          ]}
          manualItems={[
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
          <OptionalInfo label="퇴원일" value={dateInputValue(withdrawal.withdrawalDate)} />
          <OptionalInfo label="퇴원회차" value={withdrawal.withdrawalSession} />
          <OptionalInfo label="고객 퇴원사유" value={withdrawal.customerReason} />
        </dl>
        <OperationChecklistSummary
          autoItems={[
            { label: "시간표 명단 변경", checked: Boolean(withdrawal.timetableRosterUpdated) },
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
	        <OptionalInfo label="응시일시" value={dateLabel(wordRetest.testAt || "")} />
	        <OptionalInfo label="교재/시험범위" value={[wordRetest.textbookName, wordRetest.unit].filter(Boolean).join(" · ")} />
	        <OptionalInfo label="결과" value={getWordRetestScoreSummary(task)} />
	        <OptionalInfo label="1차 점수" value={wordRetest.firstScore} />
	        <OptionalInfo label="2차 점수" value={wordRetest.secondScore} />
	        <OptionalInfo label="3차 점수" value={wordRetest.thirdScore} />
	        <OptionalInfo label="요청사항" value={wordRetest.requestNote} />
	      </dl>
	    )
	  }
  return null
}
