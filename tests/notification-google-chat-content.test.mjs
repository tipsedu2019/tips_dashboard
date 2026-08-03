import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const providerUrl = new URL(
  "../src/features/notifications/server/providers/google-chat-provider.ts",
  import.meta.url,
)

const WEBHOOK_URL =
  "https://chat.googleapis.com/v1/spaces/SPACEIDENTIFIER123456/messages?key=key-secret&token=token-secret"
const legacyProjectionUrl = new URL(
  "../supabase/migrations/20260803153000_notification_legacy_content_projection.sql",
  import.meta.url,
)
const coverageManifestUrl = new URL(
  "./fixtures/notification-content-coverage-manifest.json",
  import.meta.url,
)

function context(overrides = {}) {
  return {
    delivery_id: "10000000-0000-4000-8000-000000000001",
    claim_token: "10000000-0000-4000-8000-000000000002",
    dispatch_token: "10000000-0000-4000-8000-000000000003",
    status: "sending",
    channel_key: "google_chat",
    connection_key: "google_chat.management",
    webhook_url: WEBHOOK_URL,
    rendered_title: "📥 [등록] 김학생의 등록 문의가 들어왔어요",
    rendered_body: "[학생] 김학생 · 중1\n[과목] 수학\n[진행] 관리팀의 확인을 기다리고 있어요.",
    href: "/admin/registration?taskId=10000000-0000-4000-8000-000000000004",
    ...overrides,
  }
}

