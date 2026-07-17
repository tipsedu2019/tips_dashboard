"use client"

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react"
import { Bell, Check, ClipboardCheck, FileCheck2, Paperclip, Pencil, RefreshCw, RotateCcw, Save, Send, Trash2, X } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { NotificationControlPanel, useNotificationControlPlaneAvailability } from "@/features/notifications/notification-control-panel"
import { useAuth } from "@/providers/auth-provider"

import {
  addApprovalComment,
  createMonthlyReportApproval,
  deleteApprovalRequest,
  loadApprovalWorkspaceData,
  saveApprovalTemplate,
  updateApprovalStatus,
  updateMonthlyReportApproval,
  type ApprovalChecklistItem,
  type ApprovalComment,
  type ApprovalEvent,
  type ApprovalInput,
  type ApprovalRequest,
  type ApprovalStatus,
  type ApprovalSubject,
  type ApprovalWorkspaceData,
} from "./approval-service"

type ApprovalView = "mine" | "review" | "open" | "done" | "returned"
type ApprovalTemplateKey = "english_monthly" | "math_monthly" | "free"
type ChecklistState = NonNullable<ApprovalChecklistItem["state"]>
type AttachmentDisplayRow = { key: string; label: string; href: string }

const NONE_VALUE = "__none__"

const APPROVAL_VIEWS: Array<{ key: ApprovalView; label: string }> = [
  { key: "mine", label: "내 문서" },
  { key: "review", label: "결재함" },
  { key: "open", label: "진행" },
  { key: "done", label: "완료" },
  { key: "returned", label: "반려" },
]

const TEMPLATE_OPTIONS: Array<{ key: ApprovalTemplateKey; subject: ApprovalSubject; label: string; shortLabel: string }> = [
  { key: "english_monthly", subject: "english", label: "영어 월간 보고서", shortLabel: "영어" },
  { key: "math_monthly", subject: "math", label: "수학 월간 보고서", shortLabel: "수학" },
  { key: "free", subject: "general", label: "자유 서식", shortLabel: "자유" },
]

const APPROVAL_LINE_PRESETS: Array<{ subject: ApprovalSubject; approverName: string; memberNames: string[] }> = [
  { subject: "english", approverName: "강부희", memberNames: ["오인환", "권용재"] },
  { subject: "english", approverName: "김민경", memberNames: ["강택중", "한지현"] },
  { subject: "english", approverName: "정보영", memberNames: ["박지환", "박정효", "문미성"] },
]

const ENGLISH_MONTHLY_CHECKS: Record<number, string[]> = {
  1: ["예비고반 종강 안내", "학교별 고1반 전반 안내"],
  3: ["중등 중간고사 대비 기간 보고", "중등 중간고사 교재 신청", "3월 학력평가 성적 입력"],
  5: ["중간고사 점수 입력", "시험지 스캔 및 시험 분석지 작성", "기말고사 대비 기간 보고", "기말고사 교재 신청"],
  6: ["중1 다음 학기 학습 계획표", "6월 학력평가 성적 입력", "중1 종강 상담"],
  7: ["기말고사 점수 입력", "시험지 스캔 및 시험 분석지 작성", "시험 종료 상담", "중3 중간고사 대비 보고", "중3 교재 신청"],
  8: ["중등 2학기 중간고사 대비 보고", "중등 2학기 중간고사 교재 신청"],
  9: ["중3 2학기 기말고사 대비 보고", "중3 기말고사 교재 신청", "9월 학력평가 성적 입력"],
  10: ["2학기 중간고사 점수 입력", "시험지 스캔 및 시험 분석지 작성", "기말고사 대비 보고", "기말고사 교재 신청", "10월 학력평가 성적 입력"],
  11: ["중3 기말고사 점수 입력", "중3 시험지 스캔 및 분석 자료", "중3 시험 종료 상담", "예비고반 학습 계획표", "중3 종강 및 예비고 안내"],
  12: ["중등 다음 학기 학습 계획표", "기말고사 점수 입력", "시험지 스캔 및 시험 분석지 작성", "시험 종료 상담"],
}

type ChecklistTemplateItem = { group: string; label: string }

const ENGLISH_COMMON_CHECKS: ChecklistTemplateItem[] = [
  { group: "상담", label: "초6·중등 학습 상황 상담" },
  { group: "상담", label: "신규생 2주 내 상담 전화" },
  { group: "안내", label: "다음 달 중등·고등 일정 안내 문자" },
  { group: "안내", label: "지각·결석 당일 학부모 연락" },
  { group: "관리", label: "장기 결석생 녹화·숙제 관리" },
  { group: "메이크에듀", label: "월 출석부 기록·메모·첨부" },
  { group: "메이크에듀", label: "단어·듣기·평가·모의고사 성적 입력" },
  { group: "첨부", label: "신규생 상담 전화 캡처 파일명 확인" },
  { group: "첨부", label: "월 출석부 캡처 파일명 확인" },
  { group: "자료", label: "학습 계획표 배부 또는 해석 첨삭지 제출" },
  { group: "개선", label: "수업 운영 개선 제안" },
]

const MATH_COMMON_CHECKS: ChecklistTemplateItem[] = [
  { group: "상시", label: "지각, 결석 즉시 학부모 연락" },
  { group: "상시", label: "문제 학생 선보고 및 상담 기록" },
  { group: "매일", label: "메이크에듀 출석부 점검·사유 메모" },
  { group: "매일", label: "고등 카페 과제 검사" },
  { group: "매주", label: "주 Test 시행 및 업로드" },
  { group: "매주", label: "주 Test·클리닉 마무리 확인" },
  { group: "매주", label: "중등 주 Test 문자 또는 고등 클리닉 문자" },
  { group: "시험", label: "성적 입력·성적목록 캡처 첨부" },
  { group: "시험", label: "기출 시험지 스캔" },
  { group: "시험", label: "학교별 평균, 등급컷, 교재 정보 입력" },
  { group: "첨부", label: "선생님별 출석부 PDF 파일명 확인" },
  { group: "첨부", label: "반별 성적목록 캡처 파일명 확인" },
  { group: "휴보강", label: "휴보강 신청서 승인 후 안내" },
  { group: "휴보강", label: "휴보강 내역 출결 메모 반영" },
  { group: "운영", label: "입학·전반 14일 내 첫 상담" },
  { group: "운영", label: "종강 성향 코멘트·퇴원 점검" },
]

