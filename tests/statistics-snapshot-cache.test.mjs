import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const contractModule = await import("../src/features/dashboard/statistics-contract.ts").catch(() => ({}))
const cacheModule = await import("../src/features/dashboard/statistics-cache.ts").catch(() => ({}))
const routeModule = await import("../src/features/dashboard/server/statistics-route.ts").catch(() => ({}))

const ACTOR_A = "00000000-0000-4000-8000-000000000001"
const ACTOR_B = "00000000-0000-4000-8000-000000000002"
const GENERATED_AT = "2026-08-14T00:00:00.000Z"

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function snapshot({
  tab = "overview",
  value = 1,
  generatedAt = "2026-08-14T00:00:00.000Z",
  expiresAt = "2026-08-14T00:10:00.000Z",
  cacheStatus = "hit",
} = {}) {
  return {
    ok: true,
    contractVersion: "dashboard-statistics-v1",
    tab,
    data: { value },
    generatedAt,
    expiresAt,
    cacheStatus,
  }
}

function request(query, token = "token-a") {
  return new Request(`http://localhost/api/dashboard/statistics?${query}`, {
    headers: { authorization: `Bearer ${token}` },
  })
}

function cacheKey(input) {
  return [
    input.actorProfileId,
    input.role,
    input.contractVersion,
    input.tab,
    input.subject,
    input.division,
    input.dateFrom,
    input.dateTo,
  ].join(":")
}

function createPrivateCacheFake({ now = () => Date.now() } = {}) {
  const rows = new Map()
  let tokenSequence = 0

  function ready(row) {
    return row?.status === "ready" && row.expiresAt > now()
  }

  return {
    rows,
    async claim(input) {
      const key = cacheKey(input)
      const row = rows.get(key)
      if (row && ready(row) && !input.force) {
        return {
          status: "ready",
          generation: row.generation,
          payload: row.payload,
          generatedAt: row.generatedAt,
          expiresAt: new Date(row.expiresAt).toISOString(),
        }
      }
      if (row?.status === "computing" && row.leaseExpiresAt > now() && !input.force) {
        return {
          status: "wait",
          generation: row.generation,
          leaseExpiresAt: new Date(row.leaseExpiresAt).toISOString(),
        }
      }
      const generation = (row?.generation ?? 0) + 1
      const claimToken = `claim-${++tokenSequence}`
      rows.set(key, {
        status: "computing",
        generation,
        claimToken,
        leaseExpiresAt: now() + 15_000,
      })
      return {
        status: "acquired",
        generation,
        claimToken,
        leaseExpiresAt: new Date(now() + 15_000).toISOString(),
      }
    },
    async read(input) {
      const row = rows.get(cacheKey(input))
      if (!ready(row)) return { status: "miss" }
      return {
        status: "ready",
        generation: row.generation,
        payload: row.payload,
        generatedAt: row.generatedAt,
        expiresAt: new Date(row.expiresAt).toISOString(),
      }
    },
    async finalize(input) {
      const key = cacheKey(input)
      const row = rows.get(key)
      if (
        row?.status !== "computing" ||
        row.generation !== input.generation ||
        row.claimToken !== input.claimToken
      ) return { status: "superseded" }
      const expiresAt = now() + 600_000
      rows.set(key, {
        status: "ready",
        generation: row.generation,
        payload: input.payload,
        generatedAt: GENERATED_AT,
        expiresAt,
      })
      return {
        status: "stored",
        generatedAt: GENERATED_AT,
        expiresAt: new Date(expiresAt).toISOString(),
      }
    },
    async invalidate(input) {
      const key = cacheKey(input)
      const row = rows.get(key)
      if (!row || row.generation !== input.expectedGeneration) return { status: "stale" }
      rows.set(key, {
        status: "computing",
        generation: row.generation + 1,
        claimToken: `invalidated-${++tokenSequence}`,
        leaseExpiresAt: now() - 1,
      })
      return { status: "invalidated", generation: row.generation + 1 }
    },
  }
}

function createRoute(cache, {
  calculate,
  actorId = ACTOR_A,
  role = "admin",
  sleep = async () => {},
} = {}) {
  return routeModule.createDashboardStatisticsRouteHandler({
    async authenticate(req) {
      const token = req.headers.get("authorization")?.replace("Bearer ", "")
      if (!token) throw Object.assign(new Error("unauthorized"), { status: 401 })
      return {
        actorProfileId: token === "token-b" ? ACTOR_B : actorId,
        role,
        actorClient: { kind: "authenticated", token },
      }
    },
    cache,
    calculate: calculate ?? (async ({ actorClient, request: normalized }) => ({
      actorClientKind: actorClient.kind,
      tab: normalized.tab,
    })),
    sleep,
  })
}

