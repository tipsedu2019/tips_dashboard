import assert from "node:assert/strict";
import test from "node:test";

import {
  collectClassGroupPages,
  sortClassGroupRows,
} from "../src/features/management/class-group-pagination.ts";

const CLASS_GROUP_PAGE_SIZE = 30;

test("class group pagination retains records beyond the per-request free-tier limit", async () => {
  const sourceRows = Array.from({ length: CLASS_GROUP_PAGE_SIZE + 7 }, (_, index) => ({
    id: String(index + 1).padStart(3, "0"),
    name: `그룹 ${index + 1}`,
  }));
  const requestedCursors = [];

  const result = await collectClassGroupPages(async (afterId) => {
    requestedCursors.push(afterId);
    const start = afterId ? sourceRows.findIndex(({ id }) => id === afterId) + 1 : 0;
    return {
      data: sourceRows.slice(start, start + CLASS_GROUP_PAGE_SIZE),
      error: null,
    };
  }, CLASS_GROUP_PAGE_SIZE);

  assert.equal(result.error, null);
  assert.deepEqual(result.data, sourceRows);
  assert.deepEqual(requestedCursors, [null, sourceRows[CLASS_GROUP_PAGE_SIZE - 1].id]);
});

test("class group pagination stops when a full page cannot advance its id cursor", async () => {
  const page = Array.from({ length: CLASS_GROUP_PAGE_SIZE }, () => ({ id: "same-id" }));
  const result = await collectClassGroupPages(
    async () => ({ data: page, error: null }),
    CLASS_GROUP_PAGE_SIZE,
  );

  assert.equal(result.data, null);
  assert.match(result.error.message, /페이지 기준값/);
});

test("class group sorting restores the prior display order with missing sort orders last", () => {
  const rows = [
    { id: "d", name: "나", sort_order: null },
    { id: "c", name: "가", sort_order: 2 },
    { id: "b", name: "가", sort_order: 1 },
    { id: "a", name: "가", sort_order: 1 },
  ];

  assert.deepEqual(
    sortClassGroupRows(rows, true).map(({ id }) => id),
    ["a", "b", "c", "d"],
  );
});
