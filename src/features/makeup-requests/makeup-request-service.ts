"use client"

import { supabase } from "@/lib/supabase"
import {
  buildRoomAvailability,
  canTransitionMakeupRequest,
  getMakeupRequestEffectiveYear,
  getMakeupRequestKind,
  hasCancelPart,
  hasMakeupPart,
  isMakeupApproverAllowed,
  normalizeMakeupSlots,
  resolveMakeupApprovalGroup,
  type MakeupRequestKind,
} from "./makeup-request-model.js"
import { runIdempotentMakeupCreate } from "./makeup-create-attempt.js"
import {
  mapDashboardNotificationInboxWire,
  mapDashboardNotificationReadWire,
  mapDashboardNotificationUnreadCountWire,
  normalizeDashboardNotificationRpcError,
  type DashboardNotification,
  type DashboardNotificationCursor,
  type DashboardNotificationInbox,
  type DashboardNotificationReadResult,
} from "@/lib/dashboard-inbox-state"

export type {
  DashboardNotification,
  DashboardNotificationCursor,
  DashboardNotificationInbox,
  DashboardNotificationReadResult,
}

type Row = Record<string, unknown>

export type MakeupRequestStatus =
  | "approval_pending"
  | "revision_requested"
  | "rejected"
  | "manager_pending"
  | "makeup_pending"
  | "refund_pending"
  | "completed"
  | "canceled"

export type MakeupApprovalGroup = "math_middle" | "math_high" | "english" | "unknown"

export type MakeupProfileOption = {
  id: string
  label: string
  email: string
  role: string
  teacherCatalogId: string
}

export type MakeupTeacherOption = {
  id: string
  name: string
  subjects: string
  isVisible: boolean
  sortOrder: number
  profileId: string
  accountEmail: string
  dashboardRole: string
}

export type MakeupClassOption = {
  id: string
  name: string
  subject: string
  grade: string
  teacher: string
  teacherCatalogId: string
  classroom: string
  room: string
  schedule: string
  schedulePlan: Row
  textbooks: Row[]
  textbookIds: string[]
}

export type MakeupRequestEvent = {
  id: string
  requestId: string
  actorId: string
  actorLabel: string
  eventType: string
  fieldName: string
  beforeValue: string
  afterValue: string
  note: string
  createdAt: string
}

export type MakeupSlotInput = {
  id?: string
  date?: string
  startTime?: string
  endTime?: string
  startAt?: string
  endAt?: string
  classroom?: string
}

export type MakeupRequest = {
  id: string
  status: MakeupRequestStatus
  subject: string
  approvalGroup: MakeupApprovalGroup
  requesterId: string
  requesterLabel: string
  teacherCatalogId: string
  teacherProfileId: string
  teacherLabel: string
  classId: string
  className: string
  requestKind: MakeupRequestKind
  reason: string
  cancelDate: string
  makeupStartAt: string
  makeupEndAt: string
  makeupClassroom: string
  makeupSlots: MakeupSlotInput[]
  approverTeacherCatalogId: string
  approverProfileId: string
  approverLabel: string
  returnedReason: string
  rejectedReason: string
  finalNote: string
  approvedBy: string
  approvedByLabel: string
  approvedAt: string
  completedBy: string
  completedByLabel: string
  completedAt: string
  canceledBy: string
  canceledByLabel: string
  canceledAt: string
  schedulePlanBefore: Row
  schedulePlanAfter: Row
  cancelAcademicEventId: string
  makeupAcademicEventId: string
  makeupAcademicEventIds: string[]
  createdAt: string
  updatedAt: string
  events: MakeupRequestEvent[]
}

export type MakeupRequestInput = {
  requestKind: MakeupRequestKind
  classId: string
  reason: string
  cancelDate: string
  makeupSlots: MakeupSlotInput[]
  makeupClassroom: string
  approverTeacherCatalogId: string
}

export type MakeupRequestWorkspaceData = {
  schemaReady: boolean
  requests: MakeupRequest[]
  profiles: MakeupProfileOption[]
  teachers: MakeupTeacherOption[]
  classes: MakeupClassOption[]
  classrooms: Row[]
  academicEvents: Row[]
  notificationSettings: MakeupNotificationSetting[]
  notificationDeliveries: MakeupNotificationDelivery[]
  error?: string
}

export type GoogleChatChannel = "executive" | "admin" | "math" | "english"

export type MakeupNotificationTrigger = "submitted" | "approved" | "returned" | "rejected" | "completed" | "canceled" | "refund_requested"
type ActiveMakeupNotificationTrigger = Exclude<MakeupNotificationTrigger, "completed">

export type MakeupNotificationChannel =
  | "dashboard_personal"
  | "dashboard_management"
  | "google_chat_executive"
  | "google_chat_admin"
  | "google_chat_math"
  | "google_chat_english"

export type MakeupNotificationSetting = {
  triggerKind: MakeupNotificationTrigger
  channel: MakeupNotificationChannel
  enabled: boolean
  titleTemplate: string
  bodyTemplate: string
  updatedAt: string
}

export type MakeupNotificationDelivery = {
  id: string
  requestId: string
  triggerKind: MakeupNotificationTrigger
  channel: MakeupNotificationChannel
  targetType: string
  targetLabel: string
  status: string
  dedupeKey: string
  title: string
  body: string
  error: string
  createdAt: string
}

