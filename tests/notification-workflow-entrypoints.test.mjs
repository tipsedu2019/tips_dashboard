import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const verifierUrl = new URL("../scripts/verify-notification-workflow-entrypoints.mjs", import.meta.url)

test("일곱 업무 화면은 공통 설정 surface와 고정 adapter key를 정확히 한 번 사용한다", async () => {
  const verifier = await import(verifierUrl.href)
  const evidence = verifier.NOTIFICATION_WORKFLOW_ENTRYPOINTS.map((entry) => ({
    ...entry,
    commonPanelCount: 1,
    routeLocalDialogCount: 0,
    providerPostCount: 0,
    legacySourceBridgeCount: 0,
  }))
  assert.equal(verifier.NOTIFICATION_WORKFLOW_ENTRYPOINTS.length, 7)
  assert.deepEqual(verifier.verifyNotificationWorkflowEntrypoints(evidence), {
    passed: true,
    blockers: [],
  })
})

test("설정 열기·저장 evidence에 provider 또는 source bridge가 있으면 실패한다", async () => {
  const verifier = await import(verifierUrl.href)
  const evidence = verifier.NOTIFICATION_WORKFLOW_ENTRYPOINTS.map((entry) => ({
    ...entry,
    commonPanelCount: 1,
    routeLocalDialogCount: 0,
    providerPostCount: entry.workflowKey === "tasks" ? 1 : 0,
    legacySourceBridgeCount: entry.workflowKey === "approvals" ? 1 : 0,
  }))
  assert.deepEqual(verifier.verifyNotificationWorkflowEntrypoints(evidence), {
    passed: false,
    blockers: [
      "settings_provider_call:tasks",
      "settings_legacy_bridge_call:approvals",
    ],
  })
})

test("정적 entry-point scan은 provider POST와 route-local 알림 dialog를 찾지 않는다", async () => {
  const verifier = await import(verifierUrl.href)
  const result = await verifier.scanNotificationWorkflowEntrypoints(new URL("../", import.meta.url))
  assert.deepEqual(result.blockers, [])
  assert.equal(result.entrypoints.length, 7)

  const script = await readFile(verifierUrl, "utf8")
  assert.match(script, /--base-url/)
  assert.match(script, /providerRequests/)
  assert.match(script, /390/)
  assert.match(script, /844/)
})

test("runtime request observer는 provider endpoint 호출을 실제로 기록한다", async () => {
  const verifier = await import(verifierUrl.href)
  const calls = []
  const observer = verifier.createNotificationProviderRequestObserver(async (input, init) => {
    calls.push({ input: String(input), init })
    return new Response("{}", { status: 200 })
  })

  await observer.fetch("http://127.0.0.1:3012/admin/tasks")
  await observer.fetch("https://chat.googleapis.com/v1/spaces/example/messages", { method: "POST" })

  assert.equal(calls.length, 2)
  assert.deepEqual(observer.providerRequests, [{
    method: "POST",
    origin: "https://chat.googleapis.com",
    pathname: "/v1/spaces/example/messages",
  }])
})

test("settings open/save evidence는 관측 provider와 legacy bridge가 모두 0이어야 한다", async () => {
  const verifier = await import(verifierUrl.href)
  const evidence = verifier.NOTIFICATION_WORKFLOW_ENTRYPOINTS.map((entry) => ({
    ...entry,
    commonPanelCount: 1,
    routeLocalDialogCount: 0,
    providerPostCount: 0,
    legacySourceBridgeCount: 0,
  }))

  assert.deepEqual(verifier.verifyNotificationWorkflowEntrypoints(evidence), {
    passed: true,
    blockers: [],
  })
})
