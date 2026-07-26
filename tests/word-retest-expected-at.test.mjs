import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import vm from "node:vm"

import ts from "typescript"

const migrationUrl = new URL(
  "../supabase/migrations/20260726035635_word_retest_expected_at.sql",
  import.meta.url,
)
const serviceUrl = new URL("../src/features/tasks/ops-task-service.ts", import.meta.url)
const concurrencyUrl = new URL(
  "../scripts/verify-word-retest-expected-at-concurrency.mjs",
  import.meta.url,
)

async function source(url) {
  return readFile(url, "utf8")
}

function block(input, start, end) {
  const startIndex = input.indexOf(start)
  assert.notEqual(startIndex, -1, `missing start marker: ${start}`)
  const endIndex = input.indexOf(end, startIndex + start.length)
  assert.notEqual(endIndex, -1, `missing end marker: ${end}`)
  return input.slice(startIndex, endIndex)
}

function loadServiceFunctions(snippets, exportNames, context = {}) {
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
    Date,
    Intl,
    Object,
    ...context,
  })
  return sandboxModule.exports
}

test("expected_retest_at은 nullable timestamptz이고 별도 backfill/index 없이 공통 upsert에만 추가된다", async () => {
  const sql = await source(migrationUrl)
  const alter = block(
    sql,
    "alter table public.ops_word_retests",
    "create or replace function dashboard_private.upsert_ops_task_detail_v2",
  )
  const upsert = block(
    sql,
    "create or replace function dashboard_private.upsert_ops_task_detail_v2",
    "create table if not exists dashboard_private.word_retest_expected_update_markers",
  )

  assert.match(sql, /set local lock_timeout = '5s'/)
  assert.match(sql, /set local statement_timeout = '120s'/)
  assert.match(alter, /add column if not exists expected_retest_at timestamptz\s*;/)
  assert.doesNotMatch(alter, /not null|default/i)
  assert.doesNotMatch(sql, /create (?:unique )?index[^;]*expected_retest_at/i)
  assert.match(
    upsert,
    /test_at, expected_retest_at, textbook_name[\s\S]*nullif\(p_detail ->> 'test_at', ''\)::timestamptz,\s*nullif\(p_detail ->> 'expected_retest_at', ''\)::timestamptz,[\s\S]*test_at = excluded\.test_at,\s*expected_retest_at = excluded\.expected_retest_at,/,
  )
  assert.match(
    upsert,
    /v_role in \('admin', 'staff', 'assistant'\)[\s\S]*p_detail \? 'expected_retest_at'[\s\S]*'detail_upsert'/,
  )
  assert.match(
    upsert,
    /v_role = 'teacher'[\s\S]*task\.status = 'review_requested'[\s\S]*teacher\.profile_id = v_actor[\s\S]*v_is_linked_teacher_review/,
  )
  assert.match(
    upsert,
    /delete from dashboard_private\.word_retest_expected_update_markers/,
  )
  assert.match(
    sql,
    /update_scope text not null check \(update_scope in \('expected_only', 'detail_upsert'\)\)/,
  )
  assert.match(upsert, /elsif p_type = 'transfer'/)
  assert.match(upsert, /insert into public\.ops_transfer_details/)
  assert.match(upsert, /elsif p_type = 'withdrawal'/)
  assert.match(upsert, /insert into public\.ops_withdrawal_details/)

  for (const producer of [
    "create_ops_task_v2_impl",
    "update_ops_task_v2_impl",
    "retry_word_retest_v1_impl",
  ]) {
    assert.doesNotMatch(sql, new RegExp(`create or replace function dashboard_private\\.${producer}`))
  }
})

