import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import {
  getNumberedPagination,
  normalizePage,
  validatePageSize,
} from "../src/lib/numbered-pagination.ts"

test("shared numbered-pagination contracts export page envelopes and size preferences", async () => {
  const source = await readFile(new URL("../src/lib/numbered-pagination.ts", import.meta.url), "utf8")
  assert.match(source, /export type DataTablePageSizePreference = "auto" \| DataTablePageSize/)
  assert.match(source, /export type NumberedPage<T> = \{\s*rows: T\[\]\s*page: number\s*pageSize: DataTablePageSize\s*totalCount: number\s*\}/s)
})

test("numbered pagination uses fixed blocks of ten pages", () => {
  assert.deepEqual(getNumberedPagination({ page: 9, pageSize: 10, totalCount: 260 }).pages, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  assert.deepEqual(getNumberedPagination({ page: 10, pageSize: 10, totalCount: 260 }).pages, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  assert.deepEqual(getNumberedPagination({ page: 11, pageSize: 10, totalCount: 260 }).pages, [11, 12, 13, 14, 15, 16, 17, 18, 19, 20])
  assert.deepEqual(getNumberedPagination({ page: 20, pageSize: 10, totalCount: 260 }).pages, [11, 12, 13, 14, 15, 16, 17, 18, 19, 20])
  assert.deepEqual(getNumberedPagination({ page: 21, pageSize: 10, totalCount: 260 }).pages, [21, 22, 23, 24, 25, 26])
  assert.deepEqual(getNumberedPagination({ page: 26, pageSize: 10, totalCount: 260 }).pages, [21, 22, 23, 24, 25, 26])
})

test("row sizes never change the ten-number grouping rule", () => {
  for (const pageSize of [10, 15, 20]) {
    assert.deepEqual(
      getNumberedPagination({ page: 11, pageSize, totalCount: pageSize * 26 }).pages,
      [11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
    )
  }
})

test("numbered pagination clamps known totals and preserves unknown totals", () => {
  assert.equal(getNumberedPagination({ page: 50, pageSize: 20, totalCount: 21 }).page, 2)
  assert.equal(getNumberedPagination({ page: 1, pageSize: 20, totalCount: null }).totalPages, null)
  assert.deepEqual(getNumberedPagination({ page: 1, pageSize: 20, totalCount: null }), {
    page: 1,
    totalPages: null,
    pages: [],
    rangeStart: 0,
    rangeEnd: 0,
    canPrevious: false,
    canNext: false,
  })
})

test("numbered pagination represents empty results without page zero", () => {
  assert.deepEqual(getNumberedPagination({ page: 99, pageSize: 10, totalCount: 0 }), {
    page: 1,
    totalPages: 0,
    pages: [],
    rangeStart: 0,
    rangeEnd: 0,
    canPrevious: false,
    canNext: false,
  })
})

test("numbered pagination covers single, full, and partial ten-page blocks", () => {
  for (const totalPages of [1, 9, 10, 11, 20, 21]) {
    const totalCount = totalPages * 10
    const result = getNumberedPagination({ page: totalPages, pageSize: 10, totalCount })
    assert.equal(result.totalPages, totalPages)
    assert.equal(result.pages.at(-1), totalPages)
    assert.ok(result.pages.length <= 10)
  }
})

test("invalid pages normalize to one and page sizes are strictly limited", () => {
  assert.equal(normalizePage("bad"), 1)
  assert.equal(normalizePage(0), 1)
  assert.equal(normalizePage(1.5), 1)
  assert.equal(validatePageSize(10), 10)
  assert.equal(validatePageSize(15), 15)
  assert.equal(validatePageSize(20), 20)
  assert.throws(() => validatePageSize(0), /page size/i)
  assert.throws(() => validatePageSize(5), /page size/i)
  assert.throws(() => validatePageSize(30), /page size/i)
  assert.throws(() => getNumberedPagination({ page: 1, pageSize: 5, totalCount: 10 }), /page size/i)
})
