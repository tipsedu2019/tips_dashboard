import assert from "node:assert/strict"
import test from "node:test"
import {
  buildWorkloadTeams,
  normalizeWorkloadSummary,
  normalizeWorkloadPage,
  workloadDays,
} from "../src/features/dashboard/workload-contract.ts"
import {
  readWorkloadPage,
  readWorkloadSummary,
} from "../src/features/dashboard/workload-service.ts"

const now = "2026-09-22T01:00:00Z"
const group = (extra = {}) => ({
  team: "영어팀",
  ownerKey: "owner-a",
  ownerLabel: "같은 이름",
  workflow: "registration",
  stage: "consultation_completed",
  stageLabel: "상담 완료 후속 처리",
  total: 3,
  aged: 2,
  oldestAt: "2026-09-10T01:00:00Z",
  oldestRequestedAt: "2026-09-01T01:00:00Z",
  elapsedSeconds: 3 * 21 * 86400,
  ...extra,
})
test("workload matrix sums each work unit once and keeps same-name accounts and team pools separate", () => {
  const teams = buildWorkloadTeams([
    group(),
    group({
      ownerKey: "owner-b",
      workflow: "transfer",
      total: 2,
      aged: 0,
      elapsedSeconds: 2 * 3 * 86400,
      oldestRequestedAt: "2026-09-19T01:00:00Z",
    }),
    group({
      team: "관리팀",
      ownerKey: "team",
      ownerLabel: "팀 공통",
      total: 4,
      aged: 1,
    }),
  ])
  assert.equal(teams.length, 2)
  assert.equal(teams[0].summary.total, 5)
  assert.deepEqual(teams[0].summary.counts, {
    registration: 3,
    transfer: 2,
    withdrawal: 0,
    makeup: 0,
  })
  assert.equal(teams[0].owners.length, 2)
  assert.equal(
    teams[0].summary.elapsedSeconds / teams[0].summary.total / 86400,
    13.8,
  )
  assert.equal(teams[0].summary.oldestRequestedAt, "2026-09-01T01:00:00Z")
  assert.equal(
    teams.reduce((sum, t) => sum + t.summary.total, 0),
    9,
  )
  assert.equal(teams[1].owners[0].ownerKey, "team")
})
test("empty is valid, unavailable and inconsistent aggregate contracts fail instead of showing zero", () => {
  assert.deepEqual(
    normalizeWorkloadSummary({ generatedAt: now, groups: [] }).groups,
    [],
  )
  for (const value of [
    null,
    {},
    { generatedAt: now, groups: [group({ aged: 4 })] },
    { generatedAt: now, groups: [group(), group()] },
    { generatedAt: now, groups: [group({ total: -1 })] },
    { generatedAt: now, groups: [group({ elapsedSeconds: -1 })] },
    { generatedAt: now, groups: [group({ oldestRequestedAt: null })] },
  ])
    assert.throws(() => normalizeWorkloadSummary(value), /contract_invalid/)
  assert.equal(workloadDays("2026-09-15T01:00:01Z", now), 6)
  assert.equal(workloadDays("2026-09-23T01:00:00Z", now), 0)
})
const item = {
  ...group(),
  key: "registration:track-a",
  title: "합성 학생 · 영어",
  enteredAt: "2026-09-10T01:00:00Z",
  requestedAt: "2026-09-01T01:00:00Z",
  href: "/admin/registration?taskId=task-a&trackId=track-a",
}
const page = {
  generatedAt: now,
  page: 1,
  pageSize: 10,
  totalCount: 1,
  rows: [item],
}
test("detail contracts keep actual workflow destinations and reject external, mismatched and duplicate links", () => {
  assert.equal(normalizeWorkloadPage(page).rows[0].href, item.href)
  assert.equal(
    workloadDays(normalizeWorkloadPage(page).rows[0].requestedAt, now),
    21,
  )
  assert.equal(
    workloadDays(normalizeWorkloadPage(page).rows[0].enteredAt, now),
    12,
  )
  for (const href of [
    "https://attacker.invalid/admin/registration?taskId=a",
    "//attacker.invalid/",
    "/admin/withdrawal?taskId=a",
    "javascript:alert(1)",
  ])
    assert.throws(() =>
      normalizeWorkloadPage({ ...page, rows: [{ ...item, href }] }),
    )
  assert.throws(() =>
    normalizeWorkloadPage({ ...page, totalCount: 2, rows: [item, item] }),
  )
})
function client(data, error = null) {
  const calls = []
  return {
    calls,
    rpc(name, args) {
      calls.push({ name, args })
      return {
        abortSignal(signal) {
          assert.ok(signal instanceof AbortSignal)
          return {
            retry(enabled) {
              assert.equal(enabled, false)
              return Promise.resolve({ data, error })
            },
          }
        },
      }
    },
  }
}
test("summary/detail are bounded RPC reads and detail scope/page cannot silently mismatch", async () => {
  const summaryClient = client({ generatedAt: now, groups: [group()] })
  assert.equal((await readWorkloadSummary(summaryClient)).groups[0].total, 3)
  assert.equal(summaryClient.calls[0].name, "get_dashboard_workload_v1")
  const detailClient = client(page)
  await readWorkloadPage(
    detailClient,
    { team: "영어팀", ownerKey: "owner-a", workflow: "registration" },
    1,
    10,
  )
  assert.equal(detailClient.calls[0].args.p_owner_key, "owner-a")
  await assert.rejects(
    readWorkloadPage(client(page), { team: "수학팀" }, 1, 10),
    /scope_mismatch/,
  )
  await assert.rejects(
    readWorkloadPage(client(page), { team: "영어팀" }, 2, 10),
    /scope_mismatch/,
  )
  await assert.rejects(
    readWorkloadSummary(client(null, new Error("offline"))),
    /offline/,
  )
})
