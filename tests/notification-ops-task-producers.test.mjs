import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import vm from "node:vm"

import ts from "typescript"

const migrationUrl = new URL(
  "../supabase/migrations/20260716190000_notification_ops_task_producers.sql",
  import.meta.url,
)
const reretryMigrationUrl = new URL(
  "../supabase/migrations/20260721093603_word_retest_reretry.sql",
  import.meta.url,
)
const assistantWordRetestPermissionsMigrationUrl = new URL(
  "../supabase/migrations/20260721093604_assistant_word_retest_makeup_permissions.sql",
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

function loadServiceFunctions(snippets, exportNames, context) {
  const compiled = ts.transpileModule(
    `${snippets.join("\n")}\nmodule.exports = { ${exportNames.join(", ")} }`,
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    },
  ).outputText
  const sandboxModule = { exports: {} }
  vm.runInNewContext(compiled, {
    module: sandboxModule,
    exports: sandboxModule.exports,
    ...context,
  })
  return sandboxModule.exports
}

test("업무 원본 이벤트는 요청 ID와 고정 payload를 보관하고 같은 요청의 재실행을 하나로 묶는다", async () => {
  const sql = await source(migrationUrl)

  assert.match(sql, /alter table public\.ops_task_events[\s\S]*add column if not exists request_id uuid/)
  assert.match(sql, /add column if not exists payload jsonb/)
  assert.match(sql, /ops_task_events_request_event_uidx/)
  assert.match(sql, /request_id,\s*event_type,\s*coalesce\(field_name, ''\)/)
  assert.match(sql, /notification_request_ledger/)
  assert.match(sql, /pg_advisory_xact_lock[\s\S]*notification-request:/)
  assert.match(sql, /idempotency_key_reused/)
})

test("고정 목적 RPC 10개가 인증 사용자에게만 열리고 등록 업무는 전용 서비스로 남긴다", async () => {
  const sql = await source(migrationUrl)
  const signatures = [
    "create_ops_task_v2(jsonb, uuid)",
    "update_ops_task_v2(uuid, jsonb, timestamptz, uuid)",
    "transition_ops_task_status_v2(uuid, text, timestamptz, uuid)",
    "add_ops_task_comment_v2(uuid, text, uuid)",
    "record_ops_task_activity_event_v1(uuid, text, text, text, text, uuid)",
    "cleanup_created_ops_task_v1(uuid, timestamptz, uuid)",
    "retry_word_retest_v1(uuid, jsonb, uuid)",
    "report_word_retest_result_v1(uuid, jsonb, uuid)",
    "report_word_retest_absent_v1(uuid, text, uuid)",
    "request_word_retest_revision_v1(uuid, text, uuid)",
  ]
  for (const signature of signatures) {
    const name = signature.slice(0, signature.indexOf("("))
    assert.match(sql, new RegExp(`create or replace function public\\.${name}\\(`))
    assert.match(sql, new RegExp(`revoke all on function public\\.${name}`))
    assert.match(sql, new RegExp(`grant execute on function public\\.${name}[\\s\\S]*to authenticated`))
  }
  assert.match(sql, /ops_task_type_not_supported/)
  assert.match(sql, /v_type\s*=\s*'registration'[\s\S]*registration_dedicated_service_required/)
  assert.doesNotMatch(sql, /grant execute[\s\S]*to anon/)
})

