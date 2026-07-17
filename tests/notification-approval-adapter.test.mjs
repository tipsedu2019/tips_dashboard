import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const migrationUrl = new URL(
  "../supabase/migrations/20260716193000_notification_approval_producers.sql",
  import.meta.url,
)
const serviceUrl = new URL("../src/features/approvals/approval-service.ts", import.meta.url)
const workspaceUrl = new URL("../src/features/approvals/approval-workspace.tsx", import.meta.url)
const adapterUrl = new URL(
  "../src/features/notifications/server/adapters/approvals-notification-adapter.ts",
  import.meta.url,
)
const closureUrl = new URL(
  "../supabase/migrations/20260716195000_notification_workflow_legacy_closure.sql",
  import.meta.url,
)
const workerUrl = new URL(
  "../supabase/migrations/20260716195500_notification_worker_schedule.sql",
  import.meta.url,
)
const pgTapUrl = new URL("../supabase/tests/notification_approval_adapter_test.sql", import.meta.url)

async function source(url) {
  return readFile(url, "utf8")
}

function block(input, start, end) {
  const startIndex = input.indexOf(start)
  assert.notEqual(startIndex, -1, `시작 블록이 없습니다: ${start}`)
  const endIndex = input.indexOf(end, startIndex + start.length)
  assert.notEqual(endIndex, -1, `종료 블록이 없습니다: ${end}`)
  return input.slice(startIndex, endIndex)
}

test("전자결재 원본 이벤트와 댓글은 요청 ID를 가진 UUID source이며 closure 전 writer를 호환한다", async () => {
  const sql = await source(migrationUrl)

  assert.match(sql, /alter table public\.approval_events[\s\S]*add column if not exists request_id uuid[\s\S]*add column if not exists payload jsonb/)
  assert.match(sql, /alter table public\.approval_comments[\s\S]*add column if not exists request_id uuid/)
  assert.match(sql, /approval_events_request_id_uidx/)
  assert.match(sql, /approval_comments_request_id_uidx/)
  assert.match(sql, /drop constraint if exists approval_events_approval_id_fkey/)
  assert.match(sql, /drop constraint if exists approval_comments_approval_id_fkey/)
  assert.match(sql, /grant select, insert, update, delete on public\.approval_requests to authenticated/)
  assert.match(sql, /revoke insert, update, delete on public\.approval_events from authenticated/)
  assert.match(sql, /grant select on public\.approval_events to authenticated/)
  assert.match(sql, /grant select, insert on public\.approval_comments to authenticated/)
  assert.doesNotMatch(sql, /grant[^\n]*update[^\n]*public\.approval_events/)
  assert.doesNotMatch(sql, /grant[^\n]*update[^\n]*public\.approval_comments/)
})

