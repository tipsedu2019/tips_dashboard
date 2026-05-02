import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workspacePath = "src/features/management/school-master-workspace.tsx";
const columnsPath = "src/features/management/settings-table-columns.tsx";

async function readWorkspace() {
  return readFile(workspacePath, "utf8");
}

test("school settings adds visible rows and exposes search with category counts", async () => {
  const source = await readWorkspace();

  assert.match(source, /const \[query, setQuery\] = useState\(""\)/);
  assert.match(source, /placeholder="학교명 검색"/);
  assert.match(source, /const categoryCounts = useMemo/);
  assert.match(source, /createEmptySchool\(nextSortOrder, categoryFilter\)/);
  assert.match(source, /variant=\{categoryFilter === filter \? "default" : "outline"\}/);
  assert.match(source, /filter === "전체" \? rows\.length : categoryCounts\.get\(filter\)/);
});

test("school settings guards invalid edits and makes pending changes recoverable", async () => {
  const source = await readWorkspace();

  assert.match(source, /const duplicateNameSet = useMemo/);
  assert.match(source, /const invalidRows = useMemo/);
  assert.match(source, /disabled=\{!isDirty \|\| saving \|\| invalidRows\.size > 0\}/);
  assert.match(source, /되돌리기/);
  assert.match(source, /삭제 대기/);
  assert.match(source, /변경/);
  assert.match(source, /중복/);
});

test("school settings table keeps actions reachable in dense lists", async () => {
  const source = await readWorkspace();
  const columnSource = await readFile(columnsPath, "utf8");

  assert.match(source, /sticky right-0/);
  assert.match(source, /table-fixed min-w-\[720px\]/);
  assert.match(source, /aria-label="학교명 검색 초기화"/);
  assert.match(columnSource, /aria-label="컬럼 구성"/);
  assert.match(columnSource, /초기화/);
  assert.doesNotMatch(columnSource, /而щ읆|珥덇린|怨좎젙/);
});