const EMPTY_WORKSPACE_DATA: MakeupRequestWorkspaceData = {
  schemaReady: true,
  requests: [],
  profiles: [],
  teachers: [],
  classes: [],
  classrooms: [],
  academicEvents: [],
  notificationSettings: [],
  notificationDeliveries: [],
}

export const MAKEUP_NOTIFICATION_TRIGGER_LABELS: Record<ActiveMakeupNotificationTrigger, string> = {
  submitted: "신청 제출",
  approved: "결재 승인",
  returned: "보완 요청",
  rejected: "반려",
  canceled: "승인 취소",
  refund_requested: "환불 신청",
}

export const MAKEUP_NOTIFICATION_CHANNEL_LABELS: Record<MakeupNotificationChannel, string> = {
  dashboard_personal: "웹 알림 · 개인",
  dashboard_management: "웹 알림 · 관리팀",
  google_chat_executive: "구글챗 · 경영팀",
  google_chat_admin: "구글챗 · 관리팀",
  google_chat_math: "구글챗 · 수학팀",
  google_chat_english: "구글챗 · 영어팀",
}

const MAKEUP_NOTIFICATION_TRIGGERS = Object.keys(MAKEUP_NOTIFICATION_TRIGGER_LABELS) as ActiveMakeupNotificationTrigger[]
const MAKEUP_NOTIFICATION_CHANNELS = Object.keys(MAKEUP_NOTIFICATION_CHANNEL_LABELS) as MakeupNotificationChannel[]
const MAKEUP_NOTIFICATION_DELIVERY_DISPLAY_LIMIT = 40
export function getMakeupNotificationTriggerLabel(triggerKind: string) {
  if (triggerKind === "completed") return MAKEUP_NOTIFICATION_TRIGGER_LABELS.approved
  return MAKEUP_NOTIFICATION_TRIGGER_LABELS[triggerKind as ActiveMakeupNotificationTrigger] || triggerKind
}

const MAKEUP_NOTIFICATION_TITLE_TEMPLATES: Record<MakeupNotificationTrigger, string> = {
  submitted: "휴보강 신청서가 올라왔습니다",
  approved: "휴보강 신청서가 결재 승인되어 자동 처리되었습니다",
  returned: "휴보강 신청서 보완 요청이 도착했습니다",
  rejected: "휴보강 신청서가 반려되었습니다",
  completed: "휴보강 신청서가 결재 승인되어 자동 처리되었습니다",
  canceled: "휴보강 승인이 취소되었습니다",
  refund_requested: "휴보강 환불 신청이 올라왔습니다",
}

const MAKEUP_NOTIFICATION_BODY_TEMPLATE = "{수업} · {휴강일} 휴강 / {보강일시} · {보강강의실} 보강"

export function getDefaultMakeupNotificationTitleTemplate(triggerKind: MakeupNotificationTrigger) {
  return MAKEUP_NOTIFICATION_TITLE_TEMPLATES[triggerKind] || "{프로세스}"
}

export function getDefaultMakeupNotificationBodyTemplate() {
  return MAKEUP_NOTIFICATION_BODY_TEMPLATE
}

export function renderMakeupNotificationTemplate(template: string, context: Record<string, string>) {
  return text(template).replace(/\{([^{}]+)\}/g, (match, key) => {
    const value = context[text(key)]
    return value === undefined ? match : value
  })
}

function text(value: unknown) {
  return String(value || "").trim()
}

function nullable(value: unknown) {
  const resolved = text(value)
  return resolved || null
}

function parseObject(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Row) : {}
}

function isMissingRelationError(error: unknown) {
  const code = text((error as { code?: string })?.code)
  const message = text((error as { message?: string })?.message).toLowerCase()

  return (
    code === "42P01" ||
    code === "PGRST205" ||
    message.includes("does not exist") ||
    message.includes("could not find the table") ||
    message.includes("schema cache")
  )
}

function isPermissionError(error: unknown) {
  const code = text((error as { code?: string })?.code)
  const message = text((error as { message?: string })?.message).toLowerCase()

  return (
    code === "42501" ||
    message.includes("permission denied") ||
    message.includes("row-level security")
  )
}

function profileLabel(row: Row | undefined) {
  return text(row?.name) || text(row?.full_name) || text(row?.email) || text(row?.login_id) || text(row?.id)
}

function mapProfile(row: Row): MakeupProfileOption {
  return {
    id: text(row.id),
    label: profileLabel(row),
    email: text(row.email),
    role: text(row.role),
    teacherCatalogId: text(row.teacher_catalog_id),
  }
}

function mapTeacher(row: Row): MakeupTeacherOption {
  const subjects = Array.isArray(row.subjects)
    ? row.subjects.map(text).filter(Boolean).join(", ")
    : text(row.subjects)
  return {
    id: text(row.id),
    name: text(row.name),
    subjects,
    isVisible: row.is_visible !== false,
    sortOrder: Number(row.sort_order || row.sortOrder || 0),
    profileId: text(row.profile_id),
    accountEmail: text(row.account_email),
    dashboardRole: text(row.dashboard_role),
  }
}

function parseTextbookIds(row: Row) {
  const direct = row.textbook_ids
  if (Array.isArray(direct)) {
    return direct.map(text).filter(Boolean)
  }

  const plan = parseObject(row.schedule_plan)
  if (Array.isArray(plan.textbooks)) {
    return plan.textbooks.map((item) => text((item as Row).textbookId || (item as Row).textbook_id)).filter(Boolean)
  }

  return []
}

