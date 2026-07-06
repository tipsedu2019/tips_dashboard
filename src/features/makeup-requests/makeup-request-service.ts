"use client"

import { supabase } from "@/lib/supabase"
import {
  applyMakeupRequestToSchedulePlan,
  buildMakeupCalendarDrafts,
  buildRoomAvailability,
  canTransitionMakeupRequest,
  getAllowedApproverNames,
  normalizeMakeupSlots,
  resolveMakeupApprovalGroup,
} from "./makeup-request-model.js"
import {
  buildAcademicEventMutationPayload,
  runAcademicEventMutation,
} from "@/features/operations/academic-event-utils.js"

type Row = Record<string, unknown>

export type MakeupRequestStatus =
  | "approval_pending"
  | "revision_requested"
  | "rejected"
  | "manager_pending"
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

export type DashboardNotification = {
  id: string
  title: string
  body: string
  href: string
  type: string
  dedupeKey: string
  readAt: string
  createdAt: string
}

export type GoogleChatChannel = "executive" | "admin" | "math" | "english"

export type MakeupNotificationTrigger = "submitted" | "approved" | "returned" | "rejected" | "completed" | "canceled"

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

const GOOGLE_CHAT_CHANNEL_ENV: Record<GoogleChatChannel, string> = {
  executive: "GOOGLE_CHAT_WEBHOOK_EXECUTIVE",
  admin: "GOOGLE_CHAT_WEBHOOK_ADMIN",
  math: "GOOGLE_CHAT_WEBHOOK_MATH",
  english: "GOOGLE_CHAT_WEBHOOK_ENGLISH",
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

export const MAKEUP_NOTIFICATION_TRIGGER_LABELS: Record<MakeupNotificationTrigger, string> = {
  submitted: "신청 제출",
  approved: "결재 승인",
  returned: "보완 요청",
  rejected: "반려",
  completed: "처리 완료",
  canceled: "완료 취소",
}

export const MAKEUP_NOTIFICATION_CHANNEL_LABELS: Record<MakeupNotificationChannel, string> = {
  dashboard_personal: "웹 알림 · 개인",
  dashboard_management: "웹 알림 · 관리팀",
  google_chat_executive: "Google Chat · 경영팀",
  google_chat_admin: "Google Chat · 관리팀",
  google_chat_math: "Google Chat · 수학",
  google_chat_english: "Google Chat · 영어",
}

const MAKEUP_NOTIFICATION_TRIGGERS = Object.keys(MAKEUP_NOTIFICATION_TRIGGER_LABELS) as MakeupNotificationTrigger[]
const MAKEUP_NOTIFICATION_CHANNELS = Object.keys(MAKEUP_NOTIFICATION_CHANNEL_LABELS) as MakeupNotificationChannel[]

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
  return {
    id: text(row.id),
    name: text(row.name),
    subjects: text(row.subjects),
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
  return {
    triggerKind: text(row.trigger_kind) as MakeupNotificationTrigger,
    channel: text(row.channel) as MakeupNotificationChannel,
    enabled: row.enabled !== false,
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
      updatedAt: "",
    }))
  ))
}

