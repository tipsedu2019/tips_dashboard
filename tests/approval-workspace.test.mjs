import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import test from "node:test"

const workspaceSource = readFileSync("src/features/approvals/approval-workspace.tsx", "utf8")
const serviceSource = readFileSync("src/features/approvals/approval-service.ts", "utf8")
const migrationSource = readdirSync("supabase/migrations")
  .filter((name) => name.endsWith(".sql"))
  .map((name) => readFileSync(`supabase/migrations/${name}`, "utf8"))
  .join("\n")

test("monthly approval checklist supports done, pending, and not-applicable states", () => {
  assert.match(serviceSource, /state\?: "pending" \| "done" \| "na"/)
  assert.match(workspaceSource, /type ChecklistState = NonNullable<ApprovalChecklistItem\["state"\]>/)
  assert.match(workspaceSource, /{ state: "pending", label: "미정" }/)
  assert.match(workspaceSource, /{ state: "done", label: "완료" }/)
  assert.match(workspaceSource, /{ state: "na", label: "해당 없음" }/)
})

test("operators can open the canonical approvals notification panel only when the server enables it", () => {
  assert.match(
    workspaceSource,
    /import \{ NotificationControlPanel, useNotificationControlPlaneAvailability \} from "@\/features\/notifications\/notification-control-panel"/,
  )
  assert.match(workspaceSource, /const notificationControlPlaneAvailability = useNotificationControlPlaneAvailability\(\)/)
  assert.match(workspaceSource, /const canonicalNotificationEnabled = notificationControlPlaneAvailability\.status === "enabled"/)
  assert.match(workspaceSource, /\{canApprove && canonicalNotificationEnabled \? \([\s\S]*aria-label="전자결재 알림 설정"/)
  assert.match(workspaceSource, /<NotificationControlPanel[\s\S]*workflowKey="approvals"[\s\S]*presentation="dialog"[\s\S]*open=\{notificationDialogOpen\}/)
  assert.doesNotMatch(workspaceSource, /notificationControlPlaneAvailability\.status !== "enabled"/)
  assert.doesNotMatch(workspaceSource, /!canonicalNotificationEnabled[\s\S]{0,120}<NotificationControlPanel/)
  assert.doesNotMatch(workspaceSource, /get_notification_runtime_flags_v1|NEXT_PUBLIC_NOTIFICATION_CONTROL_PLANE/)
})

test("approval progress counts completed and not-applicable items as resolved", () => {
  assert.match(workspaceSource, /const skipped = items\.filter\(\(item\) => checklistState\(item\) === "na"\)\.length/)
  assert.match(workspaceSource, /const resolved = done \+ skipped/)
  assert.match(workspaceSource, /점검 \{progress\.resolved\}\/\{progress\.total\}/)
  assert.match(workspaceSource, /해당 없음 \$\{progress\.skipped\}/)
})

test("approval checklist can resolve a whole group at once", () => {
  assert.match(workspaceSource, /const updateChecklistGroupState = \(groupLabel: string, state: ChecklistState\)/)
  assert.match(workspaceSource, /group === groupLabel \? \{ \.\.\.item, checked: state === "done", state \} : item/)
  assert.match(workspaceSource, />\s*모두 완료\s*<\/button>/)
  assert.match(workspaceSource, /updateChecklistGroupState\(group\.group, "na"\)/)
})

test("resetting approval checklist does not overwrite the report body", () => {
  assert.match(workspaceSource, /const resetChecklistFromTemplate = \(\) =>/)
  assert.match(workspaceSource, /checklistItems: buildChecklistItems\(current\.templateKey as ApprovalTemplateKey, current\.reportMonth \|\| monthInputValue\(\)\)/)
  assert.match(workspaceSource, />\s*점검 초기화\s*<\/Button>/)
  assert.doesNotMatch(workspaceSource, /onClick=\{\(\) => applyTemplate\(input\.templateKey as ApprovalTemplateKey\)\}/)
})

test("changing report month refreshes untouched monthly body and attachment names", () => {
  assert.match(workspaceSource, /const previousBody = buildBodyTemplate\(templateKey, current\.reportMonth\)/)
  assert.match(workspaceSource, /const previousAttachmentLinks = buildAttachmentTemplate\(templateKey, current\.reportMonth\)/)
  assert.match(workspaceSource, /body: current\.body === previousBody \? buildBodyTemplate\(templateKey, reportMonth\) : current\.body/)
  assert.match(workspaceSource, /attachmentLinks: !current\.attachmentLinks \|\| current\.attachmentLinks === previousAttachmentLinks/)
})

test("approval templates can edit and save custom checklist items", () => {
  assert.match(workspaceSource, /function serializeChecklistItems/)
  assert.match(workspaceSource, /function parseChecklistText/)
  assert.match(workspaceSource, /const \[checklistEditOpen, setChecklistEditOpen\]/)
  assert.match(workspaceSource, /점검 항목 편집/)
  assert.match(workspaceSource, /placeholder=\{"그룹: 점검 항목\\n예: 상담: 신규생 2주 내 상담"\}/)
  assert.match(workspaceSource, /parseChecklistText\(checklistTextDraft, current\.checklistItems\)/)
  assert.match(workspaceSource, /templateKey === "english_monthly" \|\| templateKey === "math_monthly"/)
})

test("english monthly approvals can recommend the repeated approval line", () => {
  assert.match(workspaceSource, /const APPROVAL_LINE_PRESETS/)
  assert.match(workspaceSource, /approverName: "강부희", memberNames: \["오인환", "권용재"\]/)
  assert.match(workspaceSource, /function normalizePersonName\(value: string\)/)
  assert.match(workspaceSource, /function findRecommendedApprovalLine/)
  assert.match(workspaceSource, /function approvalLineOptions/)
  assert.match(workspaceSource, /const recommendedApprovalLine = useMemo/)
  assert.match(workspaceSource, /const approvalLines = useMemo\(\(\) => approvalLineOptions\(input\.subject, approverOptions\), \[approverOptions, input\.subject\]\)/)
  assert.match(workspaceSource, /const \[manualApproverTouched, setManualApproverTouched\]/)
  assert.match(workspaceSource, /setInput\(\(current\) => current\.approverId \? current : \{ \.\.\.current, approverId: recommendedApprovalLine\.approver\.id \}\)/)
  assert.match(workspaceSource, /const handleApproverChange = \(value: string\) =>/)
  assert.match(workspaceSource, /const selectApprovalLine = \(approverId: string\) =>/)
  assert.match(workspaceSource, /추천 \{recommendedApprovalLine\.approver\.label\}/)
  assert.match(workspaceSource, /aria-label="결재선"/)
})

test("switching approval templates clears stale approver across subjects", () => {
  assert.match(workspaceSource, /const nextInput = buildTemplateInput\(templateKey, current\.reportMonth \|\| monthInputValue\(\)\)/)
  assert.match(workspaceSource, /approverId: current\.subject === nextInput\.subject \? current\.approverId : ""/)
  assert.match(workspaceSource, /setManualApproverTouched\(false\)[\s\S]*setInput\(\(current\) => \(\{[\s\S]*subject: template\.subject,[\s\S]*approverId: current\.subject === template\.subject \? current\.approverId : ""/)
})

test("approval submit requires month approver and body", () => {
  assert.match(workspaceSource, /function approvalSubmitMissingLabels\(input: ApprovalInput\)/)
  assert.match(workspaceSource, /!input\.reportMonth \? "보고월" : ""/)
  assert.match(workspaceSource, /!input\.approverId \? "결재자" : ""/)
  assert.match(workspaceSource, /!input\.body\.trim\(\) \? "본문" : ""/)
  assert.match(workspaceSource, /const submitMissingLabels = approvalSubmitMissingLabels\(input\)/)
  assert.match(workspaceSource, /const canSubmitApproval = data\.schemaReady && submitMissingLabels\.length === 0/)
  assert.match(workspaceSource, /const submitDisabledReason = submitMissingLabels\.length > 0 \? `\$\{submitMissingLabels\.join\(", "\)\} 필요` : "상신"/)
  assert.match(workspaceSource, /const nextStatus = status === "draft" && editingRequestId \? editingRequestStatus : status/)
  assert.match(workspaceSource, /const missingLabels = nextStatus === "submitted" \? approvalSubmitMissingLabels\(input\) : \[\]/)
  assert.match(workspaceSource, /aria-label="결재자"/)
  assert.match(workspaceSource, /aria-label="저장 서식"/)
})

test("approval list keeps long bodies inside the detail disclosure", () => {
  assert.match(workspaceSource, /request\.classSummary &&/)
  assert.match(workspaceSource, /<details className="rounded-md border p-3">/)
  assert.match(workspaceSource, /request\.body \|\| request\.classSummary \|\| "-"/)
  assert.doesNotMatch(workspaceSource, /line-clamp-3/)
})

test("legacy checked approval checklist items are read as done", () => {
  assert.match(serviceSource, /row\.checked === true\s*\?\s*"done"/)
  assert.match(serviceSource, /checked: state === "done"/)
})

test("saving an approval template updates an existing user template name", () => {
  assert.match(serviceSource, /\.from\("approval_templates"\)\s*\.select\("id"\)\s*\.eq\("created_by", userId\)\s*\.eq\("name", templateName\)\s*\.maybeSingle\(\)/s)
  assert.match(serviceSource, /existing\?\.data\?\.id\s*\?\s*await supabase\.from\("approval_templates"\)\.update\(payload\)/)
  assert.match(serviceSource, /await supabase\.from\("approval_templates"\)\.insert\(payload\)/)
})

test("saved approval drafts can be reopened, edited, and submitted", () => {
  assert.match(workspaceSource, /const \[editingRequestId, setEditingRequestId\]/)
  assert.match(workspaceSource, /const \[editingRequestStatus, setEditingRequestStatus\]/)
  assert.match(workspaceSource, /function approvalInputFromRequest\(request: ApprovalRequest\)/)
  assert.match(workspaceSource, /const editApproval = \(request: ApprovalRequest\)/)
  assert.match(workspaceSource, /setInput\(approvalInputFromRequest\(request\)\)/)
  assert.match(workspaceSource, /setEditingRequestId\(request\.id\)/)
  assert.match(workspaceSource, /await updateMonthlyReportApproval\(editingRequestId, input, nextStatus\)/)
  assert.match(workspaceSource, /onEdit=\{editApproval\}/)
  assert.match(workspaceSource, />\s*편집\s*<\/Button>/)
  assert.match(serviceSource, /export async function updateMonthlyReportApproval/)
  assert.match(serviceSource, /\.from\("approval_requests"\)\.update\(patch\)\.eq\("id", requestId\)/)
  assert.match(serviceSource, /function buildApprovalRequestPayload/)
})

test("resubmitted approvals clear stale decision timestamps", () => {
  assert.match(serviceSource, /if \(nextStatus === "submitted"\) \{\s*payload\.submitted_at = new Date\(\)\.toISOString\(\)\s*payload\.decided_at = null\s*\}/)
  assert.match(serviceSource, /if \(nextStatus === "draft"\) \{\s*payload\.submitted_at = null\s*payload\.decided_at = null\s*\}/)
  assert.match(serviceSource, /if \(nextStatus === "reviewing"\) payload\.decided_at = null/)
  assert.match(serviceSource, /if \(status === "submitted"\) \{\s*patch\.submitted_at = new Date\(\)\.toISOString\(\)\s*patch\.decided_at = null\s*\}/)
  assert.match(serviceSource, /if \(status === "reviewing"\) \{\s*patch\.decided_at = null\s*\}/)
})

test("approval trigger functions pin search_path for Supabase advisors", async () => {
  const migrationSource = readFileSync("supabase/migrations/20260524161000_approval_function_search_path.sql", "utf8")

  assert.match(migrationSource, /create or replace function public\.set_approval_requests_updated_at\(\)[\s\S]*set search_path = ''/)
  assert.match(migrationSource, /create or replace function public\.write_approval_status_event\(\)[\s\S]*set search_path = ''/)
})

test("approval views separate authored documents from documents waiting for my approval", () => {
  assert.match(workspaceSource, /type ApprovalView = "mine" \| "review" \| "open" \| "done" \| "returned"/)
  assert.match(workspaceSource, /{ key: "review", label: "결재함" }/)
  assert.match(workspaceSource, /{ key: "open", label: "진행" }/)
  assert.match(workspaceSource, /mine: requests\.filter\(\(request\) => request\.requesterId === userId\)\.length/)
  assert.match(workspaceSource, /review: requests\.filter\(\(request\) => request\.approverId === userId && !isClosedApproval\(request\.status\)\)\.length/)
  assert.match(workspaceSource, /if \(view === "review"\) return requests\.filter\(\(request\) => request\.approverId === userId && !isClosedApproval\(request\.status\)\)/)
})

test("approval workspace loads independent datasets in parallel", () => {
  assert.match(serviceSource, /const \[profilesResult, templatesResult, requestResult\] = await Promise\.all\(\[/)
  assert.match(serviceSource, /\.from\("profiles"\)[\s\S]*\.from\("approval_templates"\)[\s\S]*\.from\("approval_requests"\)/)
})

test("approval workspace lets only operators delete closed documents", () => {
  assert.match(workspaceSource, /const \{ user, canManageAll, isStaff, isAdmin \} = useAuth\(\)/)
  assert.match(workspaceSource, /const canDeleteClosedApprovals = isAdmin/)
  assert.match(workspaceSource, /function canDeleteApprovalRequest\(request: ApprovalRequest\)/)
  assert.match(workspaceSource, /return canDeleteClosedApprovals && isClosedApproval\(request\.status\)/)
  assert.match(workspaceSource, /deleteApprovalRequest\(request\.id\)/)
  assert.match(workspaceSource, /onDelete=\{deleteApproval\}/)
  assert.match(workspaceSource, /Trash2/)
  assert.match(serviceSource, /export async function deleteApprovalRequest\(id: string\)/)
  assert.match(serviceSource, /\.from\("approval_requests"\)\.delete\(\)\.eq\("id", requestId\)\.select\("id"\)/)
  assert.match(migrationSource, /grant select, insert, update, delete on public\.approval_requests to authenticated/)
  assert.match(migrationSource, /create policy approval_requests_delete_operator_closed/)
  assert.match(migrationSource, /for delete\s+to authenticated[\s\S]*p\.role = 'admin'/)
  assert.match(migrationSource, /status in \('approved', 'returned', 'canceled'\)/)
  assert.doesNotMatch(migrationSource, /approval_requests_delete_operator_closed[\s\S]{0,600}p\.role = 'staff'/)
})

test("monthly approval forms compress legacy report templates into operational groups", () => {
  assert.match(workspaceSource, /초6·중등 학습 상황 상담/)
  assert.match(workspaceSource, /신규생 2주 내 상담 전화/)
  assert.match(workspaceSource, /월 출석부 기록·메모·첨부/)
  assert.match(workspaceSource, /월 출석부 캡처 파일명 확인/)
  assert.match(workspaceSource, /주 Test·클리닉 마무리 확인/)
  assert.match(workspaceSource, /휴보강 내역 출결 메모 반영/)
  assert.match(workspaceSource, /선생님별 출석부 PDF 파일명 확인/)
  assert.match(workspaceSource, /종강 성향 코멘트·퇴원 점검/)
})

test("approval draft and list expose attachment count and progress at a glance", () => {
  assert.match(workspaceSource, /function attachmentDisplayRows\(value: string\)/)
  assert.match(workspaceSource, /const draftAttachments = useMemo\(\(\) => attachmentDisplayRows\(input\.attachmentLinks\), \[input\.attachmentLinks\]\)/)
  assert.match(workspaceSource, /첨부 링크·파일명\{draftAttachments\.length > 0 \? ` \$\{draftAttachments\.length\}` : ""\}/)
  assert.match(workspaceSource, /placeholder="파일명 또는 Drive 링크"/)
  assert.match(workspaceSource, /draftAttachments\.map\(\(attachment\) =>/)
  assert.match(workspaceSource, /attachment\.href && <span className="ml-1 text-primary">링크<\/span>/)
  assert.match(workspaceSource, /href=\{attachment\.href\}/)
  assert.match(workspaceSource, /import \{ Progress \} from "@\/components\/ui\/progress"/)
  assert.match(workspaceSource, /<Progress value=\{progress\.percent\}/)
})

test("approval composer stays compact until a template or document is selected", () => {
  assert.match(workspaceSource, /const \[composerOpen, setComposerOpen\] = useState\(false\)/)
  assert.match(workspaceSource, /const composerExpanded = composerOpen \|\| Boolean\(editingRequestId\)/)
  assert.match(workspaceSource, /const applyTemplate = \(templateKey: ApprovalTemplateKey\) => \{[\s\S]*setComposerOpen\(true\)/)
  assert.match(workspaceSource, /const applySavedTemplate = \(templateId: string\) => \{[\s\S]*setComposerOpen\(true\)/)
  assert.match(workspaceSource, /const editApproval = \(request: ApprovalRequest\) => \{[\s\S]*setComposerOpen\(true\)/)
  assert.match(workspaceSource, /const cancelEdit = \(\) => \{[\s\S]*setComposerOpen\(false\)/)
  assert.match(workspaceSource, /\{composerExpanded && \(/)
  assert.match(workspaceSource, /\{composerExpanded && <Badge variant="secondary">\{approvalSubjectLabel\(input\.subject\)} · \{progress\.resolved\}\/\{progress\.total\}<\/Badge>\}/)
})
