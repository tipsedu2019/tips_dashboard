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

test("Google Chat 최종 payload는 URL 없는 카드 본문과 대시보드 버튼을 담는다", async () => {
  const { buildGoogleChatCardPayload, createGoogleChatProvider } = await import(providerUrl.href)
  const built = buildGoogleChatCardPayload(context())
  const expectedUrl =
    "https://tipsedu.co.kr/admin/registration?taskId=10000000-0000-4000-8000-000000000004"
  const expectedPayload = {
    cardsV2: [{
      cardId: "tips-dashboard-notification",
      card: {
        header: { title: "📥 [등록] 김학생의 등록 문의가 들어왔어요" },
        sections: [{
          widgets: [
            { textParagraph: { text: "[학생] 김학생 · 중1<br>[과목] 수학<br>[진행] 관리팀의 확인을 기다리고 있어요." } },
            {
              buttonList: {
                buttons: [{
                  text: "대시보드에서 보기",
                  onClick: { openLink: { url: expectedUrl } },
                }],
              },
            },
          ],
        }],
      },
    }],
  }

  assert.deepEqual(built, {
    ok: true,
    payload: expectedPayload,
    absoluteUrl: expectedUrl,
    byteLength: Buffer.byteLength(JSON.stringify(expectedPayload), "utf8"),
  })
  assert.equal(JSON.stringify(built.payload).split(expectedUrl).length - 1, 1)
  assert.doesNotMatch(expectedPayload.cardsV2[0].card.header.title, /https?:\/\//u)
  assert.doesNotMatch(expectedPayload.cardsV2[0].card.sections[0].widgets[0].textParagraph.text, /https?:\/\//u)

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
  assert.deepEqual(JSON.parse(calls[0].init.body), expectedPayload)
})

test("Google Chat 카드 본문은 HTML을 escape하고 줄바꿈만 보존한다", async () => {
  const { buildGoogleChatCardPayload } = await import(providerUrl.href)
  const built = buildGoogleChatCardPayload(context({
    rendered_body: `A < B & "C" 'D'\n둘째 줄`,
  }))

  assert.equal(built.ok, true)
  assert.equal(
    built.payload.cardsV2[0].card.sections[0].widgets[0].textParagraph.text,
    "A &lt; B &amp; &quot;C&quot; &#39;D&#39;<br>둘째 줄",
  )
})

test("악성·모호한 링크는 transport 전에 render_validation_failed로 닫힌다", async () => {
  const { buildGoogleChatCardPayload, createGoogleChatProvider } = await import(providerUrl.href)
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
    assert.deepEqual(buildGoogleChatCardPayload(context({ href })), {
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
  const { buildGoogleChatCardPayload, createGoogleChatProvider } = await import(providerUrl.href)
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
    assert.deepEqual(buildGoogleChatCardPayload(input), {
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
  const { buildGoogleChatCardPayload } = await import(providerUrl.href)
  const base = buildGoogleChatCardPayload(context({
    rendered_title: "경계",
    rendered_body: "a",
    href: "/admin/tasks",
  }))
  assert.equal(base.ok, true)
  const renderedBody = "a".repeat(32_000 - base.byteLength + 1)

  const result = buildGoogleChatCardPayload(context({
    rendered_title: "경계",
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
