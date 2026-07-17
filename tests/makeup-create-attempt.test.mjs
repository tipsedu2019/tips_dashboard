import assert from "node:assert/strict"
import { randomUUID, webcrypto } from "node:crypto"
import test from "node:test"

import {
  clearMakeupCreateAttemptMemoryForTest,
  runIdempotentMakeupCreate,
} from "../src/features/makeup-requests/makeup-create-attempt.js"

function memoryStorage() {
  const values = new Map()
  return {
    getItem(key) { return values.get(key) ?? null },
    setItem(key, value) { values.set(key, String(value)) },
    removeItem(key) { values.delete(key) },
    get size() { return values.size },
  }
}

const runtime = {
  crypto: webcrypto,
  randomUUID,
  now: () => Date.parse("2026-07-17T03:00:00.000Z"),
}

test("응답이 유실된 동일 휴보강 생성 재시도는 같은 request ID를 재사용한다", async () => {
  clearMakeupCreateAttemptMemoryForTest()
  const storage = memoryStorage()
  const seen = []
  const input = {
    actorId: "00000000-0000-4000-8000-000000000001",
    payload: { class_id: "00000000-0000-4000-8000-000000000002", reason: "학교 행사" },
    storage,
    runtime,
  }

  await assert.rejects(
    runIdempotentMakeupCreate({
      ...input,
      invoke: async (requestId) => {
        seen.push(requestId)
        throw new TypeError("fetch failed after commit")
      },
    }),
    /fetch failed after commit/,
  )

  const result = await runIdempotentMakeupCreate({
    ...input,
    invoke: async (requestId) => {
      seen.push(requestId)
      return { requestId, replayed: true }
    },
  })

  assert.equal(seen.length, 2)
  assert.equal(seen[0], seen[1])
  assert.equal(result.requestId, seen[0])
  assert.equal(storage.size, 0, "성공 뒤에는 보존한 시도를 제거해야 한다")
})

test("사용자나 payload가 달라지면 휴보강 생성 request ID도 분리한다", async () => {
  clearMakeupCreateAttemptMemoryForTest()
  const storage = memoryStorage()
  const seen = []
  for (const [actorId, reason] of [
    ["00000000-0000-4000-8000-000000000001", "사유 A"],
    ["00000000-0000-4000-8000-000000000001", "사유 B"],
    ["00000000-0000-4000-8000-000000000003", "사유 A"],
  ]) {
    await assert.rejects(runIdempotentMakeupCreate({
      actorId,
      payload: { class_id: "00000000-0000-4000-8000-000000000002", reason },
      storage,
      runtime,
      invoke: async (requestId) => {
        seen.push(requestId)
        throw new TypeError("network unavailable")
      },
    }))
  }
  assert.equal(new Set(seen).size, 3)
  assert.equal(storage.size, 3)
})

test("명확한 DB 검증 실패는 보존 ID를 제거해 수정 후 새 시도로 시작한다", async () => {
  clearMakeupCreateAttemptMemoryForTest()
  const storage = memoryStorage()
  const ids = []
  const input = {
    actorId: "00000000-0000-4000-8000-000000000001",
    payload: { class_id: "00000000-0000-4000-8000-000000000002", reason: "검증" },
    storage,
    runtime,
  }
  for (let index = 0; index < 2; index += 1) {
    await assert.rejects(runIdempotentMakeupCreate({
      ...input,
      invoke: async (requestId) => {
        ids.push(requestId)
        throw Object.assign(new Error("makeup_request_input_invalid"), { code: "22023" })
      },
    }))
  }
  assert.notEqual(ids[0], ids[1])
  assert.equal(storage.size, 0)
})