function mergeNotificationSettings(settings: MakeupNotificationSetting[]) {
  const settingMap = new Map(settings.map((item) => [`${item.triggerKind}:${item.channel}`, item]))
  return buildDefaultNotificationSettings().map((fallback) => (
    settingMap.get(`${fallback.triggerKind}:${fallback.channel}`) || fallback
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

function getManagementProfileIds(profiles: MakeupProfileOption[]) {
  return profiles
    .filter((profile) => ["admin", "staff", "super_admin", "manager"].includes(profile.role))
    .map((profile) => profile.id)
    .filter(Boolean)
}

function buildRequestHref(requestId: string) {
  return `/admin/makeup-requests${requestId ? `?request=${encodeURIComponent(requestId)}` : ""}`
}

function buildNotificationDedupeKey(requestId: string, triggerKind: string, channel: string, target = "") {
  return [requestId, triggerKind, channel, target].map(text).join(":")
}

function getNotificationSetting(settings: MakeupNotificationSetting[], triggerKind: MakeupNotificationTrigger, channel: MakeupNotificationChannel) {
  return settings.find((item) => item.triggerKind === triggerKind && item.channel === channel)
}

function isNotificationChannelEnabled(settings: MakeupNotificationSetting[], triggerKind: MakeupNotificationTrigger, channel: MakeupNotificationChannel) {
  const setting = getNotificationSetting(settings, triggerKind, channel)
  return setting ? setting.enabled : true
}

async function recordMakeupRequestEvent(requestId: string, eventType: string, options: Partial<MakeupRequestEvent> = {}) {
  if (!supabase || !requestId) return

  const row: Row = {
    request_id: requestId,
    event_type: eventType,
    field_name: nullable(options.fieldName),
    before_value: nullable(options.beforeValue),
    after_value: nullable(options.afterValue),
    note: nullable(options.note),
  }
  if (text(options.actorId)) {
    row.actor_id = text(options.actorId)
  }

  const { error } = await supabase.from("makeup_request_events").insert(row)
  if (error && !isMissingRelationError(error)) {
    throw error
  }
}

async function loadMakeupNotificationSettings() {
  if (!supabase) return buildDefaultNotificationSettings()

  try {
    const rows = await readTable("makeup_notification_settings", "*", true)
    const mapped = rows.map(mapNotificationSetting)
    return mergeNotificationSettings(mapped)
  } catch (error) {
    if (isMissingRelationError(error) || isPermissionError(error)) return buildDefaultNotificationSettings()
    throw error
  }
}

async function recordNotificationDelivery(input: {
  requestId: string
  triggerKind: MakeupNotificationTrigger
  channel: MakeupNotificationChannel
  targetType: string
  targetLabel?: string
  recipientProfileId?: string
  recipientTeam?: string
  googleChatChannel?: GoogleChatChannel
  status: "sent" | "skipped" | "failed" | "disabled" | "deduped"
  dedupeKey?: string
  title: string
  body: string
  error?: string
  actorProfileId?: string
  metadata?: Row
}) {
  if (!supabase) return

  const { error } = await supabase.from("makeup_notification_deliveries").insert({
    request_id: nullable(input.requestId),
    trigger_kind: input.triggerKind,
    channel: input.channel,
    target_type: input.targetType,
    target_label: text(input.targetLabel),
    recipient_profile_id: nullable(input.recipientProfileId),
    recipient_team: nullable(input.recipientTeam),
    google_chat_channel: nullable(input.googleChatChannel),
    status: input.status,
    dedupe_key: nullable(input.dedupeKey),
    title: text(input.title),
    body: text(input.body),
    error: nullable(input.error),
    actor_profile_id: nullable(input.actorProfileId),
    metadata: input.metadata || {},
  })

  if (error && !isMissingRelationError(error)) {
    throw error
  }
}

export async function createDashboardNotification(input: {
  recipientProfileId?: string
  recipientTeam?: string
  actorProfileId?: string
  type?: string
  title: string
  body?: string
  href?: string
  dedupeKey?: string
  metadata?: Row
}) {
  if (!supabase) return

  const row = {
    recipient_profile_id: nullable(input.recipientProfileId),
    recipient_team: nullable(input.recipientTeam),
    actor_profile_id: nullable(input.actorProfileId),
    type: text(input.type) || "makeup_request",
    title: text(input.title),
    body: nullable(input.body),
    href: nullable(input.href),
    dedupe_key: nullable(input.dedupeKey),
    metadata: {
      ...(input.metadata || {}),
      dedupeKey: text(input.dedupeKey),
    },
  }

  const result = input.dedupeKey
    ? await supabase.from("dashboard_notifications").upsert(row, { onConflict: "dedupe_key", ignoreDuplicates: true })
    : await supabase.from("dashboard_notifications").insert(row)
  const error = result.error

  if (error && !isMissingRelationError(error)) {
    throw error
  }
}

async function createMonitoredDashboardNotification(input: {
  requestId: string
  triggerKind: MakeupNotificationTrigger
  channel: MakeupNotificationChannel
  recipientProfileId?: string
  recipientTeam?: string
  actorProfileId?: string
  title: string
  body: string
  href: string
  targetLabel: string
  settings: MakeupNotificationSetting[]
}) {
  const target = text(input.recipientProfileId || input.recipientTeam)
  const dedupeKey = buildNotificationDedupeKey(input.requestId, input.triggerKind, input.channel, target)
  if (!isNotificationChannelEnabled(input.settings, input.triggerKind, input.channel)) {
    await recordNotificationDelivery({
      ...input,
      targetType: input.recipientProfileId ? "profile" : "team",
      status: "disabled",
      dedupeKey,
    })
    return
  }

  if (supabase) {
    const { data } = await supabase
      .from("dashboard_notifications")
      .select("id")
      .eq("dedupe_key", dedupeKey)
      .maybeSingle()
    if (data) {
      await recordNotificationDelivery({
        ...input,
        targetType: input.recipientProfileId ? "profile" : "team",
        status: "deduped",
        dedupeKey,
      })
      return
    }
  }

  await createDashboardNotification({
    recipientProfileId: input.recipientProfileId,
    recipientTeam: input.recipientTeam,
    actorProfileId: input.actorProfileId,
    title: input.title,
    body: input.body,
    href: input.href,
    dedupeKey,
    metadata: { requestId: input.requestId, triggerKind: input.triggerKind, channel: input.channel },
  })
  await recordNotificationDelivery({
    ...input,
    targetType: input.recipientProfileId ? "profile" : "team",
    status: "sent",
    dedupeKey,
  })
}

export async function sendGoogleChatNotification(channel: GoogleChatChannel, textBody: string, metadata: Row = {}) {
  if (!GOOGLE_CHAT_CHANNEL_ENV[channel]) {
    return { ok: false, skipped: true, error: "알 수 없는 Google Chat 채널입니다." }
  }

  if (!supabase) {
    return { ok: false, skipped: true, error: "Supabase 연결 설정이 필요합니다." }
  }

  try {
    const { data } = await supabase.auth.getSession()
    const accessToken = data.session?.access_token
    if (!accessToken) {
      return { ok: false, skipped: true, error: "로그인 세션을 찾을 수 없습니다." }
    }

    const response = await fetch("/api/google-chat", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channel,
        text: textBody,
        metadata,
      }),
    })

    if (!response.ok) {
      return { ok: false, skipped: false, error: await response.text() }
    }

    return { ok: true, skipped: false, error: "" }
  } catch (error) {
    return {
      ok: false,
      skipped: false,
      error: error instanceof Error ? error.message : "Google Chat 알림 발송에 실패했습니다.",
    }
  }
}

