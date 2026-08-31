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
import * as managementPageSizing from "../src/features/management/management-page-size.ts";

const root = new URL("../", import.meta.url);

test("management sizing quantizes measured row capacity without exceeding 20", () => {
  assert.equal(pickManagementListPageSize(0), 10);
  assert.equal(pickManagementListPageSize(5), 10);
  assert.equal(pickManagementListPageSize(9), 10);
  assert.equal(pickManagementListPageSize(10), 10);
  assert.equal(pickManagementListPageSize(14), 10);
  assert.equal(pickManagementListPageSize(15), 15);
  assert.equal(pickManagementListPageSize(19), 15);
  assert.equal(pickManagementListPageSize(20), 20);
  assert.equal(pickManagementListPageSize(200), 20);
});

test("management scrollport reserves the pager without reducing the minimum page size", () => {
  assert.equal(typeof managementPageSizing.getManagementListViewportHeight, "function");
  for (const [viewportHeight, viewportDocumentTop, expected] of [
    [768, 250, 430],
    [900, 250, 562],
    [952, 250, 614],
    [768, 376, 304],
    [400, 376, 160],
  ]) {
    assert.equal(managementPageSizing.getManagementListViewportHeight({
      viewportHeight, viewportDocumentTop, footerHeight: 44, footerGap: 12, bottomReserve: 32,
    }), expected);
  }
});

test("management scrollport sizing does not depend on tall rows or internal scroll position", () => {
  assert.equal(typeof managementPageSizing.getManagementListViewportHeight, "function");
  for (const [viewportTop, documentScrollTop] of [[250, 0], [50, 200]]) {
    const height = managementPageSizing.getManagementListViewportHeight({
      viewportHeight: 768, viewportDocumentTop: viewportTop + documentScrollTop,
      footerHeight: 44, footerGap: 12, bottomReserve: 32,
    });
    assert.equal(height, 430);
    assert.equal(pickManagementListPageSize(Math.floor((height - 37) / 81)), 10);
  }
});

test("management table has one keyboard-accessible scrollport and an external pager", async () => {
  const source = await readFile(new URL("src/features/management/management-data-table.tsx", root), "utf8");
  assert.match(source, /data-testid="management-table-viewport"/);
  assert.match(source, /useLayoutEffect\(\(\) => \{\s*const tableLayout = tableLayoutRef\.current/);
  assert.match(source, /tabIndex=\{0\}/);
  assert.match(source, /md:max-h-\[var\(--management-table-height\)\]/);
  assert.match(source, /\[&>\[data-slot=table-container\]\]:overflow-visible/);
  assert.match(source, /bodyViewportTop: bodyRect\.top \+ tableViewport\.scrollTop/);
  assert.match(source, /bodyToFooterGap: footerGap \+ viewportBottomBorder/);
  assert.match(source, /<\/Table>\s*<\/div>\s*<div ref=\{tablePagerRef\}/);
  assert.doesNotMatch(source, /sticky top-0[^"\n]*relative/);
  assert.match(source, /tableY: tableViewportRef\.current\?\.scrollTop \|\| 0/);
  assert.match(source, /tableViewportRef\.current\.scrollTop = savedScroll\.tableY/);
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
  assert.equal(parseManagementPageSizePreference('{"version":1,"size":5}'), null);
  assert.equal(parseManagementPageSizePreference('{"version":2,"size":20}'), null);
  assert.equal(parseManagementPageSizePreference("broken"), null);
});

test("management sizing estimates viewport capacities at fixed breakpoints", () => {
  assert.equal(estimateManagementListPageSize(759), 10);
  assert.equal(estimateManagementListPageSize(760), 15);
  assert.equal(estimateManagementListPageSize(940), 20);
});

test("management sizing reserves the complete footer, measured gap, and shell bottom space", () => {
  assert.equal(typeof managementPageSizing.getManagementListRowCapacity, "function");
  const cases = [
    { viewportHeight: 768, footerHeight: 44, expectedFit: 10, expectedSize: 10 },
    { viewportHeight: 952, footerHeight: 44, expectedFit: 15, expectedSize: 15 },
    { viewportHeight: 930, footerHeight: 44, expectedFit: 14, expectedSize: 10 },
    { viewportHeight: 952, footerHeight: 80, expectedFit: 14, expectedSize: 10 },
  ];

  for (const testCase of cases) {
    const fit = managementPageSizing.getManagementListRowCapacity({
      viewportHeight: testCase.viewportHeight,
      bodyViewportTop: 287,
      documentScrollTop: 0,
      rowHeight: 37,
      footerHeight: testCase.footerHeight,
      bodyToFooterGap: 13,
      bottomReserve: 32,
    });
    assert.equal(fit, testCase.expectedFit);
    assert.equal(pickManagementListPageSize(fit), testCase.expectedSize);
  }
});

test("management sizing uses document position so scrolling cannot create extra row capacity", () => {
  assert.equal(typeof managementPageSizing.getManagementListRowCapacity, "function");
  for (const [bodyViewportTop, documentScrollTop] of [[287, 0], [87, 200], [-213, 500]]) {
    assert.equal(managementPageSizing.getManagementListRowCapacity({
      viewportHeight: 768,
      bodyViewportTop,
      documentScrollTop,
      rowHeight: 37,
      footerHeight: 44,
      bodyToFooterGap: 13,
      bottomReserve: 32,
    }), 10);
  }
});

test("management sizing accounts for a bulk-action layout shift without negative capacities", () => {
  assert.equal(typeof managementPageSizing.getManagementListRowCapacity, "function");
  assert.equal(managementPageSizing.getManagementListRowCapacity({
    viewportHeight: 768,
    bodyViewportTop: 383,
    documentScrollTop: 0,
    rowHeight: 37,
    footerHeight: 44,
    bodyToFooterGap: 13,
    bottomReserve: 32,
  }), 8);
  assert.equal(managementPageSizing.getManagementListRowCapacity({
    viewportHeight: 200,
    bodyViewportTop: 287,
    documentScrollTop: 0,
    rowHeight: 37,
    footerHeight: 44,
    bodyToFooterGap: 13,
    bottomReserve: 32,
  }), 0);
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
  assert.match(pageSource, /hasMore=\{hasMore\}/);
  assert.match(pageSource, /loadingMore=\{loadingMore\}/);
  assert.match(pageSource, /onLoadMore=\{loadMore\}/);
  assert.doesNotMatch(pageSource, /data-testid="management-list-continuation"/);
  assert.match(tableSource, /`다음 \$\{pageSize\}건`/);
  assert.match(tableSource, /data-testid="management-list-continuation"/);
  assert.match(tableSource, /onClick=\{\(\) => void onLoadMore\(\)\}/);
  assert.match(tableSource, /disabled=\{loading \|\| loadingMore\}/);

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
  assert.match(tableSource, /getManagementListRowCapacity\(\{/);
  assert.match(tableSource, /documentScrollTop: window\.scrollY/);
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
