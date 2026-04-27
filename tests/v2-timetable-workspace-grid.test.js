import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(testDir, "..");
const workspaceFile = path.join(root, "v2", "src", "features", "academic", "timetable-workspace.tsx");
const recordsFile = path.join(root, "v2", "src", "features", "academic", "records.js");
const toolbarFile = path.join(root, "v2", "src", "features", "academic", "filter-toolbar.tsx");
const layoutFile = path.join(root, "v2", "src", "features", "academic", "timetable-layout.ts");
const legacyGridFile = path.join(root, "v2", "src", "features", "academic", "components", "legacy-timetable-grid.jsx");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("v2 timetable workspace uses flatter operational shells instead of card-heavy wrappers", () => {
  const source = read(workspaceFile);

  assert.equal(source.includes('from "@/components/ui/card"'), false);
  assert.equal(source.includes('import { Badge } from "@/components/ui/badge";'), false);
  for (const marker of [
    'const [year, setYear] = useState("")',
    'teacherCatalogs: data.teacherCatalogs,',
    'classroomCatalogs: data.classroomCatalogs,',
    'setYear(workspace.yearOptions[workspace.yearOptions.length - 1] || "")',
    'setSubject(workspace.subjectOptions.includes("영어") ? "영어" : workspace.subjectOptions[0])',
    'setSubject(workspace.subjectOptions.includes("영어") ? "영어" : workspace.subjectOptions[0] || "")',
    'Label className="text-[11px] text-muted-foreground">과목',
    'Label className="text-[11px] text-muted-foreground">보기 전환',
    'Label className="text-[11px] text-muted-foreground">레이아웃',
    '선생님 주간',
    '강의실 주간',
    '일별 선생님',
    '일별 강의실',
    'const activeSubFilterLabel =',
    'view === "teacher-weekly"',
    'view === "classroom-weekly"',
    'workspace.teacherOptions.map((option) => (',
    'workspace.classroomOptions.map((option) => (',
    'workspace.dayOptions.map((option) => (',
    'justify-between gap-3 border-t border-border/70 pt-3',
    '필터 초기화',
    'toggleFilterValue(option, selectedTeachers, setSelectedTeachers)',
    'toggleFilterValue(option, selectedClassrooms, setSelectedClassrooms)',
    'toggleFilterValue(option, selectedDays, setSelectedDays)',
    'fitColumns={panelLayout.fitColumns}',
    'rounded-xl border border-border/70 bg-background shadow-sm',
    'bg-muted/15 px-4 py-3',
  ]) {
    assert.equal(source.includes(marker), true, `expected ${marker}`);
  }
  for (const absentMarker of [
    '{currentView.label}',
    '{grid.panels.length}개 패널',
    '연도 미선택',
    '학기 미선택',
    '과목 미선택',
    'Badge variant="outline" className="h-8 rounded-sm px-2 text-[11px] font-normal">선생님',
  ]) {
    assert.equal(source.includes(absentMarker), false, `did not expect ${absentMarker}`);
  }
});

test("timetable grid panel builder shows all axis panels when no teacher/classroom/day subfilter is selected", () => {
  const source = read(recordsFile);

  for (const marker of [
    'const activeTargets =',
    'validTargets.length > 0 ? validTargets : axisOptions;',
  ]) {
    assert.equal(source.includes(marker), true, `expected ${marker}`);
  }
});

test("2-column weekly timetable layout fits 월~일 columns without horizontal scroll", () => {
  const layoutSource = read(layoutFile);
  const legacyGridSource = read(legacyGridFile);

  for (const marker of [
    'const fitWeeklyColumns = isWeeklyView && gridCount === 2;',
    'allowHorizontalScroll: !fitWeeklyColumns && !isWeeklyView,',
    'fitColumns: fitWeeklyColumns,',
    'slotHeight: fitWeeklyColumns ? 28 : gridCount === 2 ? 30 : 38,',
    'timeColumnWidth: fitWeeklyColumns ? 76 : isWeeklyView ? 72 : 84,',
    'minColumnWidth: fitWeeklyColumns ? 0 : isWeeklyView ? 0 : 120,',
  ]) {
    assert.equal(layoutSource.includes(marker), true, `expected ${marker}`);
  }

  for (const marker of [
    'fitColumns = false,',
    "fitColumns ? 'hidden' : density === 'micro' || density === 'nano' ? 'hidden' : 'auto'",
    "width: fitColumns ? '100%' : undefined",
    'minWidth: fitColumns ? 0 : undefined',
    "['timetable-grid-shell', `is-${density}`, fitColumns ? 'is-fit-columns' : '', shellClassName]",
  ]) {
    assert.equal(legacyGridSource.includes(marker), true, `expected ${marker}`);
  }
});

test("v2 academic filter toolbar is compact and table-first without card chrome", () => {
  const source = read(toolbarFile);

  assert.equal(source.includes('from "@/components/ui/card"'), false);
  for (const marker of [
    'import { Button } from "@/components/ui/button";',
    'onReset?: () => void;',
    'showReset?: boolean;',
    'variant="ghost"',
    '조건 초기화',
    'border border-border/70 bg-background p-3',
    'md:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,0.7fr))]',
  ]) {
    assert.equal(source.includes(marker), true, `expected ${marker}`);
  }
});