test("statistics cache key fixes actor, role, contract, tab, filter, and range order", () => {
  assert.equal(typeof cacheModule.buildDashboardStatisticsCacheKey, "function")
  assert.equal(
    cacheModule.buildDashboardStatisticsCacheKey({
      userId: ACTOR_A,
      role: "staff",
      tab: "schedule_conflicts",
      subject: "",
      division: "",
      dateFrom: "2026-08-14",
      dateTo: "2026-11-12",
    }),
    `${ACTOR_A}:staff:dashboard-statistics-v1:schedule_conflicts:::2026-08-14:2026-11-12`,
  )
})

test("private route cache shares ready aggregates across handlers for exactly ten minutes", async () => {
  let now = Date.parse(GENERATED_AT)
  let calculations = 0
  const cache = createPrivateCacheFake({ now: () => now })
  const calculate = async () => ({ calculation: ++calculations })
  const firstHandler = createRoute(cache, { calculate })
  const secondHandler = createRoute(cache, { calculate })

  const first = await firstHandler(request("tab=overview&subject=all&division=all"))
  assert.equal(first.status, 200)
  assert.deepEqual(await first.json(), {
    ok: true,
    contractVersion: "dashboard-statistics-v1",
    tab: "overview",
    data: { calculation: 1 },
    generatedAt: GENERATED_AT,
    expiresAt: "2026-08-14T00:10:00.000Z",
    cacheStatus: "miss",
  })

  now += 599_999
  const hit = await secondHandler(request("tab=overview&subject=all&division=all"))
  assert.equal((await hit.json()).cacheStatus, "hit")
  assert.equal(calculations, 1)

  now += 2
  const expired = await secondHandler(request("tab=overview&subject=all&division=all"))
  assert.equal((await expired.json()).cacheStatus, "miss")
  assert.equal(calculations, 2)
})

test("concurrent claimant deduplicates calculation and waiters poll 100/250/500 before 503", async () => {
  const cache = createPrivateCacheFake({ now: () => Date.parse(GENERATED_AT) })
  const pending = deferred()
  let calculations = 0
  const delays = []
  const firstHandler = createRoute(cache, {
    calculate: async () => {
      calculations += 1
      return pending.promise
    },
  })
  const secondHandler = createRoute(cache, {
    calculate: async () => {
      calculations += 1
      return { forbidden: true }
    },
    sleep: async (delay) => {
      delays.push(delay)
      if (delay === 100) pending.resolve({ calculation: 1 })
      await Promise.resolve()
    },
  })

  const firstPromise = firstHandler(request("tab=overview&subject=all&division=all"))
  await Promise.resolve()
  const secondPromise = secondHandler(request("tab=overview&subject=all&division=all"))
  const [first, second] = await Promise.all([firstPromise, secondPromise])
  assert.equal(first.status, 200)
  assert.equal(second.status, 200)
  assert.equal((await second.json()).cacheStatus, "hit")
  assert.equal(calculations, 1)
  assert.deepEqual(delays, [100])

  const stuck = createPrivateCacheFake({ now: () => Date.parse(GENERATED_AT) })
  await stuck.claim({
    actorProfileId: ACTOR_A,
    role: "admin",
    contractVersion: "dashboard-statistics-v1",
    tab: "overview",
    subject: "all",
    division: "all",
    dateFrom: "",
    dateTo: "",
    force: false,
  })
  const stuckDelays = []
  const busyHandler = createRoute(stuck, {
    calculate: async () => assert.fail("waiter must not calculate"),
    sleep: async (delay) => stuckDelays.push(delay),
  })
  const busy = await busyHandler(request("tab=overview&subject=all&division=all"))
  assert.equal(busy.status, 503)
  assert.equal(busy.headers.get("retry-after"), "1")
  assert.deepEqual(await busy.json(), { ok: false, error: "statistics_cache_busy" })
  assert.deepEqual(stuckDelays, [100, 250, 500])
})