function parseStringArray(value: unknown) {
  if (Array.isArray(value)) {
    return value.map(text).filter(Boolean)
  }
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed.map(text).filter(Boolean) : []
    } catch {
      return []
    }
  }
  return []
}

function mapClass(row: Row): MakeupClassOption {
  const schedulePlan = parseObject(row.schedule_plan)
  return {
    id: text(row.id),
    name: text(row.name || row.class_name),
    subject: text(row.subject),
    grade: text(row.grade),
    teacher: text(row.teacher),
    teacherCatalogId: text(row.teacher_catalog_id),
    classroom: text(row.classroom),
    room: text(row.room),
    schedule: text(row.schedule),
    schedulePlan,
    textbooks: Array.isArray(row.textbooks) ? (row.textbooks as Row[]) : [],
    textbookIds: parseTextbookIds(row),
  }
}

function mapRequest(row: Row, profilesById: Map<string, MakeupProfileOption>, teachersById: Map<string, MakeupTeacherOption>, eventsByRequestId = new Map<string, MakeupRequestEvent[]>()) {
  const id = text(row.id)
  const requesterId = text(row.requester_id)
  const teacherCatalogId = text(row.teacher_catalog_id)
  const teacherProfileId = text(row.teacher_profile_id)
  const approverTeacherCatalogId = text(row.approver_teacher_catalog_id)
  const approverProfileId = text(row.approver_profile_id)
  const makeupSlots = normalizeMakeupSlots(row, text(row.makeup_classroom))
  const approvedBy = text(row.approved_by)
  const completedBy = text(row.completed_by)
  const canceledBy = text(row.canceled_by)

  return {
    id,
    status: (text(row.status) || "approval_pending") as MakeupRequestStatus,
    subject: text(row.subject),
    approvalGroup: (text(row.approval_group) || "unknown") as MakeupApprovalGroup,
    requesterId,
    requesterLabel: profilesById.get(requesterId)?.label || "신청자",
    teacherCatalogId,
    teacherProfileId,
    teacherLabel: teachersById.get(teacherCatalogId)?.name || profilesById.get(teacherProfileId)?.label || "선생님",
    classId: text(row.class_id),
    className: text(row.class_name),
    requestKind: getMakeupRequestKind(row),
    reason: text(row.reason),
    cancelDate: text(row.cancel_date),
    makeupStartAt: text(row.makeup_start_at),
    makeupEndAt: text(row.makeup_end_at),
    makeupClassroom: text(row.makeup_classroom),
    makeupSlots,
    approverTeacherCatalogId,
    approverProfileId,
    approverLabel: teachersById.get(approverTeacherCatalogId)?.name || profilesById.get(approverProfileId)?.label || "결재자",
    returnedReason: text(row.returned_reason),
    rejectedReason: text(row.rejected_reason),
    finalNote: text(row.final_note),
    approvedBy,
    approvedByLabel: profilesById.get(approvedBy)?.label || "",
    approvedAt: text(row.approved_at),
    completedBy,
    completedByLabel: profilesById.get(completedBy)?.label || "",
    completedAt: text(row.completed_at),
    canceledBy,
    canceledByLabel: profilesById.get(canceledBy)?.label || "",
    canceledAt: text(row.canceled_at),
    schedulePlanBefore: parseObject(row.schedule_plan_before),
    schedulePlanAfter: parseObject(row.schedule_plan_after),
    cancelAcademicEventId: text(row.cancel_academic_event_id),
    makeupAcademicEventId: text(row.makeup_academic_event_id),
    makeupAcademicEventIds: parseStringArray(row.makeup_academic_event_ids),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
    events: eventsByRequestId.get(id) || [],
  } satisfies MakeupRequest
}

function mapEvent(row: Row, profilesById: Map<string, MakeupProfileOption>): MakeupRequestEvent {
  const actorId = text(row.actor_id)

  return {
    id: text(row.id),
    requestId: text(row.request_id),
    actorId,
    actorLabel: profilesById.get(actorId)?.label || "시스템",
    eventType: text(row.event_type),
    fieldName: text(row.field_name),
    beforeValue: text(row.before_value),
    afterValue: text(row.after_value),
    note: text(row.note),
    createdAt: text(row.created_at),
  }
}

function mapNotificationSetting(row: Row): MakeupNotificationSetting {
  const triggerKind = text(row.trigger_kind) as MakeupNotificationTrigger
  return {
    triggerKind,
    channel: text(row.channel) as MakeupNotificationChannel,
    enabled: row.enabled !== false,
    titleTemplate: text(row.title_template) || getDefaultMakeupNotificationTitleTemplate(triggerKind),
    bodyTemplate: text(row.body_template) || getDefaultMakeupNotificationBodyTemplate(),
    updatedAt: text(row.updated_at),
  }
}

function mapNotificationDelivery(row: Row): MakeupNotificationDelivery {
  return {
    id: text(row.id),
    requestId: text(row.request_id),
    triggerKind: text(row.trigger_kind) as MakeupNotificationTrigger,
    channel: text(row.channel) as MakeupNotificationChannel,
    targetType: text(row.target_type),
    targetLabel: text(row.target_label),
    status: text(row.status),
    dedupeKey: text(row.dedupe_key),
    title: text(row.title),
    body: text(row.body),
    error: text(row.error),
    createdAt: text(row.created_at),
  }
}

