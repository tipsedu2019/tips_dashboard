import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"
import * as types from "../src/features/notifications/notification-control-plane-types.ts"
import { createGoogleChatProvider } from "../src/features/notifications/server/providers/google-chat-provider.ts"
import { selectEditableGoogleChatRules } from "../src/features/notifications/notification-google-chat-settings.ts"
import { getNotificationContentContract } from "../src/features/notifications/notification-content-contract-registry.ts"

const englishResultContract = getNotificationContentContract({ workflowKey: "word_retests", eventKey: "word_retest.result_reported", audienceKey: "subject_team", channelKey: "google_chat", ruleVariantKey: "immediate" })

test("Google Chat settings expose only the English subject result rule from word retests", async () => {
  assert.deepEqual(types.NOTIFICATION_GOOGLE_CHAT_WORKFLOW_OPTIONS?.map(({ key }) => key), [
    "tasks", "word_retests", "registration", "transfer", "withdrawal", "makeup_requests", "approvals",
  ])
  assert.ok(types.NOTIFICATION_EVENT_KEYS_BY_WORKFLOW.word_retests.includes("word_retest.result_reported"))
  const panel = await readFile(new URL("../src/features/notifications/notification-control-panel.tsx", import.meta.url), "utf8")
  const workspace = await readFile(new URL("../src/features/notifications/notification-settings-workspace.tsx", import.meta.url), "utf8")
  assert.match(panel, /NOTIFICATION_GOOGLE_CHAT_WORKFLOW_OPTIONS\.map/)
  assert.doesNotMatch(workspace, /영어 단어 재시험/)
  assert.deepEqual(selectEditableGoogleChatRules([
    { id: "retired", channelKey: "google_chat", workflowKey: "word_retests" },
    { id: "result", channelKey: "google_chat", workflowKey: "word_retests", eventKey: "word_retest.result_reported", audienceKey: "subject_team", connectionKey: "google_chat.english", ruleVariantKey: "immediate", contentContract: englishResultContract },
    { id: "management", channelKey: "google_chat", workflowKey: "word_retests", eventKey: "word_retest.result_reported", audienceKey: "management_team", connectionKey: "google_chat.management", ruleVariantKey: "immediate" },
    { id: "wrong-team", channelKey: "google_chat", workflowKey: "word_retests", eventKey: "word_retest.result_reported", audienceKey: "subject_team", connectionKey: "google_chat.math", ruleVariantKey: "immediate" },
    { id: "registration", channelKey: "google_chat", workflowKey: "registration" },
  ]).map(({ id }) => id), ["result", "registration"])
})

test("the RPC subject rule with a dynamic null connection remains editable only under the English-only contract", () => {
  const wire = {
    scope_key: "global", workflow_key: "word_retests", connections: [],
    delivery_summary: { pending_count: 0, sent_count: 0, failed_count: 0, unknown_count: 0, latest_delivery_at: null },
    rules: [{
      id: "word-result-rule", workflow_key: "word_retests", event_key: "word_retest.result_reported",
      channel_key: "google_chat", audience_key: "subject_team", connection_key: null,
      rule_variant_key: "immediate", delivery_mode: "immediate", schedule_key: null, schedule_config: null,
      enabled: true, configuration_kind: "editable_rule", activation_locked: false,
      content_contract: englishResultContract,
      template_compliance: { contract_version: "1", compliance: "conformant", violations: [] },
      active_template_id: "word-result-template", revision: "1",
      template: { id: "word-result-template", rule_id: "word-result-rule", version: "1",
        title_template: "{학생} 결과", body_template: "{점수} / {통과기준} · {판정}\n{메모정보}",
        allowed_variables: englishResultContract.availableVariables.map(({ key, token, piiClass }) => ({ key, token, pii_class: piiClass })),
        payload_schema_version: 1, content_contract_version: "1" },
    }],
  }
  const parsed = types.parseNotificationControlPlaneSnapshot(wire)
  assert.equal(parsed.ok, true, JSON.stringify(parsed))
  const rule = parsed.value.rules[0]
  assert.equal(rule.connectionKey, null)
  assert.deepEqual(selectEditableGoogleChatRules([rule]).map(({ id }) => id), ["word-result-rule"])
  for (const invalid of [
    { connectionKey: "google_chat.math" }, { connectionKey: "google_chat.management" },
    { contentContract: undefined },
    { contentContract: { ...englishResultContract, destinationPolicy: { subjectScoped: true, allowedConnectionKeys: ["google_chat.english", "google_chat.math"] } } },
    { contentContract: { ...englishResultContract, destinationPolicy: { subjectScoped: false, allowedConnectionKeys: ["google_chat.english"] } } },
  ]) assert.deepEqual(selectEditableGoogleChatRules([{ ...rule, ...invalid }]), [])
})

test("word retest provider allows only the explicit English subject result delivery identity", async () => {
  let requests = 0
  const provider = createGoogleChatProvider({ fetch: async () => {
    requests += 1
    return new Response(JSON.stringify({ name: "spaces/test/messages/test" }), { status: 200 })
  } })
  const context = {
    delivery_id: "99700000-0000-4000-8000-000000000001",
    claim_token: "99700000-0000-4000-8000-000000000002",
    dispatch_token: "99700000-0000-4000-8000-000000000003",
    status: "sending", channel_key: "google_chat", workflow_key: "word_retests",
    event_key: "word_retest.result_reported", audience_key: "subject_team",
    connection_key: "google_chat.english",
    webhook_url: "https://chat.googleapis.com/v1/spaces/test/messages?key=test&token=test",
    rendered_title: "단어 재시험 결과", rendered_body: "재시험 결과가 등록됐습니다.",
    href: "/admin/word-retests?taskId=99700000-0000-4000-8000-000000000004",
  }
  for (const invalid of [
    { event_key: undefined }, { audience_key: undefined },
    { event_key: "word_retest.completed" }, { event_key: "word_retest.created" },
    { audience_key: "management_team" }, { audience_key: "requesting_teacher" },
    { connection_key: "google_chat.management" }, { connection_key: "google_chat.math" },
    { channel_key: "in_app" },
  ]) {
    const outcome = await provider.send({ ...context, ...invalid })
    assert.equal(outcome.errorCode, "word_retest_google_chat_retired")
  }
  assert.equal(requests, 0)
  assert.equal((await provider.send(context)).status, "sent")
  assert.equal(requests, 1, "the only HTTP call uses a mocked transport")
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