test("failures are not saved and force refresh discards a superseded slow response", async () => {
  const cache = createPrivateCacheFake({ now: () => Date.parse(GENERATED_AT) })
  let attempts = 0
  const failing = createRoute(cache, {
    calculate: async () => {
      attempts += 1
      if (attempts === 1) throw new Error("source unavailable")
      return { attempt: attempts }
    },
  })
  assert.equal((await failing(request("tab=overview&subject=all&division=all"))).status, 503)
  const recovered = await failing(request("tab=overview&subject=all&division=all"))
  assert.equal(recovered.status, 200)
  assert.deepEqual((await recovered.json()).data, { attempt: 2 })

  const slow = deferred()
  let calculation = 0
  const slowHandler = createRoute(cache, {
    calculate: async () => {
      calculation += 1
      return calculation === 1 ? slow.promise : { generation: "fresh" }
    },
  })
  const keyQuery = "tab=students_classes&subject=math&division=high"
  const oldPromise = slowHandler(request(keyQuery))
  await Promise.resolve()
  const refresh = await slowHandler(request(`${keyQuery}&refresh=1`))
  assert.equal((await refresh.json()).cacheStatus, "refreshed")
  slow.resolve({ generation: "stale" })
  const old = await oldPromise
  assert.deepEqual((await old.json()).data, { generation: "fresh" })
})

test("private cache isolates actor, role, tab, filters, and ranges", async () => {
  let calculations = 0
  const cache = createPrivateCacheFake({ now: () => Date.parse(GENERATED_AT) })
  const calculate = async () => ({ calculation: ++calculations })
  const adminA = createRoute(cache, { calculate })
  const staffA = createRoute(cache, { calculate, role: "staff" })

  const requests = [
    request("tab=overview&subject=all&division=all"),
    request("tab=overview&subject=all&division=all", "token-b"),
    request("tab=overview&subject=all&division=all"),
    request("tab=students_classes&subject=all&division=all"),
    request("tab=students_classes&subject=math&division=all"),
    request("tab=schedule_conflicts&dateFrom=2026-08-14&dateTo=2026-11-12"),
    request("tab=schedule_conflicts&dateFrom=2026-08-14&dateTo=2027-02-10"),
  ]
  for (const item of requests) await adminA(item)
  await staffA(request("tab=overview&subject=all&division=all"))
  assert.equal(calculations, 7)
})

test("client memory cache loads only the active tab, deduplicates in flight, and expires without browser storage", async () => {
  let now = Date.parse("2026-08-14T00:00:00.000Z")
  let calls = 0
  const pending = deferred()
  const cache = cacheModule.createDashboardStatisticsMemoryCache({ now: () => now })
  const input = {
    active: true,
    cache,
    key: "actor:admin:dashboard-statistics-v1:overview:all:all::",
    loader: () => {
      calls += 1
      return pending.promise
    },
  }

  const first = cacheModule.loadActiveDashboardStatisticsSnapshot(input)
  const duplicate = cacheModule.loadActiveDashboardStatisticsSnapshot(input)
  assert.equal(calls, 1)
  pending.resolve(snapshot())
  assert.deepEqual(await first, snapshot())
  assert.deepEqual(await duplicate, snapshot())

  assert.equal(await cacheModule.loadActiveDashboardStatisticsSnapshot({ ...input, active: false }), null)
  assert.equal(calls, 1)
  now += 599_999
  assert.deepEqual(await cacheModule.loadActiveDashboardStatisticsSnapshot(input), snapshot())
  assert.equal(calls, 1)
  assert.deepEqual(
    await cacheModule.loadActiveDashboardStatisticsSnapshot({
      ...input,
      key: "actor:admin:dashboard-statistics-v1:textbooks:all::2026-05-17:2026-08-14",
      loader: async () => snapshot({ tab: "textbooks", value: ++calls }),
    }),
    snapshot({ tab: "textbooks", value: 2 }),
  )
  assert.deepEqual(await cacheModule.loadActiveDashboardStatisticsSnapshot(input), snapshot())
  assert.equal(calls, 2)
  now += 2
  assert.deepEqual(
    await cacheModule.loadActiveDashboardStatisticsSnapshot({
      ...input,
      loader: async () => snapshot({
        value: ++calls,
        generatedAt: "2026-08-14T00:10:00.001Z",
        expiresAt: "2026-08-14T00:20:00.001Z",
      }),
    }),
    snapshot({
      value: 3,
      generatedAt: "2026-08-14T00:10:00.001Z",
      expiresAt: "2026-08-14T00:20:00.001Z",
    }),
  )
})

