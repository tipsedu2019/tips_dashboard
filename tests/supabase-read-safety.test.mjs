import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import {
  applyPublicClassesQuerySafety,
  PUBLIC_CLASSES_QUERY_TIMEOUT_MS,
} from "../src/server/public-classes-payload.js"

test("public classes query safety applies an 8-second abort and disables retries", async () => {
  const calls = []
  const result = { data: [], error: null }
  const query = {
    abortSignal(signal) {
      calls.push({ kind: "abort", signal })
      return this
    },
    retry(value) {
      calls.push({ kind: "retry", value })
      return this
    },
    then(resolve, reject) {
      return Promise.resolve(result).then(resolve, reject)
    },
  }

  const response = await applyPublicClassesQuerySafety(query)

  assert.equal(PUBLIC_CLASSES_QUERY_TIMEOUT_MS, 8_000)
  assert.equal(calls[0].kind, "abort")
  assert.equal(calls[0].signal instanceof AbortSignal, true)
  assert.deepEqual(calls[1], { kind: "retry", value: false })
  assert.deepEqual(response, result)
})

test("academic and operations readers cancel stalled GETs without automatic retries", async () => {
  const [academic, operations] = await Promise.all([
    readFile(
      new URL("../src/features/academic/use-academic-workspace-data.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../src/features/operations/use-operations-workspace-data.ts", import.meta.url),
      "utf8",
    ),
  ])

  for (const source of [academic, operations]) {
    assert.match(source, /\.select\("\*"\)\s*\.abortSignal\(AbortSignal\.timeout\([^)]*\)\)\s*\.retry\(false\)/)
    assert.doesNotMatch(source, /Promise\.race/)
  }
})
