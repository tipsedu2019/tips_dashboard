import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  clampManagementPageIndex,
  getManagementListViewportHeight,
  managementPageSizeStorageKey,
  parseManagementPageSizePreference,
} from "../src/features/management/management-page-size.ts";

const root = new URL("../", import.meta.url);

test("management scrollport reserves the pager without changing the fixed page size", () => {
  for (const [viewportHeight, viewportDocumentTop, expected] of [
    [768, 250, 430],
    [900, 250, 562],
    [952, 250, 614],
    [768, 376, 304],
    [400, 376, 160],
  ]) {
    assert.equal(getManagementListViewportHeight({
      viewportHeight,
      viewportDocumentTop,
      footerHeight: 44,
      footerGap: 12,
      bottomReserve: 32,
    }), expected);
  }
});

test("management scrollport height is stable across document scroll positions", () => {
  for (const [viewportTop, documentScrollTop] of [[250, 0], [50, 200]]) {
    assert.equal(getManagementListViewportHeight({
      viewportHeight: 768,
      viewportDocumentTop: viewportTop + documentScrollTop,
      footerHeight: 44,
      footerGap: 12,
      bottomReserve: 32,
    }), 430);
  }
});

test("management table keeps one scrollport and observes only stable layout boundaries", async () => {
  const source = await readFile(new URL("src/features/management/management-data-table.tsx", root), "utf8");

  assert.match(source, /data-testid="management-table-viewport"/);
  assert.match(source, /tabIndex=\{0\}/);
  assert.match(source, /md:max-h-\[var\(--management-table-height\)\]/);
  assert.match(source, /\[&>\[data-slot=table-container\]\]:overflow-visible/);
  assert.match(source, /const measureViewportHeight = \(\) =>/);
  assert.match(source, /getManagementListViewportHeight\(\{/);
  assert.match(source, /resizeObserver\.observe\(tableLayout\)/);
  assert.match(source, /resizeObserver\.observe\(tablePager\)/);
  assert.match(source, /resizeObserver\.disconnect\(\)/);
  assert.match(source, /<\/Table>\s*<\/div>\s*<div ref=\{tablePagerRef\}/);
  assert.doesNotMatch(source, /getManagementListRowCapacity|onAutoPageSizeChange|pageSizeMode/);
  assert.doesNotMatch(source, /resizeObserver\.observe\(tableBody\)/);
});

test("management pagination preserves appends and clamps shrink at an unchanged page size", () => {
  assert.equal(clampManagementPageIndex(1, 40, 20), 1);
  assert.equal(clampManagementPageIndex(1, 60, 20), 1);
  assert.equal(clampManagementPageIndex(1, 20, 20), 0);
  assert.equal(clampManagementPageIndex(1, 0, 20), 0);
});

test("management sizing accepts only a versioned fixed user preference", () => {
  assert.deepEqual(parseManagementPageSizePreference('{"version":1,"size":10}'), { version: 1, size: 10 });
  assert.deepEqual(parseManagementPageSizePreference('{"version":1,"size":15}'), { version: 1, size: 15 });
  assert.deepEqual(parseManagementPageSizePreference('{"version":1,"size":20}'), { version: 1, size: 20 });
  assert.equal(parseManagementPageSizePreference('{"version":1,"size":"auto"}'), null);
  assert.equal(parseManagementPageSizePreference('{"version":1,"size":30}'), null);
  assert.equal(parseManagementPageSizePreference('{"version":1,"size":5}'), null);
  assert.equal(parseManagementPageSizePreference('{"version":2,"size":20}'), null);
  assert.equal(parseManagementPageSizePreference("broken"), null);
});

test("management sizing uses a versioned kind-specific storage key", () => {
  assert.equal(managementPageSizeStorageKey("students"), "tips:management-page-size:students:v1");
  assert.equal(managementPageSizeStorageKey("classes"), "tips:management-page-size:classes:v1");
  assert.equal(managementPageSizeStorageKey("textbooks"), "tips:management-page-size:textbooks:v1");
});
