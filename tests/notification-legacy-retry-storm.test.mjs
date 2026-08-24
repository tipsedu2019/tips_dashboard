import assert from "node:assert/strict"
import { readFile, readdir } from "node:fs/promises"
import test from "node:test"

const migrationDirectoryUrl = new URL("../supabase/migrations/", import.meta.url)
const sqlReviewWorkflowUrl = new URL(
  "../.github/workflows/supabase-sql-review.yml",
  import.meta.url,
)
const pgTapUrl = new URL(
  "../supabase/tests/legacy_notification_retry_storm_test.sql",
  import.meta.url,
)
const routeUrl = new URL(
  "../src/app/api/notifications/legacy/ops-task/route.ts",
  import.meta.url,
)
const workflowUrl = new URL(
  "../src/features/notifications/server/legacy-notification-workflow.ts",
  import.meta.url,
)

function functionBlock(source, functionName) {
  const start = source.indexOf(`create or replace function public.${functionName}`)
  assert.notEqual(start, -1, `${functionName} 최종 정의가 필요합니다.`)
  const end = source.indexOf("\n$$;", start)
  assert.notEqual(end, -1, `${functionName} 정의 끝을 찾을 수 없습니다.`)
  return source.slice(start, end + 4)
}

test("legacy Google Chat은 이벤트 종류에 맞는 canonical workflow를 provider에 전달한다", async () => {
  let workflowModule = {}
  try {
    workflowModule = await import(workflowUrl)
  } catch {
    // RED 단계에서는 모듈이 아직 없으므로 아래 실제 동작 단언이 실패해야 한다.
  }
  assert.equal(typeof workflowModule.legacyNotificationWorkflowKey, "function")

  for (const [eventKey, expected] of [
    ["task.created", "tasks"],
    ["word_retest.completed", "word_retests"],
    ["registration.case_created", "registration"],
    ["transfer.completed", "transfer"],
    ["withdrawal.completed", "withdrawal"],
  ]) {
    assert.equal(workflowModule.legacyNotificationWorkflowKey(eventKey), expected)
  }

  const route = await readFile(routeUrl, "utf8")
  assert.match(
    route,
    /workflow_key:\s*legacyNotificationWorkflowKey\(item\.eventKey\)/,
    "provider 호출 경계에서 canonical workflow를 빠뜨리면 안 됩니다.",
  )
})

test("legacy 종료 충돌은 40001 자동 재시도를 만들지 않고 닫힌 claim을 재발송하지 않는다", async () => {
  const migrationName = (await readdir(migrationDirectoryUrl)).find((name) =>
    name.endsWith("_notification_legacy_retry_storm.sql"),
  )
  assert.ok(migrationName, "legacy retry storm 순방향 migration이 필요합니다.")

  const [migration, pgTap] = await Promise.all([
    readFile(new URL(migrationName, migrationDirectoryUrl), "utf8"),
    readFile(pgTapUrl, "utf8"),
  ])
  const begin = functionBlock(migration, "begin_legacy_notification_dispatch_v1")
  const finalize = functionBlock(migration, "finalize_legacy_notification_dispatch_v1")

  assert.match(begin, /v_claim\.state\s*=\s*'closed'/i)
  assert.match(begin, /'acquired',\s*false[\s\S]*?'reason',\s*'idempotent_dispatch_replay'/i)
  assert.match(begin, /'status',\s*coalesce\(v_claim\.terminal_outcome,\s*'closed'\)/i)

  assert.match(
    finalize,
    /notification_legacy_ownership_mismatch'[\s\S]*?errcode\s*=\s*'23514'/i,
  )
  assert.match(
    finalize,
    /notification_legacy_finalize_replay_mismatch'[\s\S]*?errcode\s*=\s*'23514'/i,
  )
  assert.doesNotMatch(finalize, /errcode\s*=\s*'40001'/i)

  assert.match(
    migration,
    /revoke\s+all\s+on\s+function\s+public\.finalize_legacy_notification_dispatch_v1[\s\S]*?from\s+public,\s*anon,\s*authenticated/i,
  )
  assert.match(
    migration,
    /grant\s+execute\s+on\s+function\s+public\.finalize_legacy_notification_dispatch_v1[\s\S]*?to\s+service_role/i,
  )

  assert.match(
    pgTap,
    /throws_ok\([\s\S]*?'23514'[\s\S]*?'notification_legacy_finalize_replay_mismatch'/i,
    "pgTAP이 최종 함수의 정확한 SQLSTATE와 오류 이름을 실행 검증해야 합니다.",
  )
  assert.match(
    pgTap,
    /begin_legacy_notification_dispatch_v1[\s\S]*?'acquired'[\s\S]*?false/i,
    "pgTAP이 닫힌 claim의 begin replay를 provider-zero로 검증해야 합니다.",
  )
})

test("PR 필수 검사는 route 회귀와 최종 pgTAP을 실제로 실행한다", async () => {
  const workflow = await readFile(sqlReviewWorkflowUrl, "utf8")
  assert.match(
    workflow,
    /node --test --experimental-strip-types tests\/notification-legacy-retry-storm\.test\.mjs tests\/notification-legacy-retry-storm-route\.test\.mjs/,
  )
  assert.match(
    workflow,
    /--test supabase\/tests\/legacy_notification_retry_storm_test\.sql/,
  )
})