test("Google Chat 최종 payload는 제목·본문·고정 origin 링크를 빈 줄로 구분하고 URL을 한 번만 담는다", async () => {
  const { buildGoogleChatTextPayload, createGoogleChatProvider } = await import(providerUrl.href)
  const built = buildGoogleChatTextPayload(context())
  const expectedUrl =
    "https://tipsedu.co.kr/admin/registration?taskId=10000000-0000-4000-8000-000000000004"
  const expectedText = [
    "📥 [등록] 김학생의 등록 문의가 들어왔어요",
    "[학생] 김학생 · 중1\n[과목] 수학\n[진행] 관리팀의 확인을 기다리고 있어요.",
    expectedUrl,
  ].join("\n\n")

  assert.deepEqual(built, {
    ok: true,
    text: expectedText,
    absoluteUrl: expectedUrl,
    byteLength: Buffer.byteLength(expectedText, "utf8"),
  })
  assert.equal(built.text.split(expectedUrl).length - 1, 1)

  const calls = []
  const provider = createGoogleChatProvider({
    async fetch(input, init) {
      calls.push({ input: String(input), init })
      return new Response(JSON.stringify({ name: "spaces/fixture/messages/content-1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    },
  })
  const sent = await provider.send(context())

  assert.equal(sent.status, "sent")
  assert.equal(calls.length, 1)
  assert.deepEqual(JSON.parse(calls[0].init.body), { text: expectedText })
})

test("악성·모호한 링크는 transport 전에 render_validation_failed로 닫힌다", async () => {
  const { buildGoogleChatTextPayload, createGoogleChatProvider } = await import(providerUrl.href)
  const calls = []
  const provider = createGoogleChatProvider({
    async fetch() {
      calls.push("called")
      return new Response("{}", { status: 200 })
    },
  })
  const invalidHrefs = [
    "//evil.example/admin/tasks",
    "https://evil.example/admin/tasks",
    "javascript:alert(1)",
    "/admin/tasks/%2e%2e/withdrawal?taskId=one",
    "/admin/tasks/../withdrawal?taskId=one",
    "/admin/tasks\\withdrawal?taskId=one",
    "/admin/tasks#private",
    "/admin/tasks?taskId=one&taskId=two",
    "/admin/tasks?unknown=one",
    "/admin/withdrawal?flow=operations&taskId=one&next=%2Fadmin%2Ftasks",
    "/login?taskId=one",
  ]

  for (const href of invalidHrefs) {
    assert.deepEqual(buildGoogleChatTextPayload(context({ href })), {
      ok: false,
      errorCode: "render_validation_failed",
    })
    const result = await provider.send(context({ href }))
    assert.equal(result.status, "failed")
    assert.equal(result.statusReason, "render_validation_failed")
    assert.equal(result.errorCode, "render_validation_failed")
  }
  assert.equal(calls.length, 0)
})

test("UTF-8 32,000바이트 경계를 넘거나 본문에 URL이 중복되면 transport를 호출하지 않는다", async () => {
  const { buildGoogleChatTextPayload, createGoogleChatProvider } = await import(providerUrl.href)
  let calls = 0
  const provider = createGoogleChatProvider({
    async fetch() {
      calls += 1
      return new Response("{}", { status: 200 })
    },
  })
  const inputs = [
    context({ rendered_body: "한".repeat(11_000) }),
    context({ rendered_body: "중복 링크 https://tipsedu.co.kr/admin/tasks" }),
  ]

  for (const input of inputs) {
    assert.deepEqual(buildGoogleChatTextPayload(input), {
      ok: false,
      errorCode: "render_validation_failed",
    })
    const result = await provider.send(input)
    assert.equal(result.status, "failed")
    assert.equal(result.errorCode, "render_validation_failed")
  }
  assert.equal(calls, 0)
})

test("UTF-8 최종 payload는 정확히 32,000바이트까지 허용한다", async () => {
  const { buildGoogleChatTextPayload } = await import(providerUrl.href)
  const renderedTitle = "경계"
  const absoluteUrl = "https://tipsedu.co.kr/admin/tasks"
  const fixedBytes = Buffer.byteLength(`${renderedTitle}\n\n\n\n${absoluteUrl}`, "utf8")
  const renderedBody = "a".repeat(32_000 - fixedBytes)

  const result = buildGoogleChatTextPayload(context({
    rendered_title: renderedTitle,
    rendered_body: renderedBody,
    href: "/admin/tasks",
  }))

  assert.equal(result.ok, true)
  assert.equal(result.byteLength, 32_000)
})

test("legacy content projection은 매니페스트의 legacy 59개 identity만 rich context renderer로 허용한다", async () => {
  const [source, coverage] = await Promise.all([
    readFile(legacyProjectionUrl, "utf8"),
    readFile(coverageManifestUrl, "utf8").then(JSON.parse),
  ])
  const embedded = source.match(
    /notification_legacy_content_identity_fixture_begin\s*\$legacy_identities\$([\s\S]*?)\$legacy_identities\$::jsonb\s*-- notification_legacy_content_identity_fixture_end/u,
  )
  assert.ok(embedded)
  const actual = JSON.parse(embedded[1]).sort()
  const expected = coverage.ruleGroups
    .filter((group) => group.scopeState === "in_scope" && group.dispatchOwner === "legacy")
    .flatMap((group) => group.eventKeys.flatMap((eventKey) => (
      group.cells.flatMap((cell) => cell.ruleVariantKeys.map((ruleVariantKey) => [
        group.workflowKey,
        eventKey,
        cell.audienceKey,
        cell.channelKey,
        ruleVariantKey,
      ].join("|")))
    )))
    .sort()

  assert.equal(actual.length, 59)
  assert.deepEqual(actual, expected)
  assert.equal(actual.some((identity) => identity.startsWith("approvals|")), false)
  assert.match(source, /notification_rule_content_contracts/)
  assert.match(source, /availableVariables/)
  assert.match(source, /fieldPresence/)
  assert.match(source, /optionalLineTokens/)
  assert.match(source, /notification_legacy_content_required_field_missing/)
  assert.match(source, /notification_legacy_content_null_field_invalid/)
  assert.match(source, /notification_legacy_content_unsafe_value/)
  assert.match(source, /render_validation_failed/)
  assert.doesNotMatch(source, /create\s+or\s+replace\s+function\s+public\./iu)
  assert.doesNotMatch(source, /\b(?:insert|update|delete)\s+(?:into\s+)?dashboard_private\.(?:notification_rules|notification_templates|notification_runtime_flags|notification_dispatch_ownership_claims)\b/iu)
  assert.doesNotMatch(source, /materialize|finalize|activation|rollback|webhook|fetch|send/iu)
})
