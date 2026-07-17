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