test("조교 단어 재시험 권한은 공개 RPC 입구에서 진행 단계만 허용하고 교사 동작을 차단한다", async () => {
  const sql = await source(assistantWordRetestPermissionsMigrationUrl)
  const predicate = block(
    sql,
    "create or replace function dashboard_private.is_authenticated_assistant_request_v1",
    "create or replace function dashboard_private.assert_assistant_word_retest_update_v1",
  )
  const updateGuard = block(
    sql,
    "create or replace function dashboard_private.assert_assistant_word_retest_update_v1",
    "create or replace function dashboard_private.assert_assistant_word_retest_transition_v1",
  )
  const transitionGuard = block(
    sql,
    "create or replace function dashboard_private.assert_assistant_word_retest_transition_v1",
    "create or replace function dashboard_private.assert_assistant_word_retest_teacher_action_v1",
  )
  const teacherActionGuard = block(
    sql,
    "create or replace function dashboard_private.assert_assistant_word_retest_teacher_action_v1",
    "create or replace function public.update_ops_task_v2",
  )
  const updateWrapper = block(
    sql,
    "create or replace function public.update_ops_task_v2",
    "create or replace function public.transition_ops_task_status_v2",
  )
  const transitionWrapper = block(
    sql,
    "create or replace function public.transition_ops_task_status_v2",
    "create or replace function public.retry_word_retest_v1",
  )
  const retryWrapper = block(
    sql,
    "create or replace function public.retry_word_retest_v1",
    "create or replace function public.request_word_retest_revision_v1",
  )
  const revisionWrapper = block(
    sql,
    "create or replace function public.request_word_retest_revision_v1",
    "alter function dashboard_private.is_authenticated_assistant_request_v1",
  )

  assert.match(predicate, /auth\.jwt\(\)\s*->>\s*'role'[\s\S]*=\s*'authenticated'/)
  assert.match(predicate, /auth\.uid\(\)/)
  assert.match(predicate, /from public\.profiles profile[\s\S]*profile\.id\s*=\s*\(select auth\.uid\(\)\)[\s\S]*profile\.role\s*=\s*'assistant'/)
  assert.match(predicate, /security definer[\s\S]*set search_path = ''/)
  assert.doesNotMatch(sql, /\bcurrent_user\b/)

  assert.match(updateGuard, /for update of task/)
  assert.match(updateGuard, /for update of detail/)
  assert.match(updateGuard, /v_task\.status not in \('requested', 'confirmed', 'in_progress', 'on_hold'\)/)
  assert.match(updateGuard, /v_detail\.retest_status not in \('not_started', 'in_progress'\)/)
  assert.match(updateGuard, /v_requested_status is distinct from v_task\.status/)
  assert.match(transitionGuard, /v_task\.status not in \('requested', 'confirmed', 'on_hold'\)/)
  assert.match(transitionGuard, /p_status is distinct from 'in_progress'/)
  for (const guard of [updateGuard, transitionGuard]) {
    assert.match(
      guard,
      /notification_request_ledger[\s\S]*ledger\.request_id = p_request_id[\s\S]*return/,
    )
    assert.doesNotMatch(guard, /ledger\.request_kind/)
    assert.doesNotMatch(guard, /ledger\.request_fingerprint/)
  }

  for (const guardedBlock of [updateGuard, transitionGuard, teacherActionGuard]) {
    assert.match(guardedBlock, /word_retest_assistant_action_not_allowed[\s\S]*errcode = '42501'/)
  }
  assert.ok(
    updateWrapper.indexOf("assert_assistant_word_retest_update_v1") <
      updateWrapper.indexOf("update_ops_task_v2_impl"),
  )
  assert.ok(
    transitionWrapper.indexOf("assert_assistant_word_retest_transition_v1") <
      transitionWrapper.indexOf("transition_ops_task_status_v2_impl"),
  )
  for (const [wrapper, implementation] of [
    [retryWrapper, "retry_word_retest_v1_impl"],
    [revisionWrapper, "request_word_retest_revision_v1_impl"],
  ]) {
    assert.ok(
      wrapper.indexOf("assert_assistant_word_retest_teacher_action_v1") <
        wrapper.indexOf(implementation),
    )
  }
  for (const wrapper of [updateWrapper, transitionWrapper, retryWrapper, revisionWrapper]) {
    assert.match(wrapper, /returns jsonb[\s\S]*security definer[\s\S]*set search_path = ''/)
  }

  assert.doesNotMatch(sql, /create\s+(?:constraint\s+)?trigger/i)
  assert.doesNotMatch(sql, /create or replace function dashboard_private\.(?:update_ops_task_v2_impl|transition_ops_task_status_v2_impl|retry_word_retest_v1_impl|request_word_retest_revision_v1_impl)/)
  assert.doesNotMatch(sql, /create or replace function public\.(?:create_ops_task_v2|report_word_retest_result_v1|report_word_retest_absent_v1)/)
  assert.doesNotMatch(sql, /notification_rules|runtime_version|provider|makeup/i)
  for (const privateSignature of [
    "is_authenticated_assistant_request_v1\\(\\)",
    "assert_assistant_word_retest_update_v1\\(\\s*uuid, jsonb, timestamptz, uuid\\s*\\)",
    "assert_assistant_word_retest_transition_v1\\(\\s*uuid, text, timestamptz, uuid\\s*\\)",
    "assert_assistant_word_retest_teacher_action_v1\\(\\)",
  ]) {
    assert.match(
      sql,
      new RegExp(
        `revoke all on function dashboard_private\\.${privateSignature}[\\s\\S]*from public, anon, authenticated, service_role`,
      ),
    )
  }

  for (const signature of [
    "update_ops_task_v2(uuid, jsonb, timestamptz, uuid)",
    "transition_ops_task_status_v2(uuid, text, timestamptz, uuid)",
    "retry_word_retest_v1(uuid, jsonb, uuid)",
    "request_word_retest_revision_v1(uuid, text, uuid)",
  ]) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${signature.replace(/[()]/g, "\\$&")}`))
    assert.match(sql, new RegExp(`grant execute on function public\\.${signature.replace(/[()]/g, "\\$&")}[\\s\\S]*to authenticated`))
  }
})

test("생산자 RPC 설치 시 업무·재시험 원장의 인증 사용자 직접 DML을 즉시 닫는다", async () => {
  const sql = await source(migrationUrl)

  for (const table of ["ops_tasks", "ops_word_retests"]) {
    assert.match(
      sql,
      new RegExp(
        `revoke insert, update, delete on table public\\.${table}\\s+from public, anon, authenticated`,
      ),
    )
  }
})

test("공개 업무 활동 RPC는 비권위 활동만 받고 파생 상태 이벤트는 잠긴 변경 RPC 내부에서 기록한다", async () => {
  const sql = await source(migrationUrl)
  const writer = block(
    sql,
    "create or replace function dashboard_private.insert_ops_task_activity_event_v1",
    "create or replace function dashboard_private.record_ops_task_activity_event_v1_impl",
  )
  const recorder = block(
    sql,
    "create or replace function dashboard_private.record_ops_task_activity_event_v1_impl",
    "create or replace function dashboard_private.cleanup_created_ops_task_v1_impl",
  )

  assert.match(recorder, /p_task_id is null[\s\S]*p_request_id is null/)
  assert.match(writer, /v_event_type not in \([\s\S]*'auto_synced'[\s\S]*'manual_checked'[\s\S]*'manual_unchecked'[\s\S]*'auto_checked'[\s\S]*'rollback'[\s\S]*'created'[\s\S]*'updated'[\s\S]*'status_changed'[\s\S]*'revision_requested'/)
  assert.match(recorder, /v_event_type not in \([\s\S]*'auto_synced'[\s\S]*'manual_checked'[\s\S]*'manual_unchecked'[\s\S]*'auto_checked'[\s\S]*'rollback'[\s\S]*\)/)
  for (const derivedEventType of ["created", "updated", "status_changed", "revision_requested"]) {
    assert.doesNotMatch(
      recorder,
      new RegExp(`'${derivedEventType}'`),
      `공개 activity RPC가 파생 상태 이벤트 ${derivedEventType}를 받으면 안 됩니다`,
    )
  }
  assert.match(recorder, /v_task\.type not in \('registration', 'transfer', 'withdrawal', 'textbook'\)/)
  assert.match(recorder, /assert_ops_task_actor_v2\(v_task, null\)/)
  assert.match(recorder, /ops_task_request_replay_v2/)
  assert.match(recorder, /finish_ops_task_request_v2/)
  assert.match(recorder, /insert_ops_task_activity_event_v1\(/)
  assert.match(writer, /assert_ops_task_actor_v2\(p_task, null\)/)
  assert.match(writer, /v_source_event_id uuid := pg_catalog\.gen_random_uuid\(\)/)
  assert.match(writer, /insert into public\.ops_task_events\([\s\S]*id,[\s\S]*request_id,[\s\S]*payload/)
  assert.match(writer, /'sourceEventId', v_source_event_id/)
  assert.doesNotMatch(recorder, /record_notification_event_v1/)
  assert.doesNotMatch(recorder, /'sourceEventIds'/)

  const createSql = block(sql, "create or replace function dashboard_private.create_ops_task_v2_impl", "create or replace function dashboard_private.update_ops_task_v2_impl")
  const updateSql = block(sql, "create or replace function dashboard_private.update_ops_task_v2_impl", "create or replace function dashboard_private.transition_ops_task_status_v2_impl")
  const statusSql = block(sql, "create or replace function dashboard_private.transition_ops_task_status_v2_impl", "create or replace function dashboard_private.insert_ops_task_activity_event_v1")
  assert.match(createSql, /v_task\.type = 'textbook'[\s\S]*insert_ops_task_activity_event_v1\([\s\S]*v_task[\s\S]*'created'/)
  assert.match(updateSql, /select task\.\* into v_before[\s\S]*for update of task[\s\S]*insert_ops_task_activity_event_v1\([\s\S]*v_after[\s\S]*v_before\.title[\s\S]*v_after\.title/)
  assert.match(statusSql, /select task\.\* into v_before[\s\S]*for update of task[\s\S]*insert_ops_task_activity_event_v1\([\s\S]*v_before\.status[\s\S]*v_after\.status/)
})

test("생성 실패 정리는 최근 등록 업무 한 건만 권한·생성시각·요청 ID로 멱등 삭제한다", async () => {
  const sql = await source(migrationUrl)
  const cleanup = block(
    sql,
    "create or replace function dashboard_private.cleanup_created_ops_task_v1_impl",
    "create or replace function dashboard_private.add_ops_task_comment_v2_impl",
  )

  assert.match(cleanup, /p_task_id is null[\s\S]*p_expected_created_at is null[\s\S]*p_request_id is null/)
  assert.match(cleanup, /ops_task_request_replay_v2\([\s\S]*'cleanup_created_ops_task_v1'/)
  assert.match(cleanup, /finish_ops_task_request_v2\([\s\S]*'cleanup_created_ops_task_v1'/)
  assert.match(cleanup, /assert_ops_task_actor_v2\(v_task, null\)/)
  assert.match(cleanup, /v_task\.type <> 'registration'/)
  assert.match(cleanup, /v_task\.created_at is distinct from p_expected_created_at/)
  assert.match(cleanup, /v_task\.created_at < pg_catalog\.clock_timestamp\(\) - interval '1 hour'/)
  assert.match(cleanup, /v_task\.status in \('done', 'canceled'\)/)
  assert.match(cleanup, /registration_task_has_subject_tracks\(v_task\.id\)/)
  assert.match(cleanup, /v_actor is distinct from v_task\.requested_by[\s\S]*v_role not in \('admin', 'staff'\)/)
  assert.match(cleanup, /delete from public\.ops_tasks task[\s\S]*where task\.id = v_task\.id/)
  assert.doesNotMatch(cleanup, /delete from public\.ops_task_(events|comments)/)
  assert.match(cleanup, /'taskId', v_deleted_task_id[\s\S]*'deleted', true/)
})

test("교재 업무 생성·수정·상태 변경은 업무와 감사 이력을 같은 RPC 트랜잭션에서 저장한다", async () => {
  const sql = await source(migrationUrl)
  const service = await source(serviceUrl)
  const createSql = block(sql, "create or replace function dashboard_private.create_ops_task_v2_impl", "create or replace function dashboard_private.update_ops_task_v2_impl")
  const updateSql = block(sql, "create or replace function dashboard_private.update_ops_task_v2_impl", "create or replace function dashboard_private.transition_ops_task_status_v2_impl")
  const statusSql = block(sql, "create or replace function dashboard_private.transition_ops_task_status_v2_impl", "create or replace function dashboard_private.insert_ops_task_activity_event_v1")
  const insertSql = block(sql, "create or replace function dashboard_private.insert_ops_task_from_json_v2", "create or replace function dashboard_private.upsert_ops_task_detail_v2")
  const createService = block(service, "export async function createOpsTask(", "async function updateRegistrationTaskParent")
  const updateService = block(service, "export async function updateOpsTask(", "export async function retryWordRetest")
  const statusService = block(service, "export async function updateOpsTaskStatus(", "async function rollbackRegistrationWaitlistRemovalAfterFailure")

  assert.match(insertSql, /v_type not in \('general', 'word_retest', 'transfer', 'withdrawal', 'textbook'\)/)
  assert.match(createSql, /v_task\.type = 'textbook'[\s\S]*insert_ops_task_activity_event_v1\([\s\S]*'created'/)
  assert.match(updateSql, /v_before\.type not in \('general', 'word_retest', 'transfer', 'withdrawal', 'textbook'\)/)
  assert.match(updateSql, /v_after\.type = 'textbook'[\s\S]*insert_ops_task_activity_event_v1\([\s\S]*'updated'/)
  assert.match(statusSql, /v_before\.type not in \('general', 'word_retest', 'transfer', 'withdrawal', 'textbook'\)/)
  assert.match(statusSql, /v_after\.type = 'textbook'[\s\S]*insert_ops_task_activity_event_v1\([\s\S]*'status_changed'/)
  for (const rpcBlock of [createSql, updateSql, statusSql]) {
    assert.match(rpcBlock, /'activityEventId'/)
    assert.match(rpcBlock, /'sourceEventIds', v_source_event_ids/)
  }

  assert.match(createService, /input\.type === "general" \|\| input\.type === "word_retest" \|\| input\.type === "textbook"/)
  assert.match(updateService, /input\.type === "general" \|\| input\.type === "word_retest" \|\| input\.type === "textbook"/)
  assert.match(statusService, /currentTask\.type === "general" \|\| currentTask\.type === "word_retest" \|\| currentTask\.type === "textbook"/)
  for (const serviceBlock of [createService, updateService, statusService]) {
    assert.match(serviceBlock, /producerActivityEventId\(response\)/)
    assert.match(serviceBlock, /activityEventId[\s\S]*\{ activityEventId \}/)
  }
})

test("등록·전반·퇴원·교재 댓글도 같은 멱등 RPC에서 작성자 권한과 댓글 UUID를 고정한다", async () => {
  const sql = await source(migrationUrl)
  const comment = block(
    sql,
    "create or replace function dashboard_private.add_ops_task_comment_v2_impl",
    "alter table public.ops_task_events",
  )

  assert.match(comment, /assert_ops_task_actor_v2\(v_task, null\)/)
  assert.match(comment, /ops_task_request_replay_v2/)
  assert.match(comment, /finish_ops_task_request_v2/)
  assert.doesNotMatch(comment, /registration_dedicated_service_required/)
  assert.match(comment, /'general', 'word_retest', 'registration', 'transfer', 'withdrawal', 'textbook'/)
  assert.match(comment, /'sourceId', v_comment\.id/)
})

test("일반 할 일과 단어 재시험은 서로 다른 workflow와 허용된 세부 이벤트만 생산한다", async () => {
  const sql = await source(migrationUrl)
  const recorder = block(
    sql,
    "create or replace function dashboard_private.record_ops_task_notification_source_v2",
    "create or replace function dashboard_private.retry_word_retest_v1_impl",
  )

  assert.match(recorder, /case when p_task\.type = 'word_retest' then 'word_retests' else 'tasks' end/)
  assert.match(recorder, /case when p_task\.type = 'word_retest' then 'word_retest'/)
  assert.match(recorder, /else 'task'/)
  assert.match(recorder, /dashboard_private\.record_notification_event_v1\(/)
  assert.match(recorder, /'ops_task_event'/)
  assert.match(recorder, /'ops_task_comment'/)
  assert.match(recorder, /requester_profile_id/)
  assert.match(recorder, /requesting_teacher_profile_id/)
  assert.match(recorder, /management_profile_ids/)
  assert.doesNotMatch(recorder, /workflow_key[^\n]*registration/)
  assert.match(sql, /'before_assignee'[\s\S]*'primary_profile_id'[\s\S]*'secondary_profile_id'[\s\S]*'team'/)
  assert.match(sql, /'after_assignee'[\s\S]*'primary_profile_id'[\s\S]*'secondary_profile_id'[\s\S]*'team'/)
  assert.match(sql, /'before_schedule'[\s\S]*'test_at'[\s\S]*'start_at'[\s\S]*'due_at'/)
  assert.match(sql, /'after_schedule'[\s\S]*'test_at'[\s\S]*'start_at'[\s\S]*'due_at'/)

  for (const eventKey of [
    "task.created", "task.assignee_changed", "task.due_changed", "task.status_changed",
    "task.completed", "task.canceled", "task.reopened", "task.comment_added",
    "word_retest.created", "word_retest.assigned", "word_retest.schedule_changed",
    "word_retest.started", "word_retest.result_reported", "word_retest.absent_reported",
    "word_retest.revision_requested", "word_retest.retry_created", "word_retest.completed",
    "word_retest.canceled",
  ]) assert.ok(sql.includes(`'${eventKey}'`), `이벤트 매핑 누락: ${eventKey}`)
})

test("생성·수정·상태·댓글은 업무 원본과 canonical 이벤트를 같은 함수 트랜잭션에서 기록한다", async () => {
  const sql = await source(migrationUrl)
  const functions = [
    ["create_ops_task_v2_impl", "update_ops_task_v2_impl"],
    ["update_ops_task_v2_impl", "transition_ops_task_status_v2_impl"],
    ["transition_ops_task_status_v2_impl", "add_ops_task_comment_v2_impl"],
    ["add_ops_task_comment_v2_impl", "retry_word_retest_v1_impl"],
  ]
  for (const [name, next] of functions) {
    const body = block(
      sql,
      `create or replace function dashboard_private.${name}`,
      `create or replace function dashboard_private.${next}`,
    )
    assert.match(body, /ops_task_request_replay_v2/)
    assert.match(body, /finish_ops_task_request_v2/)
    assert.match(body, /record_ops_task_notification_source_v2/)
    assert.match(body, /sourceEventIds/)
  }
  assert.match(sql, /p_expected_updated_at[\s\S]*ops_task_stale_write/)
})

test("재시험 재생성은 이전 업무 완료·양방향 연결·새 업무 생성·두 원본 이벤트를 원자적으로 처리한다", async () => {
  const sql = await source(migrationUrl)
  const retry = block(
    sql,
    "create or replace function dashboard_private.retry_word_retest_v1_impl",
    "create or replace function dashboard_private.report_word_retest_result_v1_impl",
  )

  assert.match(sql, /add column if not exists retry_of_task_id uuid/)
  assert.match(sql, /add column if not exists retry_task_id uuid/)
  assert.match(retry, /for update of previous_task/)
  assert.match(retry, /status = 'done'/)
  assert.match(retry, /retry_task_id = v_new_task\.id/)
  assert.match(retry, /retry_of_task_id/)
  assert.match(retry, /'word_retest\.completed'/)
  assert.match(retry, /'word_retest\.retry_created'/)
  assert.match(retry, /sourceEventIds/)
})

test("재재시험 RPC는 미응시 원본·이전 날짜·연결 자식 마감 예외를 보존한다", async () => {
  const sql = await source(reretryMigrationUrl)

  assert.match(sql, /create or replace function dashboard_private\.retry_word_retest_v1_impl/)
  assert.match(sql, /v_previous_detail\.retest_status = 'absent'/)
  assert.match(sql, /coalesce\(nullif\(v_detail ->> 'test_at', ''\), v_previous_detail\.test_at::text\)/)
  assert.doesNotMatch(sql, /set retest_status = 'done'[\s\S]*where detail\.task_id = p_previous_task_id/)
  assert.match(sql, /v_detail\.retry_of_task_id is not null[\s\S]*word_retest_absent_deadline_not_allowed/)
  assert.match(sql, /word_retest\.completed/)
  assert.match(sql, /word_retest\.retry_created/)
  assert.doesNotMatch(sql, /ops_task_notification_producers_runtime_version[\s\S]*return 2/)
})

test("완료된 미응시 원본 복구는 완료 시각을 보존하고 완료 이벤트를 중복 기록하지 않는다", async () => {
  const sql = await source(reretryMigrationUrl)
  const retry = block(
    sql,
    "create or replace function dashboard_private.retry_word_retest_v1_impl",
    "create or replace function dashboard_private.report_word_retest_absent_v1_impl",
  )

  assert.match(
    retry,
    /v_previous_task\.status = 'review_requested'[\s\S]*v_previous_detail\.retest_status = 'absent'[\s\S]*v_previous_task\.status = 'done'[\s\S]*v_previous_detail\.retest_status = 'absent'/,
  )
  assert.match(
    retry,
    /set status = 'done', completed_at = coalesce\(task\.completed_at, pg_catalog\.clock_timestamp\(\)\)/,
  )
  assert.match(
    retry,
    /if v_previous_status <> 'done' then[\s\S]*'word_retest\.completed'[\s\S]*v_source_event_ids :=[\s\S]*end if;[\s\S]*'word_retest\.retry_created'/,
  )
})

test("결과·미응시·수정 요청 RPC는 브라우저 수신자 없이 권위 상태와 원본 이벤트를 함께 저장한다", async () => {
  const sql = await source(migrationUrl)
  for (const [name, eventKey] of [
    ["report_word_retest_result_v1_impl", "word_retest.result_reported"],
    ["report_word_retest_absent_v1_impl", "word_retest.absent_reported"],
    ["request_word_retest_revision_v1_impl", "word_retest.revision_requested"],
  ]) {
    const start = sql.indexOf(`create or replace function dashboard_private.${name}`)
    assert.notEqual(start, -1)
    const tail = sql.slice(start)
    assert.match(tail, new RegExp(`'${eventKey.replaceAll(".", "\\.")}'`))
    assert.match(tail, /record_ops_task_notification_source_v2/)
  }
  assert.doesNotMatch(sql, /p_(?:recipient|target|notification_title|notification_body|href)/i)
})

test("단어 재시험은 안전한 최초 상태와 전용 검토·수정 상태 전이만 허용한다", async () => {
  const sql = await source(migrationUrl)
  const insert = block(
    sql,
    "create or replace function dashboard_private.insert_ops_task_from_json_v2",
    "create or replace function dashboard_private.upsert_ops_task_detail_v2",
  )
  const update = block(
    sql,
    "create or replace function dashboard_private.update_ops_task_v2_impl",
    "create or replace function dashboard_private.transition_ops_task_status_v2_impl",
  )
  const transition = block(
    sql,
    "create or replace function dashboard_private.transition_ops_task_status_v2_impl",
    "create or replace function dashboard_private.add_ops_task_comment_v2_impl",
  )

  assert.match(insert, /v_status <> 'requested'[\s\S]*v_retest_status <> 'not_started'/)
  assert.match(insert, /word_retest_initial_state_invalid/)
  assert.match(insert, /first_score[\s\S]*second_score[\s\S]*third_score[\s\S]*score_out_of_100/)
  assert.match(insert, /word_retest_context_required/)
  assert.match(insert, /student_id[\s\S]*student_name[\s\S]*class_id[\s\S]*class_name[\s\S]*teacher_catalog_id[\s\S]*teacher_name[\s\S]*test_at/)
  assert.match(update, /word_retest_score_update_not_allowed/)
  assert.match(update, /perform dashboard_private\.assert_ops_task_actor_v2\(v_after, null\)/)
  assert.match(update, /v_detail_base := pg_catalog\.to_jsonb\(v_before_word\)[\s\S]*- 'retry_of_task_id' - 'retry_task_id'/)
  assert.match(update, /v_detail := coalesce\(v_detail_base, '\{\}'::jsonb\) \|\| v_detail/)
  assert.match(update, /v_after\.student_id::text[\s\S]*v_after\.class_id::text[\s\S]*v_detail ->> 'teacher_catalog_id'[\s\S]*v_detail ->> 'test_at'[\s\S]*word_retest_context_required/)
  assert.match(update, /v_before\.status = 'review_requested'[\s\S]*not in \('review_requested', 'done', 'canceled'\)[\s\S]*word_retest_revision_rpc_required/)
  assert.match(transition, /v_before\.status = 'review_requested'[\s\S]*p_status not in \('review_requested', 'done', 'canceled'\)[\s\S]*word_retest_revision_rpc_required/)
})

test("일정 변경과 취소는 아직 시작하지 않은 알림만 정확한 범위로 무효화한다", async () => {
  const sql = await source(migrationUrl)
  const cancellation = block(
    sql,
    "create or replace function dashboard_private.cancel_ops_task_unsent_work_v1",
    "create or replace function dashboard_private.record_ops_task_notification_source_v2",
  )

  assert.match(cancellation, /event_row\.event_key in \('task\.due_changed', 'word_retest\.schedule_changed'\)/)
  assert.match(cancellation, /job\.status in \('pending', 'claimed'\)/)
  assert.match(cancellation, /delivery\.status in \('pending', 'retry_wait'\)/)
  assert.match(cancellation, /set cancel_requested_at =[\s\S]*delivery\.status = 'claimed'/)
  assert.doesNotMatch(cancellation, /delivery\.status in \([^)]*sending/)
  assert.doesNotMatch(cancellation, /delivery\.status in \([^)]*sent/)
})

test("모든 task·word-retest 규칙은 배포 뒤에도 꺼진 상태를 강제한다", async () => {
  const sql = await source(migrationUrl)
  assert.match(sql, /update dashboard_private\.notification_rules[\s\S]*set enabled = false[\s\S]*workflow_key in \('tasks', 'word_retests'\)/)
  assert.match(sql, /ops_task_notification_rules_must_remain_disabled/)
  assert.doesNotMatch(sql, /set enabled = true/)
})

test("클라이언트 서비스는 일반·단어 재시험을 고정 RPC로 보내고 후처리 원본 이벤트를 쓰지 않는다", async () => {
  const [service, workspace] = await Promise.all([source(serviceUrl), source(workspaceUrl)])

  assert.match(service, /create_ops_task_v2/)
  assert.match(service, /update_ops_task_v2/)
  assert.match(service, /transition_ops_task_status_v2/)
  assert.match(service, /add_ops_task_comment_v2/)
  assert.match(service, /crypto\.randomUUID\(\)/)
  assert.match(service, /p_expected_updated_at/)
  assert.match(service, /retry_word_retest_v1/)
  assert.match(service, /report_word_retest_result_v1/)
  assert.match(service, /report_word_retest_absent_v1/)
  assert.match(service, /request_word_retest_revision_v1/)
  assert.match(workspace, /retryWordRetest/)
  assert.match(workspace, /task\.status !== "in_progress"[\s\S]*wordRetest\.retestStatus !== "in_progress"[\s\S]*진행 중인 단어 재시험에서만 점수를 저장할 수 있습니다/)
  assert.match(workspace, /const scoreEditingAllowed = task\.status === "in_progress"[\s\S]*wordRetest\.retestStatus === "in_progress"/)
  assert.match(workspace, /disabled=\{statusActionDisabled \|\| absent \|\| isClosedOpsTask\(task\) \|\| !scoreEditingAllowed\}/)

  const retryFlow = block(
    workspace,
    "if (isWordRetestRetry",
    "const createWordRetestStudentIds",
  )
  assert.match(retryFlow, /retryWordRetest\(/)
  assert.doesNotMatch(retryFlow, /updateOpsTask\(/)
  assert.doesNotMatch(retryFlow, /createOpsTask\(/)
})

test("점수 선입력 저장은 시험 시작 전이를 확정한 최신 버전으로 이어서 저장한다", async () => {
  const service = await source(serviceUrl)
  const update = block(
    service,
    "export async function updateOpsTask(",
    "export async function retryWordRetest(",
  )

  assert.match(service, /getWordRetestScoreSavePlan/)
  assert.match(update, /const scoreSavePlan = getWordRetestScoreSavePlan\(existingTask, input\)/)
  assert.match(update, /scoreSavePlan\.requiresStartTransition[\s\S]*transition_ops_task_status_v2/)
  assert.match(update, /p_status: "in_progress"/)
  assert.match(update, /loadOpsTaskById\(taskId\)[\s\S]*p_expected_updated_at: persistedTask\.updatedAt/)
  assert.ok(
    update.indexOf('transition_ops_task_status_v2') < update.indexOf('update_ops_task_v2'),
    "시험 시작을 점수 저장보다 먼저 확정해야 한다",
  )
  assert.match(update, /startSourceEventIds[\s\S]*producerSourceEventIds\(response\)/)
})

test("단어 재시험 계보 링크는 읽기 전용으로 매핑하고 생산 payload에는 포함하지 않는다", async () => {
  const service = await source(serviceUrl)
  const { buildWordRetestRow, mapWordRetest } = loadServiceFunctions([
    block(service, "function mapWordRetest", "function mapComment"),
    block(service, "function buildWordRetestRow", "type OpsTaskProducerResponse"),
  ], ["mapWordRetest", "buildWordRetestRow"], {
    text: (value) => String(value || "").trim(),
    numberText: (value) => value === null || value === undefined ? "" : String(value),
    nullable: (value) => String(value || "").trim() || null,
    nullableDate: (value) => String(value || "").trim() || null,
    nullableNumber: (value) => String(value || "").trim() || null,
  })

  const mapped = mapWordRetest({
    task_id: "task-1",
    retry_of_task_id: "task-0",
    retry_task_id: "task-2",
  })
  assert.equal(mapped.retryOfTaskId, "task-0")
  assert.equal(mapped.retryTaskId, "task-2")

  const row = buildWordRetestRow("task-1", {
    retryOfTaskId: "task-0",
    retryTaskId: "task-2",
  })
  for (const key of ["retryOfTaskId", "retryTaskId", "retry_of_task_id", "retry_task_id"]) {
    assert.equal(key in row, false, `${key} must not be in producer payload`)
  }
})

test("클라이언트는 closure 후 활동 이력·댓글을 테이블에 직접 쓰지 않고 UUID 영수증을 검증한다", async () => {
  const service = await source(serviceUrl)
  const eventWriter = block(
    service,
    "async function writeEvent",
    "async function writeAutoSyncEventOnce",
  )
  const commentWriter = block(
    service,
    "export async function addOpsTaskComment",
    "export async function addOpsTaskAttachment",
  )

  assert.match(eventWriter, /runIdempotentOpsTaskProducerRpc\("record_ops_task_activity_event_v1"/)
  assert.match(eventWriter, /producerSourceEventId\(response\)/)
  assert.doesNotMatch(service, /\.from\("ops_task_events"\)[\s\S]{0,120}\.insert\(/)
  assert.match(commentWriter, /runIdempotentOpsTaskProducerRpc\("add_ops_task_comment_v2"/)
  assert.doesNotMatch(commentWriter, /task\.type === "general" \|\| task\.type === "word_retest"/)
  assert.doesNotMatch(service, /\.from\("ops_task_comments"\)[\s\S]{0,120}\.insert\(/)
  assert.match(commentWriter, /sourceEventIds: producerSourceEventIds\(response\)/)
})

test("생성 실패 서비스는 범용 자식 DELETE 없이 생성 시각이 고정된 정리 RPC만 호출한다", async () => {
  const service = await source(serviceUrl)
  const cleanup = block(
    service,
    "async function deleteCreatedOpsTaskOnFailure",
    "function attachOpsTaskCleanupError",
  )

  assert.doesNotMatch(service, /function deleteOpsTaskChildRows/)
  assert.doesNotMatch(cleanup, /\.from\(|\.delete\(/)
  assert.match(cleanup, /runIdempotentOpsTaskProducerRpc\("cleanup_created_ops_task_v1"/)
  assert.match(cleanup, /p_task_id: taskId[\s\S]*p_expected_created_at: expectedCreatedAt/)
  assert.match(cleanup, /producerCleanupDeleted\(response, taskId\)/)

  const calls = []
  let validReceipt = true
  const functions = loadServiceFunctions([
    block(service, "function producerCleanupDeleted", "export type OpsTaskProducerReceipt"),
    cleanup,
  ], ["deleteCreatedOpsTaskOnFailure"], {
    supabase: {},
    text: (value) => String(value || "").trim(),
    runIdempotentOpsTaskProducerRpc: async (name, parameters) => {
      calls.push({ name, parameters })
      return validReceipt
        ? { taskId: "task-1", deleted: true }
        : { taskId: "task-1", deleted: false }
    },
  })

  assert.equal(
    await functions.deleteCreatedOpsTaskOnFailure("task-1", "2026-07-17T00:00:00.000Z"),
    null,
  )
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{
    name: "cleanup_created_ops_task_v1",
    parameters: {
      p_task_id: "task-1",
      p_expected_created_at: "2026-07-17T00:00:00.000Z",
    },
  }])

  validReceipt = false
  const cleanupError = await functions.deleteCreatedOpsTaskOnFailure(
    "task-1",
    "2026-07-17T00:00:00.000Z",
  )
  assert.match(cleanupError.message, /생성 실패 업무 정리 결과를 확인하지 못했습니다/)
})

test("활동 이력·댓글 서비스는 RPC 영수증의 UUID를 확인한 뒤 결과를 반환한다", async () => {
  const service = await source(serviceUrl)
  const eventId = "11111111-1111-4111-8111-111111111111"
  const commentId = "22222222-2222-4222-8222-222222222222"
  const calls = []
  let invalidEventReceipt = false
  const functions = loadServiceFunctions([
    block(service, "async function writeEvent", "async function writeAutoSyncEventOnce"),
    block(service, "const OPS_TASK_SOURCE_UUID_PATTERN", "export type OpsTaskProducerReceipt"),
    block(service, "export async function addOpsTaskComment", "export async function addOpsTaskAttachment"),
  ], ["writeEvent", "addOpsTaskComment"], {
    supabase: {},
    nullable: (value) => String(value || "").trim() || null,
    text: (value) => String(value || "").trim(),
    loadOpsTaskById: async () => ({ id: "task-1", type: "registration" }),
    clearOpsTaskWorkspaceDataCache: () => {},
    producerSourceEventIds: (response) => Array.isArray(response.sourceEventIds)
      ? response.sourceEventIds
      : [],
    runIdempotentOpsTaskProducerRpc: async (name, parameters) => {
      calls.push({ name, parameters })
      if (name === "record_ops_task_activity_event_v1") {
        return { sourceEventId: invalidEventReceipt ? "invalid" : eventId }
      }
      return {
        comment: {
          id: commentId,
          task_id: "task-1",
          author_id: "33333333-3333-4333-8333-333333333333",
          body: "확인 댓글",
          created_at: "2026-07-17T00:00:00.000Z",
        },
        sourceId: commentId,
        sourceEventIds: [],
      }
    },
  })

  assert.equal(
    await functions.writeEvent("task-1", "manual_checked", "수납 완료 확인", "", "완료"),
    eventId,
  )
  const commentReceipt = await functions.addOpsTaskComment("task-1", "확인 댓글")
  assert.equal(commentReceipt.comment.id, commentId)
  assert.deepEqual(Array.from(commentReceipt.sourceEventIds), [])
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    {
      name: "record_ops_task_activity_event_v1",
      parameters: {
        p_task_id: "task-1",
        p_event_type: "manual_checked",
        p_field_name: "수납 완료 확인",
        p_before_value: null,
        p_after_value: "완료",
      },
    },
    {
      name: "add_ops_task_comment_v2",
      parameters: { p_task_id: "task-1", p_body: "확인 댓글" },
    },
  ])

  invalidEventReceipt = true
  await assert.rejects(
    functions.writeEvent("task-1", "manual_checked", "수납 완료 확인", "", "완료"),
    /저장된 업무 이력 ID를 확인하지 못했습니다/,
  )
})

test("등록 legacy 경로는 커밋 뒤 파생 created·updated·status 이벤트를 별도 activity RPC로 꾸미지 않는다", async () => {
  const service = await source(serviceUrl)
  const createService = block(service, "export async function createOpsTask(", "async function updateRegistrationTaskParent")
  const updateService = block(service, "export async function updateOpsTask(", "export async function retryWordRetest")
  const statusService = block(service, "export async function updateOpsTaskStatus(", "async function rollbackRegistrationWaitlistRemovalAfterFailure")

  assert.doesNotMatch(service, /async function writeCommittedEvent/)
  assert.doesNotMatch(createService, /writeEvent\(taskId, "created"/)
  assert.doesNotMatch(updateService, /writeEvent\(taskId, "updated"/)
  assert.doesNotMatch(statusService, /writeEvent\(currentTask\.id, "(?:status_changed|revision_requested)"/)
})

test("클라이언트 서비스는 모든 실제 알림 원본 ID를 타입이 있는 receipt로 보존한다", async () => {
  const service = await source(serviceUrl)
  const create = block(service, "export async function createOpsTransitionTask", "async function updateRegistrationTaskParent")
  const update = block(service, "export async function updateOpsTask(", "export async function retryWordRetest")
  const wordActions = block(service, "export async function retryWordRetest", "async function updateOpsTaskStatusRow")
  const status = block(service, "export async function updateOpsTaskStatus(", "async function rollbackRegistrationWaitlistRemovalAfterFailure")
  const comment = block(service, "export async function addOpsTaskComment", "export async function addOpsTaskAttachment")

  assert.match(service, /export type OpsTaskProducerReceipt = Readonly<\{[\s\S]*taskId: string[\s\S]*sourceEventIds: string\[\]/)
  assert.match(service, /export type OpsTaskSourceEventReceipt = Readonly<\{[\s\S]*sourceEventIds: string\[\]/)
  assert.match(service, /export type OpsTaskProducerReceipt = Readonly<\{[\s\S]*activityEventId\?: string/)
  assert.match(service, /export type OpsTaskSourceEventReceipt = Readonly<\{[\s\S]*activityEventId\?: string/)
  assert.match(service, /export type OpsTaskCommentReceipt = Readonly<\{[\s\S]*comment: OpsTaskComment[\s\S]*sourceEventIds: string\[\]/)

  assert.match(create, /createOpsTask\([\s\S]*Promise<OpsTaskProducerReceipt>/)
  assert.match(create, /taskId: producerTaskId\(response\)[\s\S]*sourceEventIds: producerSourceEventIds\(response\)/)
  assert.match(update, /Promise<OpsTaskSourceEventReceipt>/)
  assert.match(update, /update_ops_task_v2[\s\S]*sourceEventIds: \[\.\.\.startSourceEventIds, \.\.\.producerSourceEventIds\(response\)\]/)
  assert.match(update, /completionSourceEventIds[\s\S]*sourceEventIds: \[\.\.\.sourceEventIds, \.\.\.\(completionSourceEventIds \|\| \[\]\)\]/)

  for (const rpc of [
    "retry_word_retest_v1",
    "report_word_retest_result_v1",
    "report_word_retest_absent_v1",
    "request_word_retest_revision_v1",
  ]) {
    const rpcIndex = wordActions.indexOf(`"${rpc}"`)
    assert.notEqual(rpcIndex, -1, `word action RPC 누락: ${rpc}`)
    assert.match(wordActions.slice(rpcIndex), /producerSourceEventIds\(response\)/)
  }
  assert.match(status, /return requestWordRetestRevision\(/)
  assert.match(status, /transition_ops_task_status_v2[\s\S]*sourceEventIds: producerSourceEventIds\(response\)/)
  assert.match(comment, /Promise<OpsTaskCommentReceipt>/)
  assert.match(comment, /comment:[\s\S]*sourceEventIds: producerSourceEventIds\(response\)/)
  assert.match(comment, /producerCommentSourceId\(response, commentId\)/)
  assert.doesNotMatch(comment, /sourceEventIds: \[\]/)
})

test("업무 화면은 생성·수정·상태·재시험 전용 동작·댓글 receipt를 legacy bridge까지 전달한다", async () => {
  const workspace = await source(workspaceUrl)
  const quickAdd = block(workspace, "const submitQuickAdd", "async function retryPendingRegistrationVisitNotifications")
  const submitForm = block(workspace, "const submitForm", "const handleFormKeyDown")
  const changeStatus = block(workspace, "const changeStatus", "const updateWithdrawalChecklist")
  const wordFlow = block(workspace, "const updateWordRetestFlow", "const submitWordRetestCompletion")
  const undo = block(workspace, "const undoStatusChange", "const submitAttachment")

  assert.match(quickAdd, /const receipt = await createOpsTask\(/)
  assert.match(quickAdd, /const taskId = receipt\.taskId/)
  assert.match(quickAdd, /dispatchLegacyOpsTaskSources\(receipt\.sourceEventIds, notificationSessionToken\)/)

  assert.match(submitForm, /const retryReceipt = await retryWordRetest\(/)
  assert.match(submitForm, /legacyOpsTaskSourceEventIds\.push\(\.\.\.receipt\.sourceEventIds\)/)
  assert.match(submitForm, /dispatchLegacyOpsTaskSources\(retryReceipt\.sourceEventIds, notificationSessionToken\)/)
  assert.match(changeStatus, /const receipt = await updateOpsTaskStatus\(/)
  assert.match(changeStatus, /\.\.\.receipt\.sourceEventIds/)

  assert.match(wordFlow, /await reportWordRetestResult\(/)
  assert.match(wordFlow, /await reportWordRetestAbsent\(/)
  assert.match(wordFlow, /dispatchLegacyOpsTaskSources\(receipt\.sourceEventIds, notificationSessionToken\)/)
  assert.match(undo, /const receipt = await addOpsTaskComment\(/)
  assert.match(undo, /const comment = receipt\.comment/)
  assert.match(undo, /dispatchLegacyOpsTaskSources\(receipt\.sourceEventIds, notificationSessionToken\)/)

  const dispatch = block(
    workspace,
    "async function dispatchLegacyOpsTaskSource",
    "function WithdrawalNotificationSettingsDialog",
  )
  assert.match(dispatch, /Promise\.allSettled/)
  assert.match(dispatch, /dispatchLegacyOpsTaskSource/)
})

test("클라이언트는 응답 유실 재시도에 같은 요청 ID를 쓰고 저장소에는 지문만 남긴다", async () => {
  const service = await source(serviceUrl)

  assert.match(service, /crypto\.subtle\.digest\("SHA-256"/)
  assert.match(service, /delete logicalParameters\.p_expected_updated_at/)
  assert.match(service, /OPS_TASK_PRODUCER_ATTEMPT_TTL_MS = 24 \* 60 \* 60 \* 1000/)
  assert.match(service, /expectedUpdatedAt\?: string/)
  assert.match(service, /sessionStorage\.setItem\(key, JSON\.stringify\(attempt\)\)/)
  assert.match(service, /attempt\.expectedUpdatedAt[\s\S]*p_expected_updated_at: attempt\.expectedUpdatedAt[\s\S]*p_request_id: attempt\.requestId/)
  assert.match(service, /definitiveConflict[\s\S]*clearOpsTaskProducerAttempt/)
  assert.doesNotMatch(service, /sessionStorage\.setItem\([^\n]*JSON\.stringify\(parameters\)/)
  for (const rpc of [
    "create_ops_task_v2",
    "update_ops_task_v2",
    "transition_ops_task_status_v2",
    "add_ops_task_comment_v2",
    "retry_word_retest_v1",
    "report_word_retest_result_v1",
    "report_word_retest_absent_v1",
    "request_word_retest_revision_v1",
  ]) assert.ok(service.includes(`runIdempotentOpsTaskProducerRpc("${rpc}"`), `멱등 호출 누락: ${rpc}`)
})
