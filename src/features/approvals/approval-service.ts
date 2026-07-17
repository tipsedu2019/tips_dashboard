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

const APPROVAL_MUTATION_ATTEMPT_STORAGE_PREFIX = "tips.approval.mutation-attempt.v1"
const APPROVAL_MUTATION_ATTEMPT_TTL_MS = 24 * 60 * 60 * 1000

type ApprovalMutationAttemptKind = "create" | "update" | "transition" | "delete" | "comment"
type ApprovalMutationAttempt = {
  version: 1
  salt: string
  fingerprint: string
  requestId: string
  createRequestId: string
  transitionRequestId: string
  createdAt: number
  createdApprovalId?: string
  createdUpdatedAt?: string
  expectedUpdatedAt?: string
  initialStatus?: ApprovalStatus
  postMutationUpdatedAt?: string
}

const approvalMutationAttempts = new Map<ApprovalMutationAttemptKind, ApprovalMutationAttempt>()
const approvalStatusValues = new Set<ApprovalStatus>([
  "draft",
  "submitted",
  "reviewing",
  "approved",
  "returned",
  "canceled",
])

function isUuid(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function approvalMutationStorage() {
  if (typeof window === "undefined") return null
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

function approvalMutationStorageKey(kind: ApprovalMutationAttemptKind) {
  return `${APPROVAL_MUTATION_ATTEMPT_STORAGE_PREFIX}:${kind}`
}

function canonicalMutationValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalMutationValue)
  if (value && typeof value === "object") {
    return Object.keys(value as Row)
      .sort()
      .reduce<Row>((result, key) => {
        result[key] = canonicalMutationValue((value as Row)[key])
        return result
      }, {})
  }
  return value === undefined ? null : value
}

