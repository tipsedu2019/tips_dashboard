import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const migrationUrl = new URL(
  "../supabase/migrations/20260716191000_notification_transfer_withdrawal_producers.sql",
  import.meta.url,
)
const routeUrl = new URL("../src/app/api/notifications/legacy/ops-task/route.ts", import.meta.url)
const opsTaskProducerMigrationUrl = new URL(
  "../supabase/migrations/20260716190000_notification_ops_task_producers.sql",
  import.meta.url,
)
const settingsSeedUrl = new URL(
  "../supabase/migrations/20260716112500_notification_workflow_settings_seed.sql",
  import.meta.url,
)
const tasksAdapterUrl = new URL(
  "../src/features/notifications/server/adapters/tasks-notification-adapter.ts",
  import.meta.url,
)
const wordRetestsAdapterUrl = new URL(
  "../src/features/notifications/server/adapters/word-retests-notification-adapter.ts",
  import.meta.url,
)
const immediateAdapterUrl = new URL(
  "../src/features/notifications/server/adapters/immediate-notification-adapter.ts",
  import.meta.url,
)
const intentHelperUrl = new URL(
  "../src/features/notifications/server/legacy-delivery-intent.js",
  import.meta.url,
)
const serviceUrl = new URL("../src/features/tasks/ops-task-service.ts", import.meta.url)
const workspaceUrl = new URL("../src/features/tasks/ops-task-workspace.tsx", import.meta.url)

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

test("전반·퇴원은 6개 원본 이벤트를 분리하고 제출·완료 관리팀 Chat 규칙만 소비한다", async () => {
  const sql = await source(migrationUrl)

  for (const eventKey of [
    "transfer.submitted", "transfer.processing_started", "transfer.details_changed",
    "transfer.completed", "transfer.canceled", "transfer.reopened",
    "withdrawal.submitted", "withdrawal.processing_started", "withdrawal.details_changed",
    "withdrawal.completed", "withdrawal.canceled", "withdrawal.reopened",
  ]) assert.ok(sql.includes(`'${eventKey}'`), `이벤트 누락: ${eventKey}`)

  assert.doesNotMatch(sql, /(?:transfer|withdrawal)\.(?:applicant|operations)/)
  assert.match(sql, /snapshot\.item ->> 'audience_key' = 'management_team'/)
  assert.match(sql, /snapshot\.item ->> 'channel_key' = 'google_chat'/)
  assert.match(sql, /google_chat\.management/)
  assert.match(sql, /when new\.status = 'in_progress' then new\.type \|\| '\.processing_started'/)
  assert.match(sql, /when new\.status = 'canceled' then new\.type \|\| '\.canceled'/)
  assert.match(sql, /when old\.status = 'canceled' then new\.type \|\| '\.reopened'/)
})

