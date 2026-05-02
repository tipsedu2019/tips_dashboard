import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

test("curriculum workspace reuses the class management filter panel", async () => {
  const source = await readFile(new URL("src/features/academic/curriculum-workspace.tsx", root), "utf8");

  assert.match(source, /@\/features\/management\/class-filter-panel/);
  assert.match(source, /<ClassFilterPanel\s+selects=\{filterSelects\}/);
  assert.doesNotMatch(source, /AcademicFilterToolbar/);
  assert.match(source, /id: "period"/);
  assert.match(source, /label: "수업 상태"/);
  assert.match(source, /id: "classroom"/);
  assert.match(source, /footerAction=\{/);
  assert.match(source, /filterCount=\{filterChips\.length\}/);
  assert.doesNotMatch(source, /label: <>보기/);
  assert.doesNotMatch(source, /label: <>검색어/);
  assert.doesNotMatch(source, /useEffect/);
  assert.doesNotMatch(source, /mt-3 flex flex-wrap items-center gap-2/);
});

test("curriculum model exposes class-style period and status filtering", async () => {
  const source = await readFile(new URL("src/features/academic/records.js", root), "utf8");

  assert.match(source, /buildClassGroupContext\(eligibleClasses, classTerms, classGroups, classGroupMembers\)/);
  assert.match(source, /rowMatchesClassGroup\(row, selectedGroupValues\)/);
  assert.match(source, /row\.statusFilter === selectedStatus/);
  assert.match(source, /classroomOptions: buildCatalogBackedOptions/);
});

test("curriculum summary shows actionable planning workload", async () => {
  const source = await readFile(new URL("src/features/academic/curriculum-workspace.tsx", root), "utf8");

  assert.match(source, /진도 필요 \$\{model\.summary\.updateNeededClassCount\}개/);
  assert.doesNotMatch(source, /미배정 회차 \$\{model\.summary\.pendingSessions\}회/);
});

test("curriculum overview has a PC-first work queue and dense table shell", async () => {
  const source = await readFile(new URL("src/features/academic/curriculum-workspace.tsx", root), "utf8");
  const modelSource = await readFile(new URL("src/features/academic/records.js", root), "utf8");

  assert.match(source, /const curriculumWorkQueueItems = CURRICULUM_VIEW_MODES\.map/);
  assert.match(source, /data-testid="curriculum-work-queue"/);
  assert.match(source, /const viewRowSessionCount = useMemo/);
  assert.match(source, /const viewRowTextbookCount = useMemo/);
  assert.match(source, /\{viewRowSessionCount\}회차 · \{viewRowTextbookCount\}권/);
  assert.doesNotMatch(source, /\{model\.summary\.totalSessions\}회차 · \{model\.summary\.linkedTextbooks\}권/);
  assert.match(source, /viewRows\.find\(\(row\) => row\.id === selectedClassId\) \|\|\s*viewRows\[0\] \|\|\s*null/);
  assert.doesNotMatch(source, /model\.rows\.find\(\(row\) => row\.id === selectedClassId\)/);
  assert.match(source, /setViewMode\(item\.value\)/);
  assert.match(source, /viewMode === item\.value/);
  assert.match(source, /교재 미연결/);
  assert.match(source, /진도 미배정/);
  assert.match(source, /sticky top-0 z-10 bg-background/);
  assert.match(source, /min-w-\[1040px\]/);
  assert.match(source, /const hasLinkedTextbooks = row\.textbookCount > 0/);
  assert.match(modelSource, /const progressTargetSessions = textbookCount > 0/);
  assert.match(modelSource, /Number\(session\.textbookEntryCount \|\| 0\) > 0/);
  assert.doesNotMatch(modelSource, /scheduleState !== "exception" && scheduleState !== "tbd"/);
  assert.match(source, /const progressTargetSessionCount = row\.progressTargetSessions \?\? row\.totalSessions/);
  assert.match(source, /formatProgressPrimary\(row\.plannedProgressSessions, progressTargetSessionCount\)/);
  assert.match(source, /formatProgressPercent\(row\.progressTargetPercent, progressTargetSessionCount\)/);
  assert.match(source, /formatProgressMeta\(row\.plannedProgressSessions, row\.delayedProgressSessions, progressTargetSessionCount\)/);
  assert.match(source, /교재 연결 필요/);
  assert.match(source, /교재를 연결한 뒤 회차별 진도를 배정합니다\./);
});

test("curriculum detail panel separates schedule and progress entry points", async () => {
  const source = await readFile(new URL("src/features/academic/curriculum-workspace.tsx", root), "utf8");

  assert.match(source, /data-testid="curriculum-detail-actions"/);
  assert.match(source, /const selectedRowProgressAction = selectedRow \? getCurriculumDesignAction\(selectedRow\) : null/);
  assert.match(source, /buildLessonDesignHref\(selectedRow\.id, "", "lesson-design-periods"\)/);
  assert.match(
    source,
    /buildLessonDesignHref\(\s*selectedRow\.id,\s*selectedRowProgressAction\.sessionId,\s*selectedRowProgressAction\.sectionId,\s*\)/,
  );
  assert.match(source, /일정 생성/);
  assert.match(source, /\{selectedRowProgressAction\.label === "교재" \? "교재 연결" : "진도 생성"\}/);
  assert.match(source, /className="h-7 rounded-md px-2 text-xs lg:hidden"/);
});

test("curriculum row action opens the right lesson-design workspace", async () => {
  const source = await readFile(new URL("src/features/academic/curriculum-workspace.tsx", root), "utf8");

  assert.match(source, /function getCurriculumDesignAction/);
  assert.match(source, /Number\(row\.textbookCount \|\| 0\) <= 0/);
  assert.match(source, /label: "교재"/);
  assert.match(source, /sectionId: "lesson-design-textbooks"/);
  assert.match(source, /Number\(row\.totalSessions \|\| 0\) <= 0/);
  assert.match(source, /Number\(row\.delayedProgressSessions \|\| 0\) > 0/);
  assert.doesNotMatch(source, /Number\(row\.delayedSessions \|\| 0\) > 0/);
  assert.match(source, /sectionId: "lesson-design-periods"/);
  assert.match(source, /sectionId: "lesson-design-board"/);
  assert.match(source, /rowDesignAction\.label/);
  assert.match(source, /buildLessonDesignHref\(row\.id, rowDesignAction\.sessionId, rowDesignAction\.sectionId\)/);
});

test("shared class filter panel separates search and view state from filter count", async () => {
  const source = await readFile(new URL("src/features/management/class-filter-panel.tsx", root), "utf8");

  assert.match(source, /filterCount\?: number/);
  assert.match(source, /const activeFilterCount = filterCount \?\? chips\.length/);
  assert.match(source, /aria-label=\{searchPlaceholder\}/);
});