function buildDefaultNotificationSettings() {
  return MAKEUP_NOTIFICATION_TRIGGERS.flatMap((triggerKind) => (
    MAKEUP_NOTIFICATION_CHANNELS.map((channel) => ({
      triggerKind,
      channel,
      enabled: true,
      titleTemplate: getDefaultMakeupNotificationTitleTemplate(triggerKind),
      bodyTemplate: getDefaultMakeupNotificationBodyTemplate(),
      updatedAt: "",
    }))
  ))
}

function mergeNotificationSettings(settings: MakeupNotificationSetting[]) {
  const settingMap = new Map(settings.map((item) => [`${item.triggerKind}:${item.channel}`, item]))
  return buildDefaultNotificationSettings().map((fallback) => (
    (() => {
      const setting = settingMap.get(`${fallback.triggerKind}:${fallback.channel}`)
      if (!setting) return fallback
      return {
        ...fallback,
        ...setting,
        titleTemplate: setting.titleTemplate || fallback.titleTemplate,
        bodyTemplate: setting.bodyTemplate || fallback.bodyTemplate,
      }
    })()
  ))
}

async function readTable(table: string, select = "*", optional = false) {
  if (!supabase) {
    throw new Error("Supabase 연결 설정이 필요합니다.")
  }

  const { data, error } = await supabase.from(table).select(select)
  if (error) {
    if (optional && (isMissingRelationError(error) || isPermissionError(error))) {
      return [] as Row[]
    }
    throw error
  }

  return ((data || []) as unknown) as Row[]
}

async function readNotificationDeliveryRows() {
  if (!supabase) {
    throw new Error("Supabase 연결 설정이 필요합니다.")
  }

  const { data, error } = await supabase
    .from("makeup_notification_deliveries")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(MAKEUP_NOTIFICATION_DELIVERY_DISPLAY_LIMIT)

  if (error) {
    if (isMissingRelationError(error) || isPermissionError(error)) return [] as Row[]
    throw error
  }

  return ((data || []) as unknown) as Row[]
}

function findTeacherByName(teachers: MakeupTeacherOption[], name: string) {
  const normalized = text(name)
  return teachers.find((teacher) => teacher.name === normalized)
}

function resolveTeacherForClass(classItem: MakeupClassOption, teachers: MakeupTeacherOption[], profiles: MakeupProfileOption[]) {
  if (classItem.teacherCatalogId) {
    const byCatalogId = teachers.find((teacher) => teacher.id === classItem.teacherCatalogId)
    if (byCatalogId) return byCatalogId
  }

  const byName = findTeacherByName(teachers, classItem.teacher)
  if (byName) return byName

  const profile = profiles.find((item) => item.id && item.id === classItem.teacherCatalogId)
  return profile ? teachers.find((teacher) => teacher.profileId === profile.id) : undefined
}

function isMakeupManagerRole(role: string) {
  return ["admin", "staff", "super_admin", "manager"].includes(text(role))
}

function getLatestMakeupRequestEvent(request: MakeupRequest, eventTypes: string[]) {
  return [...(request.events || [])]
    .filter((event) => eventTypes.includes(event.eventType))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] || null
}

function isRefundApprovalRequest(request: MakeupRequest) {
  const refundEvent = getLatestMakeupRequestEvent(request, ["refund_requested"])
  if (!refundEvent) return false

  const latestRequestEvent = getLatestMakeupRequestEvent(request, ["submitted", "resubmitted"])
  const latestApprovalEvent = getLatestMakeupRequestEvent(request, ["approved"])
  if (latestRequestEvent && latestRequestEvent.createdAt > refundEvent.createdAt) return false
  if (latestApprovalEvent && latestApprovalEvent.createdAt > refundEvent.createdAt) return false
  return true
}

type MakeupMutationWire = {
  request?: unknown
  sourceEventId?: unknown
}

async function dispatchLegacyMakeupNotification(sourceEventId: string) {
  if (!supabase || !sourceEventId) return
  try {
    const { data } = await supabase.auth.getSession()
    const accessToken = data.session?.access_token
    if (!accessToken) return
    const response = await fetch("/api/notifications/legacy/makeup", {
      method: "POST",
      keepalive: true,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sourceEventId }),
    })
    if (!response.ok && response.status !== 202) {
      console.warn("휴보강 저장은 완료됐지만 알림 후처리를 완료하지 못했습니다.")
    }
  } catch (error) {
    console.warn("휴보강 저장은 완료됐지만 알림 후처리를 완료하지 못했습니다.", error)
  }
}

async function runMakeupMutationRpc(
  name: "create_makeup_request_v2" | "transition_makeup_request_v2" | "delete_makeup_request_v2",
  parameters: Row,
  workspaceData: MakeupRequestWorkspaceData,
) {
  if (!supabase) throw new Error("Supabase 연결 설정이 필요합니다.")
  const { data: raw, error } = await supabase.rpc(name, parameters)
  if (error) throw error
  const wire = parseObject(raw) as MakeupMutationWire
  const requestRow = parseObject(wire.request)
  const requestId = text(requestRow.id)
  const sourceEventId = text(wire.sourceEventId)
  if (!requestId || !sourceEventId) {
    throw new Error("휴보강 저장 결과가 올바르지 않습니다.")
  }
  const profilesById = new Map(workspaceData.profiles.map((profile) => [profile.id, profile]))
  const teachersById = new Map(workspaceData.teachers.map((teacher) => [teacher.id, teacher]))
  const request = mapRequest(requestRow, profilesById, teachersById)
  await dispatchLegacyMakeupNotification(sourceEventId)
  return { request, sourceEventId }
}

