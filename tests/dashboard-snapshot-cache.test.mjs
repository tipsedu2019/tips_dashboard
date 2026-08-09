import assert from "node:assert/strict"
import test from "node:test"

import {
  createDashboardSnapshotCache,
} from "../src/features/dashboard/snapshot-cache.js"
import {
  normalizeDashboardConflictSources,
  normalizeDashboardSummarySources,
} from "../src/features/dashboard/snapshot-sources.js"

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

test("dashboard snapshot cache deduplicates in-flight and fresh values", async () => {
  let calls = 0
  let now = 1_000
  const cache = createDashboardSnapshotCache({ now: () => now, ttlMs: 30_000 })
  const pending = deferred()
  const loader = () => {
    calls += 1
    return pending.promise
  }

  const firstPromise = cache.load("user-1:admin:v1", "summary", loader)
  const secondPromise = cache.load("user-1:admin:v1", "summary", loader)
  assert.equal(calls, 1)

  pending.resolve({ call: 1 })
  assert.deepEqual(await firstPromise, { call: 1 })
  assert.deepEqual(await secondPromise, { call: 1 })

  now += 29_999
  assert.deepEqual(
    await cache.load("user-1:admin:v1", "summary", async () => ({ call: ++calls })),
    { call: 1 },
  )
  assert.equal(calls, 1)

  now += 2
  assert.deepEqual(
    await cache.load("user-1:admin:v1", "summary", async () => ({ call: ++calls })),
    { call: 2 },
  )
  assert.equal(calls, 2)
})

test("dashboard snapshot cache never caches failures", async () => {
  let calls = 0
  const cache = createDashboardSnapshotCache()

  await assert.rejects(
    cache.load("user-1:admin:v1", "summary", async () => {
      calls += 1
      throw new Error("first failure")
    }),
    /first failure/,
  )

  assert.deepEqual(
    await cache.load("user-1:admin:v1", "summary", async () => ({ call: ++calls })),
    { call: 2 },
  )
  assert.equal(calls, 2)
})

test("dashboard snapshot cache force and kind invalidation reload only the selected source", async () => {
  let summaryCalls = 0
  let conflictCalls = 0
  const scope = "user-1:staff:v1"
  const cache = createDashboardSnapshotCache()
  const loadSummary = () => cache.load(scope, "summary", async () => ({ call: ++summaryCalls }))
  const loadConflict = () => cache.load(scope, "conflict", async () => ({ call: ++conflictCalls }))

  assert.deepEqual(await loadSummary(), { call: 1 })
  assert.deepEqual(await loadConflict(), { call: 1 })
  assert.deepEqual(
    await cache.load(scope, "summary", async () => ({ call: ++summaryCalls }), { force: true }),
    { call: 2 },
  )

  cache.invalidate(scope, "conflict")
  assert.deepEqual(await loadSummary(), { call: 2 })
  assert.deepEqual(await loadConflict(), { call: 2 })
})

test("dashboard snapshot cache keeps users isolated", async () => {
  let calls = 0
  const cache = createDashboardSnapshotCache()
  const loader = async () => ({ call: ++calls })

  assert.deepEqual(await cache.load("user-1:admin:v1", "summary", loader), { call: 1 })
  assert.deepEqual(await cache.load("user-2:admin:v1", "summary", loader), { call: 2 })
  assert.deepEqual(await cache.load("user-1:admin:v1", "summary", loader), { call: 1 })
})

test("dashboard snapshot cache does not retain a stale response after invalidation", async () => {
  const cache = createDashboardSnapshotCache()
  const oldRequest = deferred()
  const oldConsumer = cache.load("user-1:admin:v1", "summary", () => oldRequest.promise)

  cache.invalidate("user-1:admin:v1", "summary")
  assert.deepEqual(
    await cache.load("user-1:admin:v1", "summary", async () => ({ generation: "new" })),
    { generation: "new" },
  )

  oldRequest.resolve({ generation: "old" })
  assert.deepEqual(await oldConsumer, { generation: "old" })
  assert.deepEqual(
    await cache.load("user-1:admin:v1", "summary", async () => ({ generation: "unexpected" })),
    { generation: "new" },
  )
})

test("dashboard summary source normalizer accepts only the canonical arrays", () => {
  const classes = [{ id: "class-1" }]
  const students = [{ id: "student-1" }]

  assert.deepEqual(
    normalizeDashboardSummarySources({ classes, students, ignored: ["value"] }),
    { classes, students },
  )
  for (const invalid of [null, [], {}, { classes, students: null }, { classes: "bad", students }]) {
    assert.throws(
      () => normalizeDashboardSummarySources(invalid),
      /대시보드 데이터 형식을 확인하지 못했습니다\./,
    )
  }
})

test("dashboard conflict source normalizer rejects any missing or non-array source", () => {
  const canonical = {
    sessionDates: [{ class_id: "class-1" }],
    classTerms: [],
    classGroups: [],
    classGroupMembers: [],
    teacherCatalogs: [],
    classroomCatalogs: [],
    academicSchools: [],
    academicExamDays: [],
    academicEventExamDetails: [],
    academicEvents: [],
  }

  assert.deepEqual(
    normalizeDashboardConflictSources({ ...canonical, ignored: ["value"] }),
    canonical,
  )
  assert.throws(
    () => normalizeDashboardConflictSources({ ...canonical, academicEvents: null }),
    /대시보드 데이터 형식을 확인하지 못했습니다\./,
  )
  const missingClassTerms = { ...canonical }
  delete missingClassTerms.classTerms
  assert.throws(
    () => normalizeDashboardConflictSources(missingClassTerms),
    /대시보드 데이터 형식을 확인하지 못했습니다\./,
  )
})
