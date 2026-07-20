import { supabase } from "@/lib/supabase"
import { ACTIVE_STUDENT_STATUS, WITHDRAWN_STUDENT_STATUS } from "@/lib/student-status.js"

import {
  REGISTRATION_PIPELINE_STATUSES,
  getOpsTaskCalendarItems,
  getTaskTypeLabel,
  summarizeOpsTasks,
} from "./ops-task-model"
import {
  getRegistrationCreateBlockers,
  getRegistrationViewKey,
  getSelectableRegistrationScheduleSessions,
  getRegistrationTransitionBlockers,
  getRegistrationWaitlistAssignmentBlockers,
  isRegistrationClassWaitlistStatus,
  isRegistrationCompletionImmutable,
  parseRegistrationSubjects,
  shouldEnsureRegistrationStudent,
} from "./registration-workflow"
import {
  clearRegistrationTrackServiceCaches,
  loadOpsRegistrationWorkspaceOptionData as loadRegistrationWorkspaceOptionData,
  loadRegistrationCaseDetail,
  loadRegistrationTrackSummaries,
  setRegistrationTrackMutationCacheInvalidator,
  type OpsRegistrationCaseDetail,
  type OpsRegistrationTrackStatus,
  type OpsRegistrationTrackSummary,
  type OpsRegistrationWorkspaceOptionData,
} from "./registration-track-service"
import {
  invalidateRegistrationSubjectTrackRuntimeAfterReadyFailure,
  probeRegistrationSubjectTrackRuntime,
  resetRegistrationSubjectTrackRuntimeProbe,
} from "./registration-runtime-probe"
import { loadRegistrationSubjectTrackFixtureClassDetails } from "./registration-track-fixture-runtime"

export type OpsTaskType =
  | "registration"
  | "withdrawal"
  | "transfer"
  | "word_retest"
  | "textbook"
  | "general"

export type OpsTaskStatus =
  | "requested"
  | "confirmed"
  | "in_progress"
  | "review_requested"
  | "done"
  | "on_hold"
  | "canceled"

export type OpsTaskPriority = "low" | "normal" | "high" | "urgent"

type Row = Record<string, unknown>
type OpsTaskLinkPatchValue = string | null
type OpsCompletionRollback = () => Promise<void>
type OpsRegistrationProjectionRollback = {
  createdStudentId: string
  rollback: OpsCompletionRollback
}

export type OpsProfileOption = {
  id: string
  label: string
  email: string
  loginId: string
  role: string
}

export type OpsLinkedOption = {
  id: string
  label: string
  meta?: string
}

export type OpsStudentOption = OpsLinkedOption & {
  grade: string
  school: string
  contact: string
  parentContact: string
  status: string
  classIds: string[]
  waitlistClassIds: string[]
}

export type OpsClassOption = OpsLinkedOption & {
  subject: string
  grade: string
  teacher: string
  room: string
  schedule: string
  fee?: number
  schedulePlan?: Record<string, unknown> | null
  studentIds: string[]
  waitlistIds: string[]
  textbookIds: string[]
}

export type OpsRegistrationClassDetail = OpsClassOption

export type OpsTextbookOption = OpsLinkedOption & {
  publisher: string
  subject: string
}

export type OpsTeacherOption = OpsLinkedOption & {
  subjects: string[]
  profileId: string
  accountEmail: string
  sortOrder: number
}

export type OpsSchoolOption = {
  id: string
  name: string
  category: string
  sortOrder: number
}

export type RegistrationSchoolCatalogStatus = "authoritative" | "error"

export type OpsRegistrationDetail = {
  pipelineStatus?: string
  inquiryAt?: string
  schoolGrade?: string
  schoolName?: string
  parentPhone?: string
  studentPhone?: string
  levelTestAt?: string
  levelTestCompletedAt?: string
  levelTestResult?: string
  levelTestPlace?: string
  levelTestMaterialLink?: string
  counselor?: string
  phoneConsultationAt?: string
  visitConsultationAt?: string
  consultationAt?: string
  classStartDate?: string
  classStartSession?: string
  textbookPreparation?: string
  visitConsultationPlace?: string
  textbookReady?: boolean
  timetableRosterUpdated?: boolean
  admissionNoticeSent?: boolean
  paymentChecked?: boolean
  makeeduRegistered?: boolean
  makeeduInvoiceSent?: boolean
  textbookBillingIssued?: boolean
  requestNote?: string
}

export type OpsWithdrawalDetail = {
  schoolGrade?: string
  teacherName?: string
  withdrawalDate?: string
  withdrawalSession?: string
  customerReason?: string
  teacherOpinion?: string
  undistributedTextbooks?: string
  completedLessonHours?: string
  fourWeekLessonHours?: string
  timetableRosterUpdated?: boolean
  makeeduWithdrawalDone?: boolean
  feeProcessed?: boolean
  textbookFeeProcessed?: boolean
}

export type OpsTransferDetail = {
  transferReason?: string
  fromClassId?: string
  toClassId?: string
  fromTeacherName?: string
  toTeacherName?: string
  fromClassName?: string
  toClassName?: string
  fromClassEndDate?: string
  fromClassEndSession?: string
  toClassStartDate?: string
  toClassStartSession?: string
  fromUndistributedTextbooks?: string
  toUndistributedTextbooks?: string
  timetableRosterUpdated?: boolean
  makeeduTransferDone?: boolean
  feeProcessed?: boolean
  textbookFeeProcessed?: boolean
}

export type OpsWordRetestDetail = {
  branch?: string
  teacherId?: string
  teacherName?: string
  className?: string
  studentName?: string
  testAt?: string
  textbookName?: string
  unit?: string
  requestNote?: string
  totalQuestionCount?: string
  scoreOutOf100?: string
  cutoffQuestionCount?: string
  firstScore?: string
  secondScore?: string
  thirdScore?: string
  retestStatus?: string
}

export type OpsTaskComment = {
  id: string
  taskId: string
  authorId: string
  authorLabel: string
  body: string
  createdAt: string
}

export type OpsTaskAttachment = {
  id: string
  taskId: string
  fileName: string
  fileKind: string
  driveFileId: string
  driveLink: string
  uploadedBy: string
  uploadedByLabel: string
  uploadedAt: string
}

export type OpsTaskEvent = {
  id: string
  taskId: string
  actorId: string
  actorLabel: string
  eventType: string
  fieldName: string
  beforeValue: string
  afterValue: string
  createdAt: string
}

export type OpsTask = {
  id: string
  title: string
  type: OpsTaskType
  status: OpsTaskStatus
  priority: OpsTaskPriority
  requestedBy: string
  requestedByLabel: string
  requestedTeam: string
  assigneeId: string
  assigneeLabel: string
  assigneeTeam: string
  secondaryAssigneeId: string
  secondaryAssigneeLabel: string
  studentId: string
  studentName: string
  classId: string
  className: string
  textbookId: string
  textbookTitle: string
  campus: string
  subject: string
  startAt: string
  dueAt: string
  completedAt: string
  memo: string
  createdAt: string
  updatedAt: string
  registration?: OpsRegistrationDetail
  registrationTracks?: OpsRegistrationTrackSummary[]
  withdrawal?: OpsWithdrawalDetail
  transfer?: OpsTransferDetail
  wordRetest?: OpsWordRetestDetail
  comments: OpsTaskComment[]
  attachments: OpsTaskAttachment[]
  events: OpsTaskEvent[]
}

export type OpsTaskWorkspaceData = {
  tasks: OpsTask[]
  profiles: OpsProfileOption[]
  students: OpsStudentOption[]
  classes: OpsClassOption[]
  textbooks: OpsTextbookOption[]
  teachers: OpsTeacherOption[]
  schemaReady: boolean
  error: string | null
}

export type OpsTaskWorkspaceOptionData = Pick<
  OpsTaskWorkspaceData,
  "profiles" | "students" | "classes" | "textbooks" | "teachers" | "schemaReady" | "error"
> & {
  directorCatalogStatus?: "authoritative" | "partial" | "error"
  schools?: OpsSchoolOption[]
  schoolCatalogStatus?: RegistrationSchoolCatalogStatus
  schoolCatalogError?: string | null
}

export type OpsTaskInput = {
  title: string
  type: OpsTaskType
  status?: OpsTaskStatus
  priority?: OpsTaskPriority
  requestedBy?: string
  requestedTeam?: string
  assigneeId?: string
  assigneeTeam?: string
  secondaryAssigneeId?: string
  studentId?: string
  classId?: string
  textbookId?: string
  studentName?: string
  className?: string
  textbookTitle?: string
  campus?: string
  subject?: string
  startAt?: string
  dueAt?: string
  completedAt?: string
  memo?: string
  registration?: OpsRegistrationDetail
  withdrawal?: OpsWithdrawalDetail
  transfer?: OpsTransferDetail
  wordRetest?: OpsWordRetestDetail
}

export const emptyOpsTaskWorkspaceData: OpsTaskWorkspaceData = {
  tasks: [],
  profiles: [],
  students: [],
  classes: [],
  textbooks: [],
  teachers: [],
  schemaReady: true,
  error: null,
}

const emptyOpsTaskWorkspaceOptionData: OpsTaskWorkspaceOptionData = {
  profiles: [],
  students: [],
  classes: [],
  textbooks: [],
  teachers: [],
  schemaReady: true,
  error: null,
}

const OPS_TASK_WORKSPACE_CACHE_TTL_MS = 15_000
const OPS_REGISTRATION_SESSION_CACHE_TTL_MS = 60_000
const OPS_REGISTRATION_SESSION_CACHE_PREFIX = "tips:registration-workspace:"
const OPS_REGISTRATION_PARENT_LIST_COLUMNS = [
  "id",
  "title",
  "type",
  "status",
  "priority",
  "requested_by",
  "assignee_id",
  "secondary_assignee_id",
  "student_id",
  "student_name",
  "campus",
  "subject",
  "created_at",
  "updated_at",
  "ops_registration_details(task_id,pipeline_status,school_grade,school_name,inquiry_at)",
].join(",")
const OPS_REGISTRATION_CLASS_COLUMN_CANDIDATES = [
  "id,name,subject,grade,teacher,room,textbook_ids",
  "id,name,subject,grade,teacher,room",
] as const
const OPS_REGISTRATION_CLASS_DETAIL_COLUMN_CANDIDATES = [
  "id,name,subject,grade,teacher,room,schedule,schedule_plan,textbook_ids",
  "id,name,subject,grade,teacher,room,schedule,schedule_plan",
] as const
const OPS_CLASS_COLUMN_CANDIDATES = [
  "id,name,subject,grade,teacher,room,schedule,schedule_plan,fee,student_ids,waitlist_ids,textbook_ids,status",
  "id,name,subject,grade,teacher,room,schedule,schedule_plan,fee,student_ids,waitlist_ids,status",
  "id,name,subject,grade,teacher,room,schedule,schedule_plan,tuition,student_ids,waitlist_ids,textbook_ids,status",
  "id,name,subject,grade,teacher,room,schedule,schedule_plan,tuition,student_ids,waitlist_ids,status",
  "id,name,subject,grade,teacher,room,schedule,schedule_plan,student_ids,waitlist_ids,textbook_ids,status",
  "id,name,subject,grade,teacher,room,schedule,schedule_plan,student_ids,waitlist_ids,status",
  "id,name,subject,grade,teacher,room,schedule,schedule_plan,fee,status",
  "id,name,subject,grade,teacher,room,schedule,schedule_plan,tuition,status",
  "id,name,subject,grade,teacher,room,schedule,schedule_plan,status",
  "id,name,subject,grade,teacher,room,schedule,status",
] as const
const OPS_REGISTRATION_OPTIONAL_DETAIL_COLUMNS = [
  "level_test_completed_at",
  "level_test_result",
  "textbook_preparation",
  "visit_consultation_place",
  "timetable_roster_updated",
] as const
type OpsTaskWorkspaceLoadOptions = {
  force?: boolean
  taskType?: OpsTaskType
  viewerId?: string
  includeManagementOptions?: boolean
  includeTeacherOptions?: boolean
  includeProfileOptions?: boolean
}
type OpsTaskWorkspaceOptionLoadOptions = {
  force?: boolean
  taskType?: OpsTaskType
  viewerId?: string
}
const opsTaskWorkspaceDataCache = new Map<string, { data: OpsTaskWorkspaceData; expiresAt: number }>()
const opsTaskWorkspaceDataInFlight = new Map<string, Promise<OpsTaskWorkspaceData>>()
const opsTaskWorkspaceOptionDataCache = new Map<string, { data: OpsTaskWorkspaceOptionData; expiresAt: number }>()
const opsTaskWorkspaceOptionDataInFlight = new Map<string, Promise<OpsTaskWorkspaceOptionData>>()
const opsRegistrationClassDetailDataCache = new Map<string, { data: OpsRegistrationClassDetail | null; expiresAt: number }>()
const opsRegistrationClassDetailDataInFlight = new Map<string, Promise<OpsRegistrationClassDetail | null>>()

function shouldIncludeOpsTeacherOptions(options: OpsTaskWorkspaceLoadOptions = {}) {
  return options.includeManagementOptions !== false || options.includeTeacherOptions === true
}

function getOpsTaskWorkspaceCacheKey(options: OpsTaskWorkspaceLoadOptions = {}) {
  return [
    options.taskType || "all",
    options.viewerId || "anonymous",
    options.includeManagementOptions === false ? "light" : "full",
    shouldIncludeOpsTeacherOptions(options) ? "teachers" : "no-teachers",
    options.includeProfileOptions === false ? "no-profiles" : "profiles",
  ].join(":")
}

function getOpsTaskWorkspaceOptionCacheKey(options: OpsTaskWorkspaceOptionLoadOptions = {}) {
  return [options.taskType || "all", options.viewerId || "anonymous"].join(":")
}

function getOpsRegistrationClassDetailCacheKey(classId: string, options: { viewerId?: string } = {}) {
  return [options.viewerId || "anonymous", classId].join(":")
}

function shouldPersistOpsTaskWorkspaceData(options: OpsTaskWorkspaceLoadOptions = {}) {
  return (
    options.taskType === "registration"
    && options.includeManagementOptions === false
    && Boolean(options.viewerId)
  )
}

function getOpsTaskWorkspaceSessionStorageKey(options: OpsTaskWorkspaceLoadOptions = {}) {
  return `${OPS_REGISTRATION_SESSION_CACHE_PREFIX}${encodeURIComponent(getOpsTaskWorkspaceCacheKey(options))}`
}

export function getPersistedOpsTaskWorkspaceData(options: OpsTaskWorkspaceLoadOptions = {}) {
  if (typeof window === "undefined" || !shouldPersistOpsTaskWorkspaceData(options)) return null

  const storageKey = getOpsTaskWorkspaceSessionStorageKey(options)
  try {
    const rawValue = window.sessionStorage.getItem(storageKey)
    if (!rawValue) return null

    const persisted = JSON.parse(rawValue) as { expiresAt?: unknown; data?: unknown }
    const expiresAt = Number(persisted.expiresAt || 0)
    const data = persisted.data as OpsTaskWorkspaceData | undefined
    if (
      !expiresAt
      || expiresAt <= Date.now()
      || !data
      || !Array.isArray(data.tasks)
      || data.schemaReady !== true
      || data.error !== null
    ) {
      window.sessionStorage.removeItem(storageKey)
      return null
    }

    return data
  } catch {
    try {
      window.sessionStorage.removeItem(storageKey)
    } catch {
      // Storage may be unavailable in privacy-restricted browser contexts.
    }
    return null
  }
}

function persistOpsTaskWorkspaceData(options: OpsTaskWorkspaceLoadOptions, data: OpsTaskWorkspaceData) {
  if (
    typeof window === "undefined"
    || !shouldPersistOpsTaskWorkspaceData(options)
    || data.schemaReady !== true
    || data.error !== null
  ) return

  try {
    window.sessionStorage.setItem(
      getOpsTaskWorkspaceSessionStorageKey(options),
      JSON.stringify({
        expiresAt: Date.now() + OPS_REGISTRATION_SESSION_CACHE_TTL_MS,
        data,
      }),
    )
  } catch {
    // Keep registration usable when the browser rejects or exhausts session storage.
  }
}

export function clearOpsTaskWorkspaceDataCache() {
  opsTaskWorkspaceDataCache.clear()
  opsTaskWorkspaceDataInFlight.clear()
  opsTaskWorkspaceOptionDataCache.clear()
  opsTaskWorkspaceOptionDataInFlight.clear()
  opsRegistrationClassDetailDataCache.clear()
  opsRegistrationClassDetailDataInFlight.clear()
  clearRegistrationTrackServiceCaches()

  if (typeof window === "undefined") return
  try {
    for (let index = window.sessionStorage.length - 1; index >= 0; index -= 1) {
      const storageKey = window.sessionStorage.key(index)
      if (storageKey?.startsWith(OPS_REGISTRATION_SESSION_CACHE_PREFIX)) {
        window.sessionStorage.removeItem(storageKey)
      }
    }
  } catch {
    // Storage may be unavailable in privacy-restricted browser contexts.
  }
}

setRegistrationTrackMutationCacheInvalidator(clearOpsTaskWorkspaceDataCache)

export function getCachedOpsTaskWorkspaceData(options: OpsTaskWorkspaceLoadOptions = {}) {
  const cached = opsTaskWorkspaceDataCache.get(getOpsTaskWorkspaceCacheKey(options))
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data
  }
  return null
}

// ops-task-read-measure:start
export type OpsTaskReadMeasureRecord = {
  name: string
  cacheHit: boolean
  queryCount: number
  ok: boolean
}

type OpsTaskReadMeasureOptions = {
  performance?: {
    mark: (name: string) => void
    measure: (name: string, startMark: string, endMark: string) => void
  }
  recordMeasure?: (record: OpsTaskReadMeasureRecord) => void
}

export function createOpsTaskReadMeasureRunner(options: OpsTaskReadMeasureOptions = {}) {
  let sequence = 0
  return function runOpsTaskReadMeasure<T>(
    name: string,
    cacheHit: boolean,
    work: (metrics: { queryCount: number }) => Promise<T> | T,
  ): Promise<T> {
    sequence += 1
    const metrics = { queryCount: 0 }
    const startMark = `${name}:start:${sequence}`
    const endMark = `${name}:end:${sequence}`
    options.performance?.mark(startMark)
    let ok = false
    let workResult: Promise<T> | T
    try {
      workResult = work(metrics)
    } catch (error) {
      workResult = Promise.reject(error)
    }
    return Promise.resolve(workResult)
      .then((result) => {
        ok = true
        return result
      })
      .finally(() => {
        options.performance?.mark(endMark)
        options.performance?.measure(name, startMark, endMark)
        options.recordMeasure?.({ name, cacheHit, queryCount: metrics.queryCount, ok })
      })
  }
}

let opsTaskReadMeasureLogger: ((record: OpsTaskReadMeasureRecord) => void) | null = null

export function setOpsTaskReadMeasureLogger(logger: ((record: OpsTaskReadMeasureRecord) => void) | null) {
  opsTaskReadMeasureLogger = logger
}

const runOpsTaskReadMeasure = createOpsTaskReadMeasureRunner({
  performance: typeof performance === "undefined"
    ? undefined
    : {
        mark: (name) => performance.mark(name),
        measure: (name, startMark, endMark) => performance.measure(name, startMark, endMark),
      },
  recordMeasure: (record) => opsTaskReadMeasureLogger?.(record),
})
// ops-task-read-measure:end

function text(value: unknown) {
  return String(value || "").trim()
}

function registrationPhoneIdentity(value: unknown) {
  return text(value).replace(/\D/g, "")
}

function bool(value: unknown) {
  return value === true
}

function numberText(value: unknown) {
  if (value === null || value === undefined || value === "") return ""
  return String(value)
}