export async function loadMakeupRequestWorkspaceData(): Promise<MakeupRequestWorkspaceData> {
  if (!supabase) {
    return {
      ...EMPTY_WORKSPACE_DATA,
      schemaReady: false,
      error: "Supabase 연결 설정이 필요합니다.",
    }
  }

  try {
    const [profilesRows, teacherRows, classRows, classroomRows, academicEventRows, requestRows, notificationSettingRows, notificationDeliveryRows] = await Promise.all([
      readTable("profiles", "id,email,name,role,login_id,teacher_catalog_id", true),
      readTable("teacher_catalogs", "id,name,subjects,is_visible,sort_order,profile_id,account_email,dashboard_role", true),
      readTable("classes", "*", true),
      readTable("classroom_catalogs", "*", true),
      readTable("academic_events", "*", true),
      readTable("makeup_requests", "*", false),
      readTable("makeup_notification_settings", "*", true),
      readNotificationDeliveryRows(),
    ])
    const profiles = profilesRows.map(mapProfile)
    const teachers = teacherRows.map(mapTeacher)
    const classes = classRows.map(mapClass)
    const profilesById = new Map(profiles.map((profile) => [profile.id, profile]))
    const teachersById = new Map(teachers.map((teacher) => [teacher.id, teacher]))
    const requestIds = requestRows.map((row) => text(row.id)).filter(Boolean)
    const eventsByRequestId = new Map<string, MakeupRequestEvent[]>()

    if (requestIds.length > 0) {
      const eventRows = await readTable("makeup_request_events", "*", true)
      for (const row of eventRows) {
        const event = mapEvent(row, profilesById)
        if (!requestIds.includes(event.requestId)) continue
        const list = eventsByRequestId.get(event.requestId) || []
        list.push(event)
        eventsByRequestId.set(event.requestId, list)
      }
    }

    return {
      schemaReady: true,
      requests: requestRows.map((row) => mapRequest(row, profilesById, teachersById, eventsByRequestId)),
      profiles,
      teachers,
      classes,
      classrooms: classroomRows,
      academicEvents: academicEventRows,
      notificationSettings: mergeNotificationSettings(notificationSettingRows.map(mapNotificationSetting)),
      notificationDeliveries: notificationDeliveryRows.map(mapNotificationDelivery),
    }
  } catch (error) {
    if (isMissingRelationError(error)) {
      return {
        ...EMPTY_WORKSPACE_DATA,
        schemaReady: false,
        error: "휴보강 신청서 DB 마이그레이션을 적용하세요.",
      }
    }

    return {
      ...EMPTY_WORKSPACE_DATA,
      schemaReady: false,
      error: error instanceof Error ? error.message : "휴보강 신청서 데이터를 불러오지 못했습니다.",
    }
  }
}

function buildCreatePayload(
  input: MakeupRequestInput,
  requesterId: string,
  data: MakeupRequestWorkspaceData,
  options: { effectiveYear?: number; allowApproverOverride?: boolean } = {},
) {
  const classItem = data.classes.find((item) => item.id === input.classId)
  if (!classItem) {
    throw new Error("신청할 수업을 선택해 주세요.")
  }

  const teacher = resolveTeacherForClass(classItem, data.teachers, data.profiles)
  if (!teacher?.profileId) {
    throw new Error("담당 선생님 계정 연결이 필요합니다. 선생님 설정에서 계정을 연결해 주세요.")
  }

  const approvalGroup = resolveMakeupApprovalGroup(classItem)
  const effectiveYear = options.effectiveYear ?? getMakeupRequestEffectiveYear()
  const allowApproverOverride = options.allowApproverOverride === true
  const approver = data.teachers.find((item) => item.id === input.approverTeacherCatalogId)
  if (!approver || !isMakeupApproverAllowed({
    classRecord: classItem,
    approverName: approver.name,
    effectiveYear,
    isManager: allowApproverOverride,
  })) {
    throw new Error("선택할 수 없는 결재자입니다.")
  }
  if (!approver.profileId) {
    throw new Error(`${approver.name} 결재자 계정 연결이 필요합니다. 선생님 설정에서 계정을 연결해 주세요.`)
  }
  const hasCancel = hasCancelPart(input)
  const hasMakeup = hasMakeupPart(input)
  if (!hasCancel && !hasMakeup) {
    throw new Error("휴강일 또는 보강일시를 입력해 주세요.")
  }
  if (hasCancel && !text(input.cancelDate)) {
    throw new Error("휴강일을 입력해 주세요.")
  }
  if (hasMakeup && input.makeupSlots.some((slot) => !text(slot.classroom))) {
    throw new Error("각 보강일시의 강의실을 선택해 주세요.")
  }
  const makeupSlots = hasMakeup ? normalizeMakeupSlots({ makeupSlots: input.makeupSlots }, "") : []
  if (hasMakeup && makeupSlots.length === 0) {
    throw new Error("보강일시를 1개 이상 입력해 주세요.")
  }
  const firstSlot = makeupSlots[0]

  return {
    status: "approval_pending",
    request_kind: input.requestKind,
    subject: classItem.subject,
    approval_group: approvalGroup,
    requester_id: requesterId,
    teacher_catalog_id: teacher.id,
    teacher_profile_id: teacher.profileId,
    class_id: classItem.id,
    class_name: classItem.name,
    reason: text(input.reason),
    cancel_date: hasCancel ? input.cancelDate : null,
    makeup_start_at: hasMakeup ? firstSlot.startAt : null,
    makeup_end_at: hasMakeup ? firstSlot.endAt : null,
    makeup_classroom: hasMakeup ? firstSlot.classroom : null,
    makeup_slots: makeupSlots,
    approver_teacher_catalog_id: approver.id,
    approver_profile_id: approver.profileId,
    returned_reason: null,
    rejected_reason: null,
  }
}

