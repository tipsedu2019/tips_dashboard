import assert from "node:assert/strict"
import test from "node:test"

import {
  createRegistrationNotificationProcessingReadinessLoader,
} from "../src/features/tasks/registration-notification-processing-readiness.ts"

test("동일 로그인 토큰의 동시 준비상태 조회는 한 요청을 공유한다", async () => {
  let resolveReadiness
  const pendingReadiness = new Promise((resolve) => {
    resolveReadiness = resolve
  })
  const calls = []
  const loadReadiness = createRegistrationNotificationProcessingReadinessLoader(
    async (accessToken) => {
      calls.push(accessToken)
      return pendingReadiness
    },
  )

  const levelTestRequest = loadReadiness("same-access-token")
  const consultationRequest = loadReadiness("same-access-token")

  await Promise.resolve()
  assert.equal(calls.length, 1)
  assert.equal(levelTestRequest, consultationRequest)

  resolveReadiness({ registrationRuntimeVersion: 1 })
  assert.deepEqual(await levelTestRequest, { registrationRuntimeVersion: 1 })
  assert.deepEqual(await consultationRequest, { registrationRuntimeVersion: 1 })

  const nextPollingRequest = loadReadiness("same-access-token")
  await Promise.resolve()
  assert.equal(calls.length, 2)
  assert.deepEqual(await nextPollingRequest, { registrationRuntimeVersion: 1 })
})

test("로그인 토큰이 바뀌면 진행 중인 준비상태 요청을 공유하지 않는다", async () => {
  const resolvers = new Map()
  const calls = []
  const loadReadiness = createRegistrationNotificationProcessingReadinessLoader(
    (accessToken) => {
      calls.push(accessToken)
      return new Promise((resolve) => resolvers.set(accessToken, resolve))
    },
  )

  const oldRequest = loadReadiness("old-access-token")
  const newRequest = loadReadiness("new-access-token")

  await Promise.resolve()
  assert.deepEqual(calls, ["old-access-token", "new-access-token"])
  assert.notEqual(oldRequest, newRequest)

  resolvers.get("old-access-token")({ profileId: "old-profile" })
  resolvers.get("new-access-token")({ profileId: "new-profile" })
  assert.deepEqual(await oldRequest, { profileId: "old-profile" })
  assert.deepEqual(await newRequest, { profileId: "new-profile" })
})
