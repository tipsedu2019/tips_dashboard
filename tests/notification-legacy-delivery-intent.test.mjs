import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import test from "node:test"

const helperUrl = new URL(
  "../src/features/notifications/server/legacy-delivery-intent.js",
  import.meta.url,
)

test("레거시 parity 해시는 CRLF·NFC·ASCII trim과 title/body/href 키 순서를 SQL과 동일하게 사용한다", async () => {
  assert.equal(existsSync(helperUrl), true, "레거시 delivery intent helper가 필요합니다.")
  const { normalizedNotificationRenderedHash } = await import(helperUrl)
  assert.equal(normalizedNotificationRenderedHash({
    title: "  알림\r\n제목  ",
    body: "본문 \"테스트\"\r끝",
    href: "/admin/tasks?taskId=abc",
  }), "7c04d55426e204778748e9f7d310481fc10356103673d40edf50b0da5c1fa08e")
  assert.equal(
    normalizedNotificationRenderedHash({
      title: "e\u0301",
      body: "  본문  ",
      href: " /admin/tasks ",
    }),
    normalizedNotificationRenderedHash({
      title: "é",
      body: "본문",
      href: "/admin/tasks",
    }),
  )
  const plainHash = normalizedNotificationRenderedHash({
    title: "알림",
    body: "본문",
    href: "/admin/tasks",
  })
  assert.equal(
    normalizedNotificationRenderedHash({
      title: " \t알림\n",
      body: "\f본문\v ",
      href: " /admin/tasks\t",
    }),
    plainHash,
  )
  assert.notEqual(
    normalizedNotificationRenderedHash({
      title: "\u00a0알림\u00a0",
      body: "본문",
      href: "/admin/tasks",
    }),
    plainHash,
    "NBSP는 SQL btrim 문자 집합에 없으므로 보존해야 합니다.",
  )
})

test("delivery intent recorder는 legacy plan checksum·해시·두 UUID만 RPC 경계로 넘기고 원문·민감정보를 노출하지 않는다", async () => {
  assert.equal(existsSync(helperUrl), true, "레거시 delivery intent helper가 필요합니다.")
  const { recordLegacyNotificationDeliveryIntent } = await import(helperUrl)
  let input = null
  const result = await recordLegacyNotificationDeliveryIntent({
    deliveryId: "a2000000-0000-4000-8000-000000000001",
    requestId: "a2000000-0000-4000-8000-000000000002",
    legacyTemplateChecksum: "a".repeat(64),
    title: "방문상담 · 김다미",
    body: "010-1234-5678",
    href: "/admin/registration?taskId=secret-task",
    record: async (value) => {
      input = value
      return { recorded: true }
    },
  })

  assert.deepEqual(Object.keys(input).sort(), [
    "deliveryId",
    "legacyTemplateChecksum",
    "normalizedRenderedHash",
    "requestId",
  ])
  assert.equal(input.legacyTemplateChecksum, "a".repeat(64))
  assert.match(input.normalizedRenderedHash, /^[a-f0-9]{64}$/)
  assert.doesNotMatch(JSON.stringify(input), /김다미|010-1234-5678|secret-task/)
  assert.equal(result.recorded, true)
  assert.equal(result.normalizedRenderedHash, input.normalizedRenderedHash)
})

test("recorded=false와 recorder 오류는 delivery 제어 결과나 provider 진행을 차단하지 않는다", async () => {
  assert.equal(existsSync(helperUrl), true, "레거시 delivery intent helper가 필요합니다.")
  const { recordLegacyNotificationDeliveryIntent } = await import(helperUrl)
  let providerCalls = 0
  for (const record of [
    async () => ({ recorded: false }),
    async () => { throw new Error("schema cache unavailable") },
  ]) {
    const result = await recordLegacyNotificationDeliveryIntent({
      deliveryId: "a2000000-0000-4000-8000-000000000001",
      requestId: "a2000000-0000-4000-8000-000000000002",
      legacyTemplateChecksum: "b".repeat(64),
      title: "알림",
      body: "본문",
      href: "/admin/tasks",
      record,
    })
    providerCalls += 1
    assert.equal(result.recorded, false)
  }
  assert.equal(providerCalls, 2)
})