export async function createMakeupRequest(input: MakeupRequestInput, requesterId: string) {
  if (!supabase) throw new Error("Supabase 연결 설정이 필요합니다.")
  const data = await loadMakeupRequestWorkspaceData()
  if (!data.schemaReady) throw new Error(data.error || "휴보강 신청서 DB를 사용할 수 없습니다.")

  const requester = data.profiles.find((profile) => profile.id === requesterId)
  const payload = buildCreatePayload(input, requesterId, data, {
    effectiveYear: getMakeupRequestEffectiveYear(),
    allowApproverOverride: isMakeupManagerRole(requester?.role || ""),
  })
  const createInput: Row = { ...payload }
  delete createInput.status
  const result = await runIdempotentMakeupCreate({
    actorId: requesterId,
    payload: createInput,
    invoke: (requestId: string) => runMakeupMutationRpc("create_makeup_request_v2", {
      p_input: createInput,
      p_request_id: requestId,
    }, data),
  })
  return result.request
}

async function loadSingleMakeupRequest(requestId: string, data?: MakeupRequestWorkspaceData) {
  if (!supabase) throw new Error("Supabase 연결 설정이 필요합니다.")

  const workspaceData = data || await loadMakeupRequestWorkspaceData()
  if (!workspaceData.schemaReady) throw new Error(workspaceData.error || "휴보강 신청서 DB를 사용할 수 없습니다.")

  const { data: row, error } = await supabase
    .from("makeup_requests")
    .select("*")
    .eq("id", requestId)
    .single()

  if (error) throw error

  const profilesById = new Map(workspaceData.profiles.map((profile) => [profile.id, profile]))
  const teachersById = new Map(workspaceData.teachers.map((teacher) => [teacher.id, teacher]))
  return {
    request: mapRequest(row as Row, profilesById, teachersById),
    data: workspaceData,
  }
}

export async function approveMakeupRequest(requestId: string, actorId: string, note = "") {
  if (!supabase) throw new Error("Supabase 연결 설정이 필요합니다.")
  const { request, data } = await loadSingleMakeupRequest(requestId)
  const nextStatus = isRefundApprovalRequest(request) ? "refund_pending" : hasMakeupPart(request) ? "completed" : "makeup_pending"
  if (!canTransitionMakeupRequest(request.status, nextStatus, { isApprover: request.approverProfileId === actorId })) {
    throw new Error("결재 승인 권한이 없습니다.")
  }

  const isRefundApproval = nextStatus === "refund_pending"
  if (!isRefundApproval && hasMakeupPart(request)) {
    assertRoomAvailableForCompletion(request, data)
  }

  const { data: sessionData } = await supabase.auth.getSession()
  const accessToken = sessionData.session?.access_token
  if (!accessToken) throw new Error("로그인 정보를 확인해 주세요.")
  const response = await fetch("/api/makeup-requests/approve", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      requestId,
      note: text(note),
      expectedStatus: request.status,
      mutationRequestId: crypto.randomUUID(),
    }),
  })
  const raw = await response.json().catch(() => null)
  const wire = parseObject(raw) as MakeupMutationWire & { error?: unknown }
  if (!response.ok) throw new Error(text(wire.error) || "휴보강 승인을 완료하지 못했습니다.")
  const requestRow = parseObject(wire.request)
  const sourceEventId = text(wire.sourceEventId)
  if (!text(requestRow.id) || !sourceEventId) {
    throw new Error("휴보강 승인 결과가 올바르지 않습니다.")
  }
  const profilesById = new Map(data.profiles.map((profile) => [profile.id, profile]))
  const teachersById = new Map(data.teachers.map((teacher) => [teacher.id, teacher]))
  const approvedRequest = mapRequest(requestRow, profilesById, teachersById)
  await dispatchLegacyMakeupNotification(sourceEventId)
  return approvedRequest
}

export async function requestMakeupRequestRevision(requestId: string, actorId: string, note: string) {
  if (!supabase) throw new Error("Supabase 연결 설정이 필요합니다.")
  const { request, data } = await loadSingleMakeupRequest(requestId)
  const isActor = request.approverProfileId === actorId
  if (!isActor || request.status !== "approval_pending") {
    throw new Error("보완 요청 권한이 없습니다.")
  }

  const returnedReason = text(note)
  const result = await runMakeupMutationRpc("transition_makeup_request_v2", {
    p_makeup_request_id: requestId,
    p_command: "revision_requested",
    p_patch: { note: returnedReason },
    p_expected_status: request.status,
    p_request_id: crypto.randomUUID(),
  }, data)
  return result.request
}

