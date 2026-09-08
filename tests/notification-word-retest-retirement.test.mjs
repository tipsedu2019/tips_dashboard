import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"
import * as types from "../src/features/notifications/notification-control-plane-types.ts"
import { createGoogleChatProvider } from "../src/features/notifications/server/providers/google-chat-provider.ts"
import { selectEditableGoogleChatRules } from "../src/features/notifications/notification-google-chat-settings.ts"

test("Google Chat settings omit word retests while keeping historical workflow identities readable", async () => {
  assert.deepEqual(types.NOTIFICATION_GOOGLE_CHAT_WORKFLOW_OPTIONS?.map(({ key }) => key), [
    "tasks", "registration", "transfer", "withdrawal", "makeup_requests", "approvals",
  ])
  assert.ok(types.NOTIFICATION_EVENT_KEYS_BY_WORKFLOW.word_retests.includes("word_retest.result_reported"))
  const panel = await readFile(new URL("../src/features/notifications/notification-control-panel.tsx", import.meta.url), "utf8")
  const workspace = await readFile(new URL("../src/features/notifications/notification-settings-workspace.tsx", import.meta.url), "utf8")
  assert.match(panel, /NOTIFICATION_GOOGLE_CHAT_WORKFLOW_OPTIONS\.map/)
  assert.doesNotMatch(workspace, /영어 단어 재시험/)
  assert.deepEqual(selectEditableGoogleChatRules([
    { id: "retired", channelKey: "google_chat", workflowKey: "word_retests" },
    { id: "registration", channelKey: "google_chat", workflowKey: "registration" },
  ]).map(({ id }) => id), ["registration"])
})

test("the Google Chat transport refuses retired word retest deliveries before HTTP", async () => {
  let requests = 0
  const provider = createGoogleChatProvider({ fetch: async () => {
    requests += 1
    return new Response(JSON.stringify({ name: "spaces/test/messages/test" }), { status: 200 })
  } })
  const result = await provider.send({
    delivery_id: "99700000-0000-4000-8000-000000000001",
    claim_token: "99700000-0000-4000-8000-000000000002",
    dispatch_token: "99700000-0000-4000-8000-000000000003",
    status: "sending", channel_key: "google_chat", workflow_key: "word_retests",
    connection_key: "google_chat.management",
    webhook_url: "https://chat.googleapis.com/v1/spaces/test/messages?key=test&token=test",
    rendered_title: "단어 재시험", rendered_body: "재시험 결과가 등록됐습니다.",
    href: "/admin/word-retests?taskId=99700000-0000-4000-8000-000000000004",
  })
  assert.equal(result.errorCode, "word_retest_google_chat_retired")
  assert.equal(requests, 0)
  assert.equal(result.providerMessageId, null)
})
