import { supabase } from "@/lib/supabase"

type Row = Record<string, unknown>

export type ApprovalStatus = "draft" | "submitted" | "reviewing" | "approved" | "returned" | "canceled"
export type ApprovalRequestType = "monthly_report" | "general"
export type ApprovalSubject = "english" | "math" | "general"
export type ApprovalChecklistItem = {
  id: string
  label: string
  checked: boolean
  group?: string
  state?: "pending" | "done" | "na"
}

export type ApprovalProfileOption = {
  id: string
  label: string
  email: string
  role: string
}

export type ApprovalRequest = {
  id: string
  type: ApprovalRequestType
  status: ApprovalStatus
  title: string
  requesterId: string
  requesterLabel: string
  approverId: string
  approverLabel: string
  subject: ApprovalSubject
  templateKey: string
  reportMonth: string
  classSummary: string
  studentIssues: string
  nextMonthPlan: string
  body: string
  checklistItems: ApprovalChecklistItem[]
  attachmentLinks: string
  memo: string
  submittedAt: string
  decidedAt: string
  createdAt: string
  updatedAt: string
  comments: ApprovalComment[]
  events: ApprovalEvent[]
}

export type ApprovalInput = {
  title: string
  subject: ApprovalSubject
  templateKey: string
  reportMonth: string
  approverId: string
  classSummary: string
  studentIssues: string
  nextMonthPlan: string
  body: string
  checklistItems: ApprovalChecklistItem[]
  attachmentLinks: string
  memo: string
}

export type ApprovalWorkspaceData = {
  schemaReady: boolean
  requests: ApprovalRequest[]
  profiles: ApprovalProfileOption[]
  templates: ApprovalTemplate[]
  error?: string
}

export type ApprovalTemplate = {
  id: string
  name: string
  subject: ApprovalSubject
  body: string
  checklistItems: ApprovalChecklistItem[]
  attachmentLinks: string
  isShared: boolean
  createdBy: string
  createdAt: string
  updatedAt: string
}

export type ApprovalComment = {
  id: string
  approvalId: string
  authorId: string
  authorLabel: string
  body: string
  createdAt: string
}

export type ApprovalEvent = {
  id: string
  approvalId: string
  actorId: string
  actorLabel: string
  eventType: string
  fieldName: string
  beforeValue: string
  afterValue: string
  createdAt: string
}

function text(value: unknown) {
  return String(value || "").trim()
}

function parseChecklistItems(value: unknown): ApprovalChecklistItem[] {
  if (!Array.isArray(value)) return []

  return value
    .map((item): ApprovalChecklistItem | null => {
      if (!item || typeof item !== "object") return null
      const row = item as Row
      const id = text(row.id)
      const label = text(row.label)
      if (!id || !label) return null
      const group = text(row.group)
      const rawState = text(row.state)
      const state: ApprovalChecklistItem["state"] = rawState === "done" || rawState === "na" || rawState === "pending"
        ? rawState
        : row.checked === true
          ? "done"
          : "pending"

      return {
        id,
        label,
        checked: state === "done",
        state,
        ...(group ? { group } : {}),
      }
    })
    .filter((item): item is ApprovalChecklistItem => Boolean(item))
}

function mapProfile(row: Row): ApprovalProfileOption {
  const email = text(row.email)
  const label = text(row.name) || text(row.full_name) || email || text(row.id)

  return {
    id: text(row.id),
    label,
    email,
    role: text(row.role),
  }
}

function mapApprovalRequest(
  row: Row,
  profilesById: Map<string, ApprovalProfileOption>,
  commentsByApprovalId: Map<string, ApprovalComment[]> = new Map(),
  eventsByApprovalId: Map<string, ApprovalEvent[]> = new Map(),
): ApprovalRequest {
  const id = text(row.id)
  const requesterId = text(row.requester_id)
  const approverId = text(row.approver_id)
  const requester = profilesById.get(requesterId)
  const approver = profilesById.get(approverId)

  return {
    id,
    type: (text(row.request_type) || "monthly_report") as ApprovalRequestType,
    status: (text(row.status) || "draft") as ApprovalStatus,
    title: text(row.title),
    requesterId,
    requesterLabel: requester?.label || text(row.requester_label) || "작성자",
    approverId,
    approverLabel: approver?.label || text(row.approver_label) || "결재자 미정",
    subject: (text(row.subject) || "general") as ApprovalSubject,
    templateKey: text(row.template_key) || "free",
    reportMonth: text(row.report_month),
    classSummary: text(row.class_summary),
    studentIssues: text(row.student_issues),
    nextMonthPlan: text(row.next_month_plan),
    body: text(row.body) || text(row.memo),
    checklistItems: parseChecklistItems(row.checklist_items),
    attachmentLinks: text(row.attachment_links),
    memo: text(row.memo),
    submittedAt: text(row.submitted_at),
    decidedAt: text(row.decided_at),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
    comments: commentsByApprovalId.get(id) || [],
    events: eventsByApprovalId.get(id) || [],
  }
}

