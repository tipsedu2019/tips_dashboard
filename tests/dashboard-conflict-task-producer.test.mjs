import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

test("conflict monitoring has no task producer or link consumer in its application contract", async () => {
  const [service, contract] = await Promise.all([
    readFile(new URL("../src/features/tasks/ops-task-service.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/dashboard/conflict-contract.ts", import.meta.url), "utf8"),
  ])
  assert.doesNotMatch(contract, /DashboardConflictRpcInput|DashboardConflictTaskLink|projectDashboardConflictRpcInput/)
  assert.doesNotMatch(service, /listDashboardConflictTaskLinks|createDashboardConflictTask|list_dashboard_conflict_task_links_v1|create_dashboard_conflict_task_v1/)
  assert.match(contract, /export type DashboardConflictRow/)
})
