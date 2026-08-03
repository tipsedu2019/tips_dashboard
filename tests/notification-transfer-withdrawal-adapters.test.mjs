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
const deepLinkHelperUrl = new URL(
  "../src/features/notifications/server/adapters/ops-transition-notification-deep-link.ts",
  import.meta.url,
)
const deepLinkMigrationUrl = new URL(
  "../supabase/migrations/20260730143100_notification_transfer_withdrawal_deep_links.sql",
  import.meta.url,
)
const transferContentMigrationUrl = new URL(
  "../supabase/migrations/20260803144000_notification_transfer_content_payload.sql",
  import.meta.url,
)
const transferAdapterUrl = new URL(
  "../src/features/notifications/server/adapters/transfer-notification-adapter.ts",
  import.meta.url,
)
const withdrawalContentMigrationUrl = new URL(
  "../supabase/migrations/20260803145000_notification_withdrawal_content_payload.sql",
  import.meta.url,
)
const withdrawalAdapterUrl = new URL(
  "../src/features/notifications/server/adapters/withdrawal-notification-adapter.ts",
  import.meta.url,
)

test("전반·퇴원 canonical 링크는 event status snapshot의 flow를 정확히 사용한다", async () => {
  const { buildOpsTransitionNotificationDeepLink } = await import(deepLinkHelperUrl)
  const taskId = "ea3cd6e1-e2da-4f9d-833e-c7349c09ee31"
  const flowByStatus = new Map([
    ["requested", "applicant"],
    ["confirmed", "operations"],
    ["in_progress", "operations"],
    ["on_hold", "operations"],
    ["review_requested", "operations"],
    ["done", "closed"],
    ["canceled", "closed"],
  ])
  for (const workflowKey of ["transfer", "withdrawal"]) {
    for (const [status, flow] of flowByStatus) {
      assert.equal(
        buildOpsTransitionNotificationDeepLink({ workflowKey, taskId, status }),
        `/admin/${workflowKey}?flow=${flow}&taskId=${taskId}`,
      )
    }
  }
  for (const input of [
    { workflowKey: "transfer", taskId, status: " requested" },
    { workflowKey: "transfer", taskId, status: "unknown" },
    { workflowKey: "transfer", taskId: "not-a-uuid", status: "requested" },
    { workflowKey: "tasks", taskId, status: "requested" },
  ]) {
    assert.throws(
      () => buildOpsTransitionNotificationDeepLink(input),
      /notification_payload_schema_unsupported/,
    )
  }
})