async function notifyMakeupRequest(request: MakeupRequest, kind: MakeupNotificationTrigger, profiles: MakeupProfileOption[], actorProfileId = "") {
  const href = buildRequestHref(request.id)
  const managementProfileIds = getManagementProfileIds(profiles)
  const titleByKind = {
    submitted: "휴보강 신청서가 올라왔습니다",
    approved: "휴보강 신청서가 결재 승인되었습니다",
    returned: "휴보강 신청서 보완 요청이 도착했습니다",
    rejected: "휴보강 신청서가 반려되었습니다",
    completed: "휴보강 처리가 완료되었습니다",
    canceled: "휴보강 처리가 취소되었습니다",
  }
  const roomSummary = request.makeupSlots.length > 0
    ? request.makeupSlots.map((slot) => text(slot.classroom || request.makeupClassroom)).filter(Boolean).join(", ")
    : request.makeupClassroom
  const body = `${request.className} · ${request.cancelDate} 휴강 / ${roomSummary} 보강`
  const settings = await loadMakeupNotificationSettings()
  const personalRecipients = new Set<string>()
  const addPersonalRecipient = (profileId: string) => {
    if (!profileId || managementProfileIds.includes(profileId)) return
    personalRecipients.add(profileId)
  }

  if (kind === "submitted") {
    addPersonalRecipient(request.approverProfileId)
  } else if (kind === "approved") {
    addPersonalRecipient(request.requesterId)
  } else if (kind === "completed" || kind === "canceled") {
    addPersonalRecipient(request.requesterId)
    addPersonalRecipient(request.approverProfileId)
  } else if (request.requesterId) {
    addPersonalRecipient(request.requesterId)
  }

  const shouldNotifyManagement = kind === "submitted" || kind === "approved" || kind === "completed" || kind === "canceled"
  await Promise.all([
    ...[...personalRecipients].map((recipientProfileId) => createMonitoredDashboardNotification({
      requestId: request.id,
      triggerKind: kind,
      channel: "dashboard_personal",
      recipientProfileId,
      actorProfileId,
      title: titleByKind[kind],
      body,
      href,
      targetLabel: profiles.find((profile) => profile.id === recipientProfileId)?.label || "개인",
      settings,
    })),
    shouldNotifyManagement
      ? createMonitoredDashboardNotification({
          requestId: request.id,
          triggerKind: kind,
          channel: "dashboard_management",
          recipientTeam: "관리팀",
          actorProfileId,
          title: titleByKind[kind],
          body,
          href,
          targetLabel: "관리팀",
          settings,
        })
      : Promise.resolve(),
  ])

  const subjectChannel: GoogleChatChannel =
    request.approvalGroup === "english" ? "english" : request.approvalGroup.startsWith("math") ? "math" : "admin"
  const chatTargets = new Set<GoogleChatChannel>(
    kind === "submitted"
      ? ["executive", "admin", subjectChannel]
      : kind === "approved"
        ? ["executive", "admin"]
        : kind === "completed" || kind === "canceled"
          ? ["executive", "admin", subjectChannel]
          : kind === "returned" || kind === "rejected"
            ? [subjectChannel]
            : [],
  )
  for (const chatChannel of chatTargets) {
    const notificationChannel = `google_chat_${chatChannel}` as MakeupNotificationChannel
    const dedupeKey = buildNotificationDedupeKey(request.id, kind, notificationChannel, chatChannel)
    if (!isNotificationChannelEnabled(settings, kind, notificationChannel)) {
      await recordNotificationDelivery({
        requestId: request.id,
        triggerKind: kind,
        channel: notificationChannel,
        targetType: "google_chat",
        targetLabel: MAKEUP_NOTIFICATION_CHANNEL_LABELS[notificationChannel],
        googleChatChannel: chatChannel,
        status: "disabled",
        dedupeKey,
        title: titleByKind[kind],
        body,
        actorProfileId,
        metadata: { webhookEnv: GOOGLE_CHAT_CHANNEL_ENV[chatChannel] },
      })
      continue
    }

    if (supabase) {
      const { data } = await supabase
        .from("makeup_notification_deliveries")
        .select("id")
        .eq("dedupe_key", dedupeKey)
        .eq("status", "sent")
        .maybeSingle()
      if (data) {
        await recordNotificationDelivery({
          requestId: request.id,
          triggerKind: kind,
          channel: notificationChannel,
          targetType: "google_chat",
          targetLabel: MAKEUP_NOTIFICATION_CHANNEL_LABELS[notificationChannel],
          googleChatChannel: chatChannel,
          status: "deduped",
          dedupeKey,
          title: titleByKind[kind],
          body,
          actorProfileId,
          metadata: { webhookEnv: GOOGLE_CHAT_CHANNEL_ENV[chatChannel] },
        })
        continue
      }
    }

    const result = await sendGoogleChatNotification(chatChannel, `${titleByKind[kind]}\n${body}`, {
      requestId: request.id,
      status: request.status,
      triggerKind: kind,
      webhookEnv: GOOGLE_CHAT_CHANNEL_ENV[chatChannel],
    })
    await recordNotificationDelivery({
      requestId: request.id,
      triggerKind: kind,
      channel: notificationChannel,
      targetType: "google_chat",
      targetLabel: MAKEUP_NOTIFICATION_CHANNEL_LABELS[notificationChannel],
      googleChatChannel: chatChannel,
      status: result.ok ? "sent" : result.skipped ? "skipped" : "failed",
      dedupeKey,
      title: titleByKind[kind],
      body,
      error: result.error,
      actorProfileId,
      metadata: { webhookEnv: GOOGLE_CHAT_CHANNEL_ENV[chatChannel] },
    })
    if (!result.ok && !result.skipped) {
      await recordMakeupRequestEvent(request.id, "google_chat_failed", {
        actorId: actorProfileId,
        note: `${chatChannel}: ${result.error}`,
      })
    }
  }
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
      readTable("makeup_notification_deliveries", "*", true),
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
      notificationDeliveries: notificationDeliveryRows
        .map(mapNotificationDelivery)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, 40),
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