export async function rejectMakeupRequest(requestId: string, actorId: string, note: string) {
  if (!supabase) throw new Error("Supabase 연결 설정이 필요합니다.")
  const { request, data } = await loadSingleMakeupRequest(requestId)
  const isActor = request.approverProfileId === actorId
  if (!isActor || request.status !== "approval_pending") {
    throw new Error("반려 권한이 없습니다.")
  }

  const rejectedReason = text(note)
  const result = await runMakeupMutationRpc("transition_makeup_request_v2", {
    p_makeup_request_id: requestId,
    p_command: "reject",
    p_patch: { note: rejectedReason },
    p_expected_status: request.status,
    p_request_id: crypto.randomUUID(),
  }, data)
  return result.request
}

export async function requestMakeupRefund(requestId: string, actorId: string, note: string) {
  if (!supabase) throw new Error("Supabase 연결 설정이 필요합니다.")
  const workspaceData = await loadMakeupRequestWorkspaceData()
  const { request } = await loadSingleMakeupRequest(requestId, workspaceData)
  const actor = workspaceData.profiles.find((profile) => profile.id === actorId)
  const isRequester = request.requesterId === actorId
  const isManager = ["admin", "staff", "super_admin", "manager"].includes(actor?.role || "")
  if (!canTransitionMakeupRequest(request.status, "approval_pending", { isRequester, isManager })) {
    throw new Error("환불 신청할 수 없는 상태입니다.")
  }

  const refundReason = text(note)
  const result = await runMakeupMutationRpc("transition_makeup_request_v2", {
    p_makeup_request_id: requestId,
    p_command: "refund_requested",
    p_patch: { note: refundReason },
    p_expected_status: request.status,
    p_request_id: crypto.randomUUID(),
  }, workspaceData)
  return result.request
}

export async function completeMakeupRefund(requestId: string, actorId: string, note = "") {
  if (!supabase) throw new Error("Supabase 연결 설정이 필요합니다.")
  const workspaceData = await loadMakeupRequestWorkspaceData()
  const { request } = await loadSingleMakeupRequest(requestId, workspaceData)
  const actor = workspaceData.profiles.find((profile) => profile.id === actorId)
  const isManager = ["admin", "staff", "super_admin", "manager"].includes(actor?.role || "")
  if (!canTransitionMakeupRequest(request.status, "completed", { isManager })) {
    throw new Error("환불 완료 권한이 없습니다.")
  }

  const completedNote = text(note)
  const result = await runMakeupMutationRpc("transition_makeup_request_v2", {
    p_makeup_request_id: requestId,
    p_command: "refund_completed",
    p_patch: { note: completedNote },
    p_expected_status: request.status,
    p_request_id: crypto.randomUUID(),
  }, workspaceData)
  return result.request
}

export async function resubmitMakeupRequest(requestId: string, input: MakeupRequestInput, actorId: string) {
  if (!supabase) throw new Error("Supabase 연결 설정이 필요합니다.")
  const data = await loadMakeupRequestWorkspaceData()
  const { request } = await loadSingleMakeupRequest(requestId, data)
  if (!canTransitionMakeupRequest(request.status, "approval_pending", { isRequester: request.requesterId === actorId })) {
    throw new Error("재상신 권한이 없습니다.")
  }

  const actor = data.profiles.find((profile) => profile.id === actorId)
  const payload = buildCreatePayload(input, actorId, data, {
    effectiveYear: getMakeupRequestEffectiveYear(request.createdAt),
    allowApproverOverride: isMakeupManagerRole(actor?.role || ""),
  })
  const transitionPatch: Row = { ...payload }
  delete transitionPatch.status
  delete transitionPatch.requester_id
  const result = await runMakeupMutationRpc("transition_makeup_request_v2", {
    p_makeup_request_id: requestId,
    p_command: "resubmit",
    p_patch: transitionPatch,
    p_expected_status: request.status,
    p_request_id: crypto.randomUUID(),
  }, data)
  return result.request
}

function assertRoomAvailableForCompletion(request: MakeupRequest, data: MakeupRequestWorkspaceData) {
  const slots = request.makeupSlots.length > 0
    ? request.makeupSlots
    : [{ id: "slot-1", startAt: request.makeupStartAt, endAt: request.makeupEndAt, classroom: request.makeupClassroom }]

  for (const slot of slots) {
    const classroom = text(slot.classroom || request.makeupClassroom)
    const availability = buildRoomAvailability({
      classrooms: data.classrooms,
      classes: data.classes,
      requests: data.requests,
      academicEvents: data.academicEvents,
      slots: [{ ...slot, classroom }],
      currentRequestId: request.id,
      subject: request.subject,
    })
    const target = availability.find((room) => room.name === classroom)
    if (target && target.collisions.length > 0) {
      const details = target.collisions.map((collision) => collision.title || collision.detail).filter(Boolean).join(", ")
      throw new Error(`보강 강의실 충돌이 있습니다: ${details}`)
    }
  }
}