test("browser cache never extends a server hit beyond authoritative expiresAt", async () => {
  let now = Date.parse("2026-08-14T00:09:59.000Z")
  let calls = 0
  const cache = cacheModule.createDashboardStatisticsMemoryCache({ now: () => now })
  const key = "actor:admin:dashboard-statistics-v1:overview:all:all::"
  const loader = async () => {
    calls += 1
    return snapshot()
  }

  assert.deepEqual(await cache.load(key, loader), snapshot())
  now += 999
  assert.deepEqual(await cache.load(key, loader), snapshot())
  assert.equal(calls, 1)

  now += 2
  await assert.rejects(
    cache.load(key, async () => snapshot()),
    /dashboard_statistics_snapshot_expired/,
  )
  assert.equal(calls, 1)
})

test("browser cache rejects expired or malformed snapshots without retaining them", async () => {
  const now = Date.parse("2026-08-14T00:10:00.001Z")
  let calls = 0
  const cache = cacheModule.createDashboardStatisticsMemoryCache({ now: () => now })
  const key = "actor:admin:dashboard-statistics-v1:overview:all:all::"

  await assert.rejects(
    cache.load(key, async () => {
      calls += 1
      return snapshot()
    }),
    /dashboard_statistics_snapshot_expired/,
  )
  await assert.rejects(
    cache.load(key, async () => {
      calls += 1
      return { data: { unsafe: true } }
    }),
    /dashboard_statistics_response_invalid/,
  )
  assert.deepEqual(
    await cache.load(key, async () => {
      calls += 1
      return snapshot({
        value: 3,
        generatedAt: "2026-08-14T00:10:00.001Z",
        expiresAt: "2026-08-14T00:20:00.001Z",
      })
    }),
    snapshot({
      value: 3,
      generatedAt: "2026-08-14T00:10:00.001Z",
      expiresAt: "2026-08-14T00:20:00.001Z",
    }),
  )
  assert.equal(calls, 3)
})

test("browser cache rejects a valid-looking envelope without its own data field", async () => {
  const now = Date.parse("2026-08-14T00:00:00.000Z")
  let calls = 0
  const cache = cacheModule.createDashboardStatisticsMemoryCache({ now: () => now })
  const key = "actor:admin:dashboard-statistics-v1:overview:all:all::"
  const missingData = snapshot()
  delete missingData.data

  await assert.rejects(
    cache.load(key, async () => {
      calls += 1
      return missingData
    }),
    /dashboard_statistics_response_invalid/,
  )
  assert.deepEqual(
    await cache.load(key, async () => {
      calls += 1
      return snapshot({ value: 2 })
    }),
    snapshot({ value: 2 }),
  )
  assert.equal(calls, 2)
})

test("force refresh stays pending across StrictMode cleanup and dependency abort until success", () => {
  assert.equal(typeof cacheModule.createDashboardStatisticsForceIntent, "function")
  const initial = cacheModule.createDashboardStatisticsForceIntent()
  const requested = cacheModule.requestDashboardStatisticsForce(initial)
  assert.equal(cacheModule.isDashboardStatisticsForcePending(requested), true)

  const strictModeCleanup = cacheModule.settleDashboardStatisticsForce(requested, {
    revision: requested.requestedRevision,
    completed: false,
  })
  assert.deepEqual(strictModeCleanup, requested)
  assert.equal(cacheModule.isDashboardStatisticsForcePending(strictModeCleanup), true)

  const dependencyAbort = cacheModule.settleDashboardStatisticsForce(strictModeCleanup, {
    revision: requested.requestedRevision,
    completed: false,
  })
  assert.equal(cacheModule.isDashboardStatisticsForcePending(dependencyAbort), true)

  const completed = cacheModule.settleDashboardStatisticsForce(dependencyAbort, {
    revision: requested.requestedRevision,
    completed: true,
  })
  assert.equal(cacheModule.isDashboardStatisticsForcePending(completed), false)
})

test("keyed snapshots never expose the prior tab, preset, or filter result", () => {
  assert.equal(typeof cacheModule.dashboardStatisticsSnapshotForKey, "function")
  const overviewKey = "actor:admin:dashboard-statistics-v1:overview:all:all::"
  const overviewResult = { key: overviewKey, snapshot: snapshot() }

  assert.deepEqual(
    cacheModule.dashboardStatisticsSnapshotForKey(overviewResult, overviewKey),
    snapshot(),
  )
  for (const changedKey of [
    "actor:admin:dashboard-statistics-v1:textbooks:all::2026-05-17:2026-08-14",
    "actor:admin:dashboard-statistics-v1:textbooks:all::2026-02-16:2026-08-14",
    "actor:admin:dashboard-statistics-v1:overview:math:all::",
  ]) {
    assert.equal(cacheModule.dashboardStatisticsSnapshotForKey(overviewResult, changedKey), null)
  }
})