function monthInputValue() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
}

function monthNumber(reportMonth: string) {
  const month = Number(reportMonth.split("-")[1] || "0")
  return Number.isFinite(month) && month >= 1 && month <= 12 ? month : new Date().getMonth() + 1
}

function buildReportTitle(templateKey: string, reportMonth: string) {
  const [year, month] = reportMonth.split("-")
  if (templateKey === "english_monthly") return `${year || "0000"}년 ${month || "00"}월 영어 월간 보고서`
  if (templateKey === "math_monthly") return `${year || "0000"}년 ${month || "00"}월 수학 월간 보고서`
  return `${year || "0000"}년 ${month || "00"}월 보고서`
}

function buildChecklistItems(templateKey: ApprovalTemplateKey, reportMonth: string): ApprovalChecklistItem[] {
  const month = monthNumber(reportMonth)
  const checks: ChecklistTemplateItem[] =
    templateKey === "english_monthly"
      ? [
          ...ENGLISH_COMMON_CHECKS,
          ...(ENGLISH_MONTHLY_CHECKS[month] || []).map((label) => ({ group: `${month}월`, label })),
        ]
      : templateKey === "math_monthly"
        ? MATH_COMMON_CHECKS
        : [{ group: "확인", label: "결재자가 확인할 항목" }]

  return checks.map((item, index) => ({
    id: `${templateKey}-${index + 1}`,
    label: item.label,
    checked: false,
    state: "pending",
    group: item.group,
  }))
}

function buildAttachmentTemplate(templateKey: ApprovalTemplateKey, reportMonth: string) {
  const month = String(monthNumber(reportMonth)).padStart(2, "0")
  if (templateKey === "english_monthly") {
    return [`${month}월 신규생 상담 전화`, `OO반 ${month}월 출석부`].join("\n")
  }
  if (templateKey === "math_monthly") {
    return [`OOO선생님 ${month}월 출석부 PDF`, `OO반 ${reportMonth.replace("-", "년 ")}월 내신·모의고사 성적`].join("\n")
  }
  return ""
}

function buildBodyTemplate(templateKey: ApprovalTemplateKey, reportMonth: string) {
  const month = monthNumber(reportMonth)
  if (templateKey === "english_monthly") {
    const monthly = ENGLISH_MONTHLY_CHECKS[month] || []
    return [
      "## 상담·안내",
      "- 특이 학생:",
      "- 신규생 상담:",
      "- 다음 달 일정 안내:",
      "",
      "## 출결·성적",
      "- 지각·결석 연락:",
      "- 장기 결석 관리:",
      "- 출석부 첨부:",
      "- 성적 입력:",
      "",
      "## 자료",
      "- 시험지·분석지·학습 계획표:",
      "- 해석 첨삭지:",
      "",
      "## 개선",
      "-",
      monthly.length > 0 ? `\n## ${month}월\n${monthly.map((item) => `- ${item}:`).join("\n")}` : "",
    ].join("\n")
  }

  if (templateKey === "math_monthly") {
    return [
      "## 상시·매일",
      "- 지각, 결석 학부모 연락:",
      "- 문제 학생 선보고 및 상담 기록:",
      "- 출석부 PDF:",
      "- 카페 과제 검사:",
      "",
      "## 매주",
      "- 주 Test 및 클리닉 관리:",
      "- 주 Test·클리닉 문자:",
      "",
      "## 시험",
      "- 성적 입력:",
      "- 성적목록 캡처:",
      "- 기출 시험지 스캔:",
      "- 학교별 평균, 등급컷, 교재 정보:",
      "",
      "## 운영",
      "- 휴보강 신청·안내:",
      "- 입학·전반 첫 상담:",
      "- 종강·퇴원 점검:",
    ].join("\n")
  }

  return ""
}

function buildTemplateInput(templateKey: ApprovalTemplateKey, reportMonth: string): ApprovalInput {
  const template = TEMPLATE_OPTIONS.find((option) => option.key === templateKey) || TEMPLATE_OPTIONS[2]
  return {
    title: buildReportTitle(templateKey, reportMonth),
    subject: template.subject,
    templateKey,
    reportMonth,
    approverId: "",
    classSummary: template.label,
    studentIssues: "",
    nextMonthPlan: "",
    body: buildBodyTemplate(templateKey, reportMonth),
    checklistItems: buildChecklistItems(templateKey, reportMonth),
    attachmentLinks: buildAttachmentTemplate(templateKey, reportMonth),
    memo: "",
  }
}

function approvalInputFromRequest(request: ApprovalRequest): ApprovalInput {
  return {
    title: request.title,
    subject: request.subject,
    templateKey: request.templateKey || "free",
    reportMonth: request.reportMonth || monthInputValue(),
    approverId: request.approverId,
    classSummary: request.classSummary,
    studentIssues: request.studentIssues,
    nextMonthPlan: request.nextMonthPlan,
    body: request.body,
    checklistItems: request.checklistItems,
    attachmentLinks: request.attachmentLinks,
    memo: request.memo,
  }
}

function approvalStatusLabel(status: ApprovalStatus) {
  if (status === "draft") return "작성"
  if (status === "submitted") return "상신"
  if (status === "reviewing") return "검토"
  if (status === "approved") return "승인"
  if (status === "returned") return "반려"
  return "취소"
}

function approvalSubjectLabel(subject: ApprovalSubject) {
  if (subject === "english") return "영어"
  if (subject === "math") return "수학"
  return "일반"
}

function isClosedApproval(status: ApprovalStatus) {
  return status === "approved" || status === "returned" || status === "canceled"
}

