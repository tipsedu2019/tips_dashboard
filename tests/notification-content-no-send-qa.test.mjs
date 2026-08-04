import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import test from "node:test"

const runnerUrl = new URL("../scripts/run-notification-content-no-send-qa.mjs", import.meta.url)
const dbEvidenceUrl = new URL("../scripts/notification-content-db-evidence.mjs", import.meta.url)

test("provider-zero lane은 모든 golden identity를 렌더링하고 Google Chat만 정확한 가짜 payload로 보낸다", async () => {
  const { runNotificationContentNoSendQa } = await import(runnerUrl.href)
  const evidence = await runNotificationContentNoSendQa()

  assert.equal(evidence.passed, true)
  assert.equal(evidence.goldenIdentityCount, 185)
  assert.equal(evidence.renderedIdentityCount, evidence.goldenIdentityCount)
  assert.equal(evidence.googleChatIdentityCount, 59)
  assert.equal(evidence.fakeFormattingTransportCallCount, evidence.googleChatIdentityCount)
  assert.equal(evidence.exactPayloadCount, evidence.googleChatIdentityCount)
  assert.equal(evidence.externalRequestCount, 0)
  assert.equal(evidence.providerAttemptRowCount, 0)
  assert.deepEqual(evidence.destinationCounts, {
    "google_chat.management": 47,
    "google_chat.executive": 5,
    "google_chat.english": 7,
    "google_chat.math": 0,
    "google_chat.science": 0,
  })
  assert.equal(evidence.destinationIsolationChecks, evidence.googleChatIdentityCount)
  assert.equal(evidence.cronStarted, false)
  assert.equal(evidence.workerStarted, false)
  assert.deepEqual(evidence.removedConnectionSecrets.sort(), [
    "GOOGLE_CHAT_WEBHOOK_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_URL",
  ])
})

test("process trap은 fetch, node:http.request, node:https.request의 실제 외부 요청을 모두 차단한다", async () => {
  const { installExternalRequestTraps } = await import(runnerUrl.href)
  const trap = installExternalRequestTraps()
  const http = await import("node:http")
  const https = await import("node:https")
  try {
    await assert.rejects(() => fetch("https://example.com"), /notification_external_request_blocked:fetch/)
    assert.throws(() => http.request("http://example.com"), /notification_external_request_blocked:http/)
    assert.throws(() => https.request("https://example.com"), /notification_external_request_blocked:https/)
    assert.deepEqual(trap.attempts.map((attempt) => attempt.transport), ["fetch", "http", "https"])
  } finally {
    trap.restore()
  }
})

test("CLI lane도 별도 프로세스에서 provider-zero JSON만 출력한다", () => {
  const result = spawnSync(process.execPath, ["--experimental-strip-types", runnerUrl.pathname], {
    encoding: "utf8",
    env: {
      ...process.env,
      SUPABASE_SERVICE_ROLE_KEY: "must-not-leak",
      GOOGLE_CHAT_WEBHOOK_URL: "https://chat.googleapis.com/secret",
    },
  })

  assert.equal(result.status, 0, result.stderr)
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /must-not-leak|chat\.googleapis\.com\/secret/u)
  const evidence = JSON.parse(result.stdout)
  assert.equal(evidence.passed, true)
  assert.equal(evidence.externalRequestCount, 0)
  assert.equal(evidence.providerAttemptRowCount, 0)
})

test("DB evidence는 로컬 URL만 허용하고 연결 값은 노출하지 않는다", async () => {
  const { assertLocalDatabaseTarget, redactDatabaseTarget } = await import(dbEvidenceUrl.href)

  assert.equal(
    assertLocalDatabaseTarget("postgresql://postgres:password@127.0.0.1:54322/postgres").hostname,
    "127.0.0.1",
  )
  assert.equal(assertLocalDatabaseTarget("postgres://localhost:54322/postgres").hostname, "localhost")
  assert.throws(
    () => assertLocalDatabaseTarget("postgresql://postgres:password@db.example.supabase.co:5432/postgres"),
    /notification_content_remote_database_refused/,
  )
  assert.equal(
    redactDatabaseTarget("postgresql://postgres:password@127.0.0.1:54322/postgres"),
    "postgresql://[redacted]@127.0.0.1:54322/postgres",
  )
})