test("legacy 전반·퇴원 계획도 canonical event snapshot의 상태별 flow를 사용한다", async () => {
  const sql = await source(deepLinkMigrationUrl)
  const plan = block(
    sql,
    "create or replace function public.get_ops_task_legacy_dispatch_plan_v1",
    "alter function dashboard_private.notification_ops_task_deep_link_v1",
  )
  assert.match(sql, /when 'requested' then 'applicant'/)
  assert.match(sql, /when 'confirmed' then 'operations'/)
  assert.match(sql, /when 'done' then 'closed'/)
  assert.match(sql, /when 'canceled' then 'closed'/)
  assert.match(sql, /\?flow=' \|\| v_flow \|\| '&taskId='/)
  assert.match(plan, /dashboard_private\.notification_ops_task_deep_link_v1\([\s\S]*?v_canonical\.payload ->> 'status'/)
  assert.doesNotMatch(plan, /when 'transfer' then '\/admin\/transfer\?taskId='/)
  assert.doesNotMatch(plan, /else '\/admin\/withdrawal\?taskId='/)
  assert.match(sql, /raise exception 'ops_task_notification_deep_link_invalid' using errcode = '22023'/)
})

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

test("ops-task legacy dispatch plan은 이벤트 업무 유형 비교 CASE를 PL/pgSQL IF에서 괄호로 감싼다", async () => {
  const sql = await source(migrationUrl)
  const plan = block(
    sql,
    "create or replace function public.get_ops_task_legacy_dispatch_plan_v1",
    "create or replace function public.transfer_withdrawal_notification_producers_runtime_version",
  )

  const sourceTypeCheck = block(
    plan,
    "if not found or pg_catalog.split_part(v_source.event_type, '.', 1)",
    "raise exception 'ops_task_notification_source_mismatch'",
  )
  assert.match(
    sourceTypeCheck,
    /<>[\s\S]*\(case v_task\.type when 'general' then 'task' else v_task\.type end\)[\s\S]*then/,
  )
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

test("전반 adapter는 presentation builder를 사용하고 관리팀 Chat 목적지만 유지한다", async () => {
  const { transferNotificationAdapter } = await import(transferAdapterUrl)
  const input = {
    eventId: "84000000-0000-4000-8000-000000000011",
    workflowKey: "transfer",
    eventKey: "transfer.submitted",
    sourceType: "ops_task_event",
    sourceId: "84000000-0000-4000-8000-000000000012",
    sourceRevision: null,
    payloadSchemaVersion: 1,
    payload: {
      task_id: "84000000-0000-4000-8000-000000000001",
      student_name: "김도윤",
      task_status: "requested",
      status: "requested",
      requester_name: "박지영",
      teacher_name: "김수학",
      before_class: "중2 수학 A반",
      after_class: "중2 수학 B반",
      requested_effective_date: "2026-08-31",
      before_class_end_date: "2026-08-28",
      after_class_start_date: "2026-08-31",
      actor_name: "이관리",
      reason: null,
      memo: null,
      occurred_at: "2026-08-04T01:00:00.000Z",
      management_profile_ids: [],
    },
    rule: {
      ruleId: "84000000-0000-4000-8000-000000000021",
      ruleRevision: "1",
      templateId: "84000000-0000-4000-8000-000000000022",
      audienceKey: "management_team",
      channelKey: "google_chat",
      connectionKey: "google_chat.management",
      ruleVariantKey: "immediate",
    },
    scheduledFor: "2026-08-04T01:00:00.000Z",
  }
  const targets = await transferNotificationAdapter.resolveTargets(input)
  assert.deepEqual(targets.targets.map((target) => target.connectionKey), ["google_chat.management"])
  const context = await transferNotificationAdapter.buildRenderContext({
    ...input,
    targetGeneration: targets.targetGeneration,
    target: targets.targets[0],
    requestedContextKeys: [
      "student_name", "before_class", "after_class", "effective_date", "requester_name", "progress_line",
    ],
  })
  assert.equal(context.student_name, "김도윤 학생")
  assert.equal(context.before_class, "중2 수학 A반")
  assert.equal(context.after_class, "중2 수학 B반")
  assert.equal(context.effective_date, "8월 31일(월)")
  assert.equal(context.requester_name, "박지영님")
  assert.equal(context.progress_line, "[진행] 관리팀의 반 이동 일정 확인을 기다리고 있어요.")
})

test("전반 content migration은 신청자·수업 담당자와 제출·완료 날짜를 같은 event transaction에서 분리한다", async () => {
  const sql = await source(transferContentMigrationUrl)
  assert.match(
    sql,
    /record_notification_event_v1\(text,text,text,text,text,bigint,text,uuid,timestamptz,integer,jsonb,uuid,bigint\)/,
  )
  const writer = block(
    sql,
    "create or replace function dashboard_private.record_ops_transition_notification_source_v1",
    "revoke all on function dashboard_private.record_ops_transition_notification_source_v1",
  )
  for (const key of [
    "requester_name", "teacher_name", "before_class", "after_class",
    "requested_effective_date", "before_class_end_date", "after_class_start_date",
    "actor_name", "reason", "memo",
  ]) assert.match(writer, new RegExp(`'${key}'`), `전반 표시 snapshot key 누락: ${key}`)

  assert.match(writer, /profile\.id = p_task\.requested_by/)
  assert.match(writer, /profile\.id = v_actor/)
  assert.match(writer, /v_teacher_name := coalesce\(nullif\(v_transfer\.from_teacher_name/)
  assert.doesNotMatch(writer, /v_requester_name\s*:=\s*v_teacher_name/)
  assert.match(writer, /insert into public\.ops_task_events[\s\S]*record_notification_event_v1/)
  assert.doesNotMatch(sql, /google_chat\.(?:english|math|science)/)
  assert.doesNotMatch(sql, /notification_runtime_flags|record_notification_delivery|fetch\(|webhook/i)
})

test("수강 제외 adapter는 선택 과목 범위와 관리팀 Chat 목적지만 렌더한다", async () => {
  const { withdrawalNotificationAdapter } = await import(withdrawalAdapterUrl)
  const input = {
    eventId: "85000000-0000-4000-8000-000000000011",
    workflowKey: "withdrawal",
    eventKey: "withdrawal.completed",
    sourceType: "ops_task_event",
    sourceId: "85000000-0000-4000-8000-000000000012",
    sourceRevision: null,
    payloadSchemaVersion: 1,
    payload: {
      task_id: "85000000-0000-4000-8000-000000000001",
      student_name: "김민서",
      task_status: "done",
      status: "done",
      selected_subject: "수학",
      selected_class: "중2 수학 A반",
      applied_withdrawal_date: "2026-08-31",
      applied_withdrawal_round: "8회차",
      requester_name: "박지영",
      actor_name: "이관리",
      other_active_subjects: ["영어"],
      reason: null,
      memo: null,
      occurred_at: "2026-08-04T01:00:00.000Z",
      management_profile_ids: [],
    },
    rule: {
      ruleId: "85000000-0000-4000-8000-000000000021",
      ruleRevision: "1",
      templateId: "85000000-0000-4000-8000-000000000022",
      audienceKey: "management_team",
      channelKey: "google_chat",
      connectionKey: "google_chat.management",
      ruleVariantKey: "immediate",
    },
    scheduledFor: "2026-08-04T01:00:00.000Z",
  }
  const targets = await withdrawalNotificationAdapter.resolveTargets(input)
  assert.deepEqual(targets.targets.map((target) => target.connectionKey), ["google_chat.management"])
  const context = await withdrawalNotificationAdapter.buildRenderContext({
    ...input,
    targetGeneration: targets.targetGeneration,
    target: targets.targets[0],
    requestedContextKeys: [
      "student_name", "subjects", "class_name", "withdrawal_date", "withdrawal_round", "progress_line",
    ],
  })
  assert.deepEqual(context, {
    student_name: "김민서 학생",
    subjects: "수학",
    class_name: "중2 수학 A반",
    withdrawal_date: "8월 31일(월)",
    withdrawal_round: "8회차",
    progress_line: "[상태] 다른 과목 수강은 그대로 유지돼요.",
  })
})

test("수강 제외 content migration은 선택 과목만 제외한 뒤 남은 활성 과목을 같은 transaction에서 snapshot한다", async () => {
  const [sql, producerSql] = await Promise.all([
    source(withdrawalContentMigrationUrl),
    source(migrationUrl),
  ])
  const writer = block(
    sql,
    "create or replace function dashboard_private.record_ops_transition_notification_source_v1",
    "revoke all on function dashboard_private.record_ops_transition_notification_source_v1",
  )
  for (const key of [
    "selected_subject", "selected_class",
    "requested_withdrawal_date", "requested_withdrawal_round",
    "applied_withdrawal_date", "applied_withdrawal_round",
    "requester_name", "actor_name", "other_active_subjects",
  ]) assert.match(writer, new RegExp(`'${key}'`), `수강 제외 표시 snapshot key 누락: ${key}`)

  const completion = block(
    producerSql,
    "create or replace function dashboard_private.complete_ops_withdrawal_roster_transition_v2_impl",
    "create or replace function dashboard_private.complete_ops_withdrawal_roster_transition_v2_impl_end",
  )
  assert.ok(
    completion.indexOf("complete_ops_withdrawal_roster_transition_impl")
      < completion.indexOf("ensure_ops_transition_completion_source_v1"),
    "선택 수업 제외가 끝난 뒤 canonical 알림 snapshot을 기록해야 합니다.",
  )
  assert.match(writer, /public\.students/)
  assert.match(writer, /public\.classes/)
  assert.match(writer, /public\.ops_registration_enrollments/)
  assert.match(writer, /enrollment\.roster_active/)
  assert.match(writer, /p_event_key = 'withdrawal\.completed'/)
  assert.match(writer, /source\.event_type = 'withdrawal\.submitted'/)
  assert.match(
    writer,
    /coalesce\(\s*source\.payload ->> 'requested_withdrawal_date',\s*source\.payload ->> 'withdrawal_date'\s*\)/,
  )
  assert.match(
    writer,
    /coalesce\(\s*source\.payload ->> 'requested_withdrawal_round',\s*source\.payload ->> 'withdrawal_round'\s*\)/,
  )
  assert.match(writer, /insert into public\.ops_task_events[\s\S]*record_notification_event_v1/)
  assert.doesNotMatch(sql, /update public\.ops_registration_enrollments|apply_student_class_roster_mode/)
  assert.doesNotMatch(sql, /google_chat\.(?:english|math|science)/)
  assert.doesNotMatch(sql, /notification_runtime_flags|record_notification_delivery|fetch\(|webhook/i)
})
