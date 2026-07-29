import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import { parseContinuousScheduleApplyArgs } from "../scripts/apply-continuous-class-schedule-backfill.mjs"

const CLASS_ID = "10000000-0000-4000-8000-000000000001"
const REQUEST_KEY = "10000000-0000-4000-8000-000000000002"

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