test("요청 trigger가 정확한 전자결재 lifecycle을 한 source UUID와 canonical occurrence로 정규화한다", async () => {
  const sql = await source(migrationUrl)
  const triggerBody = block(
    sql,
    "create or replace function dashboard_private.write_approval_notification_event_v2",
    "create or replace function dashboard_private.write_approval_comment_notification_v2",
  )

  for (const eventKey of [
    "approval.created",
    "approval.submitted",
    "approval.review_started",
    "approval.approver_changed",
    "approval.approved",
    "approval.returned",
    "approval.canceled",
    "approval.resubmitted",
    "approval.deleted",
  ]) assert.ok(triggerBody.includes(`'${eventKey}'`), `이벤트 매핑 누락: ${eventKey}`)

  assert.match(triggerBody, /old\.status = 'returned'[\s\S]*new\.status = 'submitted'[\s\S]*'approval\.resubmitted'/)
  assert.match(triggerBody, /new\.approver_id is distinct from old\.approver_id/)
  assert.match(triggerBody, /dashboard_private\.record_notification_event_v1\(/)
  assert.match(triggerBody, /'approval_event'/)
  assert.match(triggerBody, /v_source_event_id::text,[\s\S]*null,[\s\S]*v_source_event_id::text/)
  assert.match(triggerBody, /requester_profile_id/)
  assert.match(triggerBody, /approver_profile_id/)
  assert.match(triggerBody, /management_profile_ids/)
  assert.match(triggerBody, /v_request_id := coalesce\(v_request_id, pg_catalog\.gen_random_uuid\(\)\)/)
  assert.match(triggerBody, /when new\.status = 'submitted' then 'approval\.submitted'/)
  assert.match(triggerBody, /v_secondary_event_key[\s\S]*'approval\.approver_changed'[\s\S]*v_secondary_recorded/)
})

test("댓글 trigger는 댓글 UUID를 source와 occurrence로 한 번만 기록한다", async () => {
  const sql = await source(migrationUrl)
  const triggerBody = block(
    sql,
    "create or replace function dashboard_private.write_approval_comment_notification_v2",
    "drop trigger if exists write_approval_status_event",
  )

  assert.match(triggerBody, /'approval\.comment_added'/)
  assert.match(triggerBody, /'approval_comment'/)
  assert.match(triggerBody, /new\.id::text,[\s\S]*null,[\s\S]*new\.id::text/)
  assert.match(triggerBody, /dashboard_private\.record_notification_event_v1\(/)
  assert.match(triggerBody, /new\.request_id := pg_catalog\.gen_random_uuid\(\)/)
  assert.doesNotMatch(triggerBody, /p_(?:recipient|target|title|href)/i)
})

test("결재자 변경은 이전 결재자의 미발송분만 취소하고 target reconciliation은 만들지 않는다", async () => {
  const sql = await source(migrationUrl)
  const triggerBody = block(
    sql,
    "create or replace function dashboard_private.write_approval_notification_event_v2",
    "create or replace function dashboard_private.write_approval_comment_notification_v2",
  )

  assert.match(triggerBody, /delivery\.target_profile_id = old\.approver_id/)
  assert.match(triggerBody, /delivery\.audience_key = 'approver_profile'/)
  assert.match(triggerBody, /delivery\.status in \('pending', 'retry_wait'\)/)
  assert.match(triggerBody, /status_reason = 'recipient_revoked'/)
  assert.match(triggerBody, /cancel_reason = 'recipient_revoked'/)
  assert.match(triggerBody, /delivery\.status = 'claimed'/)
  assert.doesNotMatch(triggerBody, /enqueue_notification_target_reconciliation_job_v1/)
})

test("전자결재 취소는 결재자 미발송분만 source_status_changed로 닫고 발송·불명 이력을 보존한다", async () => {
  const sql = await source(migrationUrl)
  const triggerBody = block(
    sql,
    "create or replace function dashboard_private.write_approval_notification_event_v2",
    "create or replace function dashboard_private.write_approval_comment_notification_v2",
  )

  assert.match(triggerBody, /new\.status = 'canceled'/)
  assert.match(triggerBody, /delivery\.audience_key = 'approver_profile'/)
  assert.match(triggerBody, /delivery\.status in \('pending', 'retry_wait'\)/)
  assert.match(triggerBody, /status_reason = 'source_status_changed'/)
  assert.doesNotMatch(triggerBody, /delivery\.status in \([^)]*'sent'/)
  assert.doesNotMatch(triggerBody, /delivery\.status in \([^)]*'delivery_unknown'/)
})

test("고정 목적 RPC 5개가 인증 사용자에게만 열리고 요청 replay와 optimistic write를 검증한다", async () => {
  const sql = await source(migrationUrl)
  assert.doesNotMatch(sql, /language plpgsql\s+language plpgsql/i)
  const signatures = [
    "create_approval_request_v2(jsonb, text, uuid)",
    "update_approval_request_v2(uuid, jsonb, text, timestamptz, uuid)",
    "transition_approval_request_v2(uuid, text, timestamptz, uuid)",
    "add_approval_comment_v2(uuid, text, uuid)",
    "delete_approval_request_v2(uuid, uuid)",
  ]

  for (const signature of signatures) {
    const name = signature.slice(0, signature.indexOf("("))
    assert.match(sql, new RegExp(`create or replace function public\\.${name}\\(`))
    assert.match(sql, new RegExp(`revoke all on function public\\.${name}`))
    assert.match(sql, new RegExp(`grant execute on function public\\.${name}[\\s\\S]*to authenticated`))
  }
  assert.match(sql, /notification_request_ledger/)
  assert.match(sql, /pg_advisory_xact_lock[\s\S]*notification-request:/)
  assert.match(sql, /idempotency_key_reused/)
  assert.match(sql, /p_expected_updated_at[\s\S]*approval_stale_write/)
  assert.match(sql, /approval_mutation_context_missing/)
  assert.doesNotMatch(sql, /grant execute[\s\S]*to anon/)
})

test("RPC는 권위 요청자·결재자·운영자만 허용하고 브라우저 수신자 필드를 거부한다", async () => {
  const sql = await source(migrationUrl)

  assert.match(sql, /approval_access_denied/)
  assert.match(sql, /v_actor is distinct from v_request\.requester_id/)
  assert.match(sql, /v_actor is distinct from v_request\.approver_id/)
  assert.doesNotMatch(sql, /v_actor not in \(v_request\.requester_id, v_request\.approver_id\)/)
  assert.doesNotMatch(sql, /v_role not in \('admin', 'staff'\)/)
  assert.doesNotMatch(sql, /v_role <> 'admin'/)
  assert.match(sql, /v_role is distinct from 'admin'/)
  assert.match(sql, /dashboard_private\.notification_profile_is_active_v1\(v_approver_id\)/)
  assert.match(sql, /p_input - array\[[\s\S]*'approver_id'[\s\S]*\]::text\[\] <> '\{\}'::jsonb/)
  assert.doesNotMatch(sql, /p_(?:recipients|recipient_ids|targets|target_ids|management_profile_ids|title|href)/i)
})

test("삭제 RPC는 닫힌 문서의 approval.deleted audit을 cascade 밖에 남긴다", async () => {
  const sql = await source(migrationUrl)
  const deleteBody = block(
    sql,
    "create or replace function dashboard_private.delete_approval_request_v2_impl",
    "create or replace function public.create_approval_request_v2",
  )

  assert.match(deleteBody, /v_request\.status not in \('approved', 'returned', 'canceled'\)/)
  assert.match(deleteBody, /approval_set_context_v2\([\s\S]*'approval\.deleted'/)
  assert.match(deleteBody, /delete from public\.approval_requests/)
  assert.match(sql, /approval_hard_delete_audit_retained/)
})

test("전자결재 규칙은 생산자 배포 후에도 모두 비활성 상태다", async () => {
  const sql = await source(migrationUrl)

  assert.match(sql, /update dashboard_private\.notification_rules[\s\S]*set enabled = false[\s\S]*workflow_key = 'approvals'/)
  assert.match(sql, /approval_notification_rules_must_remain_disabled/)
  assert.doesNotMatch(sql, /set enabled = true/)
})

test("클라이언트 서비스는 고정 RPC만 호출하고 요청·댓글·이벤트에 직접 쓰지 않는다", async () => {
  const service = await source(serviceUrl)

  for (const rpc of [
    "create_approval_request_v2",
    "update_approval_request_v2",
    "transition_approval_request_v2",
    "add_approval_comment_v2",
    "delete_approval_request_v2",
  ]) assert.ok(service.includes(`"${rpc}"`), `RPC 호출 누락: ${rpc}`)

  assert.match(service, /crypto\.randomUUID\(\)/)
  assert.match(service, /p_expected_updated_at/)
  assert.doesNotMatch(service, /\.from\("approval_requests"\)\.(?:insert|update|delete)\(/)
  assert.doesNotMatch(service, /\.from\("approval_comments"\)\.insert\(/)
  assert.doesNotMatch(service, /\.from\("approval_events"\)\.(?:insert|update|delete)\(/)
  assert.doesNotMatch(service, /(?:recipientIds|recipients|targetIds|targets|managementProfileIds)\s*:/)
})

test("생성 RPC는 draft만 허용해 submitted 이벤트 우회를 막는다", async () => {
  const sql = await source(migrationUrl)
  const createBody = block(
    sql,
    "create or replace function dashboard_private.create_approval_request_v2_impl",
    "create or replace function dashboard_private.update_approval_request_v2_impl",
  )

  assert.match(createBody, /p_status is null\s+or p_status <> 'draft'/)
  assert.doesNotMatch(createBody, /p_status not in \('draft', 'submitted'\)/)

  const transitionBody = block(
    sql,
    "create or replace function dashboard_private.transition_approval_request_v2_impl",
    "create or replace function dashboard_private.add_approval_comment_v2_impl",
  )
  assert.match(transitionBody, /p_status is null\s+or p_status not in/)
})

test("수정 RPC는 닫힌 문서를 불변으로 유지하고 결재자의 본문 수정을 거부한다", async () => {
  const sql = await source(migrationUrl)
  const updateBody = block(
    sql,
    "create or replace function dashboard_private.update_approval_request_v2_impl",
    "create or replace function dashboard_private.transition_approval_request_v2_impl",
  )

  assert.match(updateBody, /v_request\.status in \('approved', 'canceled'\)[\s\S]*approval_closed_immutable/)
  assert.doesNotMatch(updateBody, /v_actor is distinct from v_request\.approver_id/)
  assert.match(updateBody, /v_actor is distinct from v_request\.requester_id[\s\S]*v_role is distinct from 'admin'[\s\S]*v_role is distinct from 'staff'/)
})

test("진행 중 문서는 활성 결재자를 반드시 유지한다", async () => {
  const sql = await source(migrationUrl)
  const updateBody = block(
    sql,
    "create or replace function dashboard_private.update_approval_request_v2_impl",
    "create or replace function dashboard_private.transition_approval_request_v2_impl",
  )

  assert.match(updateBody, /v_request\.status in \('submitted', 'reviewing'\)[\s\S]*v_approver_id is null[\s\S]*approval_approver_required/)
  assert.match(updateBody, /notification_profile_is_active_v1\(v_approver_id\)/)
})

test("삭제 replay는 원문 없이 최소 감사 영수증만 저장한다", async () => {
  const sql = await source(migrationUrl)
  const deleteBody = block(
    sql,
    "create or replace function dashboard_private.delete_approval_request_v2_impl",
    "create or replace function public.create_approval_request_v2",
  )

  assert.match(deleteBody, /jsonb_build_object\([\s\S]*'deleted', true[\s\S]*'approval_id', v_request\.id[\s\S]*'source_event_id', v_source_id/)
  assert.doesNotMatch(deleteBody, /approval_request_result_v2\(/)
  assert.doesNotMatch(deleteBody, /to_jsonb\(v_request\)/)
})

test("브라우저 mutation은 salted fingerprint와 opaque ID만 저장하고 같은 logical attempt를 재개한다", async () => {
  const service = await source(serviceUrl)
  const attemptType = block(
    service,
    "type ApprovalMutationAttempt = {",
    "const approvalMutationAttempts",
  )

  assert.match(service, /const APPROVAL_MUTATION_ATTEMPT_STORAGE_PREFIX/)
  assert.match(service, /const APPROVAL_MUTATION_ATTEMPT_TTL_MS = 24 \* 60 \* 60 \* 1000/)
  assert.match(service, /sessionStorage/)
  assert.match(service, /salt/)
  assert.match(service, /fingerprint/)
  assert.match(service, /createdApprovalId/)
  assert.match(service, /createRequestId/)
  assert.match(service, /transitionRequestId/)
  assert.match(service, /createdAt: Date\.now\(\)/)
  assert.match(service, /storedAge >= 0 && storedAge <= APPROVAL_MUTATION_ATTEMPT_TTL_MS/)
  assert.match(service, /let persisted: ApprovalMutationAttempt \| null = null[\s\S]*try \{[\s\S]*storage\.getItem\(approvalMutationStorageKey\(kind\)\)[\s\S]*catch/)
  assert.match(service, /function clearApprovalMutationAttempt[\s\S]*try \{[\s\S]*storage\.removeItem\(approvalMutationStorageKey\(kind\)\)[\s\S]*catch/)
  assert.match(service, /function isDefinitiveApprovalMutationError[\s\S]*code === "40001"[\s\S]*code === "42501"[\s\S]*code\.startsWith\("23"\)/)
  assert.match(service, /if \(isDefinitiveApprovalMutationError\(error\)\) \{[\s\S]*clearApprovalMutationAttempt\("transition", attempt\)/)
  assert.match(service, /p_request_id: attempt\.(?:requestId|createRequestId|transitionRequestId)/)
  assert.match(service, /storage\.setItem\(approvalMutationStorageKey\(kind\), JSON\.stringify\(attempt\)\)/)
  assert.doesNotMatch(service, /p_request_id:\s*crypto\.randomUUID\(\)/)
  assert.doesNotMatch(attemptType, /title|body|memo|attachment|comment|payload/i)
  assert.doesNotMatch(service, /sessionStorage\.setItem\([^\n]*(?:title|body|memo|attachment|comment)/i)

  const createMutation = block(
    service,
    "export async function createMonthlyReportApproval",
    "export async function updateMonthlyReportApproval",
  )
  assert.match(createMutation, /p_request_id: attempt\.createRequestId/)
  assert.match(createMutation, /attempt\.transitionRequestId/)

  const updateMutation = block(
    service,
    "export async function updateMonthlyReportApproval",
    "function buildApprovalRequestPayload",
  )
  assert.match(updateMutation, /p_request_id: attempt\.requestId/)
  assert.match(updateMutation, /attempt\.transitionRequestId/)
  assert.match(updateMutation, /catch \(error\) \{[\s\S]*isDefinitiveApprovalMutationError\(error\)[\s\S]*clearApprovalMutationAttempt\("update", attempt\)/)

  for (const [start, end] of [
    ["export async function updateApprovalStatus", "export async function deleteApprovalRequest"],
    ["export async function deleteApprovalRequest", "export async function addApprovalComment"],
    ["export async function addApprovalComment", "export async function saveApprovalTemplate"],
  ]) {
    assert.match(block(service, start, end), /attempt\.requestId/)
  }
})

test("provider 직전 재검증은 canonical 승인 이벤트를 원본 상태로 변환하고 비활성 계정을 거부한다", async () => {
  const worker = await source(workerUrl)
  const revalidation = block(
    worker,
    "create or replace function public.revalidate_immediate_notification_delivery_v1",
    "create or replace function dashboard_private.notification_event_matches_dispatch_flag_v1",
  )

  for (const [canonical, raw] of [
    ["approval.created", "created"],
    ["approval.submitted", "status_changed"],
    ["approval.resubmitted", "status_changed"],
    ["approval.review_started", "status_changed"],
    ["approval.approved", "status_changed"],
    ["approval.returned", "status_changed"],
    ["approval.canceled", "status_changed"],
    ["approval.approver_changed", "approver_changed"],
    ["approval.deleted", "deleted"],
  ]) {
    assert.match(revalidation, new RegExp(`when '${canonical.replace(".", "\\.")}' then '${raw}'`))
  }
  assert.match(revalidation, /source\.approval_id::text = v_event\.payload ->> 'approval_id'/)
  assert.match(revalidation, /source\.approval_id::text = v_event\.payload ->> 'approval_id'[\s\S]*when 'approval_comment'/)
  assert.match(revalidation, /notification_profile_is_active_v1\([\s\S]*v_delivery\.target_profile_id/)
})

test("전자결재 구버전 writer는 closure 전 안전한 최초 상태와 trigger 정규화를 유지하고 closure 뒤 닫힌다", async () => {
  const closure = await source(closureUrl)
  const sql = await source(migrationUrl)
  const triggerBody = block(
    sql,
    "create or replace function dashboard_private.write_approval_notification_event_v2",
    "create or replace function dashboard_private.write_approval_comment_notification_v2",
  )

  assert.match(closure, /revoke insert, update, delete on table public\.approval_requests from authenticated/)
  assert.match(closure, /revoke insert, update, delete on table public\.approval_requests from public, anon/)
  assert.match(triggerBody, /tg_op = 'INSERT'[\s\S]*new\.status is null[\s\S]*new\.status not in \('draft', 'submitted'\)[\s\S]*approval_initial_status_invalid/)
  assert.match(triggerBody, /approval_requester_invalid/)
  assert.match(triggerBody, /approval_approver_invalid/)
  assert.match(triggerBody, /v_requester_transition/)
  assert.match(triggerBody, /v_approver_transition/)
  assert.match(triggerBody, /approval_closed_immutable/)
  assert.match(triggerBody, /pg_catalog\.to_jsonb\(new\) - array\['status', 'decided_at', 'updated_at'\]/)
  assert.match(triggerBody, /approval_access_denied/)
  assert.match(sql, /create policy approval_requests_delete_closed_admin_v2/)
  assert.match(triggerBody, /v_request_id := coalesce\(v_request_id, pg_catalog\.gen_random_uuid\(\)\)/)
  assert.doesNotMatch(triggerBody, /tg_op in \('UPDATE', 'DELETE'\) and v_request_id is null/)
})

test("전자결재 알림 deep link는 요청 문서를 찾아 열고 소비한 query를 제거한다", async () => {
  const workspace = await source(workspaceUrl)

  assert.match(workspace, /searchParams\.get\("approvalId"\)/)
  assert.match(workspace, /data\.requests\.find\(\(item\) => item\.id === approvalId\)/)
  assert.match(workspace, /setDeepLinkedApprovalId\(approvalId\)/)
  assert.match(workspace, /nextSearchParams\.delete\("approvalId"\)/)
  assert.match(workspace, /scrollIntoView\(/)
  assert.match(workspace, /open=\{highlighted \|\| undefined\}/)
})

test("전자결재 adapter는 권위 재검증 의존성을 주입해 provider 0 통합 회귀를 실행할 수 있다", async () => {
  const adapter = await source(adapterUrl)

  assert.match(adapter, /export function createApprovalsNotificationAdapter/)
  assert.match(adapter, /dependencies\?: ImmediateNotificationAdapterDependencies/)
  assert.match(adapter, /createImmediateNotificationAdapter\([\s\S]*approvalsNotificationAdapterConfig,[\s\S]*dependencies/)
})

test("pgTAP은 권한·불변성·NULL·최소 삭제 영수증 회귀를 실행한다", async () => {
  const pgTap = await source(pgTapUrl)

  for (const marker of [
    "Task 20 closure 뒤 전자결재 요청 직접 writer는 닫힌다",
    "authenticated 사용자는 전자결재 요청을 직접 만들 수 없다",
    "authenticated 사용자는 전자결재 댓글을 직접 만들 수 없다",
    "직접 submitted 생성은 거부된다",
    "NULL 상태 생성은 고정 오류로 거부된다",
    "NULL 상태 전이는 고정 오류로 거부된다",
    "결재자는 문서 본문을 수정할 수 없다",
    "진행 중 문서의 결재자를 제거할 수 없다",
    "닫힌 문서는 수정할 수 없다",
    "삭제 replay 영수증에는 원문이 남지 않는다",
    "본문만 수정한 동일 요청은 최초 응답을 그대로 재실행한다",
    "본문만 수정하면 의미 없는 알림 원본 이벤트를 만들지 않는다",
  ]) assert.ok(pgTap.includes(marker), `pgTAP 회귀 누락: ${marker}`)
})