function buildCreatePayload(input: MakeupRequestInput, requesterId: string, data: MakeupRequestWorkspaceData) {
  const classItem = data.classes.find((item) => item.id === input.classId)
  if (!classItem) {
    throw new Error("신청할 수업을 선택해 주세요.")
  }

  const teacher = resolveTeacherForClass(classItem, data.teachers, data.profiles)
  if (!teacher?.profileId) {
    throw new Error("담당 선생님 계정 연결이 필요합니다. 선생님 설정에서 계정을 연결해 주세요.")
  }

  const approvalGroup = resolveMakeupApprovalGroup(classItem)
  const allowedNames = getAllowedApproverNames(classItem)
  const approver = data.teachers.find((item) => item.id === input.approverTeacherCatalogId)
  if (!approver || !allowedNames.includes(approver.name)) {
    throw new Error("선택할 수 없는 결재자입니다.")
  }
  if (!approver.profileId) {
    throw new Error(`${approver.name} 결재자 계정 연결이 필요합니다. 선생님 설정에서 계정을 연결해 주세요.`)
  }
  if (input.makeupSlots.some((slot) => !text(slot.classroom))) {
    throw new Error("각 보강일시의 강의실을 선택해 주세요.")
  }
  const makeupSlots = normalizeMakeupSlots({ makeupSlots: input.makeupSlots }, "")
  if (makeupSlots.length === 0) {
    throw new Error("보강일시를 1개 이상 입력해 주세요.")
  }
  const firstSlot = makeupSlots[0]

  return {
    status: "approval_pending",
    subject: classItem.subject,
    approval_group: approvalGroup,
    requester_id: requesterId,
    teacher_catalog_id: teacher.id,
    teacher_profile_id: teacher.profileId,
    class_id: classItem.id,
    class_name: classItem.name,
    reason: text(input.reason),
    cancel_date: input.cancelDate,
    makeup_start_at: firstSlot.startAt,
    makeup_end_at: firstSlot.endAt,
    makeup_classroom: firstSlot.classroom,
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

  const payload = buildCreatePayload(input, requesterId, data)
  const { data: inserted, error } = await supabase
    .from("makeup_requests")
    .insert(payload)
    .select("*")
    .single()

  if (error) throw error

  const profilesById = new Map(data.profiles.map((profile) => [profile.id, profile]))
  const teachersById = new Map(data.teachers.map((teacher) => [teacher.id, teacher]))
  const request = mapRequest(inserted as Row, profilesById, teachersById)
  await recordMakeupRequestEvent(request.id, "submitted", { actorId: requesterId, afterValue: "approval_pending" })
  await notifyMakeupRequest(request, "submitted", data.profiles, requesterId)
  return request
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

export async function approveMakeupRequest(requestId: string, actorId: string) {
  if (!supabase) throw new Error("Supabase 연결 설정이 필요합니다.")
  const { request, data } = await loadSingleMakeupRequest(requestId)
  if (!canTransitionMakeupRequest(request.status, "manager_pending", { isApprover: request.approverProfileId === actorId })) {
    throw new Error("결재 승인 권한이 없습니다.")
  }

  const { error } = await supabase
    .from("makeup_requests")
    .update({
      status: "manager_pending",
      approved_by: actorId,
      approved_at: new Date().toISOString(),
      returned_reason: null,
      rejected_reason: null,
    })
    .eq("id", requestId)

  if (error) throw error
  await recordMakeupRequestEvent(requestId, "approved", { actorId, beforeValue: request.status, afterValue: "manager_pending" })
  await notifyMakeupRequest({ ...request, status: "manager_pending" }, "approved", data.profiles, actorId)
}

export async function requestMakeupRequestRevision(requestId: string, actorId: string, note: string) {
  if (!supabase) throw new Error("Supabase 연결 설정이 필요합니다.")
  const { request, data } = await loadSingleMakeupRequest(requestId)
  const isActor = request.approverProfileId === actorId || getManagementProfileIds(data.profiles).includes(actorId)
  if (!isActor || !["approval_pending", "manager_pending"].includes(request.status)) {
    throw new Error("보완 요청 권한이 없습니다.")
  }

  const { error } = await supabase
    .from("makeup_requests")
    .update({
      status: "revision_requested",
      returned_reason: text(note),
    })
    .eq("id", requestId)

  if (error) throw error
  await recordMakeupRequestEvent(requestId, "revision_requested", { actorId, beforeValue: request.status, afterValue: "revision_requested", note })
  await notifyMakeupRequest({ ...request, status: "revision_requested" }, "returned", data.profiles, actorId)
}

export async function rejectMakeupRequest(requestId: string, actorId: string, note: string) {
  if (!supabase) throw new Error("Supabase 연결 설정이 필요합니다.")
  const { request, data } = await loadSingleMakeupRequest(requestId)
  const isActor = request.approverProfileId === actorId || getManagementProfileIds(data.profiles).includes(actorId)
  if (!isActor || !["approval_pending", "manager_pending"].includes(request.status)) {
    throw new Error("반려 권한이 없습니다.")
  }

  const { error } = await supabase
    .from("makeup_requests")
    .update({
      status: "rejected",
      rejected_reason: text(note),
    })
    .eq("id", requestId)

  if (error) throw error
  await recordMakeupRequestEvent(requestId, "rejected", { actorId, beforeValue: request.status, afterValue: "rejected", note })
  await notifyMakeupRequest({ ...request, status: "rejected" }, "rejected", data.profiles, actorId)
}

export async function resubmitMakeupRequest(requestId: string, input: MakeupRequestInput, actorId: string) {
  if (!supabase) throw new Error("Supabase 연결 설정이 필요합니다.")
  const data = await loadMakeupRequestWorkspaceData()
  const { request } = await loadSingleMakeupRequest(requestId, data)
  if (!canTransitionMakeupRequest(request.status, "approval_pending", { isRequester: request.requesterId === actorId })) {
    throw new Error("재상신 권한이 없습니다.")
  }

  const payload = buildCreatePayload(input, actorId, data)
  const { error } = await supabase
    .from("makeup_requests")
    .update({
      ...payload,
      status: "approval_pending",
      returned_reason: null,
      rejected_reason: null,
      approved_by: null,
      approved_at: null,
    })
    .eq("id", requestId)

  if (error) throw error
  await recordMakeupRequestEvent(requestId, "resubmitted", { actorId, beforeValue: request.status, afterValue: "approval_pending" })
  await notifyMakeupRequest({ ...request, status: "approval_pending" }, "submitted", data.profiles, actorId)
}

function assertManager(profileId: string, profiles: MakeupProfileOption[]) {
  if (!getManagementProfileIds(profiles).includes(profileId)) {
    throw new Error("관리팀만 최종 확인할 수 있습니다.")
  }
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

async function upsertAcademicEventDraft(draft: Row) {
  if (!supabase) throw new Error("Supabase 연결 설정이 필요합니다.")
  const client = supabase
  const mutation = buildAcademicEventMutationPayload(draft, [])
  if (!mutation.isValid || !mutation.payload) {
    throw new Error(Object.values(mutation.errors).join(" ") || "캘린더 일정 payload가 올바르지 않습니다.")
  }

  const payload = {
    id: text((mutation.payload as Row).id) || crypto.randomUUID(),
    ...(mutation.payload as Row),
  }
  const { error } = await runAcademicEventMutation(payload, (row: Row) =>
    client.from("academic_events").upsert(row, { onConflict: "id" }),
  )
  if (error) throw error
  return text(payload.id)
}

async function deleteAcademicEventById(eventId: string) {
  if (!supabase || !text(eventId)) return
  const { error } = await supabase
    .from("academic_events")
    .delete()
    .eq("id", eventId)
  if (error && !isMissingRelationError(error)) throw error
}

export async function completeMakeupRequest(requestId: string, actorId: string, finalNote = "") {
  if (!supabase) throw new Error("Supabase 연결 설정이 필요합니다.")
  const workspaceData = await loadMakeupRequestWorkspaceData()
  const { request } = await loadSingleMakeupRequest(requestId, workspaceData)
  assertManager(actorId, workspaceData.profiles)

  if (!canTransitionMakeupRequest(request.status, "completed", { isManager: true })) {
    throw new Error("최종 확인할 수 없는 상태입니다.")
  }

  assertRoomAvailableForCompletion(request, workspaceData)

  const classItem = workspaceData.classes.find((item) => item.id === request.classId)
  if (!classItem) {
    throw new Error("수업 정보를 찾을 수 없습니다.")
  }

  const schedulePlanBefore = classItem.schedulePlan || {}
  const schedulePlanAfter = applyMakeupRequestToSchedulePlan(schedulePlanBefore, classItem, request)
  const { error: classUpdateError } = await supabase
    .from("classes")
    .update({ schedule_plan: schedulePlanAfter })
    .eq("id", request.classId)

  if (classUpdateError) throw classUpdateError

  const [cancelDraft, ...makeupDrafts] = buildMakeupCalendarDrafts(request)
  const cancelAcademicEventId = await upsertAcademicEventDraft(cancelDraft)
  const makeupAcademicEventIds = []
  for (const draft of makeupDrafts) {
    makeupAcademicEventIds.push(await upsertAcademicEventDraft(draft))
  }
  const makeupAcademicEventId = makeupAcademicEventIds[0] || ""

  const { error } = await supabase
    .from("makeup_requests")
    .update({
      status: "completed",
      final_note: nullable(finalNote),
      completed_by: actorId,
      completed_at: new Date().toISOString(),
      schedule_plan_before: schedulePlanBefore,
      schedule_plan_after: schedulePlanAfter,
      cancel_academic_event_id: cancelAcademicEventId,
      makeup_academic_event_id: makeupAcademicEventId,
      makeup_academic_event_ids: makeupAcademicEventIds,
    })
    .eq("id", requestId)

  if (error) throw error

  await recordMakeupRequestEvent(requestId, "completed", { actorId, beforeValue: request.status, afterValue: "completed", note: finalNote })
  await notifyMakeupRequest({ ...request, status: "completed" }, "completed", workspaceData.profiles, actorId)
}

export async function cancelCompletedMakeupRequest(requestId: string, actorId: string, note = "") {
  if (!supabase) throw new Error("Supabase 연결 설정이 필요합니다.")
  const workspaceData = await loadMakeupRequestWorkspaceData()
  const { request } = await loadSingleMakeupRequest(requestId, workspaceData)
  assertManager(actorId, workspaceData.profiles)

  if (!canTransitionMakeupRequest(request.status, "canceled", { isManager: true })) {
    throw new Error("처리 완료된 신청서만 취소할 수 있습니다.")
  }

  if (!request.classId) {
    throw new Error("복구할 수업 정보를 찾을 수 없습니다.")
  }

  const { error: classUpdateError } = await supabase
    .from("classes")
    .update({ schedule_plan: request.schedulePlanBefore || {} })
    .eq("id", request.classId)
  if (classUpdateError) throw classUpdateError

  const eventIds = [
    request.cancelAcademicEventId,
    request.makeupAcademicEventId,
    ...request.makeupAcademicEventIds,
  ].map(text).filter(Boolean)
  for (const eventId of [...new Set(eventIds)]) {
    await deleteAcademicEventById(eventId)
  }

  const { error } = await supabase
    .from("makeup_requests")
    .update({
      status: "canceled",
      canceled_by: actorId,
      canceled_at: new Date().toISOString(),
      final_note: nullable(note || request.finalNote),
    })
    .eq("id", requestId)

  if (error) throw error

  await recordMakeupRequestEvent(requestId, "completed_canceled", { actorId, beforeValue: request.status, afterValue: "canceled", note })
  await notifyMakeupRequest({ ...request, status: "canceled" }, "canceled", workspaceData.profiles, actorId)
}

export async function toggleMakeupNotificationSetting(
  triggerKind: MakeupNotificationTrigger,
  channel: MakeupNotificationChannel,
  enabled: boolean,
  actorId: string,
) {
  if (!supabase) throw new Error("Supabase 연결 설정이 필요합니다.")
  const { error } = await supabase
    .from("makeup_notification_settings")
    .upsert({
      trigger_kind: triggerKind,
      channel,
      enabled,
      updated_by: nullable(actorId),
      updated_at: new Date().toISOString(),
    }, { onConflict: "trigger_kind,channel" })
  if (error) throw error
}

export async function loadDashboardNotifications(limit = 20): Promise<DashboardNotification[]> {
  if (!supabase) return []

  const { data, error } = await supabase
    .from("dashboard_notifications")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit * 4)

  if (error) {
    if (isMissingRelationError(error)) return []
    throw error
  }

  const grouped = new Map<string, DashboardNotification>()
  for (const row of ((data || []) as Row[])) {
    const metadata = parseObject(row.metadata)
    const notification: DashboardNotification = {
      id: text(row.id),
      title: text(row.title),
      body: text(row.body),
      href: text(row.href),
      type: text(row.type),
      dedupeKey: text(row.dedupe_key) || text(metadata.dedupeKey),
      readAt: text(row.read_at),
      createdAt: text(row.created_at),
    }
    const groupKey = notification.dedupeKey || [
      notification.type,
      notification.title,
      notification.body,
      notification.href,
      text(metadata.requestId),
    ].join("|")
    const existing = grouped.get(groupKey)
    if (!existing) {
      grouped.set(groupKey, notification)
      continue
    }
    grouped.set(groupKey, {
      ...existing,
      readAt: existing.readAt || notification.readAt,
      createdAt: existing.createdAt >= notification.createdAt ? existing.createdAt : notification.createdAt,
    })
  }

  return [...grouped.values()].slice(0, limit)
}

export async function markDashboardNotificationRead(id: string) {
  if (!supabase || !id) return
  const { error } = await supabase
    .from("dashboard_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)

  if (error && !isMissingRelationError(error)) {
    throw error
  }
}