test("DB round-trip lane은 v2 저장, reload render, no-op, conflict 보존과 rollback을 분리 보고한다", async () => {
  const { runNotificationContentDbEvidence } = await import(dbEvidenceUrl.href)
  const queryCalls = []
  const evidence = await runNotificationContentDbEvidence({
    mode: "round-trip",
    databaseUrl: "postgresql://postgres:password@127.0.0.1:54322/postgres",
    disposable: true,
    async query({ sql, databaseUrl }) {
      queryCalls.push({ sql, databaseUrl })
      return {
        mode: "round-trip",
        runtimeFlagsAllFalseBefore: true,
        runtimeFlagsAllFalseAfter: true,
        rolledBack: true,
        conflictCode: "notification_revision_conflict",
        conflictPreserved: true,
        noOpPreserved: true,
        titleTemplate: "🌿 [업무 알림] {task_title} 내용을 함께 확인해요",
        bodyTemplate: "[담당] {current_assignee}\n[업무] {task_title}\n[상태] {current_status}\n[안내] 필요한 내용을 한눈에 볼 수 있어요.",
        renderContext: {
          task_title: "2학기 수학 교재 주문",
          current_assignee: "김철수님",
          current_status: "요청됐어요.",
        },
        expectedTitle: "🌿 [업무 알림] 2학기 수학 교재 주문 내용을 함께 확인해요",
        expectedBody: "[담당] 김철수님\n[업무] 2학기 수학 교재 주문\n[상태] 요청됐어요.\n[안내] 필요한 내용을 한눈에 볼 수 있어요.",
        fixtureWrites: { ruleRevisionDelta: 1, templateDelta: 1, auditDelta: 1 },
        operationalDeltas: {
          pendingClaimedSending: 0,
          inbox: 0,
          providerAttempts: 0,
        },
      }
    },
  })

  assert.equal(evidence.passed, true)
  assert.equal(evidence.databaseTarget, "postgresql://[redacted]@127.0.0.1:54322/postgres")
  assert.equal(evidence.renderedTitle, evidence.expectedTitle)
  assert.equal(evidence.renderedBody, evidence.expectedBody)
  assert.deepEqual(evidence.operationalDeltas, {
    pendingClaimedSending: 0,
    inbox: 0,
    providerAttempts: 0,
  })
  assert.equal(queryCalls.length, 1)
  assert.equal(queryCalls[0].databaseUrl.includes("password"), true)
  assert.match(queryCalls[0].sql, /^begin;/iu)
  assert.match(queryCalls[0].sql, /public\.save_notification_control_plane_v2/iu)
  assert.match(queryCalls[0].sql, /notification_revision_conflict/iu)
  assert.match(queryCalls[0].sql, /rollback;\s*$/iu)
  assert.doesNotMatch(JSON.stringify(evidence), /password/u)
})

test("read-only operational lane은 변경 없이 runtime과 운영 delta를 확인한다", async () => {
  const { runNotificationContentDbEvidence } = await import(dbEvidenceUrl.href)
  const evidence = await runNotificationContentDbEvidence({
    mode: "read-only",
    databaseUrl: "postgresql://postgres:password@localhost:54322/postgres",
    async query({ sql }) {
      assert.match(sql, /^begin\s+read\s+only;/iu)
      assert.doesNotMatch(sql, /\b(?:insert|update|delete|truncate)\b/iu)
      assert.match(sql, /rollback;\s*$/iu)
      return {
        mode: "read-only",
        runtimeFlagsAllFalseBefore: true,
        runtimeFlagsAllFalseAfter: true,
        connectionValues: "[redacted]",
        operationalDeltas: {
          pendingClaimedSending: 0,
          inbox: 0,
          providerAttempts: 0,
          audit: 0,
        },
      }
    },
  })

  assert.equal(evidence.passed, true)
  assert.equal(evidence.connectionValues, "[redacted]")
  assert.deepEqual(evidence.operationalDeltas, {
    pendingClaimedSending: 0,
    inbox: 0,
    providerAttempts: 0,
    audit: 0,
  })
})