function mapApprovalComment(row: Row, profilesById: Map<string, ApprovalProfileOption>): ApprovalComment {
  const authorId = text(row.author_id)
  return {
    id: text(row.id),
    approvalId: text(row.approval_id),
    authorId,
    authorLabel: profilesById.get(authorId)?.label || "작성자",
    body: text(row.body),
    createdAt: text(row.created_at),
  }
}

function mapApprovalTemplate(row: Row): ApprovalTemplate {
  return {
    id: text(row.id),
    name: text(row.name),
    subject: (text(row.subject) || "general") as ApprovalSubject,
    body: text(row.body),
    checklistItems: parseChecklistItems(row.checklist_items),
    attachmentLinks: text(row.attachment_links),
    isShared: row.is_shared === true,
    createdBy: text(row.created_by),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
  }
}

function mapApprovalEvent(row: Row, profilesById: Map<string, ApprovalProfileOption>): ApprovalEvent {
  const actorId = text(row.actor_id)
  return {
    id: text(row.id),
    approvalId: text(row.approval_id),
    actorId,
    actorLabel: profilesById.get(actorId)?.label || "시스템",
    eventType: text(row.event_type),
    fieldName: text(row.field_name),
    beforeValue: text(row.before_value),
    afterValue: text(row.after_value),
    createdAt: text(row.created_at),
  }
}

function isMissingTableError(error: { code?: string; message?: string } | null) {
  return error?.code === "42P01" || /approval_(requests|templates|events|comments)/i.test(error?.message || "")
}

export async function loadApprovalWorkspaceData(): Promise<ApprovalWorkspaceData> {
  if (!supabase) {
    return { schemaReady: false, requests: [], profiles: [], templates: [], error: "Supabase 연결 설정이 필요합니다." }
  }

  const [profilesResult, templatesResult, requestResult] = await Promise.all([
    supabase
      .from("profiles")
      .select("id,email,name,role")
      .order("name", { ascending: true }),
    supabase
      .from("approval_templates")
      .select("*")
      .order("name", { ascending: true }),
    supabase
      .from("approval_requests")
      .select("*")
      .order("updated_at", { ascending: false }),
  ])

  const profiles = (profilesResult.data || []).map((row) => mapProfile(row as Row))
  const profilesById = new Map(profiles.map((profile) => [profile.id, profile]))

  if (templatesResult.error && !isMissingTableError(templatesResult.error)) {
    return {
      schemaReady: false,
      requests: [],
      profiles,
      templates: [],
      error: templatesResult.error.message,
    }
  }

  const templates = (templatesResult.data || []).map((row) => mapApprovalTemplate(row as Row))
  if (requestResult.error) {
    return {
      schemaReady: false,
      requests: [],
      profiles,
      templates,
      error: isMissingTableError(requestResult.error)
        ? "전자결재 DB 마이그레이션을 적용하세요."
        : requestResult.error.message,
    }
  }

  const requestIds = (requestResult.data || []).map((row) => text((row as Row).id)).filter(Boolean)
  const commentsByApprovalId = new Map<string, ApprovalComment[]>()
  const eventsByApprovalId = new Map<string, ApprovalEvent[]>()

  if (requestIds.length > 0) {
    const [commentsResult, eventsResult] = await Promise.all([
      supabase
        .from("approval_comments")
        .select("*")
        .in("approval_id", requestIds)
        .order("created_at", { ascending: true }),
      supabase
        .from("approval_events")
        .select("*")
        .in("approval_id", requestIds)
        .order("created_at", { ascending: true }),
    ])

    if (commentsResult.error || eventsResult.error) {
      return {
        schemaReady: false,
        requests: [],
        profiles,
        templates,
        error: commentsResult.error?.message || eventsResult.error?.message || "전자결재 기록을 불러오지 못했습니다.",
      }
    }

    for (const row of commentsResult.data || []) {
      const comment = mapApprovalComment(row as Row, profilesById)
      const list = commentsByApprovalId.get(comment.approvalId) || []
      list.push(comment)
      commentsByApprovalId.set(comment.approvalId, list)
    }

    for (const row of eventsResult.data || []) {
      const event = mapApprovalEvent(row as Row, profilesById)
      const list = eventsByApprovalId.get(event.approvalId) || []
      list.push(event)
      eventsByApprovalId.set(event.approvalId, list)
    }
  }

  return {
    schemaReady: true,
    requests: (requestResult.data || []).map((row) => mapApprovalRequest(row as Row, profilesById, commentsByApprovalId, eventsByApprovalId)),
    profiles,
    templates,
  }
}