test("range presets are tab-specific, URL allowlisted, and use local calendar bounds", () => {
  assert.deepEqual(contractModule.DASHBOARD_STATISTICS_RANGE_PRESETS.schedule_conflicts, [90, 180, 400])
  assert.deepEqual(contractModule.DASHBOARD_STATISTICS_RANGE_PRESETS.textbooks, [30, 90, 180, 365])
  assert.equal(contractModule.normalizeDashboardStatisticsRange("schedule_conflicts", "180"), 180)
  assert.equal(contractModule.normalizeDashboardStatisticsRange("schedule_conflicts", "365"), 90)
  assert.equal(contractModule.normalizeDashboardStatisticsRange("textbooks", "bad"), 90)
  assert.deepEqual(
    contractModule.buildDashboardStatisticsDateRange(
      "schedule_conflicts",
      90,
      new Date("2026-08-14T03:00:00+09:00"),
    ),
    { dateFrom: "2026-08-14", dateTo: "2026-11-12" },
  )
  assert.deepEqual(
    contractModule.buildDashboardStatisticsDateRange(
      "textbooks",
      90,
      new Date("2026-08-14T03:00:00+09:00"),
    ),
    { dateFrom: "2026-05-17", dateTo: "2026-08-14" },
  )
})

test("browser statistics request sends only bearer plus validated GET query and honors cancellation", async () => {
  const controller = new AbortController()
  let observed
  const response = cacheModule.fetchDashboardStatisticsSnapshot({
    accessToken: "secret-token",
    request: {
      tab: "schedule_conflicts",
      subject: "",
      division: "",
      dateFrom: "2026-08-14",
      dateTo: "2026-11-12",
    },
    signal: controller.signal,
    fetcher: async (url, init) => {
      observed = { url, init }
      return new Response(JSON.stringify({
        ok: true,
        contractVersion: "dashboard-statistics-v1",
        tab: "schedule_conflicts",
        data: { teacherConflicts: [] },
        generatedAt: GENERATED_AT,
        expiresAt: "2026-08-14T00:10:00.000Z",
        cacheStatus: "hit",
      }), { status: 200, headers: { "content-type": "application/json" } })
    },
  })
  controller.abort()
  assert.equal((await response).cacheStatus, "hit")
  assert.equal(observed.init.method, "GET")
  assert.equal(observed.init.headers.Authorization, "Bearer secret-token")
  assert.equal(observed.init.signal, controller.signal)
  assert.equal(observed.url, "/api/dashboard/statistics?tab=schedule_conflicts&dateFrom=2026-08-14&dateTo=2026-11-12")
  assert.equal(observed.url.includes("secret-token"), false)
})

test("production route keeps service role on cache wrappers and user JWT on invoker statistics", async () => {
  const [serverSource, appRouteSource, hookSource] = await Promise.all([
    readFile(new URL("../src/features/dashboard/server/statistics-route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/dashboard/statistics/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/dashboard/use-statistics-snapshot.ts", import.meta.url), "utf8"),
  ])

  assert.match(serverSource, /createAuthenticatedClient/iu)
  assert.match(serverSource, /createCacheServiceClient/iu)
  assert.match(serverSource, /actorClient[^;]*get_dashboard_statistics_sources_v1/isu)
  const cacheAdapter = serverSource.slice(
    serverSource.indexOf("function createProductionCache"),
    serverSource.indexOf("export function createProductionDashboardStatisticsRouteHandler"),
  )
  assert.doesNotMatch(cacheAdapter, /get_dashboard_statistics_sources_v1/iu)
  assert.ok((serverSource.match(/\.abortSignal\(AbortSignal\.timeout\(8_000\)\)\s*\.retry\(false\)/gu) || []).length >= 2)
  assert.match(appRouteSource, /createProductionDashboardStatisticsRouteHandler/iu)
  assert.match(hookSource, /new AbortController\(\)/u)
  assert.doesNotMatch(`${serverSource}\n${hookSource}`, /localStorage|sessionStorage/iu)
})
