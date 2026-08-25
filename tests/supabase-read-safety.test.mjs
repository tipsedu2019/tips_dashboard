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
      new URL("../src/features/academic/academic-read-service.js", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../src/features/operations/operations-read-service.js", import.meta.url),
      "utf8",
    ),
  ])

  assert.match(academic, /client\.rpc\("get_academic_curriculum_page_v1"[\s\S]*?\.abortSignal\(AbortSignal\.timeout\(8_000\)\)\s*\.retry\(false\)/)
  assert.match(academic, /client\.rpc\("get_academic_timetable_range_v1"[\s\S]*?\.abortSignal\(AbortSignal\.timeout\(8_000\)\)\s*\.retry\(false\)/)
  assert.match(academic, /client\.rpc\("get_academic_curriculum_detail_v1"[\s\S]*?\.abortSignal\(AbortSignal\.timeout\(8_000\)\)\s*\.retry\(false\)/)
  assert.match(operations, /client\.rpc\("get_operations_calendar_range_v1"[\s\S]*?\.abortSignal\(AbortSignal\.timeout\(8_000\)\)\s*\.retry\(false\)/)
  assert.match(operations, /client\.rpc\("get_operations_class_lesson_design_detail_v1"[\s\S]*?\.abortSignal\(AbortSignal\.timeout\(8_000\)\)\s*\.retry\(false\)/)
  assert.doesNotMatch(academic, /Promise\.race/)
  assert.doesNotMatch(operations, /Promise\.race/)
})
