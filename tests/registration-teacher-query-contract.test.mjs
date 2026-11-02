import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import { inspectQuerySurfaceSource } from "../src/lib/query-surface-budget.js"

const file = "src/features/tasks/registration-teacher-detail-service.ts"
const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8")
const inspect = (candidate) => inspectQuerySurfaceSource({ surface: "tasks", file, source: candidate })

test("teacher detail uses the existing bounded RPC guard without a contract exemption", () => {
  assert.deepEqual(inspect(source), [])
})

test("teacher detail query guard still rejects an oversized or absent RPC limit", () => {
  const oversized = source.replace(/p_limit: (?:10|15|20)/g, "p_limit: 31")
  assert.notEqual(oversized, source)
  assert.ok(inspect(oversized).some(item => item.reason === "rpc_page_limit_exceeds_30"))
  const absent = source.replace(/p_limit: (?:10|15|20),?/g, "")
  assert.ok(inspect(absent).some(item => item.reason === "rpc_page_limit_missing"))
})

test("teacher detail query guard still requires cancellation and retry controls", () => {
  const uncancelled = source.replaceAll(".abortSignal(abort)", "")
  assert.notEqual(uncancelled, source)
  assert.ok(inspect(uncancelled).some(item => item.reason === "list_abort_signal_missing"))
  const retrying = source.replaceAll(".retry(false)", ".retry(true)")
  assert.ok(inspect(retrying).some(item => item.reason === "list_retry_false_missing"))
})
