import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(testDir, "..");
const managementTableFile = path.join(
  root,
  "v2",
  "src",
  "features",
  "management",
  "management-data-table.tsx",
);

function readSource() {
  return fs.readFileSync(managementTableFile, "utf8");
}

test("management table exposes only resource-specific operational columns", () => {
  const source = readSource();

  for (const marker of [
    "const STUDENT_TABLE_COLUMN_IDS = [",
    '"school"',
    '"contact"',
    '"parentContact"',
    "const CLASS_TABLE_COLUMN_IDS = [",
    '"schedule"',
    '"teacher"',
    '"classroom"',
    '"enrollmentStatus"',
    '"weeklyHours"',
    '"tuition"',
    "const TEXTBOOK_TABLE_COLUMN_IDS = [",
    '"publisher"',
    '"price"',
    '"updatedAt"',
    "const TABLE_COLUMN_IDS_BY_KIND",
    "function getKindColumnIds(kind: ManagementKind)",
    "return getKindColumnIds(kind).has(columnId) && USER_FACING_COLUMN_IDS.has(columnId);",
    "const badgeColumn = allColumnIds.includes(\"badge\") ? table.getColumn(\"badge\") : undefined;",
    "{badgeColumn ? (",
    "onValueChange={(value) => badgeColumn.setFilterValue(value === \"all\" ? \"\" : value)}",
  ]) {
    assert.equal(source.includes(marker), true, `expected ${marker}`);
  }

  for (const staleMarker of [
    "COMMON_RAW_COLUMN_IDS",
    "sortRawColumnKeys",
    "rawColumns",
    "raw:academic_year",
    "raw:school",
    "raw:publisher",
    "raw:price",
    "DB 원본 열",
  ]) {
    assert.equal(source.includes(staleMarker), false, `unexpected raw/source-column marker ${staleMarker}`);
  }
});

test("management table persists per-resource column order, grouping, and sizing while supporting direct header resize", () => {
  const source = readSource();

  for (const marker of [
    "const STORAGE_VERSION = 9;",
    "columnVisibility: VisibilityState;",
    "columnOrder: ColumnOrderState;",
    "columnSizing: ColumnSizingState;",
    "sorting: SortingState;",
    "grouping: GroupingState;",
    "const DEFAULT_COLUMN_WIDTHS",
    "function buildDefaultColumnSizing(columnIds: string[])",
    "function normalizeColumnWidth(value: unknown, fallback: number)",
    "const storageKey = `tips-management-table:${kind}:v${STORAGE_VERSION}`;",
    "const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});",
    "onColumnSizingChange: setColumnSizing",
    'columnResizeMode: "onChange"',
    "setColumnSizing(sanitized.columnSizing)",
    "window.localStorage.setItem(storageKey, JSON.stringify(nextValue));",
    'aria-label={`${option.label} 너비`}',
    "style={getColumnSizeStyle(header.getSize())}",
    "style={getColumnSizeStyle(cell.column.getSize())}",
    "header.column.getCanResize()",
    "header.getResizeHandler()",
    "header.column.getIsResizing()",
    "header.column.resetSize()",
    "header.column.getCanSort()",
    "header.column.getIsSorted()",
    "header.column.toggleSorting(sortState === \"asc\")",
    "aria-sort={sortState === \"asc\" ? \"ascending\" : sortState === \"desc\" ? \"descending\" : undefined}",
    "aria-label={`${columnLabel} 너비 조절`}",
  ]) {
    assert.equal(source.includes(marker), true, `expected ${marker}`);
  }
});