function numberValue(value: unknown) {
  const normalized = String(value || "").replace(/[^0-9.-]+/g, "")
  const parsed = Number(normalized || 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function nullable(value: unknown) {
  const trimmed = text(value)
  return trimmed ? trimmed : null
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function nullableDate(value: unknown) {
  const trimmed = text(value)
  if (!trimmed) return null
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(trimmed) && !/(Z|[+-]\d{2}:?\d{2})$/i.test(trimmed)) {
    const date = new Date(trimmed)
    return Number.isNaN(date.getTime()) ? trimmed : date.toISOString()
  }
  return trimmed
}

function nullableNumber(value: unknown) {
  const trimmed = text(value)
  if (!trimmed) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeIdList(value: unknown) {
  return Array.isArray(value)
    ? [...new Set(value.map((item) => text(item)).filter(Boolean))]
    : []
}

function addUniqueId(values: unknown, value: string) {
  const safeValue = text(value)
  const next = normalizeIdList(values)
  return safeValue && !next.includes(safeValue) ? [...next, safeValue] : next
}

function removeId(values: unknown, value: string) {
  const safeValue = text(value)
  return normalizeIdList(values).filter((item) => item !== safeValue)
}

function withoutOpsStudentClass(student: Row | null, classId: unknown) {
  if (!student) return student
  const safeClassId = text(classId)
  if (!safeClassId) return student

  return {
    ...student,
    class_ids: removeId(student.class_ids, safeClassId),
    waitlist_class_ids: removeId(student.waitlist_class_ids, safeClassId),
  }
}

function optionMeta(parts: unknown[]) {
  return parts.map(text).filter(Boolean).join(" · ")
}

function createOpsId() {
  if (globalThis.crypto && "randomUUID" in globalThis.crypto) {
    return globalThis.crypto.randomUUID()
  }
  return `ops-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function normalizeStatus(value: unknown): OpsTaskStatus {
  const status = text(value) as OpsTaskStatus
  if (["requested", "confirmed", "in_progress", "review_requested", "done", "on_hold", "canceled"].includes(status)) {
    return status
  }
  return "requested"
}

function normalizeType(value: unknown): OpsTaskType {
  const type = text(value) as OpsTaskType
  if (["registration", "withdrawal", "transfer", "word_retest", "textbook", "general"].includes(type)) {
    return type
  }
  return "general"
}

function normalizePriority(value: unknown): OpsTaskPriority {
  const priority = text(value) as OpsTaskPriority
  if (["low", "normal", "high", "urgent"].includes(priority)) {
    return priority
  }
  return "normal"
}

function isMissingRelationError(error: unknown) {
  const code = typeof error === "object" && error ? text((error as { code?: string }).code) : ""
  const message = error instanceof Error ? error.message : text((error as { message?: string })?.message)

  return (
    code === "42P01" ||
    code === "PGRST205" ||
    message.includes("does not exist") ||
    message.includes("Could not find the table")
  )
}

function isMissingColumnError(error: unknown) {
  const code = typeof error === "object" && error ? text((error as { code?: string }).code) : ""
  const message = error instanceof Error ? error.message : text((error as { message?: string })?.message)
  return code === "42703" || code === "PGRST204" || message.includes("Could not find") || message.includes("column")
}

function profileLabel(profile: Row | undefined) {
  if (!profile) return ""
  return text(profile.name) || text(profile.email) || text(profile.login_id) || text(profile.id)
}

function profileSecondaryLabel(profile: Row) {
  return text(profile.email) || text(profile.login_id) || text(profile.role)
}

function profileOptionLabel(profile: Row, duplicatedLabels: Set<string>) {
  const label = profileLabel(profile)
  if (!duplicatedLabels.has(label)) return label

  const secondaryLabel = profileSecondaryLabel(profile)
  return secondaryLabel && secondaryLabel !== label ? `${label} · ${secondaryLabel}` : label
}

function buildProfileLookup(profiles: Row[]) {
  return new Map(profiles.map((profile) => [text(profile.id), profile]))
}

function byTaskId<T extends { taskId: string }>(items: T[]) {
  const map = new Map<string, T[]>()
  items.forEach((item) => {
    const list = map.get(item.taskId) || []
    list.push(item)
    map.set(item.taskId, list)
  })
  return map
}

function singleByTaskId<T extends { taskId: string }>(items: T[]) {
  return new Map(items.map((item) => [item.taskId, item]))
}

function embeddedTaskRows(taskRows: Row[], key: string) {
  return taskRows.flatMap((row) => {
    const embedded = row[key]
    if (Array.isArray(embedded)) return embedded as Row[]
    if (embedded && typeof embedded === "object") return [embedded as Row]
    return []
  })
}

async function readTable(table: string, columns = "*", optional = true) {
  if (!supabase) return []

  const result = await supabase.from(table).select(columns)
  if (result.error) {
    if (optional && isMissingRelationError(result.error)) return []
    throw result.error
  }

  return (result.data || []) as unknown as Row[]
}

async function readTableWithFallback(table: string, columns: string, fallbackColumns: string, optional = true) {
  if (!supabase) return []

  const result = await supabase.from(table).select(columns)
  if (!result.error) {
    return (result.data || []) as unknown as Row[]
  }

  if (fallbackColumns && isMissingColumnError(result.error)) {
    const fallback = await supabase.from(table).select(fallbackColumns)
    if (!fallback.error) {
      return (fallback.data || []) as unknown as Row[]
    }
    if (optional && isMissingRelationError(fallback.error)) return []
    throw fallback.error
  }

  if (optional && isMissingRelationError(result.error)) return []
  throw result.error
}

async function readOpsClassRows(taskType?: OpsTaskType) {
  if (!supabase) return []

  const columnCandidates = taskType === "registration"
    ? OPS_REGISTRATION_CLASS_COLUMN_CANDIDATES
    : OPS_CLASS_COLUMN_CANDIDATES
  for (const columns of columnCandidates) {
    const result = await supabase.from("classes").select(columns)
    if (!result.error) {
      return (result.data || []) as unknown as Row[]
    }
    if (!isMissingColumnError(result.error)) {
      throw result.error
    }
  }

  return []
}

async function readOpsRegistrationClassDetail(
  classId: string,
  metrics: { queryCount: number },
): Promise<OpsRegistrationClassDetail | null> {
  if (!supabase) return null
  const safeClassId = text(classId)
  if (!safeClassId) return null

  for (const columns of OPS_REGISTRATION_CLASS_DETAIL_COLUMN_CANDIDATES) {
    metrics.queryCount += 1
    const result = await supabase.from("classes").select(columns).eq("id", safeClassId).limit(1)
    if (!result.error) {
      const row = ((result.data || []) as unknown as Row[])[0]
      return row ? mapOpsClassOption(row) : null
    }
    if (!isMissingColumnError(result.error)) throw result.error
  }

  return null
}

export async function loadOpsRegistrationClassDetail(
  classId: string,
  options: { force?: boolean; viewerId?: string } = {},
): Promise<OpsRegistrationClassDetail | null> {
  const safeClassId = text(classId)
  if (!safeClassId) return null
  const safeViewerId = text(options.viewerId)
  if (!safeViewerId) throw new Error("인증된 사용자 정보를 확인할 수 없습니다.")
  const measureName = `registration:class-detail:${safeClassId}`
  const cacheKey = getOpsRegistrationClassDetailCacheKey(safeClassId, { viewerId: safeViewerId })
  const cached = opsRegistrationClassDetailDataCache.get(cacheKey)
  if (!options.force && cached && cached.expiresAt > Date.now()) {
    return runOpsTaskReadMeasure(measureName, true, async () => cached.data)
  }
  const inFlight = opsRegistrationClassDetailDataInFlight.get(cacheKey)
  if (!options.force && inFlight) return inFlight

  const loadPromise = runOpsTaskReadMeasure(
    measureName,
    false,
    (metrics) => readOpsRegistrationClassDetail(safeClassId, metrics),
  )
  opsRegistrationClassDetailDataInFlight.set(cacheKey, loadPromise)
  try {
    const data = await loadPromise
    if (opsRegistrationClassDetailDataInFlight.get(cacheKey) === loadPromise) {
      opsRegistrationClassDetailDataCache.set(cacheKey, {
        data,
        expiresAt: Date.now() + OPS_TASK_WORKSPACE_CACHE_TTL_MS,
      })
    }
    return data
  } finally {
    if (opsRegistrationClassDetailDataInFlight.get(cacheKey) === loadPromise) {
      opsRegistrationClassDetailDataInFlight.delete(cacheKey)
    }
  }
}

export async function loadOpsRegistrationClassDetails(
  classIds: readonly string[],
  options: { force?: boolean; viewerId?: string } = {},
): Promise<Record<string, OpsRegistrationClassDetail | null>> {
  const uniqueClassIds = Array.from(new Set(classIds.map(text).filter(Boolean)))
  const fixture = loadRegistrationSubjectTrackFixtureClassDetails(uniqueClassIds)
  if (fixture) return fixture
  const entries = await Promise.all(uniqueClassIds.map(async (classId) => [
    classId,
    await loadOpsRegistrationClassDetail(classId, options),
  ] as const))
  return Object.fromEntries(entries)
}

async function readTaskScopedTable(table: string, taskIds: string[], columns = "*", optional = true) {
  if (!supabase || taskIds.length === 0) return []

  const result = await supabase.from(table).select(columns).in("task_id", taskIds)
  if (result.error) {
    if (optional && isMissingRelationError(result.error)) return []
    throw result.error
  }

  return (result.data || []) as unknown as Row[]
}

async function writeEvent(taskId: string, eventType: string, fieldName = "", beforeValue = "", afterValue = "") {
  if (!supabase) return ""
  const response = await runIdempotentOpsTaskProducerRpc("record_ops_task_activity_event_v1", {
    p_task_id: taskId,
    p_event_type: eventType,
    p_field_name: nullable(fieldName),
    p_before_value: nullable(beforeValue),
    p_after_value: nullable(afterValue),
  })
  return producerSourceEventId(response)
}

async function writeAutoSyncEventOnce(taskId: string, fieldName: string, afterValue: string, beforeValue = "") {
  if (!supabase || !text(taskId) || !text(fieldName) || !text(afterValue)) return

  const { data, error } = await supabase
    .from("ops_task_events")
    .select("id")
    .eq("task_id", taskId)
    .eq("event_type", "auto_synced")
    .eq("field_name", fieldName)
    .eq("after_value", afterValue)
    .limit(1)

  if (error) {
    if (isMissingRelationError(error) || isMissingColumnError(error)) return
    throw error
  }
  if ((data || []).length > 0) return

  await writeEvent(taskId, "auto_synced", fieldName, beforeValue, afterValue)
}

type ManualCheckFieldDefinition = {
  column: string
  label: string
  getValue: (input: OpsTaskInput) => boolean
}

const MANUAL_CHECK_FIELD_DEFINITIONS: Partial<Record<OpsTaskType, { table: string; fields: ManualCheckFieldDefinition[] }>> = {
  registration: {
    table: "ops_registration_details",
    fields: [
      { column: "admission_notice_sent", label: "입학신청서 발송", getValue: (input) => Boolean(input.registration?.admissionNoticeSent) },
      { column: "makeedu_registered", label: "메이크에듀 등록(수업, 교재)", getValue: (input) => Boolean(input.registration?.makeeduRegistered) },
      { column: "makeedu_invoice_sent", label: "청구서 발송", getValue: (input) => Boolean(input.registration?.makeeduInvoiceSent) },
      { column: "payment_checked", label: "수납 완료 확인", getValue: (input) => Boolean(input.registration?.paymentChecked) },
    ],
  },
  withdrawal: {
    table: "ops_withdrawal_details",
    fields: [
      { column: "makeedu_withdrawal_done", label: "메이크에듀 퇴원처리", getValue: (input) => Boolean(input.withdrawal?.makeeduWithdrawalDone) },
      { column: "fee_processed", label: "수업료 처리", getValue: (input) => Boolean(input.withdrawal?.feeProcessed) },
      { column: "textbook_fee_processed", label: "교재비 처리", getValue: (input) => Boolean(input.withdrawal?.textbookFeeProcessed) },
    ],
  },
  transfer: {
    table: "ops_transfer_details",
    fields: [
      { column: "makeedu_transfer_done", label: "메이크에듀 전반처리", getValue: (input) => Boolean(input.transfer?.makeeduTransferDone) },
      { column: "fee_processed", label: "수업료 처리", getValue: (input) => Boolean(input.transfer?.feeProcessed) },
      { column: "textbook_fee_processed", label: "교재비 처리", getValue: (input) => Boolean(input.transfer?.textbookFeeProcessed) },
    ],
  },
}

async function writeManualCheckEvents(taskId: string, input: OpsTaskInput, previousInput?: OpsTaskInput) {
  if (!supabase) return
  const definition = MANUAL_CHECK_FIELD_DEFINITIONS[input.type]
  if (!definition) return

  const { data, error } = previousInput
    ? { data: null, error: null }
    : await supabase
      .from(definition.table)
      .select(definition.fields.map((field) => field.column).join(","))
      .eq("task_id", taskId)
      .maybeSingle()

  if (error) {
    if (isMissingRelationError(error) || isMissingColumnError(error)) return
    throw error
  }

  const previous = (data || {}) as Row
  for (const field of definition.fields) {
    const previousChecked = previousInput ? field.getValue(previousInput) : bool(previous[field.column])
    const nextChecked = field.getValue(input)
    if (previousChecked === nextChecked) continue
    await writeEvent(taskId, nextChecked ? "manual_checked" : "manual_unchecked", field.label, previousChecked ? "완료" : "", nextChecked ? "완료" : "")
  }
}

function mapRegistration(row: Row | undefined): OpsRegistrationDetail | undefined {
  if (!row) return undefined
  return {
    pipelineStatus: text(row.pipeline_status) || REGISTRATION_PIPELINE_STATUSES[0]?.value || "0. 등록 문의",
    inquiryAt: text(row.inquiry_at),
    schoolGrade: text(row.school_grade),
    schoolName: text(row.school_name),
    parentPhone: text(row.parent_phone),
    studentPhone: text(row.student_phone),
    levelTestAt: text(row.level_test_at),
    levelTestCompletedAt: text(row.level_test_completed_at),
    levelTestResult: text(row.level_test_result),
    levelTestPlace: text(row.level_test_place),
    levelTestMaterialLink: text(row.level_test_material_link),
    counselor: text(row.counselor),
    phoneConsultationAt: text(row.phone_consultation_at),
    visitConsultationAt: text(row.visit_consultation_at),
    consultationAt: text(row.consultation_at),
    classStartDate: text(row.class_start_date),
    classStartSession: text(row.class_start_session),
    textbookPreparation: text(row.textbook_preparation),
    visitConsultationPlace: text(row.visit_consultation_place),
    textbookReady: bool(row.textbook_ready),
    timetableRosterUpdated: bool(row.timetable_roster_updated),
    admissionNoticeSent: bool(row.admission_notice_sent),
    paymentChecked: bool(row.payment_checked),
    makeeduRegistered: bool(row.makeedu_registered),
    makeeduInvoiceSent: bool(row.makeedu_invoice_sent),
    textbookBillingIssued: bool(row.textbook_billing_issued),
    requestNote: text(row.request_note),
  }
}

function mapWithdrawal(row: Row | undefined): OpsWithdrawalDetail | undefined {
  if (!row) return undefined
  return {
    schoolGrade: text(row.school_grade),
    teacherName: text(row.teacher_name),
    withdrawalDate: text(row.withdrawal_date),
    withdrawalSession: text(row.withdrawal_session),
    customerReason: text(row.customer_reason),
    teacherOpinion: text(row.teacher_opinion),
    undistributedTextbooks: text(row.undistributed_textbooks),
    completedLessonHours: numberText(row.completed_lesson_hours),
    fourWeekLessonHours: numberText(row.four_week_lesson_hours),
    timetableRosterUpdated: bool(row.timetable_roster_updated),
    makeeduWithdrawalDone: bool(row.makeedu_withdrawal_done),
    feeProcessed: bool(row.fee_processed),
    textbookFeeProcessed: bool(row.textbook_fee_processed),
  }
}

function mapTransfer(row: Row | undefined): OpsTransferDetail | undefined {
  if (!row) return undefined
  return {
    transferReason: text(row.transfer_reason),
    fromClassId: text(row.from_class_id),
    toClassId: text(row.to_class_id),
    fromTeacherName: text(row.from_teacher_name),
    toTeacherName: text(row.to_teacher_name),
    fromClassName: text(row.from_class_name),
    toClassName: text(row.to_class_name),
    fromClassEndDate: text(row.from_class_end_date),
    fromClassEndSession: text(row.from_class_end_session),
    toClassStartDate: text(row.to_class_start_date),
    toClassStartSession: text(row.to_class_start_session),
    fromUndistributedTextbooks: text(row.from_undistributed_textbooks),
    toUndistributedTextbooks: text(row.to_undistributed_textbooks),
    timetableRosterUpdated: bool(row.timetable_roster_updated),
    makeeduTransferDone: bool(row.makeedu_transfer_done),
    feeProcessed: bool(row.fee_processed),
    textbookFeeProcessed: bool(row.textbook_fee_processed),
  }
}

function mapWordRetest(row: Row | undefined): OpsWordRetestDetail | undefined {
  if (!row) return undefined
  return {
    branch: text(row.branch),
    teacherId: text(row.teacher_catalog_id),
    teacherName: text(row.teacher_name),
    className: text(row.class_name),
    studentName: text(row.student_name),
    testAt: text(row.test_at),
    textbookName: text(row.textbook_name),
    unit: text(row.unit),
    requestNote: text(row.request_note),
    totalQuestionCount: numberText(row.total_question_count),
    scoreOutOf100: numberText(row.score_out_of_100),
    cutoffQuestionCount: numberText(row.cutoff_question_count),
    firstScore: numberText(row.first_score),
    secondScore: numberText(row.second_score),
    thirdScore: numberText(row.third_score),
    retestStatus: text(row.retest_status),
  }
}

function mapComment(row: Row, profiles: Map<string, Row>): OpsTaskComment {
  const authorId = text(row.author_id)
  return {
    id: text(row.id),
    taskId: text(row.task_id),
    authorId,
    authorLabel: profileLabel(profiles.get(authorId)),
    body: text(row.body),
    createdAt: text(row.created_at),
  }
}

function mapAttachment(row: Row, profiles: Map<string, Row>): OpsTaskAttachment {
  const uploadedBy = text(row.uploaded_by)
  return {
    id: text(row.id),
    taskId: text(row.task_id),
    fileName: text(row.file_name),
    fileKind: text(row.file_kind),
    driveFileId: text(row.drive_file_id),
    driveLink: text(row.drive_link),
    uploadedBy,
    uploadedByLabel: profileLabel(profiles.get(uploadedBy)),
    uploadedAt: text(row.uploaded_at),
  }
}

function mapEvent(row: Row, profiles: Map<string, Row>): OpsTaskEvent {
  const actorId = text(row.actor_id)
  return {
    id: text(row.id),
    taskId: text(row.task_id),
    actorId,
    actorLabel: profileLabel(profiles.get(actorId)),
    eventType: text(row.event_type),
    fieldName: text(row.field_name),
    beforeValue: text(row.before_value),
    afterValue: text(row.after_value),
    createdAt: text(row.created_at),
  }
}

function mapTask(
  row: Row,
  profiles: Map<string, Row>,
  registration: Map<string, OpsRegistrationDetail>,
  withdrawal: Map<string, OpsWithdrawalDetail>,
  transfer: Map<string, OpsTransferDetail>,
  wordRetest: Map<string, OpsWordRetestDetail>,
  comments: Map<string, OpsTaskComment[]>,
  attachments: Map<string, OpsTaskAttachment[]>,
  events: Map<string, OpsTaskEvent[]>,
): OpsTask {
  const id = text(row.id)
  const requestedBy = text(row.requested_by)
  const assigneeId = text(row.assignee_id)
  const secondaryAssigneeId = text(row.secondary_assignee_id)

  return {
    id,
    title: text(row.title),
    type: normalizeType(row.type),
    status: normalizeStatus(row.status),
    priority: normalizePriority(row.priority),
    requestedBy,
    requestedByLabel: profileLabel(profiles.get(requestedBy)),
    requestedTeam: text(row.requested_team),
    assigneeId,
    assigneeLabel: profileLabel(profiles.get(assigneeId)),
    assigneeTeam: text(row.assignee_team),
    secondaryAssigneeId,
    secondaryAssigneeLabel: profileLabel(profiles.get(secondaryAssigneeId)),
    studentId: text(row.student_id),
    studentName: text(row.student_name),
    classId: text(row.class_id),
    className: text(row.class_name),
    textbookId: text(row.textbook_id),
    textbookTitle: text(row.textbook_title),
    campus: text(row.campus),
    subject: text(row.subject),
    startAt: text(row.start_at),
    dueAt: text(row.due_at),
    completedAt: text(row.completed_at),
    memo: text(row.memo),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
    registration: registration.get(id),
    withdrawal: withdrawal.get(id),
    transfer: transfer.get(id),
    wordRetest: wordRetest.get(id),
    comments: comments.get(id) || [],
    attachments: attachments.get(id) || [],
    events: events.get(id) || [],
  }
}

function mapOpsClassOption(row: Row): OpsClassOption {
  return {
    id: text(row.id),
    label: text(row.name) || text(row.id),
    meta: optionMeta([row.subject, row.teacher, row.room]),
    subject: text(row.subject),
    grade: text(row.grade),
    teacher: text(row.teacher),
    room: text(row.room),
    schedule: text(row.schedule),
    fee: numberValue(row.fee || row.tuition),
    schedulePlan: recordValue(row.schedule_plan),
    studentIds: normalizeIdList(row.student_ids),
    waitlistIds: normalizeIdList(row.waitlist_ids),
    textbookIds: normalizeIdList(row.textbook_ids),
  }
}

function buildOpsTaskWorkspaceOptionData(
  profileRows: Row[],
  studentRows: Row[],
  classRows: Row[],
  textbookRows: Row[],
  teacherRows: Row[],
): Omit<OpsTaskWorkspaceOptionData, "schemaReady" | "error"> {
  const profileLabelCounts = new Map<string, number>()
  profileRows.forEach((row) => {
    const label = profileLabel(row)
    profileLabelCounts.set(label, (profileLabelCounts.get(label) || 0) + 1)
  })
  const duplicatedProfileLabels = new Set(
    Array.from(profileLabelCounts.entries())
      .filter(([, count]) => count > 1)
      .map(([label]) => label),
  )

  return {
    profiles: profileRows
      .map((row) => ({
        id: text(row.id),
        label: profileOptionLabel(row, duplicatedProfileLabels),
        email: text(row.email),
        loginId: text(row.login_id),
        role: text(row.role),
      }))
      .sort((left, right) => left.label.localeCompare(right.label, "ko")),
    students: studentRows.map((row) => ({
      id: text(row.id),
      label: text(row.name) || text(row.id),
      meta: optionMeta([row.grade, row.school, row.status]),
      grade: text(row.grade),
      school: text(row.school),
      contact: text(row.contact),
      parentContact: text(row.parent_contact),
      status: text(row.status),
      classIds: normalizeIdList(row.class_ids),
      waitlistClassIds: normalizeIdList(row.waitlist_class_ids),
    } satisfies OpsStudentOption)),
    classes: classRows.map(mapOpsClassOption),
    textbooks: textbookRows.map((row) => ({
      id: text(row.id),
      label: text(row.title) || text(row.name) || text(row.id),
      meta: optionMeta([row.publisher, row.subject]),
      publisher: text(row.publisher),
      subject: text(row.subject),
    } satisfies OpsTextbookOption)),
    teachers: teacherRows
      .filter((row) => row.is_visible !== false)
      .map((row) => ({
        id: text(row.id),
        label: text(row.name) || text(row.id),
        meta: optionMeta([Array.isArray(row.subjects) ? row.subjects.join(", ") : "", row.account_email]),
        subjects: Array.isArray(row.subjects) ? row.subjects.map((subject) => text(subject)).filter(Boolean) : [],
        profileId: text(row.profile_id),
        accountEmail: text(row.account_email),
        sortOrder: numberValue(row.sort_order),
      } satisfies OpsTeacherOption))
      .sort((left, right) => left.sortOrder - right.sortOrder || left.label.localeCompare(right.label, "ko")),
  }
}

async function readOpsTaskWorkspaceOptionData(
  options: OpsTaskWorkspaceOptionLoadOptions,
): Promise<OpsTaskWorkspaceOptionData> {
  if (!supabase) {
    return {
      ...emptyOpsTaskWorkspaceOptionData,
      schemaReady: false,
      error: "Supabase 연결 설정이 필요합니다.",
    }
  }

  try {
    const [profileRows, studentRows, classRows, textbookRows, teacherRows] = await Promise.all([
      readTable("profiles", "id,name,email,role,login_id", true),
      readTableWithFallback("students", "id,name,grade,school,contact,parent_contact,status,class_ids,waitlist_class_ids", "id,name,grade,school,contact,parent_contact,status", true),
      readOpsClassRows(options.taskType),
      readTable("textbooks", "id,title,name,publisher,subject", true),
      readTableWithFallback("teacher_catalogs", "id,name,subjects,is_visible,sort_order,profile_id,account_email", "id,name,subjects,is_visible,sort_order", true),
    ])

    return {
      ...buildOpsTaskWorkspaceOptionData(profileRows, studentRows, classRows, textbookRows, teacherRows),
      schemaReady: true,
      error: null,
    }
  } catch (error) {
    if (isMissingRelationError(error)) {
      return {
        ...emptyOpsTaskWorkspaceOptionData,
        schemaReady: false,
        error: "할 일 DB 마이그레이션을 적용한 뒤 새로고침하세요.",
      }
    }

    return {
      ...emptyOpsTaskWorkspaceOptionData,
      schemaReady: false,
      error: error instanceof Error ? error.message : "선택 정보를 불러오지 못했습니다.",
    }
  }
}

export async function loadOpsRegistrationWorkspaceOptionData(
  options: { viewerId?: string; force?: boolean } = {},
): Promise<OpsRegistrationWorkspaceOptionData> {
  const safeViewerId = text(options.viewerId)
  if (!safeViewerId) throw new Error("인증된 사용자 정보를 확인할 수 없습니다.")
  return loadRegistrationWorkspaceOptionData({
    viewerId: safeViewerId,
    force: options.force,
  })
}

export async function loadOpsTaskWorkspaceOptionData(
  options: OpsTaskWorkspaceOptionLoadOptions = {},
): Promise<OpsTaskWorkspaceOptionData> {
  if (options.taskType === "registration") {
    return loadOpsRegistrationWorkspaceOptionData({
      viewerId: options.viewerId,
      force: options.force,
    })
  }

  const cacheKey = getOpsTaskWorkspaceOptionCacheKey(options)
  const cached = opsTaskWorkspaceOptionDataCache.get(cacheKey)
  if (!options.force && cached && cached.expiresAt > Date.now()) return cached.data
  const inFlight = opsTaskWorkspaceOptionDataInFlight.get(cacheKey)
  if (!options.force && inFlight) return inFlight

  const loadPromise = readOpsTaskWorkspaceOptionData(options)
  opsTaskWorkspaceOptionDataInFlight.set(cacheKey, loadPromise)

  try {
    const data = await loadPromise
    if (
      data.schemaReady
      && data.error === null
      && opsTaskWorkspaceOptionDataInFlight.get(cacheKey) === loadPromise
    ) {
      opsTaskWorkspaceOptionDataCache.set(cacheKey, {
        data,
        expiresAt: Date.now() + OPS_TASK_WORKSPACE_CACHE_TTL_MS,
      })
    }
    return data
  } finally {
    if (opsTaskWorkspaceOptionDataInFlight.get(cacheKey) === loadPromise) {
      opsTaskWorkspaceOptionDataInFlight.delete(cacheKey)
    }
  }
}

export async function loadOpsTaskWorkspaceData(options: OpsTaskWorkspaceLoadOptions = {}): Promise<OpsTaskWorkspaceData> {
  const cacheKey = getOpsTaskWorkspaceCacheKey(options)
  const cached = opsTaskWorkspaceDataCache.get(cacheKey)
  if (!options.force && cached && cached.expiresAt > Date.now()) {
    if (options.taskType === "registration") {
      return runOpsTaskReadMeasure("registration:parent-list", true, async () => cached.data)
    }
    return cached.data
  }
  const inFlight = opsTaskWorkspaceDataInFlight.get(cacheKey)
  if (!options.force && inFlight) return inFlight

  const loadPromise = options.taskType === "registration"
    ? runOpsTaskReadMeasure(
        "registration:parent-list",
        false,
        (metrics) => readOpsTaskWorkspaceData(options, metrics),
      )
    : readOpsTaskWorkspaceData(options)
  opsTaskWorkspaceDataInFlight.set(cacheKey, loadPromise)

  try {
    const data = await loadPromise
    if (
      data.schemaReady
      && data.error === null
      && opsTaskWorkspaceDataInFlight.get(cacheKey) === loadPromise
    ) {
      opsTaskWorkspaceDataCache.set(cacheKey, {
        data,
        expiresAt: Date.now() + OPS_TASK_WORKSPACE_CACHE_TTL_MS,
      })
      persistOpsTaskWorkspaceData(options, data)
    }
    return data
  } finally {
    if (opsTaskWorkspaceDataInFlight.get(cacheKey) === loadPromise) {
      opsTaskWorkspaceDataInFlight.delete(cacheKey)
    }
  }
}

function getLegacyRegistrationTrackStatus(task: OpsTask): OpsRegistrationTrackStatus {
  const pipelineStatus = text(task.registration?.pipelineStatus)
  const viewKey = getRegistrationViewKey(pipelineStatus, task.status)
  if (viewKey === "level_test") return "level_test_scheduled"
  if (viewKey === "consulting") return "consultation_waiting"
  if (viewKey === "waiting") return "waiting"
  if (viewKey === "enrollment") return "enrollment_processing"
  if (viewKey === "closed") {
    if (pipelineStatus.startsWith("7.")) return "registered"
    if (pipelineStatus.startsWith("8.")) return "not_registered"
    return "inquiry_closed"
  }
  return "inquiry"
}

function createLegacyRegistrationTrackSummaries(tasks: OpsTask[]): OpsRegistrationTrackSummary[] {
  return tasks.flatMap((task) => {
    const subjects = parseRegistrationSubjects(task.subject)
      .filter((subject): subject is "영어" | "수학" => subject === "영어" || subject === "수학")
    const status = getLegacyRegistrationTrackStatus(task)
    const pipelineStatus = text(task.registration?.pipelineStatus)
    const waitingKind = pipelineStatus.startsWith("4-1.")
      ? "current_class"
      : pipelineStatus.startsWith("4-2.")
        ? "current_term_opening"
        : pipelineStatus.startsWith("4-3.")
          ? "next_term_opening"
          : ""

    return subjects.map((subject) => ({
      id: `legacy:${task.id}:${subject}`,
      taskId: task.id,
      subject,
      status,
      legacy: true,
      directorProfileId: null,
      directorName: "",
      directorAssignmentSource: "",
      directorAssignmentRuleKey: "",
      waitingKind,
      levelTestRetakeDecision: "",
      migrationReviewRequired: false,
      stageEnteredAt: task.registration?.inquiryAt || task.createdAt,
      phoneReadyAt: null,
      phoneReadySource: null,
    }))
  })
}

function resolveRegistrationTrackSummariesForParents(
  parentTasks: OpsTask[],
  summary: Awaited<ReturnType<typeof loadRegistrationTrackSummaries>>,
): OpsRegistrationTrackSummary[] {
  if (summary.mode === "legacy") return createLegacyRegistrationTrackSummaries(parentTasks)

  const childTracksByTaskId = new Map<string, OpsRegistrationTrackSummary[]>()
  summary.tracks.forEach((track) => {
    const current = childTracksByTaskId.get(track.taskId) || []
    current.push(track)
    childTracksByTaskId.set(track.taskId, current)
  })
  return parentTasks.flatMap((task) => {
    const registrationTracks = childTracksByTaskId.get(task.id) || []
    return registrationTracks.length > 0
      ? registrationTracks
      : createLegacyRegistrationTrackSummaries([task])
  })
}

async function readOpsRegistrationParentWorkspaceData(
  options: OpsTaskWorkspaceLoadOptions,
  metrics: { queryCount: number },
): Promise<OpsTaskWorkspaceData> {
  const safeViewerId = text(options.viewerId)
  if (!safeViewerId) {
    return {
      ...emptyOpsTaskWorkspaceData,
      schemaReady: false,
      error: "인증된 사용자 정보를 확인할 수 없습니다.",
    }
  }
  if (!supabase) {
    return {
      ...emptyOpsTaskWorkspaceData,
      schemaReady: false,
      error: "Supabase 연결 설정이 필요합니다.",
    }
  }

  try {
    metrics.queryCount += 1
    const taskReadPromise = supabase
      .from("ops_tasks")
      .select(OPS_REGISTRATION_PARENT_LIST_COLUMNS)
      .eq("type", "registration")
      .then(({ data, error }) => {
        if (error) throw error
        return (data || []) as unknown as Row[]
      })
    const taskRows = await taskReadPromise
    const registrationRows = embeddedTaskRows(taskRows, "ops_registration_details")
    const registration = singleByTaskId(registrationRows.map((row) => ({
      taskId: text(row.task_id),
      ...mapRegistration(row)!,
    })))
    const emptyProfiles = new Map<string, Row>()
    const emptyWithdrawal = new Map<string, OpsWithdrawalDetail>()
    const emptyTransfer = new Map<string, OpsTransferDetail>()
    const emptyWordRetest = new Map<string, OpsWordRetestDetail>()
    const emptyComments = new Map<string, OpsTaskComment[]>()
    const emptyAttachments = new Map<string, OpsTaskAttachment[]>()
    const emptyEvents = new Map<string, OpsTaskEvent[]>()
    const parentTasks = taskRows.map((row) => mapTask(
      row,
      emptyProfiles,
      registration,
      emptyWithdrawal,
      emptyTransfer,
      emptyWordRetest,
      emptyComments,
      emptyAttachments,
      emptyEvents,
    ))
    const taskIds = parentTasks.map((task) => task.id).filter(Boolean)
    const summary = await loadRegistrationTrackSummaries(
      taskIds,
      safeViewerId,
      { force: options.force },
    )

    if (summary.mode === "maintenance") {
      return {
        ...emptyOpsTaskWorkspaceData,
        schemaReady: false,
        error: "등록 데이터 전환 중입니다. 잠시 후 다시 시도하세요.",
      }
    }

    const tracks = resolveRegistrationTrackSummariesForParents(parentTasks, summary)
    const tracksByTaskId = byTaskId(tracks)
    const tasks = parentTasks
      .map((task) => ({
        ...task,
        registrationTracks: tracksByTaskId.get(task.id) || [],
      }))
      .sort((left, right) => (
        String(right.updatedAt || right.createdAt).localeCompare(String(left.updatedAt || left.createdAt))
      ))

    return {
      ...emptyOpsTaskWorkspaceData,
      tasks,
      schemaReady: true,
      error: null,
    }
  } catch (error) {
    if (isMissingRelationError(error)) {
      return {
        ...emptyOpsTaskWorkspaceData,
        schemaReady: false,
        error: "할 일 DB 마이그레이션을 적용한 뒤 새로고침하세요.",
      }
    }

    return {
      ...emptyOpsTaskWorkspaceData,
      schemaReady: false,
      error: error instanceof Error ? error.message : "등록 업무 목록을 불러오지 못했습니다.",
    }
  }
}

async function readOpsTaskWorkspaceData(
  options: OpsTaskWorkspaceLoadOptions,
  metrics: { queryCount: number } = { queryCount: 0 },
): Promise<OpsTaskWorkspaceData> {
  if (options.taskType === "registration") {
    return readOpsRegistrationParentWorkspaceData(options, metrics)
  }

  if (!supabase) {
    return {
      ...emptyOpsTaskWorkspaceData,
      schemaReady: false,
      error: "Supabase 연결 설정이 필요합니다.",
    }
  }

  try {
    let taskQuery = supabase.from("ops_tasks").select("*")
    if (options.taskType) taskQuery = taskQuery.eq("type", options.taskType)
    const taskReadPromise = taskQuery.then(({ data, error }) => {
      if (error) throw error
      return (data || []) as unknown as Row[]
    })
    const includeManagementOptions = options.includeManagementOptions !== false
    const includeTeacherOptions = shouldIncludeOpsTeacherOptions(options)
    const includeProfileOptions = options.includeProfileOptions !== false
    const [
      taskRows,
      profileRows,
      studentRows,
      classRows,
      textbookRows,
      teacherRows,
    ] = await Promise.all([
      taskReadPromise,
      includeProfileOptions
        ? readTable("profiles", "id,name,email,role,login_id", true)
        : Promise.resolve([]),
      includeManagementOptions
        ? readTableWithFallback("students", "id,name,grade,school,contact,parent_contact,status,class_ids,waitlist_class_ids", "id,name,grade,school,contact,parent_contact,status", true)
        : Promise.resolve([]),
      includeManagementOptions
        ? readOpsClassRows(options.taskType)
        : Promise.resolve([]),
      includeManagementOptions
        ? readTable("textbooks", "id,title,name,publisher,subject", true)
        : Promise.resolve([]),
      includeTeacherOptions
        ? readTableWithFallback("teacher_catalogs", "id,name,subjects,is_visible,sort_order,profile_id,account_email", "id,name,subjects,is_visible,sort_order", true)
        : Promise.resolve([]),
    ])

    const taskIds = taskRows.map((row) => text(row.id)).filter(Boolean)
    const shouldReadRegistration = !options.taskType
    const shouldReadWithdrawal = !options.taskType || options.taskType === "withdrawal"
    const shouldReadTransfer = !options.taskType || options.taskType === "transfer"
    const shouldReadWordRetest = !options.taskType || options.taskType === "word_retest"
    const [
      registrationRows,
      withdrawalRows,
      transferRows,
      wordRetestRows,
      commentRows,
      attachmentRows,
      eventRows,
    ] = await Promise.all([
      shouldReadRegistration ? readTaskScopedTable("ops_registration_details", taskIds) : Promise.resolve([]),
      shouldReadWithdrawal ? readTaskScopedTable("ops_withdrawal_details", taskIds) : Promise.resolve([]),
      shouldReadTransfer ? readTaskScopedTable("ops_transfer_details", taskIds) : Promise.resolve([]),
      shouldReadWordRetest ? readTaskScopedTable("ops_word_retests", taskIds) : Promise.resolve([]),
      readTaskScopedTable("ops_task_comments", taskIds),
      readTaskScopedTable("ops_task_attachments", taskIds),
      readTaskScopedTable("ops_task_events", taskIds),
    ])

    const profiles = buildProfileLookup(profileRows)
    const comments = byTaskId(commentRows.map((row) => mapComment(row, profiles)))
    const attachments = byTaskId(attachmentRows.map((row) => mapAttachment(row, profiles)))
    const events = byTaskId(eventRows.map((row) => mapEvent(row, profiles)))
    const registration = singleByTaskId(registrationRows.map((row) => ({
      taskId: text(row.task_id),
      ...mapRegistration(row)!,
    })))
    const withdrawal = singleByTaskId(withdrawalRows.map((row) => ({
      taskId: text(row.task_id),
      ...mapWithdrawal(row)!,
    })))
    const transfer = singleByTaskId(transferRows.map((row) => ({
      taskId: text(row.task_id),
      ...mapTransfer(row)!,
    })))
    const wordRetest = singleByTaskId(wordRetestRows.map((row) => ({
      taskId: text(row.task_id),
      ...mapWordRetest(row)!,
    })))

    const data = {
      tasks: taskRows
        .map((row) => mapTask(row, profiles, registration, withdrawal, transfer, wordRetest, comments, attachments, events))
        .sort((left, right) => (
          String(right.updatedAt || right.createdAt).localeCompare(String(left.updatedAt || left.createdAt))
        )),
      ...buildOpsTaskWorkspaceOptionData(profileRows, studentRows, classRows, textbookRows, teacherRows),
      schemaReady: true,
      error: null,
    }
    return data
  } catch (error) {
    if (isMissingRelationError(error)) {
      return {
        ...emptyOpsTaskWorkspaceData,
        schemaReady: false,
        error: "할 일 DB 마이그레이션을 적용한 뒤 새로고침하세요.",
      }
    }

    return {
      ...emptyOpsTaskWorkspaceData,
      schemaReady: false,
      error: error instanceof Error ? error.message : "할 일 데이터를 불러오지 못했습니다.",
    }
  }
}

export async function loadOpsTaskById(taskId: string): Promise<OpsTask | null> {
  if (!supabase || !text(taskId)) return null

  const taskResult = await supabase.from("ops_tasks").select("*").eq("id", taskId).limit(1)
  if (taskResult.error) {
    if (isMissingRelationError(taskResult.error)) return null
    throw taskResult.error
  }

  const taskRows = (taskResult.data || []) as unknown as Row[]
  if (taskRows.length === 0) return null

  const taskIds = [taskId]
  const [
    profileRows,
    registrationRows,
    withdrawalRows,
    transferRows,
    wordRetestRows,
    commentRows,
    attachmentRows,
    eventRows,
  ] = await Promise.all([
    readTable("profiles", "id,name,email,role,login_id", true),
    readTaskScopedTable("ops_registration_details", taskIds),
    readTaskScopedTable("ops_withdrawal_details", taskIds),
    readTaskScopedTable("ops_transfer_details", taskIds),
    readTaskScopedTable("ops_word_retests", taskIds),
    readTaskScopedTable("ops_task_comments", taskIds),
    readTaskScopedTable("ops_task_attachments", taskIds),
    readTaskScopedTable("ops_task_events", taskIds),
  ])

  const profiles = buildProfileLookup(profileRows)
  const comments = byTaskId(commentRows.map((row) => mapComment(row, profiles)))
  const attachments = byTaskId(attachmentRows.map((row) => mapAttachment(row, profiles)))
  const events = byTaskId(eventRows.map((row) => mapEvent(row, profiles)))
  const registration = singleByTaskId(registrationRows.map((row) => ({
    taskId: text(row.task_id),
    ...mapRegistration(row)!,
  })))
  const withdrawal = singleByTaskId(withdrawalRows.map((row) => ({
    taskId: text(row.task_id),
    ...mapWithdrawal(row)!,
  })))
  const transfer = singleByTaskId(transferRows.map((row) => ({
    taskId: text(row.task_id),
    ...mapTransfer(row)!,
  })))
  const wordRetest = singleByTaskId(wordRetestRows.map((row) => ({
    taskId: text(row.task_id),
    ...mapWordRetest(row)!,
  })))

  return mapTask(taskRows[0], profiles, registration, withdrawal, transfer, wordRetest, comments, attachments, events)
}

export function loadOpsRegistrationCaseDetail(
  taskId: string,
  viewerId: string,
  options: { force?: boolean } = {},
): Promise<OpsRegistrationCaseDetail> {
  const safeTaskId = text(taskId)
  const safeViewerId = text(viewerId)
  if (!safeTaskId) throw new Error("등록 업무를 선택하세요.")
  if (!safeViewerId) throw new Error("인증된 사용자 정보를 확인할 수 없습니다.")
  return loadRegistrationCaseDetail(safeTaskId, safeViewerId, options)
}

async function assertOpsTaskExists(taskId: string) {
  if (!supabase || !text(taskId)) throw new Error("업무 데이터를 다시 불러오세요.")

  const { data, error } = await supabase.from("ops_tasks").select("id").eq("id", taskId).limit(1)
  if (error) throw error
  if (((data || []) as unknown as Row[]).length === 0) throw new Error("업무 데이터를 다시 불러오세요.")
}

function isMissingOpsTaskReferenceError(error: unknown) {
  const code = typeof error === "object" && error ? text((error as { code?: string }).code) : ""
  const message = (error instanceof Error ? error.message : text((error as { message?: string })?.message)).toLowerCase()
  return code === "23503" || (message.includes("foreign key") && message.includes("ops_tasks"))
}

function throwIfMissingOpsTaskReference(error: unknown): never {
  if (isMissingOpsTaskReferenceError(error)) throw new Error("업무 데이터를 다시 불러오세요.")
  throw error
}

function didMutateOpsTask(data: unknown) {
  return ((data || []) as unknown as Row[]).length > 0
}

const OPS_TASK_OPTIONAL_TEAM_WORKFLOW_COLUMNS = ["requested_team", "assignee_team", "start_at"]
const OPS_WORD_RETEST_OPTIONAL_DETAIL_COLUMNS = ["teacher_catalog_id", "total_question_count", "score_out_of_100", "cutoff_question_count"]

function buildTaskRow(input: OpsTaskInput, options: { preserveManagementLinks?: boolean; completedAtFallback?: string } = {}) {
  const completedAt = nullableDate(input.completedAt) || (input.status === "done" ? nullableDate(options.completedAtFallback) : null)
  const row = {
    title: input.title,
    type: input.type,
    status: input.status || "requested",
    priority: input.priority || "normal",
    ...(text(input.requestedBy) ? { requested_by: nullable(input.requestedBy) } : {}),
    requested_team: nullable(input.requestedTeam),
    assignee_id: nullable(input.assigneeId),
    assignee_team: nullable(input.assigneeTeam),
    secondary_assignee_id: nullable(input.secondaryAssigneeId),
    student_id: nullable(input.studentId),
    class_id: nullable(input.classId),
    textbook_id: nullable(input.textbookId),
    student_name: nullable(input.studentName),
    class_name: nullable(input.className),
    textbook_title: nullable(input.textbookTitle),
    campus: nullable(input.campus),
    subject: nullable(input.subject),
    start_at: nullableDate(input.startAt),
    due_at: nullableDate(input.dueAt),
    completed_at: completedAt,
    memo: nullable(input.memo),
  }
  if (!options.preserveManagementLinks) return row

  const managementLinkColumns = new Set([
    "requested_team",
    "assignee_id",
    "assignee_team",
    "student_id",
    "class_id",
    "textbook_id",
    "student_name",
    "class_name",
    "textbook_title",
    "subject",
  ])
  const rowWithoutManagementLinks = Object.fromEntries(
    Object.entries(row).filter(([column]) => !managementLinkColumns.has(column)),
  )
  return rowWithoutManagementLinks
}

function buildRegistrationRow(taskId: string, detail: OpsRegistrationDetail = {}) {
  return {
    task_id: taskId,
    pipeline_status: nullable(detail.pipelineStatus) || REGISTRATION_PIPELINE_STATUSES[0]?.value || "0. 등록 문의",
    inquiry_at: nullableDate(detail.inquiryAt),
    school_grade: nullable(detail.schoolGrade),
    school_name: nullable(detail.schoolName),
    parent_phone: nullable(detail.parentPhone),
    student_phone: nullable(detail.studentPhone),
    level_test_at: nullableDate(detail.levelTestAt),
    level_test_completed_at: nullableDate(detail.levelTestCompletedAt),
    level_test_result: nullable(detail.levelTestResult),
    level_test_place: nullable(detail.levelTestPlace),
    level_test_material_link: nullable(detail.levelTestMaterialLink),
    counselor: nullable(detail.counselor),
    phone_consultation_at: nullableDate(detail.phoneConsultationAt),
    visit_consultation_at: nullableDate(detail.visitConsultationAt),
    consultation_at: nullableDate(detail.consultationAt),
    class_start_date: nullableDate(detail.classStartDate),
    class_start_session: nullable(detail.classStartSession),
    textbook_preparation: nullable(detail.textbookPreparation),
    visit_consultation_place: nullable(detail.visitConsultationPlace),
    textbook_ready: Boolean(detail.textbookReady),
    timetable_roster_updated: Boolean(detail.timetableRosterUpdated),
    admission_notice_sent: Boolean(detail.admissionNoticeSent),
    payment_checked: Boolean(detail.paymentChecked),
    makeedu_registered: Boolean(detail.makeeduRegistered),
    makeedu_invoice_sent: Boolean(detail.makeeduInvoiceSent),
    textbook_billing_issued: Boolean(detail.textbookBillingIssued),
    request_note: nullable(detail.requestNote),
  }
}

function buildWithdrawalRow(taskId: string, detail: OpsWithdrawalDetail = {}) {
  return {
    task_id: taskId,
    school_grade: nullable(detail.schoolGrade),
    teacher_name: nullable(detail.teacherName),
    withdrawal_date: nullableDate(detail.withdrawalDate),
    withdrawal_session: nullable(detail.withdrawalSession),
    customer_reason: nullable(detail.customerReason),
    teacher_opinion: nullable(detail.teacherOpinion),
    undistributed_textbooks: nullable(detail.undistributedTextbooks),
    completed_lesson_hours: nullableNumber(detail.completedLessonHours),
    four_week_lesson_hours: nullableNumber(detail.fourWeekLessonHours),
    timetable_roster_updated: Boolean(detail.timetableRosterUpdated),
    makeedu_withdrawal_done: Boolean(detail.makeeduWithdrawalDone),
    fee_processed: Boolean(detail.feeProcessed),
    textbook_fee_processed: Boolean(detail.textbookFeeProcessed),
  }
}

function buildTransferRow(taskId: string, detail: OpsTransferDetail = {}) {
  return {
    task_id: taskId,
    transfer_reason: nullable(detail.transferReason),
    from_class_id: nullable(detail.fromClassId),
    to_class_id: nullable(detail.toClassId),
    from_teacher_name: nullable(detail.fromTeacherName),
    to_teacher_name: nullable(detail.toTeacherName),
    from_class_name: nullable(detail.fromClassName),
    to_class_name: nullable(detail.toClassName),
    from_class_end_date: nullableDate(detail.fromClassEndDate),
    from_class_end_session: nullable(detail.fromClassEndSession),
    to_class_start_date: nullableDate(detail.toClassStartDate),
    to_class_start_session: nullable(detail.toClassStartSession),
    from_undistributed_textbooks: nullable(detail.fromUndistributedTextbooks),
    to_undistributed_textbooks: nullable(detail.toUndistributedTextbooks),
    timetable_roster_updated: Boolean(detail.timetableRosterUpdated),
    makeedu_transfer_done: Boolean(detail.makeeduTransferDone),
    fee_processed: Boolean(detail.feeProcessed),
    textbook_fee_processed: Boolean(detail.textbookFeeProcessed),
  }
}

function buildWordRetestRow(taskId: string, detail: OpsWordRetestDetail = {}) {
  return {
    task_id: taskId,
    branch: nullable(detail.branch) || "본관",
    teacher_catalog_id: nullable(detail.teacherId),
    teacher_name: nullable(detail.teacherName),
    class_name: nullable(detail.className),
    student_name: nullable(detail.studentName),
    test_at: nullableDate(detail.testAt),
    textbook_name: nullable(detail.textbookName),
    unit: nullable(detail.unit),
    request_note: nullable(detail.requestNote),
    total_question_count: nullableNumber(detail.totalQuestionCount),
    score_out_of_100: nullableNumber(detail.scoreOutOf100),
    cutoff_question_count: nullableNumber(detail.cutoffQuestionCount),
    first_score: nullableNumber(detail.firstScore),
    second_score: nullableNumber(detail.secondScore),
    third_score: nullableNumber(detail.thirdScore),
    retest_status: nullable(detail.retestStatus) || "not_started",
  }
}

type OpsTaskProducerResponse = {
  task?: Row
  previousTask?: Row
  comment?: Row
  event?: Row
  activityEventId?: unknown
  taskId?: unknown
  deleted?: unknown
  sourceId?: unknown
  sourceEventId?: unknown
  sourceEventIds?: unknown
}

function createOpsTaskRequestId() {
  if (!globalThis.crypto?.randomUUID) throw new Error("안전한 업무 요청 ID를 만들 수 없습니다.")
  return globalThis.crypto.randomUUID()
}

type OpsTaskProducerAttempt = {
  digest: string
  requestId: string
  createdAt: number
  expectedUpdatedAt?: string
}

const OPS_TASK_PRODUCER_ATTEMPT_PREFIX = "tips:ops-task-producer-attempt:v1:"
const OPS_TASK_PRODUCER_ATTEMPT_TTL_MS = 24 * 60 * 60 * 1000
const opsTaskProducerAttempts = new Map<string, OpsTaskProducerAttempt>()

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJsonValue)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value as Row)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableJsonValue(entry)]),
  )
}

async function opsTaskProducerDigest(name: string, parameters: Row) {
  if (!globalThis.crypto?.subtle) throw new Error("안전한 업무 요청 지문을 만들 수 없습니다.")
  const logicalParameters = { ...parameters }
  delete logicalParameters.p_expected_updated_at
  const canonical = JSON.stringify(stableJsonValue({ name, parameters: logicalParameters }))
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

function sweepExpiredOpsTaskProducerAttempts() {
  const expiredBefore = Date.now() - OPS_TASK_PRODUCER_ATTEMPT_TTL_MS
  for (const [key, attempt] of opsTaskProducerAttempts) {
    if (attempt.createdAt < expiredBefore) opsTaskProducerAttempts.delete(key)
  }
  if (typeof globalThis.sessionStorage === "undefined") return
  try {
    for (let index = globalThis.sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = globalThis.sessionStorage.key(index)
      if (!key?.startsWith(OPS_TASK_PRODUCER_ATTEMPT_PREFIX)) continue
      const raw = globalThis.sessionStorage.getItem(key)
      const stored = raw ? JSON.parse(raw) as Partial<OpsTaskProducerAttempt> : null
      if (typeof stored?.createdAt !== "number" || stored.createdAt < expiredBefore) {
        globalThis.sessionStorage.removeItem(key)
      }
    }
  } catch {
    // 저장소를 읽지 못해도 메모리 항목의 만료 정리는 끝났다.
  }
}

function readOpsTaskProducerAttempt(key: string) {
  const memory = opsTaskProducerAttempts.get(key)
  if (memory) return memory
  if (typeof globalThis.sessionStorage === "undefined") return null
  try {
    const raw = globalThis.sessionStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<OpsTaskProducerAttempt>
    if (
      typeof parsed.digest !== "string"
      || typeof parsed.requestId !== "string"
      || typeof parsed.createdAt !== "number"
      || (parsed.expectedUpdatedAt !== undefined && typeof parsed.expectedUpdatedAt !== "string")
    ) return null
    const attempt = parsed as OpsTaskProducerAttempt
    opsTaskProducerAttempts.set(key, attempt)
    return attempt
  } catch {
    return null
  }
}

function writeOpsTaskProducerAttempt(key: string, attempt: OpsTaskProducerAttempt) {
  opsTaskProducerAttempts.set(key, attempt)
  if (typeof globalThis.sessionStorage === "undefined") return
  try {
    globalThis.sessionStorage.setItem(key, JSON.stringify(attempt))
  } catch {
    // 메모리 보존으로 동일 탭의 응답 유실 재시도는 계속 보호한다.
  }
}

function clearOpsTaskProducerAttempt(key: string, requestId: string) {
  if (opsTaskProducerAttempts.get(key)?.requestId === requestId) {
    opsTaskProducerAttempts.delete(key)
  }
  if (typeof globalThis.sessionStorage === "undefined") return
  try {
    const raw = globalThis.sessionStorage.getItem(key)
    const stored = raw ? JSON.parse(raw) as Partial<OpsTaskProducerAttempt> : null
    if (stored?.requestId === requestId) globalThis.sessionStorage.removeItem(key)
  } catch {
    // 저장 성공 뒤 메모리 항목은 이미 제거했다.
  }
}

async function getOpsTaskProducerAttempt(name: string, parameters: Row) {
  sweepExpiredOpsTaskProducerAttempts()
  const digest = await opsTaskProducerDigest(name, parameters)
  const key = `${OPS_TASK_PRODUCER_ATTEMPT_PREFIX}${digest}`
  const existing = readOpsTaskProducerAttempt(key)
  const expectedUpdatedAt = text(parameters.p_expected_updated_at)
  if (
    existing?.digest === digest
    && Date.now() - existing.createdAt <= OPS_TASK_PRODUCER_ATTEMPT_TTL_MS
    && (!expectedUpdatedAt || Boolean(existing.expectedUpdatedAt))
  ) return { key, attempt: existing }
  const attempt = {
    digest,
    requestId: createOpsTaskRequestId(),
    createdAt: Date.now(),
    ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}),
  }
  writeOpsTaskProducerAttempt(key, attempt)
  return { key, attempt }
}

function withoutTaskId(row: Row) {
  const detail = { ...row }
  delete detail.task_id
  return detail
}

function buildOpsTaskProducerInput(input: OpsTaskInput, options: { completedAtFallback?: string } = {}) {
  const payload: Row = {
    task: buildTaskRow(input, options),
  }
  if (input.type === "word_retest") payload.word_retest = withoutTaskId(buildWordRetestRow("", input.wordRetest))
  if (input.type === "transfer") payload.transfer = withoutTaskId(buildTransferRow("", input.transfer))
  if (input.type === "withdrawal") payload.withdrawal = withoutTaskId(buildWithdrawalRow("", input.withdrawal))
  return payload
}

async function runOpsTaskProducerRpc(name: string, parameters: Row) {
  if (!supabase) throw new Error("Supabase 연결 설정이 필요합니다.")
  const { data, error } = await supabase.rpc(name, parameters)
  if (error) throw error
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("업무 저장 결과를 확인하지 못했습니다.")
  }
  return data as OpsTaskProducerResponse
}

async function runIdempotentOpsTaskProducerRpc(name: string, parameters: Row) {
  const { key, attempt } = await getOpsTaskProducerAttempt(name, parameters)
  try {
    const response = await runOpsTaskProducerRpc(name, {
      ...parameters,
      ...(attempt.expectedUpdatedAt
        ? { p_expected_updated_at: attempt.expectedUpdatedAt }
        : {}),
      p_request_id: attempt.requestId,
    })
    clearOpsTaskProducerAttempt(key, attempt.requestId)
    return response
  } catch (error) {
    const failure = error as { code?: unknown; message?: unknown }
    const code = text(failure?.code)
    const message = text(failure?.message)
    const definitiveConflict = code === "40001" && /(?:stale_write|not_allowed|closed|conflict)/i.test(message)
    if (["22023", "42501", "23514", "P0002"].includes(code) || definitiveConflict) {
      clearOpsTaskProducerAttempt(key, attempt.requestId)
    }
    throw error
  }
}

function producerTaskId(response: OpsTaskProducerResponse) {
  const taskId = text(response.task?.id)
  if (!taskId) throw new Error("저장된 업무 ID를 확인하지 못했습니다.")
  return taskId
}

function producerSourceEventIds(response: OpsTaskProducerResponse) {
  if (!Array.isArray(response.sourceEventIds)) return []
  return response.sourceEventIds.map(text).filter(Boolean)
}

const OPS_TASK_SOURCE_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function producerSourceEventId(response: OpsTaskProducerResponse) {
  const sourceEventId = text(response.sourceEventId)
  if (!OPS_TASK_SOURCE_UUID_PATTERN.test(sourceEventId)) {
    throw new Error("저장된 업무 이력 ID를 확인하지 못했습니다.")
  }
  return sourceEventId
}

function producerCommentSourceId(response: OpsTaskProducerResponse, commentId: string) {
  const sourceId = text(response.sourceId)
  if (!OPS_TASK_SOURCE_UUID_PATTERN.test(sourceId) || sourceId !== commentId) {
    throw new Error("저장된 댓글 ID를 확인하지 못했습니다.")
  }
  return sourceId
}

function producerActivityEventId(response: OpsTaskProducerResponse) {
  const activityEventId = text(response.activityEventId)
  if (!OPS_TASK_SOURCE_UUID_PATTERN.test(activityEventId)) {
    throw new Error("저장된 교재 업무 이력 ID를 확인하지 못했습니다.")
  }
  return activityEventId
}

function producerCleanupDeleted(response: OpsTaskProducerResponse, taskId: string) {
  if (response.deleted !== true || text(response.taskId) !== taskId) {
    throw new Error("생성 실패 업무 정리 결과를 확인하지 못했습니다.")
  }
}

export type OpsTaskProducerReceipt = Readonly<{
  taskId: string
  sourceEventIds: string[]
  activityEventId?: string
}>

export type OpsTaskSourceEventReceipt = Readonly<{
  sourceEventIds: string[]
  activityEventId?: string
}>

export type OpsTaskCommentReceipt = Readonly<{
  comment: OpsTaskComment
  sourceEventIds: string[]
}>

function stripMissingMigrationColumns(row: Row, columns: string[]) {
  const next = { ...row }
  columns.forEach((column) => {
    delete next[column]
  })
  return next
}

async function writeOpsTaskWithOptionalTeamWorkflowColumns(
  row: Row,
  write: (row: Row) => PromiseLike<{ data: unknown; error: unknown }>,
) {
  let result = await write(row)
  if (result.error && isMissingColumnError(result.error)) {
    result = await write(stripMissingMigrationColumns(row, OPS_TASK_OPTIONAL_TEAM_WORKFLOW_COLUMNS))
  }
  return result
}

async function upsertDetail(taskId: string, input: OpsTaskInput) {
  if (!supabase) return

  if (input.type === "registration") {
    const row = buildRegistrationRow(taskId, input.registration)
    let { error } = await supabase.from("ops_registration_details").upsert(row)
    if (error && isMissingColumnError(error)) {
      ;({ error } = await supabase
        .from("ops_registration_details")
        .upsert(stripMissingMigrationColumns(row, [...OPS_REGISTRATION_OPTIONAL_DETAIL_COLUMNS])))
    }
    if (error) throw error
  }
  if (input.type === "withdrawal") {
    const { error } = await supabase.from("ops_withdrawal_details").upsert(buildWithdrawalRow(taskId, input.withdrawal))
    if (error) throw error
  }
  if (input.type === "transfer") {
    const row = buildTransferRow(taskId, input.transfer)
    let { error } = await supabase.from("ops_transfer_details").upsert(row)
    if (error && isMissingColumnError(error)) {
      ;({ error } = await supabase
        .from("ops_transfer_details")
        .upsert(stripMissingMigrationColumns(row, ["from_class_id", "to_class_id"])))
    }
    if (error) throw error
  }
  if (input.type === "word_retest") {
    const row = buildWordRetestRow(taskId, input.wordRetest)
    let { error } = await supabase.from("ops_word_retests").upsert(row)
    if (error && isMissingColumnError(error)) {
      ;({ error } = await supabase
        .from("ops_word_retests")
        .upsert(stripMissingMigrationColumns(row, OPS_WORD_RETEST_OPTIONAL_DETAIL_COLUMNS)))
    }
    if (error) throw error
  }
}

function inputFromTask(task: OpsTask, status: OpsTaskStatus = task.status): OpsTaskInput {
  return {
    title: task.title,
    type: task.type,
    status,
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
  }
}

function isRegistrationWorkflowComplete(input: OpsTaskInput) {
  const pipelineStatus = text(input.registration?.pipelineStatus)
  return input.status === "done" || pipelineStatus.startsWith("7.")
}

function isRegistrationWaitlistPipelineStatus(value?: string) {
  return isRegistrationClassWaitlistStatus(value)
}

function getMissingRegistrationCheckLabels(registration?: OpsRegistrationDetail) {
  return [
    { checked: Boolean(registration?.admissionNoticeSent), label: "입학신청서 발송" },
    { checked: Boolean(registration?.makeeduRegistered), label: "메이크에듀 등록(수업, 교재)" },
    { checked: Boolean(registration?.makeeduInvoiceSent), label: "청구서 발송" },
    { checked: Boolean(registration?.paymentChecked), label: "수납 완료 확인" },
  ].filter((item) => !item.checked).map((item) => item.label)
}

function getMissingWithdrawalCheckLabels(withdrawal?: OpsWithdrawalDetail) {
  return [
    { checked: Boolean(withdrawal?.makeeduWithdrawalDone), label: "메이크에듀 퇴원처리" },
    { checked: Boolean(withdrawal?.feeProcessed), label: "수업료 처리" },
    { checked: Boolean(withdrawal?.textbookFeeProcessed), label: "교재비 처리" },
  ].filter((item) => !item.checked).map((item) => item.label)
}

function getMissingTransferCheckLabels(transfer?: OpsTransferDetail) {
  return [
    { checked: Boolean(transfer?.makeeduTransferDone), label: "메이크에듀 전반처리" },
    { checked: Boolean(transfer?.feeProcessed), label: "수업료 처리" },
    { checked: Boolean(transfer?.textbookFeeProcessed), label: "교재비 처리" },
  ].filter((item) => !item.checked).map((item) => item.label)
}

function findRegistrationPipelineStatus(prefix: string, fallback = "") {
  return REGISTRATION_PIPELINE_STATUSES.find((status) => text(status.value).startsWith(prefix))?.value || fallback
}

function isClosedRegistrationPipelineStatus(value?: string) {
  const current = text(value)
  return current.startsWith("7.") || current.startsWith("8.") || current.startsWith("9.")
}

function getRegistrationPipelineStatusForTaskStatus(status: OpsTaskStatus, currentPipelineStatus?: string) {
  const current = text(currentPipelineStatus)

  if (status === "done") return findRegistrationPipelineStatus("7.", current)
  if (status === "canceled") return current.startsWith("8.") || current.startsWith("9.") ? current : findRegistrationPipelineStatus("9.", current)
  if (status === "requested") return current.startsWith("0.") ? current : findRegistrationPipelineStatus("0.", current)
  if (status === "confirmed" && isClosedRegistrationPipelineStatus(current)) return findRegistrationPipelineStatus("1.", current)
  if (status === "in_progress" && isClosedRegistrationPipelineStatus(current)) return findRegistrationPipelineStatus("6.", current)
  if (status === "review_requested" && isClosedRegistrationPipelineStatus(current)) return findRegistrationPipelineStatus("6.", current)
  if (status === "on_hold" && isClosedRegistrationPipelineStatus(current)) return findRegistrationPipelineStatus("4-3.", current)

  return current
}

async function markRegistrationTextbookReady(taskId: string) {
  if (!supabase) return
  const { error } = await supabase
    .from("ops_registration_details")
    .upsert({ task_id: taskId, textbook_ready: true })
  if (error) throw error
  await writeEvent(taskId, "auto_checked", "교재 준비", "", "완료")
}

async function markRegistrationRosterUpdated(taskId: string) {
  if (!supabase) return
  const { error } = await supabase
    .from("ops_registration_details")
    .upsert({ task_id: taskId, timetable_roster_updated: true })
  if (error) {
    if (isMissingColumnError(error)) return
    throw error
  }
  await writeEvent(taskId, "auto_checked", "수업시간표 명단에 입력", "", "완료")
}

function getWordRetestDetailStatusForTaskStatus(status: OpsTaskStatus, currentRetestStatus?: string) {
  const current = text(currentRetestStatus)

  if (status === "done") return current === "absent" ? "absent" : "done"
  if (status === "canceled") return "absent"
  if (status === "review_requested") return current === "absent" ? "absent" : current === "done" ? "done" : "in_progress"
  if (status === "in_progress") return "in_progress"
  if (status === "requested" || status === "confirmed") return "not_started"
  if (status === "on_hold") return current === "in_progress" ? "in_progress" : current || "not_started"

  return current || "not_started"
}

function hasManagementReference(...values: unknown[]) {
  return values.some((value) => Boolean(text(value)))
}

function hasWordRetestScore(wordRetest?: OpsWordRetestDetail) {
  return [wordRetest?.firstScore, wordRetest?.secondScore, wordRetest?.thirdScore].some((score) => Boolean(text(score)))
}

function isWordRetestAbsent(wordRetest?: OpsWordRetestDetail) {
  return text(wordRetest?.retestStatus) === "absent"
}

function shouldRequireWordRetestScore(wordRetest?: OpsWordRetestDetail) {
  return !isWordRetestAbsent(wordRetest) && !hasWordRetestScore(wordRetest)
}

function inferClassBranch(row: Row | null) {
  const roomText = `${text(row?.room)} ${text(row?.campus)} ${text(row?.branch)}`
  if (roomText.includes("별관")) return "별관"
  if (roomText.includes("본관")) return "본관"
  return ""
}

function isSameManagementReference(first: unknown, second: unknown) {
  const firstValue = text(first)
  const secondValue = text(second)
  return firstValue !== "" && firstValue === secondValue
}

const MANAGEMENT_LINK_FIELDS = new Set(["학생", "수업", "교재", "전 수업", "후 수업", "선생님"])
const MANAGEMENT_INPUT_FIELDS = new Set(["학생명", "학부모 전화", "문의일시", "레벨테스트 예약일시", "레벨테스트 완료일시", "레벨테스트 결과", "시험지·결과지 URL", "상담 예약일시", "상담 완료일시", "상담 책임자", "수업시작일", "퇴원일", "전 수업 종료일", "후 수업 시작일", "본시험일", "시험범위", "점수"])
const MANAGEMENT_CHOICE_FIELDS = new Set(["과목", "학년", "레벨테스트 장소", "방문상담실", "다른 수업"])

function managementMissingFieldLabel(field: string) {
  if (MANAGEMENT_INPUT_FIELDS.has(field)) return `${field} 입력 필요`
  if (MANAGEMENT_CHOICE_FIELDS.has(field)) return `${field} 선택 필요`
  if (MANAGEMENT_LINK_FIELDS.has(field)) return `${field} 연결 필요`
  return `${field} 확인 필요`
}

function assertManagementSyncReady(input: OpsTaskInput) {
  const missingFields: string[] = []

  if (input.type === "registration" && text(input.registration?.pipelineStatus).startsWith("0.")) {
    getRegistrationCreateBlockers(input).forEach((label) => missingFields.push(label))
  }

  if (input.type === "registration") {
    getRegistrationTransitionBlockers(input, input.registration?.pipelineStatus).forEach((label) => missingFields.push(label))
  }

  if (input.type === "registration" && isRegistrationWaitlistPipelineStatus(input.registration?.pipelineStatus)) {
    if (!hasManagementReference(input.studentId, input.studentName)) missingFields.push("학생")
    if (!hasManagementReference(input.classId)) missingFields.push("수업")
  }

  if (input.type === "registration" && isRegistrationWorkflowComplete(input)) {
    if (!text(input.registration?.classStartDate)) missingFields.push("수업시작일")
    if (!text(input.registration?.classStartSession)) missingFields.push("수업시작일")
    if (!hasManagementReference(input.studentId, input.studentName)) missingFields.push("학생")
    if (!hasManagementReference(input.classId)) missingFields.push("수업")
    getMissingRegistrationCheckLabels(input.registration).forEach((label) => missingFields.push(label))
  }

  if (input.type === "withdrawal" && input.status === "done") {
    if (!text(input.withdrawal?.withdrawalDate)) missingFields.push("퇴원일")
    if (!hasManagementReference(input.studentId)) missingFields.push("학생")
    if (!hasManagementReference(input.classId)) missingFields.push("수업")
    getMissingWithdrawalCheckLabels(input.withdrawal).forEach((label) => missingFields.push(label))
  }

  if (input.type === "transfer" && input.status === "done") {
    const transfer = input.transfer || {}
    if (!text(transfer.fromClassEndDate)) missingFields.push("전 수업 종료일")
    if (!text(transfer.toClassStartDate)) missingFields.push("후 수업 시작일")
    if (!hasManagementReference(input.studentId)) missingFields.push("학생")
    if (!hasManagementReference(transfer.fromClassId)) missingFields.push("전 수업")
    if (!hasManagementReference(transfer.toClassId || input.classId)) {
      missingFields.push("후 수업")
    }
    if (isSameManagementReference(transfer.fromClassId, transfer.toClassId || input.classId)) missingFields.push("다른 수업")
    getMissingTransferCheckLabels(input.transfer).forEach((label) => missingFields.push(label))
  }

  if (input.type === "word_retest" && input.status === "done") {
    const wordRetest = input.wordRetest || {}
    if (!hasManagementReference(input.studentId)) missingFields.push("학생")
    if (!hasManagementReference(input.classId)) missingFields.push("수업")
    if (!hasManagementReference(wordRetest.teacherId)) missingFields.push("선생님")
    if (!hasManagementReference(input.textbookId)) missingFields.push("교재")
    if (!text(wordRetest.branch)) missingFields.push("지점")
    if (!text(wordRetest.testAt)) missingFields.push("본시험일")
    if (!text(wordRetest.unit)) missingFields.push("시험범위")
    if (shouldRequireWordRetestScore(wordRetest)) missingFields.push("점수")
  }

  if (missingFields.length > 0) {
    const uniqueMissingFields = [...new Set(missingFields)]
    throw new Error(`${getTaskTypeLabel(input.type)} 완료 전: ${uniqueMissingFields.map(managementMissingFieldLabel).join(", ")}`)
  }
}

function assertRegistrationInquiryBaseReady(input: OpsTaskInput) {
  if (input.type !== "registration") return
  const missingFields = getRegistrationCreateBlockers(input)
  if (missingFields.length === 0) return
  throw new Error(`${getTaskTypeLabel(input.type)} 완료 전: ${missingFields.map(managementMissingFieldLabel).join(", ")}`)
}

async function assertManagementSyncRecordsReady(input: OpsTaskInput) {
  if (input.type === "registration" && isRegistrationWaitlistPipelineStatus(input.registration?.pipelineStatus)) {
    const student = hasManagementReference(input.studentId) ? await resolveOpsRegistrationStudent(input) : null
    const classRow = await selectOpsRowById("classes", input.classId || "")

    if (hasManagementReference(input.studentId)) assertResolvedManagementRecord(student, "대기 등록 전에 학생 정보를 다시 선택하세요.")
    assertResolvedManagementRecord(classRow, "대기 등록 전에 대기할 수업을 다시 선택하세요.")
  }

  if (input.type === "registration" && isRegistrationWorkflowComplete(input)) {
    const student = hasManagementReference(input.studentId) ? await resolveOpsRegistrationStudent(input) : null
    const classRow = await selectOpsRowById("classes", input.classId || "")
    const textbook = hasManagementReference(input.textbookId)
      ? await selectOpsRowById("textbooks", input.textbookId || "")
      : null

    if (hasManagementReference(input.studentId)) assertResolvedManagementRecord(student, "등록 완료 전에 학생 정보를 다시 선택하세요.")
    assertResolvedManagementRecord(classRow, "등록 완료 전에 등록할 수업을 다시 선택하세요.")
    if (hasManagementReference(input.textbookId)) assertResolvedManagementRecord(textbook, "등록 완료 전에 등록 교재를 다시 선택하세요.")
    const selectedScheduleExists = getSelectableRegistrationScheduleSessions(recordValue(classRow.schedule_plan)).some((session) => (
      session.dateKey === text(input.registration?.classStartDate).slice(0, 10)
      && session.sessionLabel === text(input.registration?.classStartSession)
    ))
    if (!selectedScheduleExists) throw new Error("등록 완료 전에 수업 시작 일정을 다시 선택하세요.")
  }

  if (input.type === "withdrawal" && input.status === "done") {
    const student = await selectOpsRowById("students", input.studentId || "")
    const classRow = await selectOpsRowById("classes", input.classId || "")

    assertResolvedManagementRecord(student, "퇴원 완료 전에 기존 학생을 다시 선택하세요.")
    assertResolvedManagementRecord(classRow, "퇴원 완료 전에 기존 수업을 다시 선택하세요.")
    assertOpsStudentInClass(student, classRow, "퇴원 완료 전에 학생이 해당 수업 명단에 있는지 확인하세요.")
  }

  if (input.type === "transfer" && input.status === "done") {
    const transfer = input.transfer || {}
    const student = await selectOpsRowById("students", input.studentId || "")
    const fromClass = await selectOpsRowById("classes", transfer.fromClassId || "")
    const toClass = await selectOpsRowById("classes", transfer.toClassId || input.classId || "")

    assertResolvedManagementRecord(student, "전반 완료 전에 기존 학생을 다시 선택하세요.")
    assertResolvedManagementRecord(fromClass, "전반 완료 전에 전 수업을 다시 선택하세요.")
    assertResolvedManagementRecord(toClass, "전반 완료 전에 후 수업을 다시 선택하세요.")
    assertDifferentOpsClass(fromClass, toClass, "전반 완료 전에 전 수업과 후 수업을 다르게 선택하세요.")
    assertOpsStudentInClass(student, fromClass, "전반 완료 전에 학생이 전 수업 명단에 있는지 확인하세요.")
  }

  if (input.type === "word_retest" && input.status === "done") {
    const wordRetest = input.wordRetest || {}
    const student = await selectOpsRowById("students", input.studentId || "")
    const classRow = await selectOpsRowById("classes", input.classId || "")
    const textbook = await selectOpsRowById("textbooks", input.textbookId || "")
    const teacher = await selectOpsRowById("teacher_catalogs", wordRetest.teacherId || "")

    assertResolvedManagementRecord(student, "단어 재시험 완료 전에 기존 학생을 다시 선택하세요.")
    assertResolvedManagementRecord(classRow, "단어 재시험 완료 전에 기존 수업을 다시 선택하세요.")
    assertResolvedManagementRecord(textbook, "단어 재시험 완료 전에 기존 교재를 다시 선택하세요.")
    assertResolvedManagementRecord(teacher, "단어 재시험 완료 전에 담당 선생님을 다시 선택하세요.")
    assertOpsStudentInClass(student, classRow, "단어 재시험 완료 전에 학생이 해당 수업 명단에 있는지 확인하세요.")
  }
}

function assertResolvedManagementRecord(record: Row | null, message: string): asserts record is Row {
  if (!record) throw new Error(message)
}

function assertCompletedOperationStatusTransition(task: OpsTask, status: OpsTaskStatus) {
  if (task.type !== "general" && task.status === "done" && status !== "done") {
    throw new Error("완료된 운영 업무는 관리 데이터가 반영되어 상태만 되돌릴 수 없습니다.")
  }
}

function assertCompletedOperationEditable(task: OpsTask) {
  if (task.type !== "general" && task.status === "done") {
    throw new Error("완료된 운영 업무는 관리 데이터와 이력이 연결되어 수정할 수 없습니다.")
  }
}

async function selectOpsRowById(table: string, id: string) {
  if (!supabase || !text(id)) return null
  const { data, error } = await supabase.from(table).select("*").eq("id", id).limit(1)
  if (error) {
    if (isMissingRelationError(error) || isMissingColumnError(error)) return null
    throw error
  }
  return ((data || []) as unknown as Row[])[0] || null
}

async function findOpsStudentByName(input: OpsTaskInput) {
  if (!supabase) return null
  const studentName = text(input.studentName || input.wordRetest?.studentName)
  if (!studentName) return null

  const { data, error } = await supabase.from("students").select("*").eq("name", studentName).limit(20)
  if (error) {
    if (isMissingRelationError(error) || isMissingColumnError(error)) return null
    throw error
  }

  const rows = ((data || []) as unknown as Row[])
  if (input.type === "registration") {
    return rows.find((row) => matchesOpsRegistrationStudent(row, input)) || null
  }
  const school = text(input.registration?.schoolName)
  const studentPhone = text(input.registration?.studentPhone)
  return rows.find((row) => (
    (!school || text(row.school) === school) &&
    (!studentPhone || text(row.contact) === studentPhone)
  )) || rows[0] || null
}

async function resolveOpsStudent(input: OpsTaskInput) {
  if (input.type === "registration") return await resolveOpsRegistrationStudent(input)
  return await selectOpsRowById("students", input.studentId || "") || await findOpsStudentByName(input)
}

function matchesOpsRegistrationStudent(row: Row, input: OpsTaskInput) {
  const registration = input.registration || {}
  const studentName = text(input.studentName)
  if (!studentName || text(row.name) !== studentName) return false
  const identityFields = [
    { input: registrationPhoneIdentity(registration.studentPhone), row: registrationPhoneIdentity(row.contact) },
    { input: registrationPhoneIdentity(registration.parentPhone), row: registrationPhoneIdentity(row.parent_contact) },
  ].filter((field) => Boolean(field.input))
  const supportingFields = [
    { input: text(registration.schoolName), row: text(row.school) },
  ].filter((field) => Boolean(field.input))

  if (identityFields.length === 0) return false
  return identityFields.every((field) => field.row === field.input) && supportingFields.every((field) => field.row === field.input)
}

async function resolveOpsRegistrationStudent(input: OpsTaskInput) {
  const persistedStudentId = text(input.studentId)
  if (persistedStudentId) {
    const byId = await selectOpsRowById("students", persistedStudentId)
    if (byId && matchesOpsRegistrationStudent(byId, input)) return byId
    throw new Error("연결된 학생 정보가 등록 문의 정보와 일치하지 않습니다.")
  }
  if (!supabase) return null

  const studentName = text(input.studentName)
  if (!studentName) return null

  const { data, error } = await supabase.from("students").select("*").eq("name", studentName).limit(20)
  if (error) {
    if (isMissingRelationError(error) || isMissingColumnError(error)) return null
    throw error
  }

  return (((data || []) as unknown as Row[]).find((row) => matchesOpsRegistrationStudent(row, input))) || null
}

async function ensureOpsStudent(input: OpsTaskInput, existingStudent?: Row | null, createdStudentId = "") {
  if (!supabase) return null
  const existing = existingStudent === undefined ? await resolveOpsStudent(input) : existingStudent
  const studentName = text(input.studentName || input.wordRetest?.studentName || existing?.name)
  if (!studentName) return existing

  const registration = input.registration || {}
  const payload = {
    id: text(existing?.id) || text(createdStudentId) || createOpsId(),
    name: studentName,
    school: nullable(registration.schoolName) || nullable(existing?.school),
    grade: nullable(registration.schoolGrade) || nullable(existing?.grade),
    contact: nullable(registration.studentPhone) || nullable(existing?.contact),
    parent_contact: nullable(registration.parentPhone) || nullable(existing?.parent_contact),
    enroll_date: nullableDate(registration.classStartDate) || nullable(existing?.enroll_date) || new Date().toISOString().slice(0, 10),
    status: ACTIVE_STUDENT_STATUS,
    class_ids: normalizeIdList(existing?.class_ids),
    waitlist_class_ids: normalizeIdList(existing?.waitlist_class_ids),
  }

  let result = await supabase.from("students").upsert(payload).select("*").limit(1)
  if (result.error && isMissingColumnError(result.error)) {
    result = await supabase
      .from("students")
      .upsert(stripMissingMigrationColumns(payload, ["status", "class_ids", "waitlist_class_ids"]))
      .select("*")
      .limit(1)
  }
  if (result.error) throw result.error
  return ((result.data || []) as unknown as Row[])[0] || payload
}

async function resolveOpsClass(classId?: string, className?: string, teacherName?: string) {
  if (!supabase) return null
  const byId = await selectOpsRowById("classes", classId || "")
  if (byId) return byId

  const safeName = text(className)
  if (!safeName) return null

  const { data, error } = await supabase.from("classes").select("*").eq("name", safeName).limit(20)
  if (error) {
    if (isMissingRelationError(error) || isMissingColumnError(error)) return null
    throw error
  }
  const rows = ((data || []) as unknown as Row[])
  const safeTeacherName = text(teacherName)
  return rows.find((row) => !safeTeacherName || text(row.teacher) === safeTeacherName) || rows[0] || null
}

async function resolveOpsTextbook(textbookId?: string, textbookTitle?: string) {
  if (!supabase) return null
  const byId = await selectOpsRowById("textbooks", textbookId || "")
  if (byId) return byId

  const title = text(textbookTitle)
  if (!title) return null
  const byTitle = await supabase.from("textbooks").select("*").eq("title", title).limit(1)
  if (!byTitle.error && byTitle.data?.length) return (byTitle.data as unknown as Row[])[0]
  if (byTitle.error && !isMissingRelationError(byTitle.error) && !isMissingColumnError(byTitle.error)) throw byTitle.error

  const byName = await supabase.from("textbooks").select("*").eq("name", title).limit(1)
  if (byName.error) {
    if (isMissingRelationError(byName.error) || isMissingColumnError(byName.error)) return null
    throw byName.error
  }
  return ((byName.data || []) as unknown as Row[])[0] || null
}

async function resolveOpsTeacher(teacherId?: string, teacherName?: string) {
  if (!supabase) return null
  const byId = await selectOpsRowById("teacher_catalogs", teacherId || "")
  if (byId) return byId

  const name = text(teacherName)
  if (!name) return null
  const { data, error } = await supabase.from("teacher_catalogs").select("*").eq("name", name).limit(1)
  if (error) {
    if (isMissingRelationError(error) || isMissingColumnError(error)) return null
    throw error
  }
  return ((data || []) as unknown as Row[])[0] || null
}

function getOpsStudentClassMode(student: Row | null, classId: string) {
  const safeClassId = text(classId)
  if (!safeClassId) return ""
  if (normalizeIdList(student?.class_ids).includes(safeClassId)) return "enrolled"
  if (normalizeIdList(student?.waitlist_class_ids).includes(safeClassId)) return "waitlist"
  return ""
}

function hasOpsStudentClassRosterLink(student: Row | null, classRow: Row | null) {
  const studentId = text(student?.id)
  const classId = text(classRow?.id)
  if (!studentId || !classId) return false

  return (
    normalizeIdList(student?.class_ids).includes(classId) ||
    normalizeIdList(student?.waitlist_class_ids).includes(classId) ||
    normalizeIdList(classRow?.student_ids).includes(studentId) ||
    normalizeIdList(classRow?.waitlist_ids).includes(studentId)
  )
}

function hasSymmetricOpsStudentClassRosterLink(student: Row | null, classRow: Row | null) {
  const studentId = text(student?.id)
  const classId = text(classRow?.id)
  if (!studentId || !classId) return false

  const studentMode = getOpsStudentClassMode(student, classId)
  const classMode = normalizeIdList(classRow?.student_ids).includes(studentId)
    ? "enrolled"
    : normalizeIdList(classRow?.waitlist_ids).includes(studentId)
      ? "waitlist"
      : ""
  return (studentMode === "enrolled" && classMode === "enrolled")
    || (studentMode === "waitlist" && classMode === "waitlist")
}

function hasSymmetricOpsWaitlistLink(student: Row | null, classRow: Row | null) {
  const studentId = text(student?.id)
  const classId = text(classRow?.id)
  if (!studentId || !classId) return false
  return getOpsStudentClassMode(student, classId) === "waitlist"
    && normalizeIdList(classRow?.waitlist_ids).includes(studentId)
}

function hasOpsClassTextbookLink(classRow: Row | null, textbookId: string) {
  const safeTextbookId = text(textbookId)
  if (!safeTextbookId) return false
  return normalizeIdList(classRow?.textbook_ids).includes(safeTextbookId)
}

function assertOpsStudentInClass(student: Row | null, classRow: Row | null, message: string) {
  const studentId = text(student?.id)
  const classId = text(classRow?.id)
  const enrolledOnStudent = Boolean(classId) && normalizeIdList(student?.class_ids).includes(classId)
  const enrolledOnClass = Boolean(studentId) && normalizeIdList(classRow?.student_ids).includes(studentId)
  if (!enrolledOnStudent || !enrolledOnClass) throw new Error(message)
}

function assertDifferentOpsClass(firstClass: Row | null, secondClass: Row | null, message: string) {
  const firstClassId = text(firstClass?.id)
  const secondClassId = text(secondClass?.id)
  if (firstClassId && secondClassId && firstClassId === secondClassId) throw new Error(message)
}

async function assertOpsRosterLinked(studentId: string, classId: string, message: string) {
  if (!supabase || !studentId || !classId) return
  const [student, classRow] = await Promise.all([
    selectOpsRowById("students", studentId),
    selectOpsRowById("classes", classId),
  ])
  if (!hasSymmetricOpsStudentClassRosterLink(student, classRow)) throw new Error(message)
}

async function assertOpsRosterUnlinked(studentId: string, classId: string, message: string) {
  if (!supabase || !studentId || !classId) return
  const [student, classRow] = await Promise.all([
    selectOpsRowById("students", studentId),
    selectOpsRowById("classes", classId),
  ])
  if (hasOpsStudentClassRosterLink(student, classRow)) throw new Error(message)
}

async function assertOpsClassTextbookLinked(classId: string, textbookId: string, message: string) {
  if (!supabase || !classId || !textbookId) return
  const classRow = await selectOpsRowById("classes", classId)
  if (!hasOpsClassTextbookLink(classRow, textbookId)) throw new Error(message)
}

async function assertOpsStudentStatus(studentId: string, status: string, message: string) {
  if (!supabase || !studentId || !status) return
  const student = await selectOpsRowById("students", studentId)
  if (text(student?.status) !== status) throw new Error(message)
}

function isMissingOpsRosterRpc(error: unknown) {
  if (!error || typeof error !== "object") return false
  const row = error as Row
  const code = text(row.code).toUpperCase()
  const message = text(row.message).toLowerCase()
  return code === "PGRST202" || code === "42883"
    || (message.includes("schema cache") && message.includes("could not find the function"))
}

async function getOpsRosterRuntimeState() {
  const runtime = await probeRegistrationSubjectTrackRuntime()
  if (runtime.mode === "maintenance") {
    throw new Error("데이터 전환 중에는 학생 명단을 변경할 수 없습니다.")
  }
  return runtime
}

async function applyReadyOpsRosterMode(
  studentId: string,
  classId: string,
  nextMode: "enrolled" | "waitlist" | "removed",
  expectedMode: "enrolled" | "waitlist" | "removed",
  memo: string,
) {
  if (!supabase || !studentId || !classId) return false
  const runtime = await getOpsRosterRuntimeState()
  if (runtime.mode === "legacy") return false

  const { data, error } = await supabase.rpc("set_student_class_roster_mode", {
    p_student_id: studentId,
    p_class_id: classId,
    p_next_mode: nextMode,
    p_expected_mode: expectedMode,
    p_memo: memo,
  })
  if (error) {
    if (isMissingOpsRosterRpc(error)) {
      invalidateRegistrationSubjectTrackRuntimeAfterReadyFailure(error)
    }
    throw error
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("학생 명단 변경 결과를 다시 불러오세요.")
  }
  return true
}

async function completeReadyOpsRosterTransition(taskId: string, type: OpsTaskType) {
  if (!supabase || !taskId || !["withdrawal", "transfer"].includes(type)) return null
  const runtime = await getOpsRosterRuntimeState()
  const v2FunctionName = type === "withdrawal"
    ? "complete_ops_withdrawal_roster_transition_v2"
    : "complete_ops_transfer_roster_transition_v2"
  if (runtime.mode !== "legacy") {
    try {
      const response = await runIdempotentOpsTaskProducerRpc(v2FunctionName, {
        p_task_id: taskId,
      })
      return producerSourceEventIds(response)
    } catch (error) {
      if (!isMissingOpsRosterRpc(error)) throw error
      resetRegistrationSubjectTrackRuntimeProbe()
    }
  }

  const legacyFunctionName = type === "withdrawal"
    ? "complete_ops_withdrawal_roster_transition"
    : "complete_ops_transfer_roster_transition"
  const { data, error } = await supabase.rpc(legacyFunctionName, {
    p_task_id: taskId,
    p_request_key: `ops-${type}-completion-${taskId}`,
  })
  if (error) throw error
  return producerSourceEventIds(data as OpsTaskProducerResponse)
}

function getReadyOpsCompletionInput(input: OpsTaskInput): OpsTaskInput {
  if (input.type === "withdrawal") {
    return {
      ...input,
      withdrawal: { ...(input.withdrawal || {}), timetableRosterUpdated: false },
    }
  }
  if (input.type === "transfer") {
    return {
      ...input,
      transfer: { ...(input.transfer || {}), timetableRosterUpdated: false },
    }
  }
  return input
}

async function restoreOpsStudentRosterSnapshot(studentId: string, student: Row | null) {
  if (!supabase || !studentId || !student) return
  const { data, error } = await supabase.from("students").update({
    status: text(student.status) || null,
    class_ids: normalizeIdList(student.class_ids),
    waitlist_class_ids: normalizeIdList(student.waitlist_class_ids),
  }).eq("id", studentId).select("id")
  if (error && !isMissingColumnError(error)) throw error
  if (!error && !didMutateOpsTask(data)) throw new Error("학생 명단 복원 대상을 찾지 못했습니다.")
}

async function restoreOpsRegistrationStudentSnapshot(studentId: string, student: Row | null) {
  if (!supabase || !studentId || !student) return

  const payload = {
    name: text(student.name),
    school: nullable(student.school),
    grade: nullable(student.grade),
    contact: nullable(student.contact),
    parent_contact: nullable(student.parent_contact),
    enroll_date: nullableDate(student.enroll_date),
    status: text(student.status) || null,
    class_ids: normalizeIdList(student.class_ids),
    waitlist_class_ids: normalizeIdList(student.waitlist_class_ids),
  }

  let result = await supabase.from("students").update(payload).eq("id", studentId).select("id")
  if (result.error && isMissingColumnError(result.error)) {
    result = await supabase
      .from("students")
      .update(stripMissingMigrationColumns(payload, ["parent_contact", "enroll_date", "status", "class_ids", "waitlist_class_ids"]))
      .eq("id", studentId)
      .select("id")
  }
  if (result.error && !isMissingColumnError(result.error)) throw result.error
  if (!result.error && !didMutateOpsTask(result.data)) throw new Error("등록 학생 복원 대상을 찾지 못했습니다.")
}

async function restoreOpsClassRosterSnapshot(classId: string, classRow: Row | null) {
  if (!supabase || !classId || !classRow) return
  const { data, error } = await supabase.from("classes").update({
    student_ids: normalizeIdList(classRow.student_ids),
    waitlist_ids: normalizeIdList(classRow.waitlist_ids),
  }).eq("id", classId).select("id")
  if (error && !isMissingColumnError(error)) throw error
  if (!error && !didMutateOpsTask(data)) throw new Error("수업 명단 복원 대상을 찾지 못했습니다.")
}

async function restoreOpsStudentClassRosterSnapshots(studentId: string, student: Row | null, classId: string, classRow: Row | null) {
  const rollbackResults = await Promise.allSettled([
    restoreOpsStudentRosterSnapshot(studentId, student),
    restoreOpsClassRosterSnapshot(classId, classRow),
  ])
  throwFirstRejectedRollback(rollbackResults)
}

async function restoreOpsClassTextbookSnapshot(classId: string, classRow: Row | null) {
  if (!supabase || !classId || !classRow) return
  const { data, error } = await supabase.from("classes").update({
    textbook_ids: normalizeIdList(classRow.textbook_ids),
  }).eq("id", classId).select("id")
  if (error && !isMissingColumnError(error)) throw error
  if (!error && !didMutateOpsTask(data)) throw new Error("수업 교재 복원 대상을 찾지 못했습니다.")
}

async function deleteOpsRegistrationCreatedStudent(student: Row | null, shouldDelete: boolean) {
  if (!supabase || !shouldDelete) return
  const studentId = text(student?.id)
  if (!studentId) return
  const { error } = await supabase.from("students").delete().eq("id", studentId)
  if (error && !isMissingRelationError(error) && !isMissingColumnError(error)) throw error
}

function throwFirstRejectedRollback(rollbackResults: PromiseSettledResult<unknown>[]) {
  const failedRollback = rollbackResults.find((result) => result.status === "rejected") as PromiseRejectedResult | undefined
  if (failedRollback) throw failedRollback.reason
}

async function rollbackOpsRegistrationCompletionSync(taskId: string, student: Row, classRow: Row, originalStudent: Row | null = null, shouldDeleteCreatedStudent = false) {
  const studentId = text(student.id)
  const classId = text(classRow.id)
  let projectedStudent: Row | null = student
  let projectionReadError: unknown = null
  if (!shouldDeleteCreatedStudent) {
    try {
      projectedStudent = await selectOpsRowById("students", studentId) || student
    } catch (error) {
      projectionReadError = error
    }
  }
  const previousMode = getOpsStudentClassMode(projectedStudent, classId)
  const nextMode = getOpsStudentClassMode(originalStudent || student, classId)
  const studentRollback = shouldDeleteCreatedStudent
    ? deleteOpsRegistrationCreatedStudent(student, true)
    : restoreOpsRegistrationStudentSnapshot(studentId, originalStudent || student)
  const rollbackResults = await Promise.allSettled([
    studentRollback,
    restoreOpsClassRosterSnapshot(classId, classRow),
    restoreOpsClassTextbookSnapshot(classId, classRow),
  ])
  const rollbackErrors: unknown[] = projectionReadError ? [projectionReadError] : []
  for (const rollbackResult of rollbackResults) {
    if (rollbackResult.status === "rejected") rollbackErrors.push(rollbackResult.reason)
  }

  if (!shouldDeleteCreatedStudent && previousMode !== nextMode) {
    try {
      await insertOpsStudentClassHistory(
        studentId,
        classId,
        nextMode === "enrolled" ? "enrolled" : nextMode === "waitlist" ? "waitlist" : "removed",
        previousMode,
        nextMode,
        "registration_projection_rollback",
      )
    } catch (error) {
      rollbackErrors.push(error)
    }
  }

  const studentLabel = text(student.name) || studentId
  const classLabel = text(classRow.name) || classId
  try {
    await writeAutoSyncEventOnce(taskId, "registration_rollback", `${studentLabel} · ${classLabel}`)
  } catch (error) {
    rollbackErrors.push(error)
  }
  if (rollbackErrors.length > 0) throw rollbackErrors[0]
}

async function rollbackOpsTransferCompletionSync(taskId: string, student: Row, fromClass: Row, toClass: Row) {
  const studentId = text(student.id)
  const fromClassId = text(fromClass.id)
  const toClassId = text(toClass.id)
  const rollbackResults = await Promise.allSettled([
    restoreOpsStudentRosterSnapshot(studentId, student),
    restoreOpsClassRosterSnapshot(fromClassId, fromClass),
    restoreOpsClassRosterSnapshot(toClassId, toClass),
  ])
  throwFirstRejectedRollback(rollbackResults)

  const studentLabel = text(student.name) || studentId
  const fromClassLabel = text(fromClass.name) || fromClassId
  const toClassLabel = text(toClass.name) || toClassId
  await writeAutoSyncEventOnce(taskId, "transfer_rollback", `${studentLabel} · ${fromClassLabel} → ${toClassLabel}`)
}

async function rollbackOpsWithdrawalCompletionSync(taskId: string, student: Row, classRow: Row) {
  const studentId = text(student.id)
  const classId = text(classRow.id)
  const rollbackResults = await Promise.allSettled([
    restoreOpsStudentRosterSnapshot(studentId, student),
    restoreOpsClassRosterSnapshot(classId, classRow),
  ])
  throwFirstRejectedRollback(rollbackResults)

  const studentLabel = text(student.name) || studentId
  const classLabel = text(classRow.name) || classId
  await writeAutoSyncEventOnce(taskId, "withdrawal_rollback", `${studentLabel} · ${classLabel}`)
}

async function restoreOpsTaskLinkSnapshot(task: OpsTask) {
  await updateOpsTaskLinkFields(task.id, {
    student_id: nullable(task.studentId),
    student_name: nullable(task.studentName),
    class_id: nullable(task.classId),
    class_name: nullable(task.className),
    textbook_id: nullable(task.textbookId),
    textbook_title: nullable(task.textbookTitle),
    subject: nullable(task.subject),
    assignee_id: nullable(task.assigneeId),
  })
}

async function restoreOpsTaskDetailSnapshot(task: OpsTask) {
  const input = inputFromTask(task, task.status)

  if (task.type === "registration") {
    if (task.registration) {
      await upsertDetail(task.id, input)
    } else {
      await deleteOpsTaskDetailRow("ops_registration_details", task.id)
    }
    return
  }

  if (task.type === "withdrawal") {
    if (task.withdrawal) {
      await upsertDetail(task.id, input)
    } else {
      await deleteOpsTaskDetailRow("ops_withdrawal_details", task.id)
    }
    return
  }

  if (task.type === "transfer") {
    if (task.transfer) {
      await upsertDetail(task.id, input)
    } else {
      await deleteOpsTaskDetailRow("ops_transfer_details", task.id)
    }
    return
  }

  if (task.type === "word_retest") {
    if (task.wordRetest) {
      await upsertDetail(task.id, input)
    } else {
      await deleteOpsTaskDetailRow("ops_word_retests", task.id)
    }
  }
}

function uniqueOpsRowsById(rows: Array<Row | null>) {
  const rowsById = new Map<string, Row>()
  rows.forEach((row) => {
    const id = text(row?.id)
    if (id && row && !rowsById.has(id)) rowsById.set(id, row)
  })
  return [...rowsById.values()]
}

function equalOpsIdLists(first: unknown, second: unknown) {
  const firstIds = normalizeIdList(first).sort()
  const secondIds = normalizeIdList(second).sort()
  return firstIds.length === secondIds.length && firstIds.every((id, index) => id === secondIds[index])
}

async function assertRegistrationProjectionSnapshotsRestored(
  studentSnapshots: Row[],
  classSnapshots: Row[],
  createdStudentId: string,
) {
  for (const snapshot of studentSnapshots) {
    const restored = await selectOpsRowById("students", text(snapshot.id))
    if (
      !restored
      || text(restored.status) !== text(snapshot.status)
      || !equalOpsIdLists(restored.class_ids, snapshot.class_ids)
      || !equalOpsIdLists(restored.waitlist_class_ids, snapshot.waitlist_class_ids)
    ) {
      throw new Error("등록 학생 명단을 원래 상태로 복원하지 못했습니다.")
    }
  }
  for (const snapshot of classSnapshots) {
    const restored = await selectOpsRowById("classes", text(snapshot.id))
    if (
      !restored
      || !equalOpsIdLists(restored.student_ids, snapshot.student_ids)
      || !equalOpsIdLists(restored.waitlist_ids, snapshot.waitlist_ids)
      || !equalOpsIdLists(restored.textbook_ids, snapshot.textbook_ids)
    ) {
      throw new Error("등록 수업 명단을 원래 상태로 복원하지 못했습니다.")
    }
  }
  if (createdStudentId && await selectOpsRowById("students", createdStudentId)) {
    throw new Error("등록 실패 후 임시 학생 정보를 정리하지 못했습니다.")
  }
}

type OpsRegistrationRollbackHistory = {
  studentId: string
  classId: string
  previousMode: string
  nextMode: string
}

async function getRegistrationProjectionRollbackHistory(studentSnapshots: Row[], classSnapshots: Row[]) {
  const transitions: OpsRegistrationRollbackHistory[] = []
  for (const studentSnapshot of studentSnapshots) {
    const studentId = text(studentSnapshot.id)
    const currentStudent = await selectOpsRowById("students", studentId)
    if (!currentStudent) continue
    for (const classSnapshot of classSnapshots) {
      const classId = text(classSnapshot.id)
      const previousMode = getOpsStudentClassMode(currentStudent, classId)
      const nextMode = getOpsStudentClassMode(studentSnapshot, classId)
      if (previousMode !== nextMode) transitions.push({ studentId, classId, previousMode, nextMode })
    }
  }
  return transitions
}

async function writeRegistrationProjectionRollbackHistory(transitions: OpsRegistrationRollbackHistory[]) {
  const historyWrites = await Promise.allSettled(transitions.map((transition) => (
    insertOpsStudentClassHistory(
      transition.studentId,
      transition.classId,
      transition.nextMode === "enrolled" ? "enrolled" : transition.nextMode === "waitlist" ? "waitlist" : "removed",
      transition.previousMode,
      transition.nextMode,
      "registration_projection_rollback",
    )
  )))
  throwFirstRejectedRollback(historyWrites)
}

async function prepareRegistrationProjectionRollback(task: OpsTask, input: OpsTaskInput): Promise<OpsRegistrationProjectionRollback> {
  const previousInput = inputFromTask(task)
  const [previousStudent, targetStudent, previousClass, targetClass] = await Promise.all([
    text(task.studentId)
      ? selectOpsRowById("students", task.studentId)
      : resolveOpsRegistrationStudent(previousInput),
    resolveOpsRegistrationStudent(input),
    resolveOpsClass(task.classId, task.className),
    resolveOpsClass(input.classId, input.className),
  ])
  const studentSnapshots = uniqueOpsRowsById([previousStudent, targetStudent])
  const classSnapshots = uniqueOpsRowsById([previousClass, targetClass])
  const shouldEnsureStudent = shouldEnsureRegistrationStudent(
    input.registration?.pipelineStatus,
    isRegistrationWorkflowComplete(input),
  )
  const createdStudentId = !targetStudent && shouldEnsureStudent ? createOpsId() : ""

  return {
    createdStudentId,
    rollback: async () => {
      if (!supabase) return
      let firstRollbackError: unknown = null
      let rollbackHistory: OpsRegistrationRollbackHistory[] = []
      const captureRollback = async (operation: () => Promise<void>) => {
        try {
          await operation()
        } catch (rollbackError) {
          firstRollbackError ||= rollbackError
        }
      }

      await captureRollback(async () => {
        rollbackHistory = await getRegistrationProjectionRollbackHistory(studentSnapshots, classSnapshots)
      })
      await captureRollback(async () => {
        const projectionRollbackResults = await Promise.allSettled([
          ...studentSnapshots.map((student) => restoreOpsRegistrationStudentSnapshot(text(student.id), student)),
          ...classSnapshots.flatMap((classRow) => [
            restoreOpsClassRosterSnapshot(text(classRow.id), classRow),
            restoreOpsClassTextbookSnapshot(text(classRow.id), classRow),
          ]),
        ])
        throwFirstRejectedRollback(projectionRollbackResults)
      })
      await captureRollback(() => deleteOpsRegistrationCreatedStudent(
        createdStudentId ? { id: createdStudentId } : null,
        Boolean(createdStudentId),
      ))
      await captureRollback(() => assertRegistrationProjectionSnapshotsRestored(studentSnapshots, classSnapshots, createdStudentId))
      await captureRollback(() => restoreOpsTaskLinkSnapshot(task))
      await captureRollback(() => restoreOpsTaskDetailSnapshot(task))
      await captureRollback(() => writeRegistrationProjectionRollbackHistory(rollbackHistory))
      await captureRollback(async () => {
        await writeEvent(task.id, "rollback", "등록 저장", "변경 시도", "원래 상태 복원")
      })
      if (firstRollbackError) throw firstRollbackError
    },
  }
}

async function prepareOpsCompletionStatusRollback(task: OpsTask, input: OpsTaskInput): Promise<OpsCompletionRollback | null> {
  if (input.type === "withdrawal" && input.status === "done") {
    const student = await resolveOpsStudent(input)
    const classRow = await resolveOpsClass(input.classId, input.className, input.withdrawal?.teacherName)

    return async () => {
      if (student && classRow) {
        await rollbackOpsWithdrawalCompletionSync(task.id, student, classRow)
      }
      await restoreOpsTaskLinkSnapshot(task)
      await restoreOpsTaskDetailSnapshot(task)
    }
  }

  if (input.type === "transfer" && input.status === "done") {
    const transfer = input.transfer || {}
    const student = await resolveOpsStudent(input)
    const fromClass = await resolveOpsClass(transfer.fromClassId, transfer.fromClassName, transfer.fromTeacherName)
    const toClass = await resolveOpsClass(transfer.toClassId || input.classId, transfer.toClassName || input.className, transfer.toTeacherName)

    return async () => {
      if (student && fromClass && toClass) {
        await rollbackOpsTransferCompletionSync(task.id, student, fromClass, toClass)
      }
      await restoreOpsTaskLinkSnapshot(task)
      await restoreOpsTaskDetailSnapshot(task)
    }
  }

  if (input.type === "word_retest" && input.status === "done") {
    return async () => {
      await restoreOpsTaskLinkSnapshot(task)
      await restoreOpsTaskDetailSnapshot(task)
      await syncWordRetestManagementLinks(task.id, inputFromTask(task, task.status))
    }
  }

  return null
}

async function prepareCreatedOpsCompletionSyncRollback(taskId: string, input: OpsTaskInput) {
  const shouldRollbackRegistrationProjection = input.type === "registration" && (
    isRegistrationWorkflowComplete(input) || isRegistrationWaitlistPipelineStatus(input.registration?.pipelineStatus)
  )
  if (shouldRollbackRegistrationProjection) {
    const originalStudent = await resolveOpsStudent(input)
    const classRow = await resolveOpsClass(input.classId, input.className)
    const registrationCreatedStudentId = originalStudent ? "" : createOpsId()

    return {
      registrationCreatedStudentId,
      rollback: async () => {
        const studentId = text(originalStudent?.id) || registrationCreatedStudentId
        const student = studentId ? await selectOpsRowById("students", studentId) : null
        if (student && classRow) {
          await rollbackOpsRegistrationCompletionSync(taskId, student, classRow, originalStudent, Boolean(registrationCreatedStudentId))
          return
        }
        if (classRow) {
          await restoreOpsClassRosterSnapshot(text(classRow.id), classRow)
          await restoreOpsClassTextbookSnapshot(text(classRow.id), classRow)
        }
      },
    }
  }

  if (input.status !== "done") return { rollback: null, registrationCreatedStudentId: "" }

  if (input.type === "withdrawal") {
    const student = await resolveOpsStudent(input)
    const classRow = await resolveOpsClass(input.classId, input.className, input.withdrawal?.teacherName)

    return {
      registrationCreatedStudentId: "",
      rollback: async () => {
        if (student && classRow) {
          await rollbackOpsWithdrawalCompletionSync(taskId, student, classRow)
        }
      },
    }
  }

  if (input.type === "transfer") {
    const transfer = input.transfer || {}
    const student = await resolveOpsStudent(input)
    const fromClass = await resolveOpsClass(transfer.fromClassId, transfer.fromClassName, transfer.fromTeacherName)
    const toClass = await resolveOpsClass(transfer.toClassId || input.classId, transfer.toClassName || input.className, transfer.toTeacherName)

    return {
      registrationCreatedStudentId: "",
      rollback: async () => {
        if (student && fromClass && toClass) {
          await rollbackOpsTransferCompletionSync(taskId, student, fromClass, toClass)
        }
      },
    }
  }

  return { rollback: null, registrationCreatedStudentId: "" }
}

async function rollbackAppliedCompletionSync(rollbackCompletionSync: OpsCompletionRollback | null, completionSyncApplied: boolean, originalError: unknown) {
  if (!completionSyncApplied || !rollbackCompletionSync) return

  try {
    await rollbackCompletionSync()
  } catch (rollbackError) {
    attachOpsTaskCleanupError(originalError, rollbackError)
  }
}

async function insertOpsStudentClassHistory(studentId: string, classId: string, action: "enrolled" | "waitlist" | "removed", previousMode: string, nextMode: string, memo: string) {
  if (!supabase || !studentId || !classId) return
  const { error } = await supabase.from("student_class_enrollment_history").insert({
    student_id: studentId,
    class_id: classId,
    action,
    previous_mode: nullable(previousMode),
    next_mode: nullable(nextMode),
    memo,
  })
  if (error && !isMissingRelationError(error) && !isMissingColumnError(error)) throw error
}

async function waitForOpsRosterWriteResults(
  writes: Array<PromiseLike<{ data: unknown; error: unknown }>>,
) {
  const settledWrites = await Promise.allSettled(writes)
  const results: Array<{ data: unknown; error: unknown }> = []
  for (const settledWrite of settledWrites) {
    if (settledWrite.status === "rejected") throw settledWrite.reason
    results.push(settledWrite.value)
  }
  return results
}

async function assignOpsStudentToClass(student: Row | null, classRow: Row | null, memo = "ops_task") {
  if (!supabase || !student || !classRow) return
  const studentId = text(student.id)
  const classId = text(classRow.id)
  if (!studentId || !classId) return

  const previousMode = getOpsStudentClassMode(student, classId)
  if (await applyReadyOpsRosterMode(studentId, classId, "enrolled", previousMode || "removed", memo)) return
  const studentPatch = {
    status: ACTIVE_STUDENT_STATUS,
    class_ids: addUniqueId(student.class_ids, classId),
    waitlist_class_ids: removeId(student.waitlist_class_ids, classId),
  }
  const classPatch = {
    student_ids: addUniqueId(classRow.student_ids, studentId),
    waitlist_ids: removeId(classRow.waitlist_ids, studentId),
  }

  try {
    const [studentResult, classResult] = await waitForOpsRosterWriteResults([
      supabase.from("students").update(studentPatch).eq("id", studentId).select("id"),
      supabase.from("classes").update(classPatch).eq("id", classId).select("id"),
    ])
    if (studentResult.error) throw studentResult.error
    if (classResult.error) throw classResult.error
    if (!didMutateOpsTask(studentResult.data) || !didMutateOpsTask(classResult.data)) {
      throw new Error("수업명단 등록 중 대상 학생 또는 수업을 찾지 못했습니다.")
    }
    await assertOpsRosterLinked(studentId, classId, "수업명단 등록 후 학생과 수업 연결을 확인하지 못했습니다.")
  } catch (error) {
    await restoreOpsStudentClassRosterSnapshots(studentId, student, classId, classRow)
    throw error
  }
  if (previousMode !== "enrolled") {
    await insertOpsStudentClassHistory(studentId, classId, "enrolled", previousMode, "enrolled", memo)
  }
}

async function assignOpsStudentToWaitlist(student: Row | null, classRow: Row | null, memo = "ops_task") {
  if (!supabase || !student || !classRow) return
  const studentId = text(student.id)
  const classId = text(classRow.id)
  if (!studentId || !classId) return

  const assignmentBlockers = getRegistrationWaitlistAssignmentBlockers({
    classId,
    studentClassIds: normalizeIdList(student.class_ids),
  })
  if (assignmentBlockers.length > 0) {
    throw new Error("이미 등록된 수업에는 대기 등록할 수 없습니다. 다른 수업을 선택하세요.")
  }

  const previousMode = getOpsStudentClassMode(student, classId)
  if (await applyReadyOpsRosterMode(studentId, classId, "waitlist", previousMode || "removed", memo)) return
  const studentPatch = {
    status: ACTIVE_STUDENT_STATUS,
    class_ids: removeId(student.class_ids, classId),
    waitlist_class_ids: addUniqueId(student.waitlist_class_ids, classId),
  }
  const classPatch = {
    student_ids: removeId(classRow.student_ids, studentId),
    waitlist_ids: addUniqueId(classRow.waitlist_ids, studentId),
  }

  try {
    const [studentResult, classResult] = await waitForOpsRosterWriteResults([
      supabase.from("students").update(studentPatch).eq("id", studentId).select("id"),
      supabase.from("classes").update(classPatch).eq("id", classId).select("id"),
    ])
    if (studentResult.error) throw studentResult.error
    if (classResult.error) throw classResult.error
    if (!didMutateOpsTask(studentResult.data) || !didMutateOpsTask(classResult.data)) {
      throw new Error("대기명단 등록 중 대상 학생 또는 수업을 찾지 못했습니다.")
    }
    await assertOpsRosterLinked(studentId, classId, "대기명단 등록 후 학생과 수업 연결을 확인하지 못했습니다.")
  } catch (error) {
    await restoreOpsStudentClassRosterSnapshots(studentId, student, classId, classRow)
    throw error
  }

  if (previousMode !== "waitlist") {
    await insertOpsStudentClassHistory(studentId, classId, "waitlist", previousMode, "waitlist", memo)
  }
}

async function assignOpsTextbookToClass(classRow: Row | null, textbook: Row | null) {
  if (!supabase || !classRow || !textbook) return
  const classId = text(classRow.id)
  const textbookId = text(textbook.id)
  if (!classId || !textbookId) return

  try {
    const { data, error } = await supabase
      .from("classes")
      .update({
        textbook_ids: addUniqueId(classRow.textbook_ids, textbookId),
      })
      .eq("id", classId)
      .select("id")
    if (error && !isMissingColumnError(error)) throw error
    if (!error && !didMutateOpsTask(data)) throw new Error("등록 교재를 연결할 수업을 찾지 못했습니다.")
    await assertOpsClassTextbookLinked(classId, textbookId, "등록 교재를 수업에 연결하지 못했습니다.")
  } catch (error) {
    await restoreOpsClassTextbookSnapshot(classId, classRow)
    throw error
  }
}

async function removeOpsStudentFromClass(student: Row | null, classRow: Row | null, memo = "ops_task") {
  if (!supabase || !student || !classRow) return
  const studentId = text(student.id)
  const classId = text(classRow.id)
  if (!studentId || !classId) return

  const previousMode = getOpsStudentClassMode(student, classId)
  if (await applyReadyOpsRosterMode(studentId, classId, "removed", previousMode || "removed", memo)) return
  try {
    const [studentResult, classResult] = await waitForOpsRosterWriteResults([
      supabase.from("students").update({
        class_ids: removeId(student.class_ids, classId),
        waitlist_class_ids: removeId(student.waitlist_class_ids, classId),
      }).eq("id", studentId).select("id"),
      supabase.from("classes").update({
        student_ids: removeId(classRow.student_ids, studentId),
        waitlist_ids: removeId(classRow.waitlist_ids, studentId),
      }).eq("id", classId).select("id"),
    ])
    if (studentResult.error) throw studentResult.error
    if (classResult.error) throw classResult.error
    if (!didMutateOpsTask(studentResult.data) || !didMutateOpsTask(classResult.data)) {
      throw new Error("수업명단 제거 중 대상 학생 또는 수업을 찾지 못했습니다.")
    }
    await assertOpsRosterUnlinked(studentId, classId, "수업명단 제거 후 학생과 수업 연결이 남아 있습니다.")
  } catch (error) {
    await restoreOpsStudentClassRosterSnapshots(studentId, student, classId, classRow)
    throw error
  }
  if (previousMode) {
    await insertOpsStudentClassHistory(studentId, classId, "removed", previousMode, "", memo)
  }
}

async function setOpsStudentStatus(student: Row | null, status: string) {
  if (!supabase || !student || !text(student.id)) return
  const studentId = text(student.id)
  const { error } = await supabase.from("students").update({ status }).eq("id", studentId)
  if (error && !isMissingColumnError(error)) throw error
  await assertOpsStudentStatus(studentId, status, "학생 상태 변경을 확인하지 못했습니다.")
}

async function updateOpsTaskLinkFields(taskId: string, patch: Record<string, OpsTaskLinkPatchValue>) {
  if (!supabase) return
  const nextPatch = Object.fromEntries(
    Object.entries(patch)
      .map(([key, value]) => [key, value === null ? null : text(value)])
      .filter(([, value]) => value === null || Boolean(value)),
  )
  if (Object.keys(nextPatch).length === 0) return
  let { data, error } = await supabase.from("ops_tasks").update(nextPatch).eq("id", taskId).select("id")
  if (error && isMissingColumnError(error)) {
    const fallbackPatch = stripMissingMigrationColumns(nextPatch, OPS_TASK_OPTIONAL_TEAM_WORKFLOW_COLUMNS)
    if (Object.keys(fallbackPatch).length === 0) return
    ;({ data, error } = await supabase.from("ops_tasks").update(fallbackPatch).eq("id", taskId).select("id"))
  }
  if (error) throw error
  if (!didMutateOpsTask(data)) throw new Error("업무 연결 정보를 다시 불러오세요.")
}

async function syncRegistrationPipelineStatusForTaskStatus(task: OpsTask, status: OpsTaskStatus): Promise<OpsCompletionRollback | null> {
  if (!supabase || task.type !== "registration") return null

  const previousPipelineStatus = text(task.registration?.pipelineStatus)
  const pipelineStatus = getRegistrationPipelineStatusForTaskStatus(status, previousPipelineStatus)
  if (!pipelineStatus || pipelineStatus === previousPipelineStatus) return null

  const { error } = await supabase
    .from("ops_registration_details")
    .upsert({ task_id: task.id, pipeline_status: pipelineStatus })
  if (error) throw error

  return async () => {
    if (!supabase) return
    if (!previousPipelineStatus) {
      await deleteOpsTaskDetailRow("ops_registration_details", task.id)
      return
    }
    const { error: rollbackError } = await supabase
      .from("ops_registration_details")
      .upsert({ task_id: task.id, pipeline_status: previousPipelineStatus })
    if (rollbackError) throw rollbackError
  }
}

async function restorePreviousRegistrationWaitlist(student: Row, classRow: Row) {
  const refreshedStudent = await selectOpsRowById("students", text(student.id)) || student
  const refreshedClass = await selectOpsRowById("classes", text(classRow.id)) || classRow
  await assignOpsStudentToWaitlist(refreshedStudent, refreshedClass, "registration_waitlist_restored")
}

async function syncRegistrationWaitlist(
  taskId: string,
  input: OpsTaskInput,
  previousTask: OpsTask | null,
  student: Row | null,
  classRow: Row | null,
) {
  const waiting = isRegistrationWaitlistPipelineStatus(input.registration?.pipelineStatus)
  const previousInput = previousTask ? inputFromTask(previousTask) : null
  const previousStudent = previousInput ? await resolveOpsRegistrationStudent(previousInput) : null
  const previousClass = previousTask
    ? await resolveOpsClass(previousTask.classId, previousTask.className)
    : null
  const previousWasLegacyNextOpeningWaitlist = Boolean(
    text(previousTask?.registration?.pipelineStatus).startsWith("4-3.")
    && previousStudent
    && previousClass
    && getOpsStudentClassMode(previousStudent, text(previousClass.id)) === "waitlist",
  )
  const previousWaiting = isRegistrationWaitlistPipelineStatus(previousTask?.registration?.pipelineStatus)
    || previousWasLegacyNextOpeningWaitlist
  const changedRelation = (
    text(previousStudent?.id) !== text(student?.id) ||
    text(previousClass?.id) !== text(classRow?.id)
  )
  let previousWaitlistRemoved = false

  if (previousWaiting && previousStudent && previousClass && (!waiting || changedRelation)) {
    await removeOpsStudentFromClass(previousStudent, previousClass, "registration_waitlist_removed")
    previousWaitlistRemoved = true
    await writeAutoSyncEventOnce(
      taskId,
      "대기명단",
      `${text(previousClass.name) || previousTask?.className || "수업"} 대기 제거 · registration_waitlist_removed`,
    )
  }

  if (!waiting) return
  assertResolvedManagementRecord(student, "대기 등록 전에 학생 정보를 입력하세요.")
  assertResolvedManagementRecord(classRow, "대기 등록 전에 대기할 수업을 선택하세요.")
  try {
    await assignOpsStudentToWaitlist(student, classRow, "registration_waitlist")
  } catch (error) {
    if (previousWaitlistRemoved && previousStudent && previousClass) {
      try {
        await restorePreviousRegistrationWaitlist(previousStudent, previousClass)
      } catch (rollbackError) {
        attachOpsTaskCleanupError(error, rollbackError)
      }
    }
    throw error
  }
  await writeAutoSyncEventOnce(
    taskId,
    "대기명단",
    `${text(classRow.name) || text(input.className)} 대기 등록 · waitlist_registered`,
  )
}

async function syncRegistrationManagementLinks(
  taskId: string,
  input: OpsTaskInput,
  previousTask: OpsTask | null = null,
  options: { createdStudentId?: string } = {},
) {
  const completed = isRegistrationWorkflowComplete(input)
  const shouldEnsureStudent = shouldEnsureRegistrationStudent(input.registration?.pipelineStatus, completed)
  const existingStudent = shouldEnsureStudent ? await resolveOpsRegistrationStudent(input) : null
  const linkedStudent = shouldEnsureStudent ? existingStudent : await resolveOpsRegistrationStudent(input)
  const student = shouldEnsureStudent
    ? await ensureOpsStudent(input, existingStudent, options.createdStudentId)
    : linkedStudent
  const shouldDeleteCreatedStudent = completed && !existingStudent && Boolean(text(student?.id))
  const classRow = await resolveOpsClass(input.classId, input.className)
  const textbook = hasManagementReference(input.textbookId)
    ? await resolveOpsTextbook(input.textbookId)
    : null

  await updateOpsTaskLinkFields(taskId, {
    student_id: text(student?.id) || null,
    student_name: text(student?.name) || text(input.studentName) || null,
    class_id: text(classRow?.id) || null,
    class_name: text(classRow?.name) || text(input.className) || null,
    textbook_id: text(textbook?.id) || null,
    textbook_title: textbook ? text(textbook.title || textbook.name) || null : null,
    subject: text(input.subject) || text(classRow?.subject) || null,
  })

  await syncRegistrationWaitlist(taskId, input, previousTask, student, classRow)

  if (completed) {
    assertResolvedManagementRecord(student, "등록 완료 전에 학생 정보를 입력하세요.")
    assertResolvedManagementRecord(classRow, "등록 완료 전에 등록할 수업을 선택하세요.")
    if (hasManagementReference(input.textbookId)) assertResolvedManagementRecord(textbook, "등록 완료 전에 등록 교재를 선택하세요.")
    const studentLabel = text(student.name) || text(input.studentName)
    const classLabel = text(classRow.name) || text(input.className)
    const textbookLabel = textbook ? text(textbook.title || textbook.name) || text(input.textbookTitle) : ""
    try {
      await assignOpsStudentToClass(student, classRow, "registration_completed")
      await markRegistrationRosterUpdated(taskId)
      if (textbook) {
        await assignOpsTextbookToClass(classRow, textbook)
        await markRegistrationTextbookReady(taskId)
      }
    } catch (error) {
      try {
        await rollbackOpsRegistrationCompletionSync(taskId, student, classRow, existingStudent, shouldDeleteCreatedStudent)
      } catch (rollbackError) {
        attachOpsTaskCleanupError(error, rollbackError)
      }
      throw error
    }
    await writeAutoSyncEventOnce(taskId, "학생관리", `${studentLabel} 등록`)
    await writeAutoSyncEventOnce(taskId, "수업명단", `${classLabel} 등록 · registration_completed`)
    if (textbook) {
      await writeAutoSyncEventOnce(taskId, "교재 연결", `${textbookLabel} · ${classLabel}`)
    }
  }
}

async function markWithdrawalRosterUpdated(taskId: string) {
  if (!supabase) return
  const { error } = await supabase
    .from("ops_withdrawal_details")
    .upsert({ task_id: taskId, timetable_roster_updated: true })
  if (error) throw error
  await writeEvent(taskId, "auto_checked", "시간표 명단 변경", "", "완료")
}

async function markTransferRosterUpdated(taskId: string) {
  if (!supabase) return
  const { error } = await supabase
    .from("ops_transfer_details")
    .upsert({ task_id: taskId, timetable_roster_updated: true })
  if (error) throw error
  await writeEvent(taskId, "auto_checked", "시간표 명단 변경", "", "완료")
}

async function syncWithdrawalManagementLinks(taskId: string, input: OpsTaskInput) {
  const student = await resolveOpsStudent(input)
  const classRow = await resolveOpsClass(input.classId, input.className, input.withdrawal?.teacherName)

  await updateOpsTaskLinkFields(taskId, {
    student_id: text(student?.id) || null,
    student_name: text(student?.name) || text(input.studentName) || null,
    class_id: text(classRow?.id) || null,
    class_name: text(classRow?.name) || text(input.className) || null,
    subject: text(classRow?.subject) || text(input.subject) || null,
  })

  if (input.status === "done") {
    assertResolvedManagementRecord(student, "퇴원 완료 전에 기존 학생을 연결하세요.")
    assertResolvedManagementRecord(classRow, "퇴원 완료 전에 기존 수업을 연결하세요.")
    assertOpsStudentInClass(student, classRow, "퇴원 완료 전에 학생이 해당 수업 명단에 있는지 확인하세요.")
    const classLabel = text(classRow.name) || text(input.className)
    try {
      await removeOpsStudentFromClass(student, classRow, "withdrawal_completed")
      await setOpsStudentStatus(student, WITHDRAWN_STUDENT_STATUS)
      await markWithdrawalRosterUpdated(taskId)
    } catch (error) {
      try {
        await rollbackOpsWithdrawalCompletionSync(taskId, student, classRow)
      } catch (rollbackError) {
        attachOpsTaskCleanupError(error, rollbackError)
      }
      throw error
    }
    await writeAutoSyncEventOnce(taskId, "수업명단", `${classLabel} 제거 · withdrawal_completed`)
    await writeAutoSyncEventOnce(taskId, "학생 상태", "퇴원")
  }
}

async function syncTransferManagementLinks(taskId: string, input: OpsTaskInput) {
  const transfer = input.transfer || {}
  const student = await resolveOpsStudent(input)
  const fromClass = await resolveOpsClass(transfer.fromClassId, transfer.fromClassName, transfer.fromTeacherName)
  const toClass = await resolveOpsClass(transfer.toClassId || input.classId, transfer.toClassName || input.className, transfer.toTeacherName)

  await updateOpsTaskLinkFields(taskId, {
    student_id: text(student?.id) || null,
    student_name: text(student?.name) || text(input.studentName) || null,
    class_id: text(toClass?.id) || null,
    class_name: text(toClass?.name) || text(transfer.toClassName || input.className) || null,
    subject: text(toClass?.subject) || text(input.subject) || null,
  })

  if (input.status === "done") {
    assertResolvedManagementRecord(student, "전반 완료 전에 기존 학생을 연결하세요.")
    assertResolvedManagementRecord(fromClass, "전반 완료 전에 전 수업을 연결하세요.")
    assertResolvedManagementRecord(toClass, "전반 완료 전에 후 수업을 연결하세요.")
    assertDifferentOpsClass(fromClass, toClass, "전반 완료 전에 전 수업과 후 수업을 다르게 선택하세요.")
    assertOpsStudentInClass(student, fromClass, "전반 완료 전에 학생이 전 수업 명단에 있는지 확인하세요.")
    const fromClassLabel = text(fromClass.name) || text(transfer.fromClassName)
    const toClassLabel = text(toClass.name) || text(transfer.toClassName || input.className)
    try {
      await removeOpsStudentFromClass(student, fromClass, "transfer_from_class")
      const studentAfterFromRemoval = withoutOpsStudentClass(student, fromClass.id)
      await assignOpsStudentToClass(studentAfterFromRemoval, toClass, "transfer_to_class")
      await setOpsStudentStatus(student, ACTIVE_STUDENT_STATUS)
      await markTransferRosterUpdated(taskId)
    } catch (error) {
      try {
        await rollbackOpsTransferCompletionSync(taskId, student, fromClass, toClass)
      } catch (rollbackError) {
        attachOpsTaskCleanupError(error, rollbackError)
      }
      throw error
    }
    await writeAutoSyncEventOnce(taskId, "수업명단", `${fromClassLabel} 제거 · transfer_from_class → ${toClassLabel} 등록 · transfer_to_class`)
    await writeAutoSyncEventOnce(taskId, "학생 상태", "재원")
  }
}

async function syncWordRetestManagementLinks(taskId: string, input: OpsTaskInput) {
  if (!supabase) return
  const wordRetest = input.wordRetest || {}
  const student = await resolveOpsStudent({
    ...input,
    studentName: input.studentName || wordRetest.studentName,
  })
  const classRow = await resolveOpsClass(input.classId, input.className || wordRetest.className, wordRetest.teacherName)
  const textbook = await resolveOpsTextbook(input.textbookId, input.textbookTitle || wordRetest.textbookName)
  const teacher = await resolveOpsTeacher(wordRetest.teacherId, wordRetest.teacherName)

  if (input.status === "done") {
    assertResolvedManagementRecord(student, "단어 재시험 완료 전에 기존 학생을 연결하세요.")
    assertResolvedManagementRecord(classRow, "단어 재시험 완료 전에 기존 수업을 연결하세요.")
    assertResolvedManagementRecord(textbook, "단어 재시험 완료 전에 기존 교재를 연결하세요.")
    assertResolvedManagementRecord(teacher, "단어 재시험 완료 전에 담당 선생님을 연결하세요.")
    assertOpsStudentInClass(student, classRow, "단어 재시험 완료 전에 학생이 해당 수업 명단에 있는지 확인하세요.")
    await writeAutoSyncEventOnce(
      taskId,
      "단어 재시험 연결",
      [text(student.name), text(classRow.name), text(teacher.name)].filter(Boolean).join(" · "),
    )
  }

  await updateOpsTaskLinkFields(taskId, {
    student_id: text(student?.id) || null,
    student_name: text(student?.name) || text(input.studentName || wordRetest.studentName) || null,
    class_id: text(classRow?.id) || null,
    class_name: text(classRow?.name) || text(input.className || wordRetest.className) || null,
    textbook_id: text(textbook?.id) || null,
    textbook_title: text(textbook?.title || textbook?.name) || text(input.textbookTitle || wordRetest.textbookName) || null,
    subject: text(classRow?.subject) || text(input.subject) || null,
    assignee_id: text(teacher?.profile_id) || text(input.assigneeId) || null,
  })

  const detailPatch = {
    branch: nullable(wordRetest.branch) || inferClassBranch(classRow) || "본관",
    teacher_catalog_id: text(teacher?.id) || nullable(wordRetest.teacherId),
    teacher_name: text(teacher?.name) || nullable(wordRetest.teacherName),
    class_name: text(classRow?.name) || nullable(wordRetest.className || input.className),
    student_name: text(student?.name) || nullable(wordRetest.studentName || input.studentName),
    textbook_name: text(textbook?.title || textbook?.name) || nullable(wordRetest.textbookName || input.textbookTitle),
    test_at: nullableDate(wordRetest.testAt),
    retest_status: getWordRetestDetailStatusForTaskStatus(input.status || "requested", wordRetest.retestStatus),
  }
  const { error } = await supabase.from("ops_word_retests").update(detailPatch).eq("task_id", taskId)
  if (error && !isMissingColumnError(error)) throw error
}

async function syncOpsTaskManagementLinks(
  taskId: string,
  input: OpsTaskInput,
  previousTask: OpsTask | null = null,
  options: { registrationCreatedStudentId?: string } = {},
) {
  if (!supabase) return
  assertManagementSyncReady(input)
  if (input.type === "registration") {
    await syncRegistrationManagementLinks(taskId, input, previousTask, {
      createdStudentId: options.registrationCreatedStudentId,
    })
  }
  if (input.type === "withdrawal") await syncWithdrawalManagementLinks(taskId, input)
  if (input.type === "transfer") await syncTransferManagementLinks(taskId, input)
  if (input.type === "word_retest") await syncWordRetestManagementLinks(taskId, input)
}

type OpsTaskDetailTable =
  | "ops_registration_details"
  | "ops_withdrawal_details"
  | "ops_transfer_details"
  | "ops_word_retests"

async function deleteOpsTaskDetailRow(tableName: OpsTaskDetailTable, taskId: string) {
  if (!supabase || !text(taskId)) return
  const { error } = await supabase.from(tableName).delete().eq("task_id", taskId)
  if (error && !isMissingRelationError(error) && !isMissingColumnError(error)) throw error
}

async function deleteCreatedOpsTaskOnFailure(taskId: string, expectedCreatedAt: string) {
  if (!supabase || !text(taskId) || !text(expectedCreatedAt)) {
    return new Error("생성 실패 업무 정리 대상을 확인하지 못했습니다.")
  }
  try {
    const response = await runIdempotentOpsTaskProducerRpc("cleanup_created_ops_task_v1", {
      p_task_id: taskId,
      p_expected_created_at: expectedCreatedAt,
    })
    producerCleanupDeleted(response, taskId)
    return null
  } catch (error) {
    return error
  }
}

function attachOpsTaskCleanupError(originalError: unknown, cleanupError: unknown) {
  if (!cleanupError || typeof originalError !== "object" || originalError === null) return
  const mutableError = originalError as Row
  mutableError.cleanupError = cleanupError
}

export async function createOpsTransitionTask(input: OpsTaskInput): Promise<OpsTaskProducerReceipt> {
  if (!supabase) throw new Error("Supabase 연결 설정이 필요합니다.")
  if (!["transfer", "withdrawal"].includes(input.type)) {
    throw new Error("전반·퇴원 업무만 안전 생성 경로를 사용할 수 있습니다.")
  }
  assertManagementSyncReady(input)
  await assertManagementSyncRecordsReady(input)
  try {
    const response = await runIdempotentOpsTaskProducerRpc("create_ops_task_v2", {
      p_input: buildOpsTaskProducerInput(input),
    })
    clearOpsTaskWorkspaceDataCache()
    return {
      taskId: producerTaskId(response),
      sourceEventIds: producerSourceEventIds(response),
    }
  } catch (error) {
    if (!isMissingOpsRosterRpc(error)) throw error
    resetRegistrationSubjectTrackRuntimeProbe()
    return createOpsTask(input, { skipTransitionProducer: true })
  }
}

export async function createOpsTask(
  input: OpsTaskInput,
  options: { skipTransitionProducer?: boolean } = {},
): Promise<OpsTaskProducerReceipt> {
  if (!supabase) throw new Error("Supabase 연결 설정이 필요합니다.")
  const client = supabase
  assertRegistrationInquiryBaseReady(input)
  assertManagementSyncReady(input)
  await assertManagementSyncRecordsReady(input)
  if ((input.type === "transfer" || input.type === "withdrawal") && !options.skipTransitionProducer) {
    return createOpsTransitionTask(input)
  }
  if (input.type === "general" || input.type === "word_retest" || input.type === "textbook") {
    const response = await runIdempotentOpsTaskProducerRpc("create_ops_task_v2", {
      p_input: buildOpsTaskProducerInput(input),
    })
    const activityEventId = input.type === "textbook"
      ? producerActivityEventId(response)
      : undefined
    clearOpsTaskWorkspaceDataCache()
    return {
      taskId: producerTaskId(response),
      sourceEventIds: producerSourceEventIds(response),
      ...(activityEventId ? { activityEventId } : {}),
    }
  }
  const stagesReadyOpsRosterCompletion = input.status === "done"
    && ["withdrawal", "transfer"].includes(input.type)
    && (await getOpsRosterRuntimeState()).mode === "ready"
  const stagesTerminalRegistrationParent = input.type === "registration"
    && ["done", "canceled"].includes(input.status || "requested")
  const initialParentInput: OpsTaskInput = stagesTerminalRegistrationParent || stagesReadyOpsRosterCompletion
    ? { ...input, status: "in_progress" }
    : input

  const { data, error } = await writeOpsTaskWithOptionalTeamWorkflowColumns(
    buildTaskRow(initialParentInput, { completedAtFallback: new Date().toISOString() }),
    (row) => client
      .from("ops_tasks")
      .insert(row)
      .select("id,created_at")
      .single(),
  )

  if (error) throw error
  const taskId = text((data as Row).id)
  const createdAt = text((data as Row).created_at)
  let rollbackCompletionSync: OpsCompletionRollback | null = null
  let completionSyncApplied = false
  try {
    const readyCompletionInput = stagesReadyOpsRosterCompletion ? getReadyOpsCompletionInput(input) : input
    await writeManualCheckEvents(taskId, readyCompletionInput)
    await upsertDetail(taskId, readyCompletionInput)
    if (stagesReadyOpsRosterCompletion) {
      const sourceEventIds = await completeReadyOpsRosterTransition(taskId, input.type)
      clearOpsTaskWorkspaceDataCache()
      return { taskId, sourceEventIds: sourceEventIds || [] }
    }
    const completionMutation = await prepareCreatedOpsCompletionSyncRollback(taskId, input)
    rollbackCompletionSync = completionMutation.rollback
    completionSyncApplied = Boolean(rollbackCompletionSync)
    await syncOpsTaskManagementLinks(taskId, input, null, {
      registrationCreatedStudentId: completionMutation.registrationCreatedStudentId,
    })
    if (stagesTerminalRegistrationParent) {
      await updateRegistrationTaskParent(taskId, input, { preserveManagementLinks: true })
    }
    clearOpsTaskWorkspaceDataCache()
    return { taskId, sourceEventIds: [] }
  } catch (error) {
    await rollbackAppliedCompletionSync(rollbackCompletionSync, completionSyncApplied, error)
    const cleanupError = await deleteCreatedOpsTaskOnFailure(taskId, createdAt)
    attachOpsTaskCleanupError(error, cleanupError)
    throw error
  }
}

async function updateRegistrationTaskParent(
  taskId: string,
  input: OpsTaskInput,
  options: { preserveManagementLinks?: boolean } = {},
) {
  if (!supabase) throw new Error("Supabase 연결 설정이 필요합니다.")
  const client = supabase
  const { data, error } = await writeOpsTaskWithOptionalTeamWorkflowColumns(
    buildTaskRow(input, { preserveManagementLinks: options.preserveManagementLinks }),
    (row) => client
      .from("ops_tasks")
      .update(row)
      .eq("id", taskId)
      .select("id"),
  )
  if (error) throw error
  if (!didMutateOpsTask(data)) throw new Error("업무 데이터를 다시 불러오세요.")
}

async function applyRegistrationTaskChildren(
  taskId: string,
  input: OpsTaskInput,
  existingTask: OpsTask,
  createdStudentId = "",
) {
  await upsertDetail(taskId, input)
  await syncOpsTaskManagementLinks(taskId, input, existingTask, {
    registrationCreatedStudentId: createdStudentId,
  })
  await writeManualCheckEvents(taskId, input, inputFromTask(existingTask))
}

async function rollbackRegistrationUpdate(
  taskId: string,
  existingTask: OpsTask,
  originalError: unknown,
  rollbackRegistrationProjection: OpsCompletionRollback,
  options: { parentWriteOrder: "first" | "last" },
) {
  if (!supabase || existingTask.type !== "registration") return
  const existingInput = inputFromTask(existingTask)
  let firstRollbackError: unknown = null
  const captureRollback = async (operation: () => Promise<void>) => {
    try {
      await operation()
    } catch (rollbackError) {
      firstRollbackError ||= rollbackError
    }
  }

  if (options.parentWriteOrder === "first") {
    await captureRollback(() => updateRegistrationTaskParent(taskId, existingInput))
  }
  await captureRollback(() => rollbackRegistrationProjection())
  if (options.parentWriteOrder === "last") {
    await captureRollback(() => updateRegistrationTaskParent(taskId, existingInput))
  }
  if (firstRollbackError) attachOpsTaskCleanupError(originalError, firstRollbackError)
}

async function updateRegistrationOpsTask(taskId: string, input: OpsTaskInput, existingTask: OpsTask) {
  const registrationProjectionRollback = await prepareRegistrationProjectionRollback(existingTask, input)
  const nextStatus = input.status || "requested"
  const reopensTerminalTask = ["done", "canceled"].includes(existingTask.status)
    && !["done", "canceled"].includes(nextStatus)

  if (!reopensTerminalTask) {
    try {
      await applyRegistrationTaskChildren(taskId, input, existingTask, registrationProjectionRollback.createdStudentId)
      await updateRegistrationTaskParent(taskId, input, { preserveManagementLinks: true })
    } catch (error) {
      await rollbackRegistrationUpdate(taskId, existingTask, error, registrationProjectionRollback.rollback, { parentWriteOrder: "first" })
      throw error
    }
    return
  }

  await updateRegistrationTaskParent(taskId, input)
  try {
    await applyRegistrationTaskChildren(taskId, input, existingTask, registrationProjectionRollback.createdStudentId)
  } catch (error) {
    await rollbackRegistrationUpdate(taskId, existingTask, error, registrationProjectionRollback.rollback, { parentWriteOrder: "last" })
    throw error
  }
}

export async function updateOpsTask(
  taskId: string,
  input: OpsTaskInput,
): Promise<OpsTaskSourceEventReceipt> {
  if (!supabase) throw new Error("Supabase 연결 설정이 필요합니다.")
  const client = supabase
  const nextStatus = input.status || "requested"
  const existingTask = await loadOpsTaskById(taskId)
  if (!existingTask) throw new Error("업무 데이터를 다시 불러오세요.")
  assertCompletedOperationStatusTransition(existingTask, nextStatus)
  assertCompletedOperationEditable(existingTask)
  assertRegistrationInquiryBaseReady(input)
  assertManagementSyncReady(input)
  await assertManagementSyncRecordsReady(input)

  if (input.type === "general" || input.type === "word_retest" || input.type === "textbook") {
    const response = await runIdempotentOpsTaskProducerRpc("update_ops_task_v2", {
      p_task_id: taskId,
      p_input: buildOpsTaskProducerInput(input),
      p_expected_updated_at: existingTask.updatedAt,
    })
    const activityEventId = input.type === "textbook"
      ? producerActivityEventId(response)
      : undefined
    clearOpsTaskWorkspaceDataCache()
    return {
      sourceEventIds: producerSourceEventIds(response),
      ...(activityEventId ? { activityEventId } : {}),
    }
  }

  if (input.type === "withdrawal" || input.type === "transfer") {
    const producerInput = nextStatus === "done"
      ? getReadyOpsCompletionInput({ ...input, status: existingTask.status })
      : input
    try {
      const response = await runIdempotentOpsTaskProducerRpc("update_ops_task_v2", {
        p_task_id: taskId,
        p_input: buildOpsTaskProducerInput(producerInput),
        p_expected_updated_at: existingTask.updatedAt,
      })
      const sourceEventIds = producerSourceEventIds(response)
      if (nextStatus === "done") {
        const completionSourceEventIds = await completeReadyOpsRosterTransition(taskId, input.type)
        clearOpsTaskWorkspaceDataCache()
        return { sourceEventIds: [...sourceEventIds, ...(completionSourceEventIds || [])] }
      }
      clearOpsTaskWorkspaceDataCache()
      return { sourceEventIds }
    } catch (error) {
      if (!isMissingOpsRosterRpc(error)) throw error
      resetRegistrationSubjectTrackRuntimeProbe()
    }
  }

  if (input.type === "registration") {
    const runtime = await getOpsRosterRuntimeState()
    if (runtime.mode !== "legacy") {
      throw new Error("과목별 등록 화면에서 변경하세요.")
    }
    await updateRegistrationOpsTask(taskId, input, existingTask)
    clearOpsTaskWorkspaceDataCache()
    return { sourceEventIds: [] }
  }

  if (nextStatus === "done") {
    let rollbackCompletionSync: OpsCompletionRollback | null = null
    let completionSyncApplied = false
    rollbackCompletionSync = await prepareOpsCompletionStatusRollback(existingTask, input)
    const completionRollbackArmed = Boolean(rollbackCompletionSync)
    try {
      await writeManualCheckEvents(taskId, input, inputFromTask(existingTask))
      await upsertDetail(taskId, input)
      await syncOpsTaskManagementLinks(taskId, input, existingTask)
      completionSyncApplied = true
      const { data, error } = await writeOpsTaskWithOptionalTeamWorkflowColumns(
        buildTaskRow(input, { preserveManagementLinks: true, completedAtFallback: new Date().toISOString() }),
        (row) => client
          .from("ops_tasks")
          .update(row)
          .eq("id", taskId)
          .select("id"),
      )
      if (error) throw error
      if (!didMutateOpsTask(data)) throw new Error("업무 데이터를 다시 불러오세요.")
    } catch (error) {
      await rollbackAppliedCompletionSync(
        rollbackCompletionSync,
        completionRollbackArmed || completionSyncApplied,
        error,
      )
      throw error
    }
    clearOpsTaskWorkspaceDataCache()
    return { sourceEventIds: [] }
  }

  const { data, error } = await writeOpsTaskWithOptionalTeamWorkflowColumns(
    buildTaskRow(input),
    (row) => client
      .from("ops_tasks")
      .update(row)
      .eq("id", taskId)
      .select("id"),
  )

  if (error) throw error
  if (!didMutateOpsTask(data)) throw new Error("업무 데이터를 다시 불러오세요.")
  try {
    await upsertDetail(taskId, input)
    await syncOpsTaskManagementLinks(taskId, input, existingTask)
    await writeManualCheckEvents(taskId, input, inputFromTask(existingTask))
  } catch (syncError) {
    throw syncError
  }
  clearOpsTaskWorkspaceDataCache()
  return { sourceEventIds: [] }
}

export async function retryWordRetest(
  previousTaskId: string,
  input: OpsTaskInput,
): Promise<OpsTaskProducerReceipt> {
  if (input.type !== "word_retest") throw new Error("단어 재시험만 다시 만들 수 있습니다.")
  const response = await runIdempotentOpsTaskProducerRpc("retry_word_retest_v1", {
    p_previous_task_id: previousTaskId,
    p_input: buildOpsTaskProducerInput(input),
  })
  clearOpsTaskWorkspaceDataCache()
  return {
    taskId: producerTaskId(response),
    sourceEventIds: producerSourceEventIds(response),
  }
}

export async function reportWordRetestResult(
  taskId: string,
  detail: OpsWordRetestDetail,
): Promise<OpsTaskSourceEventReceipt> {
  const response = await runIdempotentOpsTaskProducerRpc("report_word_retest_result_v1", {
    p_task_id: taskId,
    p_result: withoutTaskId(buildWordRetestRow("", detail)),
  })
  clearOpsTaskWorkspaceDataCache()
  return { sourceEventIds: producerSourceEventIds(response) }
}

export async function reportWordRetestAbsent(
  taskId: string,
  source: "manual" | "deadline" | "attendance",
): Promise<OpsTaskSourceEventReceipt> {
  const response = await runIdempotentOpsTaskProducerRpc("report_word_retest_absent_v1", {
    p_task_id: taskId,
    p_source: source,
  })
  clearOpsTaskWorkspaceDataCache()
  return { sourceEventIds: producerSourceEventIds(response) }
}

export async function requestWordRetestRevision(
  taskId: string,
  reason: string,
): Promise<OpsTaskSourceEventReceipt> {
  const response = await runIdempotentOpsTaskProducerRpc("request_word_retest_revision_v1", {
    p_task_id: taskId,
    p_reason: reason,
  })
  clearOpsTaskWorkspaceDataCache()
  return { sourceEventIds: producerSourceEventIds(response) }
}

async function updateOpsTaskStatusRow(taskId: string, status: OpsTaskStatus) {
  if (!supabase) throw new Error("Supabase 연결 설정이 필요합니다.")
  const { data, error } = await supabase
    .from("ops_tasks")
    .update({
      status,
      completed_at: status === "done" ? new Date().toISOString() : null,
    })
    .eq("id", taskId)
    .select("id")
  if (error) throw error
  if (!didMutateOpsTask(data)) throw new Error("업무 데이터를 다시 불러오세요.")
}

async function updateRegistrationOpsTaskStatus(currentTask: OpsTask, status: OpsTaskStatus) {
  let rollbackPipelineStatus: OpsCompletionRollback | null = null
  const reopensTerminalTask = ["done", "canceled"].includes(currentTask.status)
    && !["done", "canceled"].includes(status)

  if (status === "done") {
    const nextPipelineStatus = getRegistrationPipelineStatusForTaskStatus(status, currentTask.registration?.pipelineStatus)
    const nextInput = {
      ...inputFromTask(currentTask, status),
      registration: {
        ...(currentTask.registration || {}),
        pipelineStatus: nextPipelineStatus,
      },
    }
    assertManagementSyncReady(nextInput)
    await assertManagementSyncRecordsReady(nextInput)
    await updateRegistrationOpsTask(currentTask.id, nextInput, currentTask)
    return
  }

  if (reopensTerminalTask) {
    await updateOpsTaskStatusRow(currentTask.id, status)
    try {
      await syncRegistrationPipelineStatusForTaskStatus(currentTask, status)
    } catch (error) {
      try {
        await updateOpsTaskStatusRow(currentTask.id, currentTask.status)
      } catch (rollbackError) {
        attachOpsTaskCleanupError(error, rollbackError)
      }
      throw error
    }
    return
  }

  try {
    rollbackPipelineStatus = await syncRegistrationPipelineStatusForTaskStatus(currentTask, status)
    await updateOpsTaskStatusRow(currentTask.id, status)
  } catch (error) {
    if (rollbackPipelineStatus) {
      try {
        await rollbackPipelineStatus()
      } catch (rollbackError) {
        attachOpsTaskCleanupError(error, rollbackError)
      }
    }
    throw error
  }
}

export async function updateOpsTaskStatus(
  task: OpsTask,
  status: OpsTaskStatus,
): Promise<OpsTaskSourceEventReceipt> {
  let rollbackCompletionSync: OpsCompletionRollback | null = null
  let completionSyncApplied = false
  if (!supabase) throw new Error("Supabase 연결 설정이 필요합니다.")
  const currentTask = await loadOpsTaskById(task.id)
  if (!currentTask) throw new Error("업무 데이터를 다시 불러오세요.")
  assertCompletedOperationStatusTransition(currentTask, status)

  if (currentTask.type === "general" || currentTask.type === "word_retest" || currentTask.type === "textbook") {
    if (currentTask.type === "word_retest" && currentTask.status === "review_requested" && status === "in_progress") {
      return requestWordRetestRevision(currentTask.id, "담당 선생님 수정 요청")
    } else {
      const response = await runIdempotentOpsTaskProducerRpc("transition_ops_task_status_v2", {
        p_task_id: currentTask.id,
        p_status: status,
        p_expected_updated_at: currentTask.updatedAt,
      })
      const activityEventId = currentTask.type === "textbook"
        ? producerActivityEventId(response)
        : undefined
      clearOpsTaskWorkspaceDataCache()
      return {
        sourceEventIds: producerSourceEventIds(response),
        ...(activityEventId ? { activityEventId } : {}),
      }
    }
  }

  if (currentTask.type === "registration") {
    const runtime = await getOpsRosterRuntimeState()
    if (runtime.mode !== "legacy") {
      throw new Error("과목별 등록 화면에서 변경하세요.")
    }
    await updateRegistrationOpsTaskStatus(currentTask, status)
    clearOpsTaskWorkspaceDataCache()
    return { sourceEventIds: [] }
  }

  if (currentTask.type === "withdrawal" || currentTask.type === "transfer") {
    if (status === "done") {
      const sourceEventIds = await completeReadyOpsRosterTransition(currentTask.id, currentTask.type)
      clearOpsTaskWorkspaceDataCache()
      return { sourceEventIds: sourceEventIds || [] }
    }
    try {
      const response = await runIdempotentOpsTaskProducerRpc("transition_ops_task_status_v2", {
        p_task_id: currentTask.id,
        p_status: status,
        p_expected_updated_at: currentTask.updatedAt,
      })
      clearOpsTaskWorkspaceDataCache()
      return { sourceEventIds: producerSourceEventIds(response) }
    } catch (error) {
      if (!isMissingOpsRosterRpc(error)) throw error
      resetRegistrationSubjectTrackRuntimeProbe()
    }
  }

  if (status === "done") {
    const nextInput = inputFromTask(currentTask, status)
    await assertManagementSyncRecordsReady(nextInput)
    rollbackCompletionSync = await prepareOpsCompletionStatusRollback(currentTask, nextInput)
    try {
      await syncOpsTaskManagementLinks(currentTask.id, nextInput, currentTask)
      completionSyncApplied = true
    } catch (error) {
      await rollbackAppliedCompletionSync(rollbackCompletionSync, true, error)
      throw error
    }
  }

  const { data, error } = await supabase
    .from("ops_tasks")
    .update({
      status,
      completed_at: status === "done" ? new Date().toISOString() : null,
    })
    .eq("id", currentTask.id)
    .select("id")

  if (error || !didMutateOpsTask(data)) {
    await rollbackAppliedCompletionSync(rollbackCompletionSync, completionSyncApplied, error)
    if (error) throw error
    throw new Error("업무 데이터를 다시 불러오세요.")
  }
  clearOpsTaskWorkspaceDataCache()
  return { sourceEventIds: [] }
}

async function rollbackRegistrationWaitlistRemovalAfterFailure(student: Row, classRow: Row, originalError: unknown) {
  const studentId = text(student.id)
  const classId = text(classRow.id)
  let firstCleanupError: unknown = null
  let projectedStudent: Row | null = null
  try {
    projectedStudent = await selectOpsRowById("students", studentId)
  } catch (error) {
    firstCleanupError = error
  }
  const projectedMode = getOpsStudentClassMode(projectedStudent, classId)
  const restoreResults = await Promise.allSettled([
    restoreOpsStudentRosterSnapshot(studentId, student),
    restoreOpsClassRosterSnapshot(classId, classRow),
  ])
  for (const restoreResult of restoreResults) {
    if (restoreResult.status === "rejected") firstCleanupError ||= restoreResult.reason
  }
  if (projectedMode !== "waitlist") {
    try {
      await insertOpsStudentClassHistory(
        studentId,
        classId,
        "waitlist",
        projectedMode,
        "waitlist",
        "registration_waitlist_delete_rollback",
      )
    } catch (error) {
      firstCleanupError ||= error
    }
  }
  if (firstCleanupError) attachOpsTaskCleanupError(originalError, firstCleanupError)
}

async function resolveRegistrationWaitlistClassForDelete(task: OpsTask, student: Row) {
  if (!supabase) throw new Error("Supabase 연결 설정이 필요합니다.")
  const persistedClassId = text(task.classId)
  if (persistedClassId) {
    const persistedClass = await selectOpsRowById("classes", persistedClassId)
    if (!persistedClass || !hasSymmetricOpsWaitlistLink(student, persistedClass)) {
      throw new Error("저장된 대기 수업 연결을 양쪽 명단에서 확인할 수 없어 삭제할 수 없습니다.")
    }
    return persistedClass
  }

  const candidateIds = normalizeIdList(student.waitlist_class_ids)
  if (candidateIds.length === 0) {
    throw new Error("대기 수업 연결 ID가 없어 안전하게 삭제할 수 없습니다.")
  }
  const { data, error } = await supabase.from("classes").select("*").in("id", candidateIds)
  if (error) throw error
  const expectedClassName = text(task.className)
  const symmetricCandidates = ((data || []) as unknown as Row[]).filter((classRow) => (
    hasSymmetricOpsWaitlistLink(student, classRow)
    && (!expectedClassName || text(classRow.name) === expectedClassName)
  ))
  if (symmetricCandidates.length !== 1) {
    throw new Error("대기 수업 연결을 하나로 확인할 수 없습니다. 수업 연결을 먼저 정리하세요.")
  }
  return symmetricCandidates[0]
}

async function removeRegistrationWaitlistOnDelete(task: OpsTask | null) {
  if (!task || task.type !== "registration" || !isRegistrationWaitlistPipelineStatus(task.registration?.pipelineStatus)) return null
  const input = inputFromTask(task)
  const student = await resolveOpsRegistrationStudent(input)
  if (!student) return null
  const classRow = await resolveRegistrationWaitlistClassForDelete(task, student)

  try {
    await removeOpsStudentFromClass(student, classRow, "registration_waitlist_deleted")
  } catch (error) {
    await rollbackRegistrationWaitlistRemovalAfterFailure(student, classRow, error)
    throw error
  }
  return async () => {
    const [currentStudent, currentClass] = await Promise.all([
      selectOpsRowById("students", text(student.id)),
      selectOpsRowById("classes", text(classRow.id)),
    ])
    if (!currentStudent || !currentClass) throw new Error("대기명단 삭제 복원 대상을 다시 불러오지 못했습니다.")
    await assignOpsStudentToWaitlist(currentStudent, currentClass, "registration_waitlist_restore")
  }
}

export async function deleteOpsTask(taskId: string) {
  if (!supabase) throw new Error("Supabase 연결 설정이 필요합니다.")
  await assertOpsTaskExists(taskId)
  const task = await loadOpsTaskById(taskId)
  if (task?.type === "registration" && (task.status === "done" || isRegistrationCompletionImmutable(task.registration?.pipelineStatus))) {
    throw new Error("등록 완료 건은 학생·수업·교재 연결을 유지해야 하므로 삭제할 수 없습니다.")
  }
  const rollbackWaitlist = await removeRegistrationWaitlistOnDelete(task)
  const { data, error } = await supabase.from("ops_tasks").delete().eq("id", taskId).select("id")
  if (error || !didMutateOpsTask(data)) {
    if (rollbackWaitlist) await rollbackWaitlist()
    if (error) throw error
    throw new Error("업무 데이터를 다시 불러오세요.")
  }
  clearOpsTaskWorkspaceDataCache()
}

export async function addOpsTaskComment(taskId: string, body: string): Promise<OpsTaskCommentReceipt> {
  if (!supabase) throw new Error("Supabase 연결 설정이 필요합니다.")
  const task = await loadOpsTaskById(taskId)
  if (!task) throw new Error("업무 데이터를 다시 불러오세요.")
  const response = await runIdempotentOpsTaskProducerRpc("add_ops_task_comment_v2", {
    p_task_id: taskId,
    p_body: body,
  })
  const row = response.comment
  if (!row) throw new Error("저장된 댓글을 확인하지 못했습니다.")
  const commentId = text(row.id)
  producerCommentSourceId(response, commentId)

  clearOpsTaskWorkspaceDataCache()
  return {
    comment: {
      id: commentId,
      taskId: text(row.task_id),
      authorId: text(row.author_id),
      authorLabel: "",
      body: text(row.body),
      createdAt: text(row.created_at),
    },
    sourceEventIds: producerSourceEventIds(response),
  }
}

export async function addOpsTaskAttachment(taskId: string, fileName: string, driveLink: string, fileKind = "link") {
  if (!supabase) throw new Error("Supabase 연결 설정이 필요합니다.")
  await assertOpsTaskExists(taskId)
  const { data, error } = await supabase
    .from("ops_task_attachments")
    .insert({
      task_id: taskId,
      file_name: fileName,
      file_kind: fileKind,
      drive_link: driveLink,
    })
    .select("id,task_id,file_name,file_kind,drive_file_id,drive_link,uploaded_by,uploaded_at")
    .single()
  if (error) throwIfMissingOpsTaskReference(error)

  clearOpsTaskWorkspaceDataCache()
  const row = data as Row
  return {
    id: text(row.id),
    taskId: text(row.task_id),
    fileName: text(row.file_name),
    fileKind: text(row.file_kind),
    driveFileId: text(row.drive_file_id),
    driveLink: text(row.drive_link),
    uploadedBy: text(row.uploaded_by),
    uploadedByLabel: "",
    uploadedAt: text(row.uploaded_at),
  } satisfies OpsTaskAttachment
}

export { getOpsTaskCalendarItems, summarizeOpsTasks }
