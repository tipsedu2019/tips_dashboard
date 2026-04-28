import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

async function readSource(pathname) {
  return readFile(new URL(pathname, root), "utf8");
}

test("annual board uses one unified editable map without mode tabs", async () => {
  const source = await readSource("src/features/operations/academic-annual-board-workspace.tsx");

  assert.doesNotMatch(source, /빠른 편집/);
  assert.doesNotMatch(source, /전체 맵/);
  assert.doesNotMatch(source, /Tabs/);
  assert.match(source, /AnnualBoardMapView/);
  assert.match(source, /onCellCreate/);
  assert.match(source, /onEntryEdit/);
});

test("annual board exposes only 전체, 1학기, 2학기 period filtering", async () => {
  const source = await readSource("src/features/operations/academic-annual-board-workspace.tsx");

  assert.match(source, /const SEMESTER_FILTER_OPTIONS = \["전체", "1학기", "2학기"\] as const/);
  assert.match(source, /Label htmlFor="annual-board-semester"[^>]*>시기<\/Label>/);
  assert.match(source, /getTermRows\(selectedSemester\)/);
  assert.match(source, /row\.semester === selectedSemester/);
});

test("annual board hover popover shows subject scope and opens existing edit modal", async () => {
  const source = await readSource("src/features/operations/academic-annual-board-workspace.tsx");

  assert.match(source, /HoverCard/);
  assert.match(source, /교재 시험범위/);
  assert.match(source, /부교재 시험범위/);
  assert.match(source, /getStructuredScopeItems/);
  assert.match(source, /setShowBoardEventForm\(true\)/);
  assert.match(source, /<EventForm/);
});

test("annual board keeps print and dense visual map affordances", async () => {
  const [source, globals] = await Promise.all([
    readSource("src/features/operations/academic-annual-board-workspace.tsx"),
    readSource("src/app/globals.css"),
  ]);

  assert.match(source, /window\.print\(\)/);
  assert.match(globals, /@page\s*\{\s*size:\s*A4 landscape/);
  assert.match(globals, /\.annual-board-map-row-alt/);
  assert.match(globals, /\.annual-board-row-active/);
  assert.match(globals, /\.annual-board-column-active/);
  assert.match(globals, /\.annual-board-value-period/);
  assert.match(globals, /\.annual-board-value-empty/);
});

test("annual board model classifies event semesters by requested month split", async () => {
  const source = await readSource("src/features/operations/academic-calendar-models.js");

  assert.match(source, /\["01", "02", "03", "04", "05", "06", "07"\]\.includes\(month\)\) return "1학기"/);
  assert.match(source, /\["08", "09", "10", "11", "12"\]\.includes\(month\)\) return "2학기"/);
});