test("명단 완료 RPC는 명단·상태·원본·canonical 기록과 요청 재실행을 한 트랜잭션에 묶는다", async () => {
  const sql = await source(migrationUrl)
  for (const [name, legacyName] of [
    ["complete_ops_transfer_roster_transition_v2_impl", "complete_ops_transfer_roster_transition"],
    ["complete_ops_withdrawal_roster_transition_v2_impl", "complete_ops_withdrawal_roster_transition"],
  ]) {
    const start = `create or replace function dashboard_private.${name}`
    const body = block(sql, start, `${start}_end`)
    assert.match(body, new RegExp(legacyName))
    assert.match(body, /ops_task_request_replay_v2/)
    assert.match(body, /ensure_ops_transition_completion_source_v1/)
    assert.match(body, /app\.ops_transition_completion_authorized/)
    assert.match(body, /finish_ops_task_request_v2/)
    assert.match(body, /sourceEventIds/)
  }
  assert.match(sql, /create or replace function public\.complete_ops_transfer_roster_transition_v2\(/)
  assert.match(sql, /create or replace function public\.complete_ops_withdrawal_roster_transition_v2\(/)
  assert.match(sql, /create or replace function public\.complete_ops_transfer_roster_transition_v2\([\s\S]*?returns jsonb[\s\S]*?security definer/)
  assert.match(sql, /create or replace function public\.complete_ops_withdrawal_roster_transition_v2\([\s\S]*?returns jsonb[\s\S]*?security definer/)
})

test("체크리스트 저장은 비종료 update RPC만 사용하고 어떤 알림 원본도 만들지 않는다", async () => {
  const [sql, service, workspace] = await Promise.all([
    source(migrationUrl), source(serviceUrl), source(workspaceUrl),
  ])
  for (const name of ["updateWithdrawalChecklist", "updateTransferChecklist"]) {
    const body = block(workspace, `const ${name}`, "\n  }")
    assert.match(body, /updateOpsTask\(/)
    assert.doesNotMatch(body, /updateOpsTaskStatus\(|completeOps.*Transition|notify(?:Withdrawal|Transfer)Workflow/)
  }
  assert.match(service, /update_ops_task_v2/)
  assert.match(sql, /'timetable_roster_updated',[\s\S]*'fee_processed', 'textbook_fee_processed'/)
  assert.match(sql, /source\.request_id = p_request_id/)
  assert.match(sql, /'sourceEventIds', v_source_event_ids/)
})

test("일반 수정·상태 RPC는 전반·퇴원 완료 우회를 막고 신규 화면은 구 DB로 안전하게 폴백한다", async () => {
  const [sql, service] = await Promise.all([source(migrationUrl), source(serviceUrl)])
  assert.match(sql, /ops_transition_initial_status_invalid/)
  assert.match(sql, /ops_transition_completion_rpc_required/)
  assert.match(sql, /old\.status = 'done'[\s\S]*ops_transition_closed/)
  assert.match(service, /isMissingOpsRosterRpc\(error\)[\s\S]*skipTransitionProducer: true/)
  assert.match(service, /complete_ops_transfer_roster_transition"/)
  assert.match(service, /complete_ops_withdrawal_roster_transition"/)
  assert.match(service, /p_request_key: `ops-\$\{type\}-completion-\$\{taskId\}`/)
  assert.match(service, /transition_ops_task_status_v2[\s\S]*isMissingOpsRosterRpc\(error\)/)
})

test("브라우저는 저장 후 안정된 sourceEventId만 legacy bridge로 보내고 공급자 실패와 저장 성공을 분리한다", async () => {
  const workspace = await source(workspaceUrl)
  const dispatch = block(
    workspace,
    "async function dispatchLegacyOpsTaskSource",
    "function WithdrawalNotificationSettingsDialog",
  )
  assert.match(dispatch, /\/api\/notifications\/legacy\/ops-task/)
  assert.match(dispatch, /JSON\.stringify\(\{ sourceEventId \}\)/)
  assert.doesNotMatch(dispatch, /JSON\.stringify\(\{[^}]*\b(?:title|text|recipient|webhook|channel)\b/)
  assert.doesNotMatch(workspace, /void notifyWithdrawalWorkflow\(/)
  assert.doesNotMatch(workspace, /void notifyTransferWorkflow\(/)
  assert.match(workspace, /Promise\.allSettled[\s\S]*dispatchLegacyOpsTaskSource/)
})

test("legacy ops-task route는 exact sourceEventId envelope만 받고 서버 provider와 공통 소유권을 사용한다", async () => {
  const [route, intentHelper, sql] = await Promise.all([
    source(routeUrl),
    source(intentHelperUrl),
    source(migrationUrl),
  ])

  assert.match(route, /Object\.keys\(body\)\.length !== 1/)
  assert.match(route, /Object\.keys\(body\)\[0\] !== "sourceEventId"/)
  assert.match(route, /notification_payload_forbidden/)
  assert.match(route, /notification_payload_forbidden" \}, 422\)/)
  assert.match(route, /get_ops_task_legacy_dispatch_plan_v1/)
  assert.match(route, /record_legacy_notification_intent_v1/)
  assert.match(route, /begin_legacy_notification_dispatch_v1/)
  assert.match(route, /finalize_legacy_notification_dispatch_v1/)
  assert.match(route, /createGoogleChatProvider/)
  assert.match(route, /readLegacyGoogleChatWebhookUrl/)
  assert.doesNotMatch(route, /\/api\/google-chat/)
  assert.doesNotMatch(route, /body\.(?:title|text|recipient|webhook|channel)/)
  assert.doesNotMatch(route, /randomUUID/)
  assert.match(route, /createHash\("sha256"\)/)
  assert.match(route, /normalizedNotificationRenderedHash/)
  assert.match(route, /templateChecksum:\s*text\(raw\.templateChecksum\)/)
  assert.match(route, /const TEMPLATE_CHECKSUM = \/\^\(\?:\[a-f0-9\]\{32\}\|\[a-f0-9\]\{64\}\)\$\//)
  assert.match(route, /TEMPLATE_CHECKSUM\.test\(item\.templateChecksum\)/)
  assert.match(route, /p_legacy_template_checksum:\s*item\.templateChecksum/)
  assert.match(sql, /'templateChecksum',\s*template_row\.checksum/)
  assert.match(intentHelper, /replace\(\/\\r\\n\?\/g, "\\n"\)[\s\S]*\.normalize\("NFC"\)/)
  assert.equal(
    intentHelper.includes('.replace(/^[ \\t\\n\\f\\v]+|[ \\t\\n\\f\\v]+$/g, "")'),
    true,
  )
  assert.doesNotMatch(intentHelper, /\.trim\(\)/)
  assert.match(intentHelper, /JSON\.stringify\(\{[\s\S]*title:[\s\S]*body:[\s\S]*href:/)
  const begin = block(route, "async function beginLegacyDispatch", "async function loadLegacyDispatchPlan")
  assert.ok(
    begin.indexOf("record_legacy_notification_intent_v1")
      < begin.indexOf("begin_legacy_notification_dispatch_v1"),
    "정규화 의도 기록은 소유권 획득보다 먼저 실행해야 합니다.",
  )
  assert.match(route, /webhook_configuration_error[\s\S]*"failed"/)
  assert.match(route, /provider_exception[\s\S]*"delivery_unknown"/)
  assert.match(route, /status\) === "dispatch_already_started"/)
  assert.match(route, /reason\) === "idempotent_dispatch_replay"/)
  assert.match(
    route,
    /if \(isInterruptedDispatchReplay\(begun\)\)[\s\S]*finalizeLegacyDispatch\([\s\S]*"delivery_unknown"[\s\S]*return "delivery_unknown"/,
  )
  assert.match(route, /items\.length === 0 \|\| deduped === items\.length \? 202 : 200/)
})

test("legacy route는 task·word_retest를 canonical workflow로 정규화하고 기존 등록·전반·퇴원 분기를 보존한다", async () => {
  const route = await source(routeUrl)
  const parse = block(route, "function parsePlan", "async function beginLegacyDispatch")
  const begin = block(route, "async function beginLegacyDispatch", "async function loadLegacyDispatchPlan")
  const load = block(route, "async function loadLegacyDispatchPlan", "async function finalizeLegacyDispatch")

  for (const prefix of ["task", "word_retest", "registration", "transfer", "withdrawal"]) {
    assert.ok(parse.includes(`"${prefix}"`), `route 이벤트 prefix 누락: ${prefix}`)
  }
  assert.match(begin, /prefix === "task"[\s\S]*\? "tasks"/)
  assert.match(begin, /prefix === "word_retest"[\s\S]*\? "word_retests"/)
  assert.match(begin, /: prefix/)
  assert.match(begin, /workflowKey === "registration"[\s\S]*registration_core_legacy_bridge_v1[\s\S]*ops_task_legacy_bridge_v1/)
  assert.match(load, /get_ops_task_legacy_dispatch_plan_v1/)
  assert.match(load, /code\) !== "P0002"/)
  assert.match(load, /get_registration_core_legacy_dispatch_plan_v1/)
})

test("tasks·word_retests legacy 계획은 허용 이벤트·canonical 원본·딥링크를 즉시 어댑터와 동일하게 고정한다", async () => {
  const [sql, producerSql, settingsSeed, tasksAdapter, wordRetestsAdapter, immediateAdapter] = await Promise.all([
    source(migrationUrl),
    source(opsTaskProducerMigrationUrl),
    source(settingsSeedUrl),
    source(tasksAdapterUrl),
    source(wordRetestsAdapterUrl),
    source(immediateAdapterUrl),
  ])
  const plan = block(
    sql,
    "create or replace function public.get_ops_task_legacy_dispatch_plan_v1",
    "create or replace function public.transfer_withdrawal_notification_producers_runtime_version",
  )

  const taskEvents = [
    ["task.created", "할 일 생성"],
    ["task.assignee_changed", "담당 변경"],
    ["task.due_changed", "일정 변경"],
    ["task.status_changed", "상태 변경"],
    ["task.completed", "완료"],
    ["task.canceled", "취소"],
    ["task.reopened", "재개"],
    ["task.comment_added", "댓글"],
  ]
  const wordEvents = [
    ["word_retest.created", "재시험 생성"],
    ["word_retest.assigned", "배정"],
    ["word_retest.schedule_changed", "본시험일 변경"],
    ["word_retest.started", "시작"],
    ["word_retest.result_reported", "결과 보고"],
    ["word_retest.absent_reported", "미응시 보고"],
    ["word_retest.revision_requested", "수정 요청"],
    ["word_retest.retry_created", "재시험 재생성"],
    ["word_retest.completed", "완료"],
    ["word_retest.canceled", "취소"],
  ]
  for (const [eventKey, eventLabel] of [...taskEvents, ...wordEvents]) {
    assert.ok(plan.includes(`'${eventKey}'`), `legacy 계획 이벤트 누락: ${eventKey}`)
    const adapter = eventKey.startsWith("task.") ? tasksAdapter : wordRetestsAdapter
    assert.ok(adapter.includes(`"${eventKey}": "${eventLabel}"`), `즉시 어댑터 라벨 불일치: ${eventKey}`)
    assert.ok(settingsSeed.includes(`'${eventKey}', '${eventLabel}'`), `설정 registry 라벨 불일치: ${eventKey}`)
  }

  assert.match(plan, /task\.type in \('general', 'word_retest', 'transfer', 'withdrawal'\)/)
  assert.match(plan, /when 'general' then 'tasks'[\s\S]*when 'word_retest' then 'word_retests'/)
  assert.match(plan, /when 'general' then '\/admin\/tasks\?taskId='/)
  assert.match(plan, /when 'word_retest' then '\/admin\/word-retests\?taskId='/)
  assert.match(tasksAdapter, /workflowKey: "tasks"[\s\S]*linkRoot: "\/admin\/tasks"[\s\S]*workflowLabel: "할 일"/)
  assert.match(wordRetestsAdapter, /workflowKey: "word_retests"[\s\S]*linkRoot: "\/admin\/word-retests"[\s\S]*workflowLabel: "영어 단어 재시험"/)

  assert.match(plan, /when v_source\.event_type = 'task\.comment_added' then 'ops_task_comment'/)
  assert.match(plan, /v_source\.payload ->> 'comment_id'/)
  assert.match(plan, /public\.ops_task_comments[\s\S]*comment_row\.task_id = v_task\.id/)
  assert.match(plan, /event_row\.source_type = v_canonical_source_type/)
  assert.match(plan, /event_row\.source_id = v_canonical_source_id::text/)
  assert.match(plan, /event_row\.occurrence_key = v_canonical_source_id::text/)
  assert.match(producerSql, /'comment_id', p_comment_id[\s\S]*'occurred_at', v_occurred_at/)

  assert.match(plan, /registry\.workflow_label[\s\S]*registry\.event_label/)
  assert.match(plan, /coalesce\(v_canonical\.payload ->> 'occurred_at', v_canonical\.occurred_at::text\)/)
  assert.match(immediateAdapter, /occurredAt\.trim\(\)[\s\S]*input\.scheduledFor/)
  assert.match(settingsSeed, /\('tasks', '할 일', 1\)/)
  assert.match(settingsSeed, /\('word_retests', '영어 단어 재시험', 2\)/)
})

test("legacy dispatch plan은 원본 당시 rule snapshot·불변 template·정확한 업무 링크만 반환한다", async () => {
  const sql = await source(migrationUrl)
  const plan = block(
    sql,
    "create or replace function public.get_ops_task_legacy_dispatch_plan_v1",
    "create or replace function public.transfer_withdrawal_notification_producers_runtime_version",
  )
  assert.match(plan, /public\.ops_task_events/)
  assert.match(plan, /public\.ops_tasks/)
  assert.match(plan, /public\.ops_transfer_details/)
  assert.match(plan, /public\.ops_withdrawal_details/)
  assert.match(plan, /dashboard_private\.notification_events/)
  assert.match(plan, /dashboard_private\.notification_templates/)
  assert.match(plan, /jsonb_array_elements\(v_canonical\.rule_snapshot\)/)
  assert.doesNotMatch(plan, /notification_rules/)
  assert.match(plan, /template_row\.id = \(snapshot\.item ->> 'template_id'\)::uuid/)
  assert.match(plan, /template_row\.rule_id = \(snapshot\.item ->> 'rule_id'\)::uuid/)
  assert.match(plan, /'targetGeneration', '0'/)
  assert.match(plan, /'connectionKey', 'google_chat\.management'/)
  assert.match(plan, /'\/admin\/tasks\?taskId='/)
  assert.match(plan, /'\/admin\/word-retests\?taskId='/)
  assert.match(plan, /'\/admin\/transfer\?taskId='/)
  assert.match(plan, /'\/admin\/withdrawal\?taskId='/)
  assert.doesNotMatch(plan, /p_(?:title|body|text|recipient|webhook|channel)/i)
})