test("전용 RPC는 멱등 ledger, parent-child lock order, stale revision, 실제 역할 분기를 직접 강제한다", async () => {
  const sql = await source(migrationUrl)
  const rpc = block(
    sql,
    "create or replace function dashboard_private.update_word_retest_expected_at_v1_impl",
    "create or replace function public.update_word_retest_expected_at_v1",
  )
  const parentLock = rpc.indexOf("for update of task")
  const childLock = rpc.indexOf("for update of detail")

  assert.match(rpc, /p_task_id is null[\s\S]*p_expected_updated_at is null[\s\S]*p_request_id is null/)
  assert.match(rpc, /ops_task_request_replay_v2\([\s\S]*'update_word_retest_expected_at_v1'/)
  assert.ok(parentLock >= 0 && childLock > parentLock, "the parent row must lock before the child row")
  assert.match(rpc, /v_task\.updated_at is distinct from p_expected_updated_at[\s\S]*word_retest_expected_stale_write[\s\S]*errcode = '40001'/)
  assert.match(rpc, /v_task\.status in \('done', 'canceled'\)/)
  assert.match(rpc, /v_role in \('admin', 'staff'\)/)
  assert.match(rpc, /v_role = 'assistant'[\s\S]*\('requested', 'confirmed', 'in_progress', 'on_hold'\)/)
  assert.match(rpc, /v_role = 'teacher'[\s\S]*teacher\.id = v_detail\.teacher_catalog_id[\s\S]*teacher\.profile_id = v_actor/)
  assert.doesNotMatch(rpc, /assert_ops_task_actor_v2/)
  assert.match(rpc, /is distinct from p_expected_retest_at[\s\S]*word_retest_expected_update_markers/)
  assert.match(rpc, /'taskId', v_task\.id[\s\S]*'expectedRetestAt', v_detail\.expected_retest_at[\s\S]*'updatedAt', v_task\.updated_at/)
  assert.match(rpc, /finish_ops_task_request_v2/)

  for (const forbidden of [
    "record_ops_task_notification_source",
    "record_notification_event",
    "notification_events",
    "notification_event_fanout_jobs",
    "notification_deliveries",
    "google_chat",
    "web_push",
    "solapi",
  ]) assert.doesNotMatch(rpc, new RegExp(forbidden, "i"))
  assert.doesNotMatch(sql, /update dashboard_private\.notification_(?:rules|runtime_flags)/i)
  assert.doesNotMatch(sql, /set\s+(?:enabled|dispatch_enabled)\s*=\s*true/i)
})

test("retry 경계와 linked-teacher full-update/delete guard는 예상일시 전용 변경만 허용한다", async () => {
  const sql = await source(migrationUrl)
  const retryTrigger = block(
    sql,
    "create or replace function dashboard_private.clear_word_retest_expected_at_on_retry_link_v1",
    "drop trigger if exists clear_word_retest_expected_at_on_retry_link",
  )
  const guard = block(
    sql,
    "create or replace function dashboard_private.guard_word_retest_expected_only_v1",
    "drop trigger if exists word_retest_expected_only_parent_update_guard",
  )

  assert.match(retryTrigger, /old\.retry_of_task_id is null and new\.retry_of_task_id is not null/)
  assert.match(retryTrigger, /new\.expected_retest_at := null/)
  assert.match(sql, /before update of retry_of_task_id on public\.ops_word_retests/)
  assert.match(guard, /v_role = 'teacher'/)
  assert.match(guard, /teacher\.profile_id = v_actor/)
  assert.match(guard, /v_status not in \('requested', 'confirmed', 'in_progress', 'on_hold'\)/)
  assert.match(guard, /tg_op = 'DELETE'[\s\S]*word_retest_expected_only_required/)
  assert.match(guard, /word_retest_expected_update_markers/)
  assert.match(guard, /v_marker_scope = 'detail_upsert'[\s\S]*v_role in \('admin', 'staff', 'assistant'\)[\s\S]*v_role = 'teacher'[\s\S]*v_status = 'review_requested'[\s\S]*v_is_linked_teacher/)
  assert.match(guard, /v_marker_scope <> 'expected_only'/)
  assert.match(guard, /pg_catalog\.to_jsonb\(new\) - 'updated_at'/)
  assert.match(guard, /pg_catalog\.to_jsonb\(new\) - 'expected_retest_at' - 'updated_at'/)
  assert.match(guard, /old\.retry_of_task_id is null[\s\S]*new\.retry_of_task_id is not null/)
  const directExpectedGuard = guard.indexOf(
    "old.expected_retest_at is distinct from new.expected_retest_at",
  )
  const nonTeacherEarlyReturn = guard.indexOf("if not v_is_linked_teacher")
  assert.ok(
    directExpectedGuard >= 0 && directExpectedGuard < nonTeacherEarlyReturn,
    "all roles must hit the direct expected_retest_at write guard before the generic early return",
  )
  assert.match(sql, /before update on public\.ops_tasks/)
  assert.match(sql, /before delete on public\.ops_tasks/)
  assert.match(sql, /before update on public\.ops_word_retests/)
})

test("공개 wrapper와 marker는 최소 권한 계약을 가진다", async () => {
  const sql = await source(migrationUrl)
  assert.match(
    sql,
    /revoke all on table dashboard_private\.word_retest_expected_update_markers\s+from public, anon, authenticated, service_role/,
  )
  assert.match(
    sql,
    /revoke all on function dashboard_private\.update_word_retest_expected_at_v1_impl\([\s\S]*from public, anon, authenticated, service_role/,
  )
  assert.match(
    sql,
    /revoke all on function public\.update_word_retest_expected_at_v1\([\s\S]*from public, anon, authenticated, service_role/,
  )
  assert.match(
    sql,
    /grant execute on function public\.update_word_retest_expected_at_v1\([\s\S]*\) to authenticated/,
  )
  assert.match(sql, /security definer[\s\S]*set search_path = ''/)
  assert.doesNotMatch(sql, /grant execute[\s\S]*to anon/)
})

test("서비스는 저장 ISO를 매핑하고 서울 minute 입력을 기계 timezone과 무관하게 직렬화한다", async () => {
  const service = await source(serviceUrl)
  const helperSource = block(
    service,
    "export function seoulDateTimeInputToIso",
    "function nullableNumber",
  )
  const mapSource = block(service, "function mapWordRetest", "function mapComment")
  const buildSource = block(service, "function buildWordRetestRow", "type OpsTaskProducerResponse")
  const helpers = loadServiceFunctions(
    [helperSource],
    ["seoulDateTimeInputToIso", "isoToSeoulDateTimeInput"],
    { text: (value) => String(value || "").trim() },
  )
  const { mapWordRetest } = loadServiceFunctions([mapSource], ["mapWordRetest"], {
    text: (value) => String(value || "").trim(),
    numberText: (value) => value === null || value === undefined || value === "" ? "" : String(value),
  })
  const { buildWordRetestRow } = loadServiceFunctions([buildSource], ["buildWordRetestRow"], {
    nullable: (value) => String(value || "").trim() || null,
    nullableDate: (value) => String(value || "").trim() || null,
    nullableNumber: (value) => value === "" || value === undefined ? null : Number(value),
    seoulDateTimeInputToIso: helpers.seoulDateTimeInputToIso,
  })

  assert.equal(
    helpers.seoulDateTimeInputToIso("2026-07-24T19:30"),
    "2026-07-24T10:30:00.000Z",
  )
  assert.equal(
    helpers.isoToSeoulDateTimeInput("2026-07-24T10:30:00.000Z"),
    "2026-07-24T19:30",
  )
  assert.equal(helpers.seoulDateTimeInputToIso(""), "")
  assert.equal(helpers.seoulDateTimeInputToIso("2026-07-24"), "")
  assert.equal(mapWordRetest({ expected_retest_at: "2026-07-24T10:30:00.000Z" }).expectedRetestAt, "2026-07-24T10:30:00.000Z")
  assert.equal(buildWordRetestRow("", { expectedRetestAt: "" }).expected_retest_at, null)
  assert.equal(
    buildWordRetestRow("", { expectedRetestAt: "2026-07-24T19:30" }).expected_retest_at,
    "2026-07-24T10:30:00.000Z",
  )
  assert.match(service, /expected_retest_at: seoulDateTimeInputToIso\(detail\.expectedRetestAt \|\| ""\) \|\| null/)
})

test("전용 서비스 wrapper는 멱등 RPC 응답을 검증하고 clear를 빈 문자열로 정규화하며 cache만 지운다", async () => {
  const service = await source(serviceUrl)
  const wrapper = block(
    service,
    "export async function updateWordRetestExpectedAt",
    "export async function reportWordRetestResult",
  )
  const calls = []
  let cacheClears = 0
  let response = {
    taskId: "task-1",
    expectedRetestAt: "2026-07-24T10:30:00+00:00",
    updatedAt: "2026-07-23T01:00:00.000Z",
  }
  const { updateWordRetestExpectedAt } = loadServiceFunctions(
    [wrapper],
    ["updateWordRetestExpectedAt"],
    {
      text: (value) => String(value || "").trim(),
      seoulDateTimeInputToIso: (value) => value
        ? "2026-07-24T10:30:00.000Z"
        : "",
      runIdempotentOpsTaskProducerRpc: async (name, parameters) => {
        calls.push({ name, parameters })
        return response
      },
      clearOpsTaskWorkspaceDataCache: () => { cacheClears += 1 },
    },
  )

  assert.deepEqual(
    JSON.parse(JSON.stringify(await updateWordRetestExpectedAt({
      taskId: "task-1",
      expectedRetestAt: "2026-07-24T19:30",
      expectedUpdatedAt: "2026-07-23T00:00:00.000Z",
    }))),
    {
      taskId: "task-1",
      expectedRetestAt: "2026-07-24T10:30:00+00:00",
      updatedAt: "2026-07-23T01:00:00.000Z",
    },
  )
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{
    name: "update_word_retest_expected_at_v1",
    parameters: {
      p_task_id: "task-1",
      p_expected_retest_at: "2026-07-24T10:30:00.000Z",
      p_expected_updated_at: "2026-07-23T00:00:00.000Z",
    },
  }])
  assert.equal(cacheClears, 1)

  response = {
    taskId: "task-1",
    expectedRetestAt: null,
    updatedAt: "2026-07-23T02:00:00.000Z",
  }
  const cleared = await updateWordRetestExpectedAt({
    taskId: "task-1",
    expectedRetestAt: "",
    expectedUpdatedAt: "2026-07-23T01:00:00.000Z",
  })
  assert.equal(cleared.expectedRetestAt, "")
  assert.equal(cacheClears, 2)

  response = { taskId: "wrong", expectedRetestAt: null, updatedAt: "invalid" }
  await assert.rejects(
    updateWordRetestExpectedAt({
      taskId: "task-1",
      expectedRetestAt: "",
      expectedUpdatedAt: "2026-07-23T02:00:00.000Z",
    }),
    /저장된 응시예정일시를 확인하지 못했습니다/,
  )
  assert.doesNotMatch(wrapper, /dispatch|sourceEvent|notification/i)
})

test("retry 서비스는 raw input의 이전 예상일시를 명시적으로 제거한다", async () => {
  const service = await source(serviceUrl)
  const retry = block(
    service,
    "export async function retryWordRetest",
    "export async function updateWordRetestExpectedAt",
  )
  const calls = []
  const { retryWordRetest } = loadServiceFunctions([retry], ["retryWordRetest"], {
    runIdempotentOpsTaskProducerRpc: async (name, parameters) => {
      calls.push({ name, parameters })
      return { task: { id: "next-task" }, sourceEventIds: [] }
    },
    buildOpsTaskProducerInput: (input) => input,
    clearOpsTaskWorkspaceDataCache: () => {},
    producerTaskId: (response) => response.task.id,
    producerSourceEventIds: (response) => response.sourceEventIds,
  })
  await retryWordRetest("previous-task", {
    type: "word_retest",
    title: "retry",
    wordRetest: { expectedRetestAt: "2026-07-24T19:30" },
  })
  assert.equal(calls[0].name, "retry_word_retest_v1")
  assert.equal(calls[0].parameters.p_input.wordRetest.expectedRetestAt, "")
})

test("동시성 verifier는 승인 target, 동일 actor 두 client, local barrier, stale-write와 provider-zero DB 증거를 요구한다", async () => {
  const script = await source(concurrencyUrl)
  assert.match(script, /argv\.includes\("--run"\)/)
  for (const flag of ["--url", "--anon-key", "--service-role-key", "--actor-token"]) {
    assert.match(script, new RegExp(flag))
  }
  assert.match(script, /KNOWN_PRODUCTION_HOSTS[\s\S]*slnjqlzzhewblvttiidk\.supabase\.co/)
  assert.match(script, /Unrecognized target abort/)
  assert.match(script, /decodeJwtSubject/)
  assert.match(script, /\["admin", "staff"\]\.includes\(data\.role\)/)
  assert.match(script, /createAuthenticatedClient\(url, anonKey, actorToken\)/g)
  assert.match(script, /createRaceBarrier\(2\)/)
  assert.match(script, /p_expected_updated_at: beforeParent\.updated_at/)
  assert.match(script, /p_request_id: requestId/)
  assert.match(script, /fulfilled\.length, 1/)
  assert.match(script, /rejected\.length, 1/)
  assert.match(script, /rejected\[0\]\.reason\.code, "40001"/)
  assert.match(script, /stale_write/i)
  assert.match(script, /withoutKeys\(afterParent, \["updated_at"\]\)/)
  assert.match(script, /withoutKeys\(afterDetail, \["expected_retest_at", "updated_at"\]\)/)
  for (const table of [
    "ops_task_events",
    "notification_events",
    "notification_event_fanout_jobs",
    "notification_deliveries",
  ]) assert.match(script, new RegExp(table))
  assert.match(script, /detail reverse cleanup[\s\S]*parent reverse cleanup[\s\S]*request-ledger reverse cleanup/)
  assert.match(script, /Word-retest expected-time concurrency proof \(not executed\)/)
})
