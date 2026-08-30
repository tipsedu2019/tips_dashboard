import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  clampManagementPageIndex,
  estimateManagementListPageSize,
  managementPageSizeStorageKey,
  parseManagementPageSizePreference,
  pickManagementListPageSize,
} from "../src/features/management/management-page-size.ts";

const root = new URL("../", import.meta.url);

test("management sizing quantizes measured row capacity without exceeding 20", () => {
  assert.equal(pickManagementListPageSize(9), 10);
  assert.equal(pickManagementListPageSize(10), 10);
  assert.equal(pickManagementListPageSize(14), 10);
  assert.equal(pickManagementListPageSize(15), 15);
  assert.equal(pickManagementListPageSize(19), 15);
  assert.equal(pickManagementListPageSize(20), 20);
  assert.equal(pickManagementListPageSize(200), 20);
});

test("management pagination preserves appends and clamps shrink at an unchanged page size", () => {
  assert.equal(clampManagementPageIndex(1, 40, 20), 1);
  assert.equal(clampManagementPageIndex(1, 60, 20), 1);
  assert.equal(clampManagementPageIndex(1, 20, 20), 0);
  assert.equal(clampManagementPageIndex(1, 0, 20), 0);
});

test("management sizing accepts only a versioned user override", () => {
  assert.deepEqual(parseManagementPageSizePreference('{"version":1,"size":15}'), { version: 1, size: 15 });
  assert.equal(parseManagementPageSizePreference('{"version":1,"size":30}'), null);
  assert.equal(parseManagementPageSizePreference('{"version":2,"size":20}'), null);
  assert.equal(parseManagementPageSizePreference("broken"), null);
});

test("management sizing estimates viewport capacities at fixed breakpoints", () => {
  assert.equal(estimateManagementListPageSize(759), 10);
  assert.equal(estimateManagementListPageSize(760), 15);
  assert.equal(estimateManagementListPageSize(940), 20);
});

test("management sizing quantizes hand-derived available-height fits", () => {
  const cases = [
    { viewportBottom: 860, bodyTop: 120, pagerHeight: 44, margin: 16, rowHeight: 34, expectedFit: 20, expectedSize: 20 },
    { viewportBottom: 690, bodyTop: 120, pagerHeight: 44, margin: 16, rowHeight: 34, expectedFit: 15, expectedSize: 15 },
    { viewportBottom: 656, bodyTop: 120, pagerHeight: 44, margin: 16, rowHeight: 34, expectedFit: 14, expectedSize: 10 },
  ];

  for (const testCase of cases) {
    const fit = Math.floor(
      (testCase.viewportBottom - testCase.bodyTop - testCase.pagerHeight - testCase.margin)
      / testCase.rowHeight,
    );
    assert.equal(fit, testCase.expectedFit);
    assert.equal(pickManagementListPageSize(fit), testCase.expectedSize);
  }
});

test("management sizing uses a versioned kind-specific storage key", () => {
  assert.equal(managementPageSizeStorageKey("students"), "tips:management-page-size:students:v1");
  assert.equal(managementPageSizeStorageKey("classes"), "tips:management-page-size:classes:v1");
  assert.equal(managementPageSizeStorageKey("textbooks"), "tips:management-page-size:textbooks:v1");
});

test("management page wires adaptive sizing into the request and controlled table pagination", async () => {
  const pageSource = await readFile(new URL("src/features/management/management-page.tsx", root), "utf8");
  const tableSource = await readFile(new URL("src/features/management/management-data-table.tsx", root), "utf8");

  assert.match(pageSource, /managementPageSizeStorageKey\(kind\)/);
  assert.match(pageSource, /useManagementRecords\(kind, managementListFilters, \{[\s\S]*?enabled: pageSizeState\.ready,[\s\S]*?pageSize: pageSizeState\.size/);
  assert.match(pageSource, /pageSize=\{pageSizeState\.size\}/);
  assert.match(pageSource, /pageSizeMode=\{pageSizeState\.mode\}/);
  assert.match(pageSource, /onAutoPageSizeChange=\{handleAutoPageSizeChange\}/);
  assert.match(pageSource, /onPageSizePreferenceChange=\{handlePageSizePreferenceChange\}/);
  assert.match(pageSource, /`다음 \$\{pageSizeState\.size\}건`/);
  assert.doesNotMatch(pageSource, /loadingMore \? "불러오는 중" : "다음 30건"/);

  assert.match(tableSource, /MANAGEMENT_LIST_PAGE_SIZES/);
  assert.match(tableSource, /pagination: \{ pageIndex, pageSize \}/);
  assert.match(tableSource, /onPaginationChange:/);
  assert.match(tableSource, /useEffect\(\(\) => \{\s*setPageIndex\(0\);\s*\}, \[kind, pageSize\]\);/);
  assert.match(tableSource, /const prePaginationRowCount = table\.getPrePaginationRowModel\(\)\.rows\.length/);
  assert.match(tableSource, /clampManagementPageIndex\(current, prePaginationRowCount, pageSize\)/);
  assert.match(tableSource, /new ResizeObserver/);
  assert.match(tableSource, /resizeObserver\.disconnect\(\)/);
  assert.match(tableSource, /window\.removeEventListener\("resize", measurePageSize\)/);
  assert.match(tableSource, /const tableLayoutRef = useRef<HTMLDivElement \| null>\(null\)/);
  assert.match(tableSource, /<div ref=\{tableLayoutRef\} className="w-full space-y-3">/);
  assert.match(tableSource, /resizeObserver\.observe\(tableLayout\)/);
  assert.match(tableSource, /<TableBody ref=\{tableBodyRef\}>/);
  assert.match(tableSource, /className="h-\[34px\] border-b/);
  assert.match(tableSource, /"sticky top-0 z-10 h-9 border-b[^"]*px-2 py-1/);
  assert.match(tableSource, /className="size-6 text-destructive/);
  assert.match(tableSource, /className="size-6" aria-label="컬럼 구성"/);
  assert.match(tableSource, /checked=\{column\.getIsVisible\(\)\}[\s\S]*?className="size-6"/);
  assert.match(tableSource, /aria-label=\{`\$\{columnLabel\} 열 너비 조절`\}[\s\S]*?w-6[\s\S]*?after:w-px/);
  assert.match(tableSource, /ref=\{tablePagerRef\} className="flex min-h-11/);
  assert.doesNotMatch(tableSource, /const PAGE_SIZE_OPTIONS = \[30\]/);
});