function dateLabel(value: string) {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

function dateTimeLabel(value: string) {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return `${dateLabel(value)} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
}

function nextApprovalAction(status: ApprovalStatus, canApprove: boolean, isRequester: boolean) {
  if (status === "draft" && isRequester) return { status: "submitted" as ApprovalStatus, label: "상신" }
  if (!canApprove) return null
  if (status === "submitted") return { status: "reviewing" as ApprovalStatus, label: "검토" }
  if (status === "reviewing") return { status: "approved" as ApprovalStatus, label: "승인" }
  return null
}

function checklistProgress(items: ApprovalChecklistItem[]) {
  const done = items.filter((item) => checklistState(item) === "done").length
  const skipped = items.filter((item) => checklistState(item) === "na").length
  const resolved = done + skipped
  const total = items.length
  const percent = total > 0 ? Math.round((resolved / total) * 100) : 0
  return { done, skipped, resolved, total, percent }
}

function checklistState(item: ApprovalChecklistItem): ChecklistState {
  if (item.state === "done" || item.state === "na" || item.state === "pending") return item.state
  return item.checked ? "done" : "pending"
}

function checklistStateLabel(state: ChecklistState) {
  if (state === "done") return "완료"
  if (state === "na") return "해당 없음"
  return "미정"
}

function approvalSubmitMissingLabels(input: ApprovalInput) {
  return [
    !input.reportMonth ? "보고월" : "",
    !input.approverId ? "결재자" : "",
    !input.body.trim() ? "본문" : "",
  ].filter(Boolean)
}

function checklistGroups(items: ApprovalChecklistItem[]) {
  const groups = new Map<string, ApprovalChecklistItem[]>()
  for (const item of items) {
    const group = item.group || "확인"
    groups.set(group, [...(groups.get(group) || []), item])
  }
  return [...groups.entries()].map(([group, rows]) => ({ group, rows }))
}

function serializeChecklistItems(items: ApprovalChecklistItem[]) {
  return items
    .map((item) => {
      const group = item.group || "확인"
      return group === "확인" ? item.label : `${group}: ${item.label}`
    })
    .join("\n")
}

function parseChecklistText(value: string, previousItems: ApprovalChecklistItem[] = []): ApprovalChecklistItem[] {
  const previousByKey = new Map(
    previousItems.map((item) => [`${item.group || "확인"}:${item.label}`, item]),
  )

  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const match = line.match(/^(.+?)\s*[:：-]\s*(.+)$/)
      const group = match ? match[1].trim() || "확인" : "확인"
      const label = match ? match[2].trim() : line
      const previous = previousByKey.get(`${group}:${label}`)
      const state = previous ? checklistState(previous) : "pending"

      return {
        id: previous?.id || `custom-${index + 1}`,
        label,
        checked: state === "done",
        state,
        group,
      }
    })
}

function defaultTemplateName(input: ApprovalInput) {
  const title = input.title
    .replace(/^\d{4}년\s*\d{1,2}월\s*/, "")
    .replace(/\s*보고서$/, " 보고서")
    .trim()

  return title || input.classSummary || "전자결재 서식"
}

function buildSavedTemplateTitle(templateName: string, reportMonth: string) {
  const [year, month] = reportMonth.split("-")
  const prefix = `${year || "0000"}년 ${month || "00"}월`
  const normalizedName = templateName.replace(/^\d{4}년\s*\d{1,2}월\s*/, "").trim()
  return `${prefix} ${normalizedName || "보고서"}`
}

function attachmentRows(value: string) {
  return value
    .split(/\r?\n/)
    .map((row) => row.trim())
    .filter(Boolean)
}

function attachmentDisplayRows(value: string): AttachmentDisplayRow[] {
  const seen = new Set<string>()

  return attachmentRows(value)
    .map((row, index) => {
      const href = row.match(/https?:\/\/\S+/i)?.[0] || ""
      const label = href
        ? row
            .replace(href, "")
            .replace(/[-–—|:：]+$/g, "")
            .trim() || href
        : row
      const key = `${href || label}-${index}`

      if (seen.has(`${href || ""}:${label}`)) return null
      seen.add(`${href || ""}:${label}`)

      return { key, label, href }
    })
    .filter((row): row is AttachmentDisplayRow => Boolean(row))
}

function normalizePersonName(value: string) {
  return value
    .replace(/선생님|원장님|원장/g, "")
    .replace(/\s+/g, "")
    .trim()
}

function findRecommendedApprovalLine(
  subject: ApprovalSubject,
  currentUserName: string,
  approverOptions: ApprovalWorkspaceData["profiles"],
) {
  const normalizedUserName = normalizePersonName(currentUserName)
  if (!normalizedUserName) return null

  const line = APPROVAL_LINE_PRESETS.find((preset) => (
    preset.subject === subject &&
    preset.memberNames.some((name) => normalizePersonName(name) === normalizedUserName)
  ))
  if (!line) return null

  const approver = approverOptions.find((profile) => normalizePersonName(profile.label) === normalizePersonName(line.approverName))
  return approver ? { line, approver } : null
}

function approvalLineOptions(
  subject: ApprovalSubject,
  approverOptions: ApprovalWorkspaceData["profiles"],
) {
  return APPROVAL_LINE_PRESETS
    .filter((preset) => preset.subject === subject)
    .map((line) => {
      const approver = approverOptions.find((profile) => normalizePersonName(profile.label) === normalizePersonName(line.approverName))
      return approver ? { line, approver } : null
    })
    .filter((line): line is { line: (typeof APPROVAL_LINE_PRESETS)[number]; approver: ApprovalWorkspaceData["profiles"][number] } => Boolean(line))
}

export function ApprovalWorkspace() {
  const { user, canManageAll, isStaff, isAdmin } = useAuth()
  const notificationControlPlaneAvailability = useNotificationControlPlaneAvailability()
  const canonicalNotificationEnabled = notificationControlPlaneAvailability.status === "enabled"
  const [data, setData] = useState<ApprovalWorkspaceData>({ schemaReady: true, requests: [], profiles: [], templates: [] })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [view, setView] = useState<ApprovalView>("mine")
  const [input, setInput] = useState<ApprovalInput>(() => buildTemplateInput("english_monthly", monthInputValue()))
  const [message, setMessage] = useState("")
  const [composerOpen, setComposerOpen] = useState(false)
  const [checklistOpen, setChecklistOpen] = useState(false)
  const [checklistEditOpen, setChecklistEditOpen] = useState(false)
  const [checklistTextDraft, setChecklistTextDraft] = useState("")
  const [templateSaveOpen, setTemplateSaveOpen] = useState(false)
  const [templateName, setTemplateName] = useState("")
  const [selectedSavedTemplate, setSelectedSavedTemplate] = useState(NONE_VALUE)
  const [manualApproverTouched, setManualApproverTouched] = useState(false)
  const [editingRequestId, setEditingRequestId] = useState("")
  const [editingRequestStatus, setEditingRequestStatus] = useState<ApprovalStatus>("draft")
  const [notificationDialogOpen, setNotificationDialogOpen] = useState(false)
  const canApprove = canManageAll || isStaff
  const canDeleteClosedApprovals = isAdmin
  const userId = user?.id || ""
  const progress = checklistProgress(input.checklistItems)
  const draftAttachments = useMemo(() => attachmentDisplayRows(input.attachmentLinks), [input.attachmentLinks])
  const submitMissingLabels = approvalSubmitMissingLabels(input)
  const canSubmitApproval = data.schemaReady && submitMissingLabels.length === 0
  const submitDisabledReason = submitMissingLabels.length > 0 ? `${submitMissingLabels.join(", ")} 필요` : "상신"
  const composerExpanded = composerOpen || Boolean(editingRequestId)

  const reload = useCallback(async () => {
    setLoading(true)
    const nextData = await loadApprovalWorkspaceData()
    setData(nextData)
    setLoading(false)
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const approvalCounts = useMemo(() => {
    const requests = data.requests
    return {
      mine: requests.filter((request) => request.requesterId === userId).length,
      review: requests.filter((request) => request.approverId === userId && !isClosedApproval(request.status)).length,
      open: requests.filter((request) => !isClosedApproval(request.status)).length,
      done: requests.filter((request) => request.status === "approved").length,
      returned: requests.filter((request) => request.status === "returned").length,
    }
  }, [data.requests, userId])

  const visibleRequests = useMemo(() => {
    const requests = data.requests
    if (view === "mine") return requests.filter((request) => request.requesterId === userId)
    if (view === "review") return requests.filter((request) => request.approverId === userId && !isClosedApproval(request.status))
    if (view === "open") return requests.filter((request) => !isClosedApproval(request.status))
    if (view === "done") return requests.filter((request) => request.status === "approved")
    return requests.filter((request) => request.status === "returned")
  }, [data.requests, userId, view])

  const approverOptions = useMemo(
    () => data.profiles.filter((profile) => ["admin", "staff", "super_admin", "manager"].includes(profile.role) && profile.id !== userId),
    [data.profiles, userId],
  )
  const recommendedApprovalLine = useMemo(() => {
    return findRecommendedApprovalLine(input.subject, user?.name || user?.email || "", approverOptions)
  }, [approverOptions, input.subject, user?.email, user?.name])
  const approvalLines = useMemo(() => approvalLineOptions(input.subject, approverOptions), [approverOptions, input.subject])

  useEffect(() => {
    if (manualApproverTouched || input.approverId || !recommendedApprovalLine?.approver.id) return
    setInput((current) => current.approverId ? current : { ...current, approverId: recommendedApprovalLine.approver.id })
  }, [input.approverId, manualApproverTouched, recommendedApprovalLine?.approver.id])

  const updateInput = <Key extends keyof ApprovalInput>(key: Key, value: ApprovalInput[Key]) => {
    setMessage("")
    setInput((current) => ({ ...current, [key]: value }))
  }

  const applyTemplate = (templateKey: ApprovalTemplateKey) => {
    setMessage("")
    setComposerOpen(true)
    setSelectedSavedTemplate(NONE_VALUE)
    setManualApproverTouched(false)
    setEditingRequestId("")
    setEditingRequestStatus("draft")
    setInput((current) => {
      const nextInput = buildTemplateInput(templateKey, current.reportMonth || monthInputValue())
      return {
        ...nextInput,
        approverId: current.subject === nextInput.subject ? current.approverId : "",
      }
    })
    setTemplateName("")
  }

  const applySavedTemplate = (templateId: string) => {
    setSelectedSavedTemplate(templateId)
    if (templateId === NONE_VALUE) return

    const template = data.templates.find((item) => item.id === templateId)
    if (!template) return
    setMessage("")
    setComposerOpen(true)
    setManualApproverTouched(false)
    setInput((current) => ({
      ...current,
      title: current.title === buildReportTitle(current.templateKey, current.reportMonth) || !current.title
        ? buildSavedTemplateTitle(template.name, current.reportMonth || monthInputValue())
        : current.title,
      subject: template.subject,
      templateKey: "free",
      approverId: current.subject === template.subject ? current.approverId : "",
      classSummary: template.name,
      body: template.body,
      checklistItems: template.checklistItems,
      attachmentLinks: template.attachmentLinks,
    }))
    setTemplateName(template.name)
  }

  const updateReportMonth = (reportMonth: string) => {
    setMessage("")
    setInput((current) => {
      const templateKey = current.templateKey as ApprovalTemplateKey
      const previousTitle = buildReportTitle(templateKey, current.reportMonth)
      const previousBody = buildBodyTemplate(templateKey, current.reportMonth)
      const previousAttachmentLinks = buildAttachmentTemplate(templateKey, current.reportMonth)
      return {
        ...current,
        reportMonth,
        title: current.title === previousTitle ? buildReportTitle(templateKey, reportMonth) : current.title,
        body: current.body === previousBody ? buildBodyTemplate(templateKey, reportMonth) : current.body,
        checklistItems: templateKey === "english_monthly" || templateKey === "math_monthly"
          ? buildChecklistItems(templateKey, reportMonth)
          : current.checklistItems,
        attachmentLinks: !current.attachmentLinks || current.attachmentLinks === previousAttachmentLinks
          ? buildAttachmentTemplate(templateKey, reportMonth)
          : current.attachmentLinks,
      }
    })
  }

  const handleApproverChange = (value: string) => {
    setManualApproverTouched(true)
    updateInput("approverId", value === NONE_VALUE ? "" : value)
  }

  const selectApprovalLine = (approverId: string) => {
    setManualApproverTouched(true)
    updateInput("approverId", approverId)
  }

  const updateChecklistState = (id: string, state: ChecklistState) => {
    setMessage("")
    setInput((current) => ({
      ...current,
      checklistItems: current.checklistItems.map((item) => item.id === id ? { ...item, checked: state === "done", state } : item),
    }))
  }

  const updateChecklistGroupState = (groupLabel: string, state: ChecklistState) => {
    setMessage("")
    setInput((current) => ({
      ...current,
      checklistItems: current.checklistItems.map((item) => {
        const group = item.group || "확인"
        return group === groupLabel ? { ...item, checked: state === "done", state } : item
      }),
    }))
  }

  const resetChecklistFromTemplate = () => {
    setMessage("")
    setChecklistEditOpen(false)
    setInput((current) => ({
      ...current,
      checklistItems: buildChecklistItems(current.templateKey as ApprovalTemplateKey, current.reportMonth || monthInputValue()),
    }))
  }

  const openChecklistEditor = () => {
    setChecklistTextDraft(serializeChecklistItems(input.checklistItems))
    setChecklistEditOpen(true)
  }

  const applyChecklistEditor = () => {
    setMessage("")
    setInput((current) => ({
      ...current,
      checklistItems: parseChecklistText(checklistTextDraft, current.checklistItems),
    }))
    setChecklistEditOpen(false)
  }

  const createApproval = async (status: ApprovalStatus) => {
    if (!userId || saving) return
    const nextStatus = status === "draft" && editingRequestId ? editingRequestStatus : status
    const missingLabels = nextStatus === "submitted" ? approvalSubmitMissingLabels(input) : []
    if (missingLabels.length > 0) {
      setMessage(`${missingLabels.join(", ")} 입력`)
      return
    }
    setSaving(true)
    try {
      if (editingRequestId) {
        await updateMonthlyReportApproval(editingRequestId, input, nextStatus)
      } else {
        await createMonthlyReportApproval(input, userId, status)
      }
      setInput(buildTemplateInput(input.templateKey as ApprovalTemplateKey, monthInputValue()))
      setComposerOpen(false)
      setEditingRequestId("")
      setEditingRequestStatus("draft")
      await reload()
      setMessage(editingRequestId ? "수정했습니다." : status === "draft" ? "임시 저장했습니다." : "상신했습니다.")
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "저장하지 못했습니다.")
    } finally {
      setSaving(false)
    }
  }

  const editApproval = (request: ApprovalRequest) => {
    setMessage("")
    setChecklistEditOpen(false)
    setTemplateSaveOpen(false)
    setSelectedSavedTemplate(NONE_VALUE)
    setManualApproverTouched(true)
    setComposerOpen(true)
    setEditingRequestId(request.id)
    setEditingRequestStatus(request.status)
    setInput(approvalInputFromRequest(request))
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  const cancelEdit = () => {
    setMessage("")
    setComposerOpen(false)
    setEditingRequestId("")
    setEditingRequestStatus("draft")
    setInput(buildTemplateInput(input.templateKey as ApprovalTemplateKey, input.reportMonth || monthInputValue()))
  }

  const saveTemplate = async () => {
    if (!userId || saving) return
    const nextName = templateName.trim() || defaultTemplateName(input)
    if (!input.body.trim() && input.checklistItems.length === 0) {
      setMessage("저장할 본문이나 확인 항목이 없습니다.")
      return
    }

    setSaving(true)
    try {
      await saveApprovalTemplate(input, userId, nextName)
      setTemplateName("")
      setTemplateSaveOpen(false)
      await reload()
      setMessage(`${nextName} 서식을 저장했습니다.`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "서식을 저장하지 못했습니다.")
    } finally {
      setSaving(false)
    }
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    await createApproval("submitted")
  }

  const changeStatus = async (request: ApprovalRequest, status: ApprovalStatus) => {
    if (saving) return
    setSaving(true)
    try {
      await updateApprovalStatus(request.id, status)
      await reload()
      setMessage(`${request.title} · ${approvalStatusLabel(status)}`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "상태를 바꾸지 못했습니다.")
    } finally {
      setSaving(false)
    }
  }

  const addComment = async (request: ApprovalRequest, body: string) => {
    if (!userId || saving) return
    setSaving(true)
    try {
      await addApprovalComment(request.id, userId, body)
      await reload()
      setMessage(`${request.title} · 댓글 추가`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "댓글을 저장하지 못했습니다.")
    } finally {
      setSaving(false)
    }
  }

  function canDeleteApprovalRequest(request: ApprovalRequest) {
    return canDeleteClosedApprovals && isClosedApproval(request.status)
  }

  const deleteApproval = async (request: ApprovalRequest) => {
    if (!canDeleteApprovalRequest(request) || saving) return
    const confirmed = window.confirm(`${request.title || "전자결재 문서"} 삭제할까요?`)
    if (!confirmed) return
    setSaving(true)
    try {
      await deleteApprovalRequest(request.id)
      await reload()
      setMessage(`${request.title} 삭제 완료`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "문서를 삭제하지 못했습니다.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-4 px-3 pb-6 sm:px-4 lg:px-6">
      <div className="grid gap-4 xl:grid-cols-[420px_minmax(0,1fr)]">
        <form onSubmit={submit} className="self-start rounded-lg border bg-card p-4 shadow-xs">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold">{editingRequestId ? "문서 수정" : "전자결재"}</h2>
            <div className="flex items-center gap-2">
              {editingRequestId && (
                <Button type="button" variant="ghost" size="icon" className="size-8" onClick={cancelEdit} aria-label="수정 취소">
                  <X />
                </Button>
              )}
              {composerExpanded && <Badge variant="secondary">{approvalSubjectLabel(input.subject)} · {progress.resolved}/{progress.total}</Badge>}
            </div>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2">
            {TEMPLATE_OPTIONS.map((template) => (
              <Button
                key={template.key}
                type="button"
                variant={input.templateKey === template.key ? "default" : "outline"}
                size="sm"
                onClick={() => applyTemplate(template.key)}
              >
                {template.shortLabel}
              </Button>
            ))}
          </div>

          {(composerExpanded || data.templates.length > 0) && (
          <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <Select value={selectedSavedTemplate} onValueChange={applySavedTemplate}>
              <SelectTrigger className="w-full" disabled={data.templates.length === 0} aria-label="저장 서식">
                <SelectValue placeholder={data.templates.length === 0 ? "저장 서식 없음" : "서식 불러오기"} />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value={NONE_VALUE}>기본 서식</SelectItem>
                  {data.templates.map((template) => (
                    <SelectItem key={template.id} value={template.id}>{template.name}</SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            {composerExpanded && (
              <Button type="button" variant="outline" size="sm" onClick={() => setTemplateSaveOpen((open) => !open)}>
                <Save />
                서식 저장
              </Button>
            )}
          </div>
          )}

          {composerExpanded && templateSaveOpen && (
            <div className="mt-2 grid gap-2 rounded-md border bg-muted/30 p-2 sm:grid-cols-[minmax(0,1fr)_auto]">
              <Input value={templateName} onChange={(event) => setTemplateName(event.target.value)} placeholder={defaultTemplateName(input)} aria-label="서식명" />
              <Button type="button" size="sm" disabled={saving || !data.schemaReady} onClick={() => void saveTemplate()}>
                저장
              </Button>
            </div>
          )}

          {composerExpanded && (
          <>
          <div className="mt-4 grid gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1.5 text-sm font-medium">
                <span>보고월</span>
                <Input type="month" value={input.reportMonth} onChange={(event) => updateReportMonth(event.target.value)} />
              </label>
              <div className="grid gap-1.5 text-sm font-medium">
                <span>결재자</span>
                <Select
                  value={input.approverId || NONE_VALUE}
                  onValueChange={handleApproverChange}
                >
                  <SelectTrigger className="w-full" aria-label="결재자">
                    <SelectValue placeholder="미지정" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value={NONE_VALUE}>결재자 미정</SelectItem>
                      {approverOptions.map((profile) => (
                        <SelectItem key={profile.id} value={profile.id}>{profile.label}</SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                {recommendedApprovalLine && input.approverId !== recommendedApprovalLine.approver.id && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 justify-start px-2 text-xs text-muted-foreground"
                    onClick={() => updateInput("approverId", recommendedApprovalLine.approver.id)}
                  >
                    추천 {recommendedApprovalLine.approver.label}
                  </Button>
                )}
                {approvalLines.length > 0 && (
                  <div className="flex flex-wrap gap-1" aria-label="결재선">
                    {approvalLines.map(({ line, approver }) => (
                      <button
                        key={approver.id}
                        type="button"
                        aria-pressed={input.approverId === approver.id}
                        onClick={() => selectApprovalLine(approver.id)}
                        className={[
                          "inline-flex min-h-7 max-w-full items-center gap-1 rounded-md border px-2 text-xs font-medium transition-colors",
                          input.approverId === approver.id
                            ? "border-primary bg-primary/10 text-primary"
                            : "bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
                        ].join(" ")}
                        title={`${approver.label}: ${line.memberNames.join(", ")}`}
                      >
                        <span>{approver.label}</span>
                        <span className="max-w-32 truncate opacity-70">{line.memberNames.join("·")}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px]">
              <label className="grid gap-1.5 text-sm font-medium">
                <span>제목</span>
                <Input value={input.title} onChange={(event) => updateInput("title", event.target.value)} />
              </label>
              <label className="grid gap-1.5 text-sm font-medium">
                <span>대상</span>
                <Input value={input.classSummary} onChange={(event) => updateInput("classSummary", event.target.value)} placeholder="예: 고1 영어A / 전체" />
              </label>
            </div>

            <label className="grid gap-1.5 text-sm font-medium">
              <span>본문</span>
              <Textarea
                value={input.body}
                onChange={(event) => updateInput("body", event.target.value)}
                placeholder="월간 보고 내용을 자유롭게 정리"
                className="min-h-64 text-sm leading-6"
              />
            </label>

            <section className="rounded-md border bg-muted/30" aria-label="월간 보고서 점검">
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm font-semibold"
                aria-expanded={checklistOpen}
                onClick={() => setChecklistOpen((open) => !open)}
              >
                <span>점검 {progress.resolved}/{progress.total}</span>
                <span className="text-xs text-muted-foreground">
                  {progress.skipped > 0 && `해당 없음 ${progress.skipped} · `}
                  {checklistOpen ? "접기" : "펼치기"}
                </span>
              </button>
              <Progress value={progress.percent} className="h-1.5 rounded-none bg-muted" />
              {checklistOpen && (
                <div className="grid gap-2 border-t p-3">
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={openChecklistEditor}>
                      항목 편집
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={resetChecklistFromTemplate}>
                      점검 초기화
                    </Button>
                  </div>
                  {checklistEditOpen && (
                    <div className="grid gap-2 rounded-md border bg-background p-2">
                      <Textarea
                        value={checklistTextDraft}
                        onChange={(event) => setChecklistTextDraft(event.target.value)}
                        className="min-h-28 text-sm leading-6"
                        aria-label="점검 항목 편집"
                        placeholder={"그룹: 점검 항목\n예: 상담: 신규생 2주 내 상담"}
                      />
                      <div className="flex justify-end gap-2">
                        <Button type="button" variant="outline" size="sm" onClick={() => setChecklistEditOpen(false)}>
                          취소
                        </Button>
                        <Button type="button" size="sm" onClick={applyChecklistEditor}>
                          반영
                        </Button>
                      </div>
                    </div>
                  )}
                  {checklistGroups(input.checklistItems).map((group) => (
                    <div key={group.group} className="grid gap-1.5">
                      <div className="flex items-center justify-between gap-2 px-1">
                        <div className="text-xs font-semibold text-muted-foreground">{group.group}</div>
                        <div className="inline-flex overflow-hidden rounded-md border bg-background">
                          <button
                            type="button"
                            className="h-7 px-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                            onClick={() => updateChecklistGroupState(group.group, "done")}
                          >
                            모두 완료
                          </button>
                          <button
                            type="button"
                            className="h-7 border-l px-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                            onClick={() => updateChecklistGroupState(group.group, "na")}
                          >
                            해당 없음
                          </button>
                        </div>
                      </div>
                      {group.rows.map((item) => (
                        <ChecklistItemControl
                          key={item.id}
                          item={item}
                          onChange={(state) => updateChecklistState(item.id, state)}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </section>

            <label className="grid gap-1.5 text-sm font-medium">
              <span>첨부 링크·파일명{draftAttachments.length > 0 ? ` ${draftAttachments.length}` : ""}</span>
              <Textarea
                value={input.attachmentLinks}
                onChange={(event) => updateInput("attachmentLinks", event.target.value)}
                className="min-h-20"
                placeholder="파일명 또는 Drive 링크"
              />
              {draftAttachments.length > 0 && (
                <span className="flex flex-wrap gap-1.5">
                  {draftAttachments.map((attachment) => (
                    <span key={attachment.key} className="max-w-full truncate rounded-md border bg-background px-2 py-1 text-xs text-muted-foreground">
                      {attachment.label}
                      {attachment.href && <span className="ml-1 text-primary">링크</span>}
                    </span>
                  ))}
                </span>
              )}
            </label>
          </div>

          <div className="mt-4 grid grid-cols-[auto_minmax(0,1fr)] gap-2">
            <Button type="button" variant="outline" disabled={saving || !data.schemaReady} onClick={() => void createApproval("draft")}>
              {editingRequestId ? "수정 저장" : "임시저장"}
            </Button>
            <Button
              type="submit"
              disabled={saving || !canSubmitApproval}
              title={submitDisabledReason}
            >
              <Send />
              상신
            </Button>
          </div>
          </>
          )}
        </form>

        <section className="min-w-0 rounded-lg border bg-card shadow-xs">
          <div className="flex flex-col gap-2 border-b p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist" aria-label="전자결재 보기">
              {APPROVAL_VIEWS.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={view === tab.key}
                  onClick={() => setView(tab.key)}
                  className={[
                    "shrink-0 rounded-md px-3 py-2 text-sm font-medium",
                    view === tab.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  ].join(" ")}
                >
                  {tab.label}
                  {approvalCounts[tab.key] > 0 && <span className="ml-1 text-xs opacity-80">{approvalCounts[tab.key]}</span>}
                </button>
              ))}
            </div>
            <div className="flex items-center justify-end gap-2">
              {canApprove && canonicalNotificationEnabled ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="size-8 px-0"
                  onClick={() => setNotificationDialogOpen(true)}
                  aria-label="전자결재 알림 설정"
                  title="전자결재 알림 설정"
                >
                  <Bell className="size-4" aria-hidden="true" />
                  <span className="sr-only">전자결재 알림 설정</span>
                </Button>
              ) : null}
              <Button type="button" variant="outline" size="sm" onClick={() => void reload()} disabled={loading}>
                <RefreshCw />
                새로고침
              </Button>
            </div>
          </div>

          {message && <div role="status" className="border-b px-3 py-2 text-sm text-primary">{message}</div>}
          {!data.schemaReady && <div role="alert" className="border-b px-3 py-2 text-sm text-destructive">{data.error}</div>}

          <div className="divide-y">
            {loading ? (
              <div className="p-6 text-sm text-muted-foreground">불러오는 중</div>
            ) : visibleRequests.length === 0 ? (
              <Empty className="min-h-48 border-0 p-8">
                <EmptyHeader>
                  <EmptyMedia variant="icon" className="text-muted-foreground">
                    <FileCheck2 className="size-5" />
                  </EmptyMedia>
                  <EmptyTitle className="text-sm text-muted-foreground">표시할 문서 없음</EmptyTitle>
                </EmptyHeader>
              </Empty>
            ) : visibleRequests.map((request) => (
              <ApprovalRequestRow
                key={request.id}
                request={request}
                canApprove={canApprove}
                userId={userId}
                saving={saving}
                canDelete={canDeleteApprovalRequest(request)}
                onEdit={editApproval}
                onStatusChange={changeStatus}
                onAddComment={addComment}
                onDelete={deleteApproval}
              />
            ))}
          </div>
        </section>
      </div>
      {canonicalNotificationEnabled ? (
        <NotificationControlPanel
          workflowKey="approvals"
          presentation="dialog"
          open={notificationDialogOpen}
          onOpenChange={setNotificationDialogOpen}
        />
      ) : null}
    </div>
  )
}

function ChecklistItemControl({
  item,
  onChange,
}: {
  item: ApprovalChecklistItem
  onChange: (state: ChecklistState) => void
}) {
  const state = checklistState(item)
  const options: Array<{ state: ChecklistState; label: string }> = [
    { state: "pending", label: "미정" },
    { state: "done", label: "완료" },
    { state: "na", label: "해당 없음" },
  ]

  return (
    <div className="grid gap-2 rounded-md bg-background px-2 py-2 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <span className="min-w-0 leading-5">{item.label}</span>
      <div className="inline-flex w-fit overflow-hidden rounded-md border" role="group" aria-label={`${item.label} 상태`}>
        {options.map((option) => (
          <button
            key={option.state}
            type="button"
            aria-pressed={state === option.state}
            onClick={() => onChange(option.state)}
            className={[
              "h-8 px-2.5 text-xs font-medium transition-colors",
              state === option.state
                ? "bg-primary text-primary-foreground"
                : "bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
              option.state !== "pending" ? "border-l" : "",
            ].join(" ")}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function ApprovalRequestRow({
  request,
  canApprove,
  userId,
  saving,
  canDelete,
  onEdit,
  onStatusChange,
  onAddComment,
  onDelete,
}: {
  request: ApprovalRequest
  canApprove: boolean
  userId: string
  saving: boolean
  canDelete: boolean
  onEdit: (request: ApprovalRequest) => void
  onStatusChange: (request: ApprovalRequest, status: ApprovalStatus) => void
  onAddComment: (request: ApprovalRequest, body: string) => void
  onDelete: (request: ApprovalRequest) => void
}) {
  const nextAction = nextApprovalAction(request.status, canApprove, request.requesterId === userId)
  const [commentBody, setCommentBody] = useState("")
  const progress = checklistProgress(request.checklistItems)
  const attachments = attachmentDisplayRows(request.attachmentLinks)
  const canEdit = (request.requesterId === userId || canApprove) && request.status !== "approved" && request.status !== "canceled"

  const submitComment = (event: FormEvent) => {
    event.preventDefault()
    const body = commentBody.trim()
    if (!body) return
    setCommentBody("")
    onAddComment(request, body)
  }

  return (
    <article className="grid gap-3 p-4">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={request.status === "approved" ? "default" : request.status === "returned" ? "destructive" : "secondary"}>
              {approvalStatusLabel(request.status)}
            </Badge>
            <Badge variant="outline">{approvalSubjectLabel(request.subject)}</Badge>
            <h3 className="truncate font-semibold">{request.title}</h3>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span>{request.reportMonth || "보고월 미정"}</span>
            <span>{request.requesterLabel}</span>
            <span>{request.approverLabel}</span>
            {request.submittedAt && <span>상신 {dateLabel(request.submittedAt)}</span>}
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-sm">
            <span className="inline-flex items-center gap-1 rounded-md bg-muted/60 px-2 py-1">
              <ClipboardCheck className="size-4 text-muted-foreground" />
              점검 {progress.resolved}/{progress.total}
            </span>
            <span className="inline-flex items-center gap-1 rounded-md bg-muted/60 px-2 py-1">
              <Paperclip className="size-4 text-muted-foreground" />
              첨부 {attachments.length}
            </span>
            {request.classSummary && (
              <span className="inline-flex min-w-0 max-w-full items-center rounded-md bg-muted/60 px-2 py-1 text-muted-foreground">
                <span className="truncate">{request.classSummary}</span>
              </span>
            )}
          </div>
          <Progress value={progress.percent} className="mt-2 h-1.5 bg-muted" />
        </div>
        <div className="flex flex-wrap gap-2 lg:justify-end">
          {canEdit && (
            <Button type="button" size="sm" variant="outline" onClick={() => onEdit(request)} disabled={saving}>
              <Pencil />
              편집
            </Button>
          )}
          {nextAction && (
            <Button type="button" size="sm" onClick={() => onStatusChange(request, nextAction.status)} disabled={saving}>
              <Check />
              {nextAction.label}
            </Button>
          )}
          {canApprove && request.status !== "returned" && !isClosedApproval(request.status) && (
            <Button type="button" size="sm" variant="outline" onClick={() => onStatusChange(request, "returned")} disabled={saving}>
              <RotateCcw />
              반려
            </Button>
          )}
          {canDelete && (
            <Button type="button" size="sm" variant="destructive" onClick={() => onDelete(request)} disabled={saving}>
              <Trash2 />
              삭제
            </Button>
          )}
        </div>
      </div>

      <details className="rounded-md border p-3">
        <summary className="cursor-pointer text-sm font-semibold">내용</summary>
        <div className="mt-3 grid gap-3">
          <pre className="whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-sm font-sans">{request.body || request.classSummary || "-"}</pre>
          {request.checklistItems.length > 0 && (
            <div className="grid gap-2">
              {checklistGroups(request.checklistItems).map((group) => (
                <div key={group.group} className="grid gap-1.5">
                  <div className="text-xs font-semibold text-muted-foreground">{group.group}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {group.rows.map((item) => (
                      <Badge key={item.id} variant={checklistState(item) === "done" ? "default" : checklistState(item) === "na" ? "secondary" : "outline"}>
                        {item.label}
                        <span className="ml-1 opacity-70">{checklistStateLabel(checklistState(item))}</span>
                      </Badge>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          {attachments.length > 0 && (
            <div className="grid gap-1.5">
              {attachments.map((attachment) => {
                return attachment.href ? (
                  <a key={attachment.key} href={attachment.href} target="_blank" rel="noreferrer" className="truncate text-sm text-primary underline underline-offset-4">
                    {attachment.label}
                  </a>
                ) : (
                  <span key={attachment.key} className="text-sm text-muted-foreground">{attachment.label}</span>
                )
              })}
            </div>
          )}
        </div>
      </details>

      <div className="grid gap-3 border-t pt-3 lg:grid-cols-[minmax(0,1fr)_minmax(240px,320px)]">
        <ApprovalActivity comments={request.comments} events={request.events} />
        <form onSubmit={submitComment} className="flex gap-2">
          <Input value={commentBody} onChange={(event) => setCommentBody(event.target.value)} placeholder="댓글" aria-label={`${request.title} 댓글`} />
          <Button type="submit" variant="outline" disabled={saving || !commentBody.trim()}>
            저장
          </Button>
        </form>
      </div>
    </article>
  )
}

function ApprovalActivity({ comments, events }: { comments: ApprovalComment[]; events: ApprovalEvent[] }) {
  const activity = [
    ...comments.map((comment) => ({ id: `comment-${comment.id}`, at: comment.createdAt, label: comment.authorLabel, body: comment.body })),
    ...events.map((event) => ({ id: `event-${event.id}`, at: event.createdAt, label: event.actorLabel, body: approvalEventLabel(event) })),
  ].sort((left, right) => String(left.at).localeCompare(String(right.at)))

  if (activity.length === 0) {
    return <div className="text-sm text-muted-foreground">기록 없음</div>
  }

  return (
    <div className="grid gap-1.5">
      {activity.slice(-4).map((item) => (
        <div key={item.id} className="min-w-0 text-sm">
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <span>{item.label}</span>
            <span>{dateTimeLabel(item.at)}</span>
          </div>
          <p className="line-clamp-2 break-words">{item.body}</p>
        </div>
      ))}
    </div>
  )
}

function approvalEventLabel(event: ApprovalEvent) {
  if (event.eventType === "created") return "문서 생성"
  if (event.eventType === "status_changed") return `${approvalStatusLabel(event.beforeValue as ApprovalStatus)} → ${approvalStatusLabel(event.afterValue as ApprovalStatus)}`
  return event.afterValue || event.eventType
}
