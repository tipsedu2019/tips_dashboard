import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { pathToFileURL } from "node:url"
import test from "node:test"

const verifierUrl = new URL("../scripts/verify-notification-workflow-entrypoints.mjs", import.meta.url)

async function createEntrypointFixture(t, overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), "notification-entrypoints-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  const files = {
    "src/app/admin/tasks/page.tsx": '<OpsTaskWorkspace workspace="todo" />',
    "src/app/admin/word-retests/page.tsx": '<OpsTaskWorkspace workspace="word_retest" />',
    "src/app/admin/registration/page.tsx": '<OpsTaskWorkspace workspace="registration" />',
    "src/app/admin/transfer/page.tsx": '<OpsTaskWorkspace workspace="transfer" />',
    "src/app/admin/withdrawal/page.tsx": '<OpsTaskWorkspace workspace="withdrawal" />',
    "src/app/admin/makeup-requests/page.tsx": "export default function Page() {}",
    "src/app/admin/approvals/page.tsx": "export default function Page() {}",
    "src/features/tasks/ops-task-workspace.tsx": "export function OpsTaskWorkspace() {}",
    "src/features/makeup-requests/makeup-request-workspace.tsx": "export function MakeupRequestWorkspace() {}",
    "src/features/approvals/approval-workspace.tsx": "export function ApprovalWorkspace() {}",
    "src/app/admin/settings/notifications/page.tsx": "<NotificationSettingsWorkspace />",
    "src/features/notifications/notification-settings-workspace.tsx": '<NotificationControlPanel presentation="page" />',
    "src/features/notifications/notification-control-panel.tsx": "NOTIFICATION_WORKFLOW_OPTIONS.map(() => data-notification-workflow={activeWorkflow})",
    "src/features/notifications/notification-control-plane-types.ts": [
      "tasks",
      "word_retests",
      "registration",
      "transfer",
      "withdrawal",
      "makeup_requests",
      "approvals",
    ].map((key) => `key: "${key}"`).join("\n"),
    "src/lib/navigation.ts": '{ title: "알림 설정", url: "/admin/settings/notifications" }',
    "src/app/api/google-chat/route.ts": "notification_payload_forbidden sourceEventId",
    "src/app/api/web-push/route.ts": "notification_payload_forbidden",
    ...overrides,
  }
  for (const [relativePath, source] of Object.entries(files)) {
    const absolutePath = join(root, relativePath)
    await mkdir(dirname(absolutePath), { recursive: true })
    await writeFile(absolutePath, source, "utf8")
  }
  return pathToFileURL(`${root}/`)
}

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

test("정적 scan은 공통 panel 이름을 쓰지 않는 route-local 알림 설정 dialog도 차단한다", async (t) => {
  const verifier = await import(verifierUrl.href)
  const rootUrl = await createEntrypointFixture(t, {
    "src/features/makeup-requests/makeup-request-workspace.tsx": `
      export function MakeupRequestWorkspace() {
        const [notificationDialogOpen] = useState(false)
        return <Dialog open={notificationDialogOpen}><DialogTitle>알림 설정</DialogTitle></Dialog>
      }
    `,
  })

  const result = await verifier.scanNotificationWorkflowEntrypoints(rootUrl)
  assert.deepEqual(result.blockers, ["route_local_dialog:makeup_requests"])
})

test("정적 scan은 entry page에 직접 추가된 알림 설정 dialog도 차단한다", async (t) => {
  const verifier = await import(verifierUrl.href)
  const rootUrl = await createEntrypointFixture(t, {
    "src/app/admin/approvals/page.tsx": `
      export default function Page() {
        return <Dialog open={notificationDialogOpen}><DialogTitle>알림 설정</DialogTitle></Dialog>
      }
    `,
  })

  const result = await verifier.scanNotificationWorkflowEntrypoints(rootUrl)
  assert.deepEqual(result.blockers, ["route_local_dialog:approvals"])
})

test("정적 scan은 우회 형태의 route-local Google Chat API 재도입도 차단한다", async (t) => {
  const verifier = await import(verifierUrl.href)
  const rootUrl = await createEntrypointFixture(t, {
    "src/features/makeup-requests/makeup-request-workspace.tsx": `
      const googleChatEndpoint = "/api/google-chat"
      const patchInit = { method: "PATCH" }

      function request(url, init) {
        return fetch(url, init)
      }

      export async function saveLegacyGoogleChatWebhook(webhookUrl) {
        return request(googleChatEndpoint, {
          ...patchInit,
          body: JSON.stringify({ webhookUrl }),
        })
      }
    `,
  })

  const result = await verifier.scanNotificationWorkflowEntrypoints(rootUrl)
  assert.deepEqual(result.blockers, ["settings_provider_call:makeup_requests"])
})

test("정적 scan은 별도 helper로 숨긴 Google Chat API 재도입도 차단한다", async (t) => {
  const verifier = await import(verifierUrl.href)
  const rootUrl = await createEntrypointFixture(t, {
    "src/features/makeup-requests/makeup-request-workspace.tsx": `
      import { saveLegacyGoogleChatWebhook } from "../notifications/legacy-google-chat-client"

      export function MakeupRequestWorkspace() {
        return <button onClick={() => saveLegacyGoogleChatWebhook("legacy")}>save</button>
      }
    `,
    "src/features/notifications/legacy-google-chat-client.ts": `
      const googleChatEndpoint = "/api/google-chat"
      const patchInit = { method: "PATCH" }

      function request(url, init) {
        return fetch(url, init)
      }

      export function saveLegacyGoogleChatWebhook(webhookUrl) {
        return request(googleChatEndpoint, {
          ...patchInit,
          body: JSON.stringify({ webhookUrl }),
        })
      }
    `,
  })

  const result = await verifier.scanNotificationWorkflowEntrypoints(rootUrl)
  assert.deepEqual(result.blockers, [
    "settings_provider_call:source:src/features/notifications/legacy-google-chat-client.ts",
  ])
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