export async function cancelCompletedMakeupRequest(requestId: string, actorId: string, note = "") {
  if (!supabase) throw new Error("Supabase 연결 설정이 필요합니다.")
  const workspaceData = await loadMakeupRequestWorkspaceData()
  const { request } = await loadSingleMakeupRequest(requestId, workspaceData)

  if (!canTransitionMakeupRequest(request.status, "canceled", { isApprover: request.approverProfileId === actorId })) {
    throw new Error("승인 취소할 수 없는 상태입니다.")
  }

  if (!request.classId) {
    throw new Error("복구할 수업 정보를 찾을 수 없습니다.")
  }

  const cancelNote = text(note)
  const result = await runMakeupMutationRpc("transition_makeup_request_v2", {
    p_makeup_request_id: requestId,
    p_command: "approval_canceled",
    p_patch: { note: cancelNote },
    p_expected_status: request.status,
    p_request_id: crypto.randomUUID(),
  }, workspaceData)
  return result.request
}

export async function deleteMakeupRequest(requestId: string, actorId: string) {
  if (!supabase) throw new Error("Supabase 연결 설정이 필요합니다.")
  const id = text(requestId)
  if (!id) throw new Error("삭제할 휴보강 신청서를 찾을 수 없습니다.")

  const workspaceData = await loadMakeupRequestWorkspaceData()
  const { request } = await loadSingleMakeupRequest(id, workspaceData)
  const actor = workspaceData.profiles.find((profile) => profile.id === actorId)
  if (actor?.role !== "admin") {
    throw new Error("운영자만 휴보강 이력을 삭제할 수 있습니다.")
  }
  if (!["completed", "rejected", "canceled"].includes(request.status)) {
    throw new Error("승인/반려된 휴보강 이력만 삭제할 수 있습니다.")
  }

  const result = await runMakeupMutationRpc("delete_makeup_request_v2", {
    p_makeup_request_id: id,
    p_request_id: crypto.randomUUID(),
  }, workspaceData)
  return result.request
}

export async function toggleMakeupNotificationSetting(
  triggerKind: MakeupNotificationTrigger,
  channel: MakeupNotificationChannel,
  enabled: boolean,
  actorId: string,
) {
  if (!supabase) throw new Error("Supabase 연결 설정이 필요합니다.")
  const channels: MakeupNotificationChannel[] =
    channel === "google_chat_english" || channel === "google_chat_math"
      ? ["google_chat_english", "google_chat_math"]
      : [channel]
  const updatedAt = new Date().toISOString()
  const rows = channels.map((targetChannel) => ({
    trigger_kind: triggerKind,
    channel: targetChannel,
    enabled,
    updated_by: nullable(actorId),
    updated_at: updatedAt,
  }))
  const { error } = await supabase
    .from("makeup_notification_settings")
    .upsert(rows, { onConflict: "trigger_kind,channel" })
  if (error) throw error
}

export async function updateMakeupNotificationTriggerContent(
  triggerKind: MakeupNotificationTrigger,
  inputTitleTemplate: string,
  inputBodyTemplate: string,
  actorId: string,
) {
  if (!supabase) throw new Error("Supabase 연결 설정이 필요합니다.")
  const titleTemplate = text(inputTitleTemplate) || getDefaultMakeupNotificationTitleTemplate(triggerKind)
  const bodyTemplate = text(inputBodyTemplate) || getDefaultMakeupNotificationBodyTemplate()
  const rows = MAKEUP_NOTIFICATION_CHANNELS.map((channel) => ({
    trigger_kind: triggerKind,
    channel,
    title_template: titleTemplate,
    body_template: bodyTemplate,
    updated_by: nullable(actorId),
    updated_at: new Date().toISOString(),
  }))
  const { error } = await supabase
    .from("makeup_notification_settings")
    .upsert(rows, { onConflict: "trigger_kind,channel" })
  if (error) throw error
}

export async function loadDashboardNotifications(
  limit = 20,
  cursor: DashboardNotificationCursor | null = null,
): Promise<DashboardNotificationInbox> {
  if (!supabase) return { items: [], unreadCount: 0, nextCursor: null }

  const { data, error } = await supabase.rpc("get_dashboard_notification_inbox_v1", {
    p_limit: limit,
    p_before_created_at: cursor?.createdAt ?? null,
    p_before_id: cursor?.id ?? null,
  })
  if (error) {
    throw normalizeDashboardNotificationRpcError(error, "get_dashboard_notification_inbox_v1")
  }
  return mapDashboardNotificationInboxWire(data)
}

export async function loadDashboardUnreadNotificationCount(): Promise<number> {
  if (!supabase) return 0

  const { data, error } = await supabase.rpc("get_dashboard_notification_unread_count_v1")
  if (error) {
    throw normalizeDashboardNotificationRpcError(
      error,
      "get_dashboard_notification_unread_count_v1",
    )
  }
  return mapDashboardNotificationUnreadCountWire(data)
}

export async function markDashboardNotificationRead(
  id: string,
): Promise<DashboardNotificationReadResult> {
  if (!supabase) throw new Error("Supabase 연결 설정이 필요합니다.")
  const notificationId = text(id)
  if (!notificationId) throw new Error("읽음 처리할 알림을 찾을 수 없습니다.")

  const { data, error } = await supabase.rpc("mark_dashboard_notification_read_v1", {
    p_notification_id: notificationId,
  })
  if (error) {
    throw normalizeDashboardNotificationRpcError(error, "mark_dashboard_notification_read_v1")
  }
  return mapDashboardNotificationReadWire(data)
}