export async function createMonthlyReportApproval(input: ApprovalInput, requesterId: string, status: ApprovalStatus = "submitted") {
  if (!supabase) throw new Error("Supabase 연결 설정이 필요합니다.")
  const body = text(input.body)
  const { error } = await supabase.from("approval_requests").insert(buildApprovalRequestPayload(input, requesterId, status, body, "insert"))

  if (error) throw error
}

export async function updateMonthlyReportApproval(id: string, input: ApprovalInput, status: ApprovalStatus) {
  if (!supabase) throw new Error("Supabase 연결 설정이 필요합니다.")
  const requestId = text(id)
  if (!requestId) throw new Error("수정할 문서를 찾을 수 없습니다.")
  const body = text(input.body)
  const patch = buildApprovalRequestPayload(input, "", status, body, "update")
  const { error } = await supabase.from("approval_requests").update(patch).eq("id", requestId)

  if (error) throw error
}

function buildApprovalRequestPayload(input: ApprovalInput, requesterId: string, status: ApprovalStatus, body: string, mode: "insert" | "update"): Row {
  const title = text(input.title) || `${input.reportMonth || "이번 달"} 월간 보고서`
  const nextStatus: ApprovalStatus = ["draft", "submitted", "reviewing", "approved", "returned", "canceled"].includes(status)
    ? status
    : "submitted"
  const payload: Row = {
    request_type: "monthly_report",
    status: nextStatus,
    title,
    approver_id: text(input.approverId) || null,
    subject: text(input.subject) || "general",
    template_key: text(input.templateKey) || "free",
    report_month: text(input.reportMonth) || null,
    class_summary: text(input.classSummary) || body.slice(0, 240) || null,
    student_issues: text(input.studentIssues) || null,
    next_month_plan: text(input.nextMonthPlan) || null,
    body: body || null,
    checklist_items: input.checklistItems || [],
    attachment_links: text(input.attachmentLinks) || null,
    memo: text(input.memo) || null,
  }

  if (mode === "insert") payload.requester_id = requesterId || null
  if (nextStatus === "submitted") {
    payload.submitted_at = new Date().toISOString()
    payload.decided_at = null
  }
  if (nextStatus === "draft") {
    payload.submitted_at = null
    payload.decided_at = null
  }
  if (nextStatus === "reviewing") payload.decided_at = null

  return payload
}

export async function updateApprovalStatus(id: string, status: ApprovalStatus) {
  if (!supabase) throw new Error("Supabase 연결 설정이 필요합니다.")
  const patch: Row = { status }
  if (status === "submitted") {
    patch.submitted_at = new Date().toISOString()
    patch.decided_at = null
  }
  if (status === "reviewing") {
    patch.decided_at = null
  }
  if (status === "approved" || status === "returned" || status === "canceled") {
    patch.decided_at = new Date().toISOString()
  }
  const { error } = await supabase.from("approval_requests").update(patch).eq("id", id)
  if (error) throw error
}

export async function deleteApprovalRequest(id: string) {
  if (!supabase) throw new Error("Supabase 연결 설정이 필요합니다.")
  const requestId = text(id)
  if (!requestId) throw new Error("삭제할 문서를 찾을 수 없습니다.")

  const { data, error } = await supabase.from("approval_requests").delete().eq("id", requestId).select("id")
  if (error) throw error
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("삭제할 문서를 찾을 수 없습니다.")
  }
}

export async function addApprovalComment(approvalId: string, authorId: string, body: string) {
  if (!supabase) throw new Error("Supabase 연결 설정이 필요합니다.")
  const nextBody = text(body)
  if (!nextBody) throw new Error("댓글을 입력하세요.")
  const { error } = await supabase.from("approval_comments").insert({
    approval_id: approvalId,
    author_id: authorId,
    body: nextBody,
  })
  if (error) throw error
}

export async function saveApprovalTemplate(input: ApprovalInput, userId: string, name: string) {
  if (!supabase) throw new Error("Supabase 연결 설정이 필요합니다.")
  const templateName = text(name)
  if (!templateName) throw new Error("서식명을 입력하세요.")

  const payload = {
    name: templateName,
    subject: text(input.subject) || "general",
    body: text(input.body) || null,
    checklist_items: input.checklistItems || [],
    attachment_links: text(input.attachmentLinks) || null,
    is_shared: true,
    created_by: userId || null,
  }

  const existing = userId
    ? await supabase
        .from("approval_templates")
        .select("id")
        .eq("created_by", userId)
        .eq("name", templateName)
        .maybeSingle()
    : null

  if (existing?.error && existing.error.code !== "PGRST116") throw existing.error

  const { error } = existing?.data?.id
    ? await supabase.from("approval_templates").update(payload).eq("id", text(existing.data.id))
    : await supabase.from("approval_templates").insert(payload)

  if (error) throw error
}