async function approvalMutationFingerprint(salt: string, payload: unknown) {
  const canonicalPayload = JSON.stringify(canonicalMutationValue(payload))
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${salt}:${canonicalPayload}`),
  )
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

function parseApprovalMutationAttempt(value: string | null): ApprovalMutationAttempt | null {
  if (!value) return null
  try {
    const row = JSON.parse(value) as Record<string, unknown>
    if (row.version !== 1
      || !isUuid(row.salt)
      || typeof row.fingerprint !== "string"
      || !/^[0-9a-f]{64}$/i.test(row.fingerprint)
      || !isUuid(row.requestId)
      || !isUuid(row.createRequestId)
      || !isUuid(row.transitionRequestId)
      || typeof row.createdAt !== "number"
      || !Number.isFinite(row.createdAt)
      || row.createdAt <= 0
    ) return null

    const attempt: ApprovalMutationAttempt = {
      version: 1,
      salt: row.salt,
      fingerprint: row.fingerprint,
      requestId: row.requestId,
      createRequestId: row.createRequestId,
      transitionRequestId: row.transitionRequestId,
      createdAt: row.createdAt,
    }
    if (isUuid(row.createdApprovalId)) attempt.createdApprovalId = row.createdApprovalId
    if (typeof row.createdUpdatedAt === "string" && row.createdUpdatedAt) {
      attempt.createdUpdatedAt = row.createdUpdatedAt
    }
    if (typeof row.expectedUpdatedAt === "string" && row.expectedUpdatedAt) {
      attempt.expectedUpdatedAt = row.expectedUpdatedAt
    }
    if (typeof row.initialStatus === "string" && approvalStatusValues.has(row.initialStatus as ApprovalStatus)) {
      attempt.initialStatus = row.initialStatus as ApprovalStatus
    }
    if (typeof row.postMutationUpdatedAt === "string" && row.postMutationUpdatedAt) {
      attempt.postMutationUpdatedAt = row.postMutationUpdatedAt
    }
    return attempt
  } catch {
    return null
  }
}

function persistApprovalMutationAttempt(
  kind: ApprovalMutationAttemptKind,
  attempt: ApprovalMutationAttempt,
) {
  approvalMutationAttempts.set(kind, attempt)
  const storage = approvalMutationStorage()
  if (!storage) return
  try {
    storage.setItem(approvalMutationStorageKey(kind), JSON.stringify(attempt))
  } catch {
    // 메모리 보존으로 현재 탭의 논리 재시도는 계속 지원한다.
  }
}

async function loadApprovalMutationAttempt(
  kind: ApprovalMutationAttemptKind,
  payload: unknown,
) {
  const storage = approvalMutationStorage()
  let persisted: ApprovalMutationAttempt | null = null
  if (storage) {
    try {
      persisted = parseApprovalMutationAttempt(storage.getItem(approvalMutationStorageKey(kind)))
    } catch {
      // 저장소를 읽지 못해도 현재 탭의 메모리 재시도는 계속 지원한다.
    }
  }
  const stored = approvalMutationAttempts.get(kind)
    || persisted
  const storedAge = stored ? Date.now() - stored.createdAt : Number.POSITIVE_INFINITY
  if (stored && storedAge >= 0 && storedAge <= APPROVAL_MUTATION_ATTEMPT_TTL_MS) {
    const fingerprint = await approvalMutationFingerprint(stored.salt, payload)
    if (fingerprint === stored.fingerprint) {
      approvalMutationAttempts.set(kind, stored)
      return stored
    }
  }

  const salt = crypto.randomUUID()
  const attempt: ApprovalMutationAttempt = {
    version: 1,
    salt,
    fingerprint: await approvalMutationFingerprint(salt, payload),
    requestId: crypto.randomUUID(),
    createRequestId: crypto.randomUUID(),
    transitionRequestId: crypto.randomUUID(),
    createdAt: Date.now(),
  }
  persistApprovalMutationAttempt(kind, attempt)
  return attempt
}

function updateApprovalMutationAttempt(
  kind: ApprovalMutationAttemptKind,
  attempt: ApprovalMutationAttempt,
  patch: Partial<ApprovalMutationAttempt>,
) {
  const next = { ...attempt, ...patch }
  persistApprovalMutationAttempt(kind, next)
  return next
}

function clearApprovalMutationAttempt(
  kind: ApprovalMutationAttemptKind,
  attempt: ApprovalMutationAttempt,
) {
  const current = approvalMutationAttempts.get(kind)
  if (current && current.fingerprint !== attempt.fingerprint) return
  approvalMutationAttempts.delete(kind)
  const storage = approvalMutationStorage()
  if (!storage) return
  try {
    const stored = parseApprovalMutationAttempt(storage.getItem(approvalMutationStorageKey(kind)))
    if (!stored || stored.fingerprint === attempt.fingerprint) {
      storage.removeItem(approvalMutationStorageKey(kind))
    }
  } catch {
    // 저장 성공 뒤 메모리 항목은 이미 제거했다.
  }
}

function isDefinitiveApprovalMutationError(error: unknown) {
  if (!error || typeof error !== "object") return false
  const code = text((error as Row).code)
  return code === "22023"
    || code === "40001"
    || code === "42501"
    || code === "P0002"
    || code.startsWith("23")
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
  void requesterId
  const body = text(input.body)
  const payload = buildApprovalRequestPayload(input, body)
  let attempt = await loadApprovalMutationAttempt("create", {
    operation: "create",
    payload,
    status,
  })
  let createdApprovalId = attempt.createdApprovalId
  let createdUpdatedAt = attempt.createdUpdatedAt

  if (!createdApprovalId || !createdUpdatedAt) {
    const { data, error } = await supabase.rpc("create_approval_request_v2", {
      p_input: payload,
      p_status: "draft",
      p_request_id: attempt.createRequestId,
    })

    if (error) {
      if (isDefinitiveApprovalMutationError(error)) {
        clearApprovalMutationAttempt("create", attempt)
      }
      throw error
    }
    const created = approvalRequestRowFromRpc(data)
    createdApprovalId = text(created.id)
    createdUpdatedAt = text(created.updated_at)
    attempt = updateApprovalMutationAttempt("create", attempt, {
      createdApprovalId,
      createdUpdatedAt,
    })
  }

  if (status !== "draft") {
    await transitionApprovalRequest(
      createdApprovalId,
      status,
      createdUpdatedAt,
      attempt.transitionRequestId,
    )
  }
  clearApprovalMutationAttempt("create", attempt)
}

export async function updateMonthlyReportApproval(id: string, input: ApprovalInput, status: ApprovalStatus) {
  if (!supabase) throw new Error("Supabase 연결 설정이 필요합니다.")
  const requestId = text(id)
  if (!requestId) throw new Error("수정할 문서를 찾을 수 없습니다.")
  const body = text(input.body)
  const payload = buildApprovalRequestPayload(input, body)
  let attempt = await loadApprovalMutationAttempt("update", {
    operation: "update",
    approvalId: requestId,
    payload,
    status,
  })
  if (!attempt.expectedUpdatedAt || !attempt.initialStatus) {
    const current = await loadApprovalMutationSnapshot(requestId)
    const initialStatus = text(current.status) as ApprovalStatus
    if (!approvalStatusValues.has(initialStatus)) {
      throw new Error("전자결재 상태를 확인하지 못했습니다.")
    }
    attempt = updateApprovalMutationAttempt("update", attempt, {
      expectedUpdatedAt: text(current.updated_at),
      initialStatus,
    })
  }

  const expectedUpdatedAt = attempt.expectedUpdatedAt
  const initialStatus = attempt.initialStatus
  if (!expectedUpdatedAt || !initialStatus) {
    throw new Error("전자결재 수정 기준을 확인하지 못했습니다.")
  }

  let postMutationUpdatedAt = attempt.postMutationUpdatedAt
  if (!postMutationUpdatedAt) {
    const { data, error } = await supabase.rpc("update_approval_request_v2", {
      p_approval_id: requestId,
      p_input: payload,
      p_status: initialStatus,
      p_expected_updated_at: expectedUpdatedAt,
      p_request_id: attempt.requestId,
    })

    if (error) {
      if (isDefinitiveApprovalMutationError(error)) {
        clearApprovalMutationAttempt("update", attempt)
      }
      throw error
    }
    const updated = approvalRequestRowFromRpc(data)
    postMutationUpdatedAt = text(updated.updated_at)
    attempt = updateApprovalMutationAttempt("update", attempt, {
      postMutationUpdatedAt,
    })
  }

  if (status !== initialStatus) {
    try {
      await transitionApprovalRequest(
        requestId,
        status,
        postMutationUpdatedAt,
        attempt.transitionRequestId,
      )
    } catch (error) {
      if (isDefinitiveApprovalMutationError(error)) {
        clearApprovalMutationAttempt("update", attempt)
      }
      throw error
    }
  }
  clearApprovalMutationAttempt("update", attempt)
}

function buildApprovalRequestPayload(input: ApprovalInput, body: string): Row {
  const title = text(input.title) || `${input.reportMonth || "이번 달"} 월간 보고서`
  return {
    request_type: "monthly_report",
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
}

function approvalRequestRowFromRpc(data: unknown): Row {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("전자결재 저장 결과를 확인하지 못했습니다.")
  }
  const request = (data as Row).request
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new Error("전자결재 저장 결과를 확인하지 못했습니다.")
  }
  const row = request as Row
  if (!text(row.id) || !text(row.status) || !text(row.updated_at)) {
    throw new Error("전자결재 저장 결과가 올바르지 않습니다.")
  }
  return row
}

async function loadApprovalMutationSnapshot(id: string): Promise<Row> {
  if (!supabase) throw new Error("Supabase 연결 설정이 필요합니다.")
  const { data, error } = await supabase
    .from("approval_requests")
    .select("id,status,updated_at")
    .eq("id", id)
    .single()
  if (error) throw error
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("수정할 문서를 찾을 수 없습니다.")
  }
  const row = data as Row
  if (!text(row.id) || !text(row.status) || !text(row.updated_at)) {
    throw new Error("수정할 문서를 찾을 수 없습니다.")
  }
  return row
}

async function transitionApprovalRequest(
  id: string,
  status: ApprovalStatus,
  expectedUpdatedAt: unknown,
  requestId: string,
) {
  if (!supabase) throw new Error("Supabase 연결 설정이 필요합니다.")
  const { data, error } = await supabase.rpc("transition_approval_request_v2", {
    p_approval_id: id,
    p_status: status,
    p_expected_updated_at: text(expectedUpdatedAt),
    p_request_id: requestId,
  })
  if (error) throw error
  return approvalRequestRowFromRpc(data)
}

export async function updateApprovalStatus(id: string, status: ApprovalStatus) {
  if (!supabase) throw new Error("Supabase 연결 설정이 필요합니다.")
  const requestId = text(id)
  if (!requestId) throw new Error("수정할 문서를 찾을 수 없습니다.")
  let attempt = await loadApprovalMutationAttempt("transition", {
    operation: "transition",
    approvalId: requestId,
    status,
  })
  if (!attempt.expectedUpdatedAt) {
    const current = await loadApprovalMutationSnapshot(requestId)
    attempt = updateApprovalMutationAttempt("transition", attempt, {
      expectedUpdatedAt: text(current.updated_at),
    })
  }
  try {
    await transitionApprovalRequest(
      requestId,
      status,
      attempt.expectedUpdatedAt,
      attempt.requestId,
    )
  } catch (error) {
    if (isDefinitiveApprovalMutationError(error)) {
      clearApprovalMutationAttempt("transition", attempt)
    }
    throw error
  }
  clearApprovalMutationAttempt("transition", attempt)
}

export async function deleteApprovalRequest(id: string) {
  if (!supabase) throw new Error("Supabase 연결 설정이 필요합니다.")
  const requestId = text(id)
  if (!requestId) throw new Error("삭제할 문서를 찾을 수 없습니다.")
  const attempt = await loadApprovalMutationAttempt("delete", {
    operation: "delete",
    approvalId: requestId,
  })

  const { data, error } = await supabase.rpc("delete_approval_request_v2", {
    p_approval_id: requestId,
    p_request_id: attempt.requestId,
  })
  if (error) {
    if (isDefinitiveApprovalMutationError(error)) {
      clearApprovalMutationAttempt("delete", attempt)
    }
    throw error
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("삭제할 문서를 찾을 수 없습니다.")
  }
  const receipt = data as Row
  if (receipt.deleted !== true || text(receipt.approval_id) !== requestId) {
    throw new Error("전자결재 삭제 결과를 확인하지 못했습니다.")
  }
  clearApprovalMutationAttempt("delete", attempt)
}

export async function addApprovalComment(approvalId: string, authorId: string, body: string) {
  if (!supabase) throw new Error("Supabase 연결 설정이 필요합니다.")
  void authorId
  const nextBody = text(body)
  if (!nextBody) throw new Error("댓글을 입력하세요.")
  const requestId = text(approvalId)
  if (!requestId) throw new Error("댓글을 남길 문서를 찾을 수 없습니다.")
  const attempt = await loadApprovalMutationAttempt("comment", {
    operation: "comment",
    approvalId: requestId,
    body: nextBody,
  })
  const { error } = await supabase.rpc("add_approval_comment_v2", {
    p_approval_id: requestId,
    p_body: nextBody,
    p_request_id: attempt.requestId,
  })
  if (error) {
    if (isDefinitiveApprovalMutationError(error)) {
      clearApprovalMutationAttempt("comment", attempt)
    }
    throw error
  }
  clearApprovalMutationAttempt("comment", attempt)
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
