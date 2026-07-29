import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import * as applyScript from "../scripts/apply-continuous-class-schedule-backfill.mjs"
import * as verifyScript from "../scripts/verify-continuous-class-schedule-release-2.mjs"

const CLASS_ID = "10000000-0000-4000-8000-000000000001"
const REQUEST_KEY = "10000000-0000-4000-8000-000000000002"
const { parseContinuousScheduleApplyArgs } = applyScript

test("apply requires an explicit class, source hash, idempotency key, apply flag, and confirmation", () => {
  assert.throws(() => parseContinuousScheduleApplyArgs([]), /--apply/)
  assert.throws(() => parseContinuousScheduleApplyArgs(["--class-id", CLASS_ID, "--expected-source-hash", "a", "--request-key", REQUEST_KEY, "--apply"]), /--confirm-class-id/)
  assert.deepEqual(parseContinuousScheduleApplyArgs([
    "--class-id", CLASS_ID, "--expected-source-hash", "abcdef", "--request-key", REQUEST_KEY,
    "--apply", "--confirm-class-id", CLASS_ID,
  ]), { classId: CLASS_ID, expectedSourceHash: "abcdef", requestKey: REQUEST_KEY })
})

test("apply and verifier use an authenticated admin token instead of service role credentials", async () => {
  const [apply, verify] = await Promise.all([
    readFile(new URL("../scripts/apply-continuous-class-schedule-backfill.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/verify-continuous-class-schedule-release-2.mjs", import.meta.url), "utf8"),
  ])
  for (const source of [apply, verify]) {
    assert.match(source, /CONTINUOUS_SCHEDULE_ADMIN_ACCESS_TOKEN/)
    assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY/)
  }
})

test("apply builds and sends the complete shadow payload from the current legacy class", async () => {
  assert.equal(typeof applyScript.applyContinuousScheduleBackfill, "function")

  const calls = []
  const result = await applyScript.applyContinuousScheduleBackfill({
    async readLegacyClass(classId) {
      assert.equal(classId, CLASS_ID)
      return {
        id: CLASS_ID,
        schedule: "화 14:00-15:30",
        teacher: "테스트 선생님",
        room: "테스트 강의실",
        schedule_plan: {
          sessions: [{
            id: "session:001:2026-04-03",
            date: "2026-04-03",
            scheduleState: "active",
            memo: "기존 메모",
            billingId: "period-april",
            billingLabel: "4월",
            billingColor: "#3182f6",
          }],
        },
      }
    },
    async backfill(parameters) {
      calls.push(structuredClone(parameters))
      return { storageMode: "shadow", slotCount: 1, sessionCount: 1 }
    },
  }, {
    classId: CLASS_ID,
    expectedSourceHash: "abcdef",
    requestKey: REQUEST_KEY,
  })

  assert.deepEqual(calls, [{
    p_class_id: CLASS_ID,
    p_expected_source_hash: "abcdef",
    p_slots: [{
      classId: CLASS_ID,
      weekday: 2,
      startTime: "14:00",
      endTime: "15:30",
      teacherCatalogId: null,
      teacherName: "테스트 선생님",
      classroomCatalogId: null,
      classroomName: "테스트 강의실",
      sortOrder: 0,
    }],
    p_sessions: [{
      classId: CLASS_ID,
      sessionKey: "session:001:2026-04-03",
      sessionDate: "2026-04-03",
      scheduleState: "active",
      startTime: null,
      endTime: null,
      teacherCatalogId: null,
      teacherNameSnapshot: "",
      classroomCatalogId: null,
      classroomNameSnapshot: "",
      memo: "기존 메모",
      origin: "legacy",
      legacyBillingId: "period-april",
      legacyBillingLabel: "4월",
      legacyBillingColor: "#3182f6",
    }],
    p_request_key: REQUEST_KEY,
  }])
  assert.deepEqual(result, {
    storageMode: "shadow",
    slotCount: 1,
    sessionCount: 1,
  })
})

test("apply rejects an ineligible legacy class before calling the backfill RPC", async () => {
  assert.equal(typeof applyScript.applyContinuousScheduleBackfill, "function")

  let called = false
  await assert.rejects(
    applyScript.applyContinuousScheduleBackfill({
      async readLegacyClass() {
        return {
          id: CLASS_ID,
          schedule: "해석할 수 없는 시간표",
          teacher: "",
          room: "",
          schedule_plan: { sessions: [] },
        }
      },
      async backfill() {
        called = true
      },
    }, {
      classId: CLASS_ID,
      expectedSourceHash: "abcdef",
      requestKey: REQUEST_KEY,
    }),
    /not eligible.*unparseable_default_schedule/i,
  )
  assert.equal(called, false)
})

test("canary verification requires an exact class and source hash and calls the shadow verifier", async () => {
  assert.equal(typeof verifyScript.parseContinuousScheduleVerifyArgs, "function")
  assert.equal(typeof verifyScript.verifyContinuousScheduleShadow, "function")
  assert.throws(
    () => verifyScript.parseContinuousScheduleVerifyArgs(["--class-id", CLASS_ID]),
    /expected-source-hash/i,
  )
  const input = verifyScript.parseContinuousScheduleVerifyArgs([
    "--class-id", CLASS_ID,
    "--expected-source-hash", "abcdef",
  ])
  assert.deepEqual(input, {
    classId: CLASS_ID,
    expectedSourceHash: "abcdef",
  })

  const calls = []
  const result = await verifyScript.verifyContinuousScheduleShadow({
    async verify(parameters) {
      calls.push(parameters)
      return {
        matches: true,
        slotCount: 1,
        sessionCount: 1,
        issueCodes: [],
      }
    },
  }, input)
  assert.deepEqual(calls, [{
    p_class_id: CLASS_ID,
    p_expected_source_hash: "abcdef",
  }])
  assert.deepEqual(result, {
    matches: true,
    slotCount: 1,
    sessionCount: 1,
    issueCodes: [],
  })
})
