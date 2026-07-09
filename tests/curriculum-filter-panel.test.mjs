import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

test("curriculum workspace reuses the class management filter panel", async () => {
  const source = await readFile(new URL("src/features/academic/curriculum-workspace.tsx", root), "utf8");

  assert.match(source, /@\/features\/management\/class-filter-panel/);
  assert.match(source, /<ClassFilterPanel\s+selects=\{filterSelects\}/);
  assert.match(source, /quickSelectIds=\{CURRICULUM_QUICK_FILTER_IDS\}/);
  assert.match(source, /quickSelectGridClassName="grid-cols-2"/);
  assert.match(source, /const CURRICULUM_QUICK_FILTER_IDS = \["subject", "grade", "teacher", "classroom"\]/);
  assert.doesNotMatch(source, /AcademicFilterToolbar/);
  assert.match(source, /id: "period"/);
  assert.match(source, /label: "수업 상태"/);
  assert.match(source, /id: "classroom"/);
  assert.match(source, /footerAction=\{/);
  assert.match(source, /filterCount=\{filterChips\.length\}/);
  assert.doesNotMatch(source, /label: <>보기/);
  assert.doesNotMatch(source, /label: <>검색어/);
  assert.doesNotMatch(source, /mt-3 flex flex-wrap items-center gap-2/);
});

test("curriculum model exposes class-style period and status filtering", async () => {
  const source = await readFile(new URL("src/features/academic/records.js", root), "utf8");

  assert.match(source, /buildClassGroupContext\(eligibleClasses, classTerms, classGroups, classGroupMembers\)/);
  assert.match(source, /rowMatchesClassGroup\(row, selectedGroupValues\)/);
  assert.match(source, /row\.statusFilter === selectedStatus/);
  assert.match(source, /classroomOptions: buildCatalogBackedOptions/);
});

test("curriculum default period follows the configured period option", async () => {
  const source = await readFile(new URL("src/features/academic/records.js", root), "utf8");
  const typeSource = await readFile(new URL("src/features/academic/records.d.ts", root), "utf8");
  const workspaceSource = await readFile(new URL("src/features/academic/curriculum-workspace.tsx", root), "utf8");

  assert.match(source, /isDefault: group\.isDefault === true/);
  assert.match(source, /const option = \{ value, label, aliases \}/);
  assert.match(source, /if \(isDefault === true\) \{\s*option\.isDefault = true;\s*\}/);
  assert.match(typeSource, /classGroupOptions: Array<\{ value: string; label: string; aliases\?: string\[\]; isDefault\?: boolean \}>/);
  assert.match(workspaceSource, /const defaultPeriod = useMemo\(\(\) => pickDefaultPeriodValue\(baseModel\.classGroupOptions\), \[baseModel\.classGroupOptions\]\)/);
});

test("curriculum summary shows actionable planning workload", async () => {
  const source = await readFile(new URL("src/features/academic/curriculum-workspace.tsx", root), "utf8");

  assert.match(source, /진도 필요 \$\{model\.summary\.updateNeededClassCount\}개/);
  assert.doesNotMatch(source, /미배정 회차 \$\{model\.summary\.pendingSessions\}회/);
});

test("curriculum overview has a PC-first work queue and dense table shell", async () => {
  const source = await readFile(new URL("src/features/academic/curriculum-workspace.tsx", root), "utf8");
  const modelSource = await readFile(new URL("src/features/academic/records.js", root), "utf8");

  assert.match(source, /const curriculumWorkQueueItems = useMemo/);
  assert.match(source, /CURRICULUM_VIEW_MODES\.map/);
  assert.match(source, /\[model\.rows\]/);
  assert.match(source, /data-testid="curriculum-work-queue"/);
  assert.match(source, /className="grid grid-cols-2 gap-2 xl:grid-cols-5"/);
  assert.match(source, /flex h-10 items-center justify-between rounded-md border px-3 text-left text-sm transition-colors/);
  assert.match(source, /const viewRowSessionCount = viewRowTotals\.sessions/);
  assert.match(source, /const viewRowTextbookCount = viewRowTotals\.textbooks/);
  assert.match(source, /const CURRICULUM_CLASS_PAGE_SIZE = 40/);
  assert.match(source, /const \[classListLimitsByScope, setClassListLimitsByScope\] = useState<Record<string, number>>\(\{\}\)/);
  assert.match(source, /const classListScopeKey = \[/);
  assert.match(source, /const classListLimit = classListLimitsByScope\[classListScopeKey\] \|\| CURRICULUM_CLASS_PAGE_SIZE/);
  assert.match(source, /const visibleViewRows = useMemo\(\(\) => viewRows\.slice\(0, classListLimit\), \[classListLimit, viewRows\]\)/);
  assert.match(source, /const hasMoreViewRows = visibleViewRows\.length < viewRows\.length/);
  assert.match(source, /const viewRowTotals = useMemo/);
  assert.match(source, /const curriculumViewModeCounts = useMemo/);
  assert.match(source, /data-testid="curriculum-mobile-list"/);
  assert.match(source, /data-testid=\{`curriculum-mobile-card-\$\{row\.id\}`\}/);
  assert.match(source, /data-testid="curriculum-desktop-scroll-anchor"/);
  assert.match(source, /<ScrollArea className="hidden h-\[38rem\] \[contain-intrinsic-size:640px\] \[content-visibility:auto\] md:block">/);
  assert.match(source, /for \(const row of model\.rows\)/);
  assert.match(source, /counts\.unlinked \+= 1/);
  assert.match(source, /counts\.unscheduled \+= 1/);
  assert.match(source, /counts\.update \+= 1/);
  assert.match(source, /counts\.done \+= 1/);
  assert.doesNotMatch(source, /rowMatchesViewMode\(row, mode\.value\)/);
  assert.match(source, /\{visibleViewRows\.map\(\(row\) =>/);
  assert.match(source, /setClassListLimitsByScope\(\(current\) => \(\{/);
  assert.match(source, /\[classListScopeKey\]: \(current\[classListScopeKey\] \|\| CURRICULUM_CLASS_PAGE_SIZE\) \+ CURRICULUM_CLASS_PAGE_SIZE/);
  assert.match(source, /\{viewRowSessionCount\}회차 · \{viewRowTextbookCount\}권/);
  assert.doesNotMatch(source, /\{model\.summary\.totalSessions\}회차 · \{model\.summary\.linkedTextbooks\}권/);
  assert.doesNotMatch(source, /selectedClassId/);
  assert.doesNotMatch(source, /selectedRow/);
  assert.doesNotMatch(source, /aria-selected/);
  assert.doesNotMatch(source, /data-selected/);
  assert.match(source, /setViewMode\(item\.value\)/);
  assert.match(source, /viewMode === item\.value/);
  assert.match(source, /교재 미연결/);
  assert.match(source, /진도 미배정/);
  assert.match(source, /sticky top-0 z-10 bg-background/);
  assert.match(source, /min-w-\[920px\]/);
  assert.match(source, /<TableHead className="w-\[12%\] text-right">작업<\/TableHead>/);
  assert.match(source, /const hasLinkedTextbooks = row\.textbookCount > 0/);
  assert.match(source, /inline-flex h-8 items-center rounded-md border border-dashed/);
  assert.match(modelSource, /const progressTargetSessions = textbookCount > 0/);
  assert.match(modelSource, /Number\(session\.textbookEntryCount \|\| 0\) > 0/);
  assert.doesNotMatch(modelSource, /scheduleState !== "exception" && scheduleState !== "tbd"/);
  assert.match(source, /const progressTargetSessionCount = row\.progressTargetSessions \?\? row\.totalSessions/);
  assert.match(source, /formatProgressPrimary\(row\.plannedProgressSessions, progressTargetSessionCount\)/);
  assert.match(source, /formatProgressPercent\(row\.progressTargetPercent, progressTargetSessionCount\)/);
  assert.match(source, /formatProgressMeta\(row\.plannedProgressSessions, row\.delayedProgressSessions, progressTargetSessionCount\)/);
  assert.match(source, /교재 연결 필요/);
  assert.doesNotMatch(source, /교재를 연결한 뒤 회차별 진도를 배정합니다\./);
});

test("curriculum workspace removes duplicated right detail panel", async () => {
  const source = await readFile(new URL("src/features/academic/curriculum-workspace.tsx", root), "utf8");

  assert.doesNotMatch(source, /data-testid="curriculum-detail-actions"/);
  assert.doesNotMatch(source, /const selectedRowProgressAction/);
  assert.doesNotMatch(source, /selectedProgressTargetSessionCount/);
  assert.doesNotMatch(source, /selectedClassId/);
  assert.doesNotMatch(source, /selectedRow/);
  assert.doesNotMatch(source, /xl:sticky xl:top-24 xl:self-start/);
  assert.doesNotMatch(source, /회차 배치/);
  assert.doesNotMatch(source, /buildLessonDesignHref\(selectedRow\.id, "", "lesson-design-periods"\)/);
  assert.match(source, /buildLessonDesignHref\(\s*row\.id,\s*rowDesignAction\.sectionId,\s*rowDesignAction\.sessionId,\s*curriculumReturnPath,\s*\)/);
  assert.match(source, /className="h-7 rounded-md px-2 text-xs lg:hidden"/);
});

test("curriculum row action opens the lesson design modal route", async () => {
  const source = await readFile(new URL("src/features/academic/curriculum-workspace.tsx", root), "utf8");

  assert.match(source, /function getCurriculumDesignAction/);
  assert.match(source, /function buildLessonDesignHref/);
  assert.match(source, /returnTo = ""/);
  assert.match(source, /params\.set\("lessonDesign", "1"\)/);
  assert.match(source, /params\.set\("classId", normalizedClassId\)/);
  assert.match(source, /params\.set\("returnTo", normalizedReturnTo\)/);
  assert.match(source, /return `\/admin\/curriculum\?\$\{params\.toString\(\)\}`/);
  assert.doesNotMatch(source, /function buildClassDetailHref/);
  assert.doesNotMatch(source, /return `\/admin\/classes\?\$\{params\.toString\(\)\}`/);
  assert.doesNotMatch(source, /params\.set\("tab", tab \|\| "basic"\)/);
  assert.match(source, /Number\(row\.textbookCount \|\| 0\) <= 0/);
  assert.match(source, /label: "교재"/);
  assert.match(source, /tab: "curriculum"/);
  assert.match(source, /sectionId: "lesson-design-textbooks"/);
  assert.match(source, /Number\(row\.totalSessions \|\| 0\) <= 0/);
  assert.match(source, /tab: "schedule"/);
  assert.match(source, /Number\(row\.delayedProgressSessions \|\| 0\) > 0/);
  assert.doesNotMatch(source, /Number\(row\.delayedSessions \|\| 0\) > 0/);
  assert.match(source, /sectionId: "lesson-design-periods"/);
  assert.match(source, /sectionId: "lesson-design-board"/);
  assert.match(source, /rowDesignAction\.label/);
  assert.match(source, /buildLessonDesignHref\(\s*row\.id,\s*rowDesignAction\.sectionId,\s*rowDesignAction\.sessionId,\s*curriculumReturnPath,\s*\)/);
});

test("curriculum row actions show the next work reason before navigation", async () => {
  const source = await readFile(new URL("src/features/academic/curriculum-workspace.tsx", root), "utf8");

  assert.match(source, /reason: "교재 연결 필요"/);
  assert.match(source, /reason: "회차 생성 필요"/);
  assert.match(source, /reason: `미배정 \$\{Number\(row\.delayedProgressSessions \|\| 0\)\}회`/);
  assert.match(source, /reason: "기본 정보 확인"/);
  assert.match(source, /data-testid="curriculum-row-next-action"/);
  assert.match(source, /rowDesignAction\.reason/);
  assert.match(source, /aria-label=\{`\$\{row\.title\} \$\{rowDesignAction\.label\} \$\{rowDesignAction\.reason\}`\}/);
});

test("completed curriculum rows open basic class detail without stale section targets", async () => {
  const source = await readFile(new URL("src/features/academic/curriculum-workspace.tsx", root), "utf8");

  assert.match(source, /return \{ label: "보기", tab: "basic", sectionId: "", sessionId: "", reason: "기본 정보 확인" \}/);
  assert.doesNotMatch(source, /return \{ label: "보기", tab: "basic", sectionId: "lesson-design-board", sessionId, reason: "기본 정보 확인" \}/);
});

test("curriculum rows open lesson design without a duplicated preview", async () => {
  const source = await readFile(new URL("src/features/academic/curriculum-workspace.tsx", root), "utf8");

  assert.match(source, /const openCurriculumRow = useCallback/);
  assert.match(source, /router\.push\(buildLessonDesignHref\(/);
  assert.match(source, /const handleCurriculumRowKeyDown = useCallback/);
  assert.match(source, /event\.key !== "Enter" && event\.key !== " "/);
  assert.match(source, /data-testid=\{`curriculum-mobile-card-\$\{row\.id\}`\}/);
  assert.match(source, /onClick=\{\(\) => openCurriculumRow\(row, rowDesignAction\)\}/);
  assert.match(source, /onKeyDown=\{\(event\) => handleCurriculumRowKeyDown\(event, row, rowDesignAction\)\}/);
  assert.match(source, /data-testid=\{`curriculum-desktop-row-\$\{row\.id\}`\}/);
  assert.match(source, /role="link"/);
  assert.match(source, /tabIndex=\{0\}/);
  assert.doesNotMatch(source, /setSelectedClassId/);
  assert.doesNotMatch(source, /data-testid="curriculum-detail-actions"/);
});

test("curriculum work queue persists filter context in the URL and return path", async () => {
  const source = await readFile(new URL("src/features/academic/curriculum-workspace.tsx", root), "utf8");

  assert.match(source, /usePathname, useRouter, useSearchParams/);
  assert.match(source, /function applyCurriculumQueryState/);
  assert.match(source, /\["q", state\.search\.trim\(\), ""\]/);
  assert.match(source, /\["view", normalizeCurriculumViewMode\(state\.viewMode\), "all"\]/);
  assert.match(source, /params\.delete\("classId"\)/);
  assert.match(source, /const curriculumReturnPath = useMemo/);
  assert.match(source, /buildCurriculumListHref\(pathname, searchParamString, curriculumQueryState\)/);
  assert.match(source, /router\.replace\(nextHref, \{ scroll: false \}\)/);
  assert.match(source, /setPeriod\(value === "none" \? "" : value\)/);
});

test("curriculum work queue restores scroll position after opening class detail", async () => {
  const source = await readFile(new URL("src/features/academic/curriculum-workspace.tsx", root), "utf8");

  assert.match(source, /CURRICULUM_SCROLL_STORAGE_PREFIX/);
  assert.match(source, /function getCurriculumScrollStorageKey/);
  assert.match(source, /function parseStoredCurriculumScroll/);
  assert.match(source, /const desktopListRef = useRef<HTMLDivElement \| null>\(null\)/);
  assert.match(source, /const rememberCurriculumScrollPosition = useCallback/);
  assert.match(source, /window\.sessionStorage\.setItem/);
  assert.match(source, /pageY: window\.scrollY/);
  assert.match(source, /listY: viewport\?\.scrollTop \|\| 0/);
  assert.match(source, /querySelector<HTMLElement>\('\[data-slot="scroll-area-viewport"\]'\)/);
  assert.match(source, /window\.requestAnimationFrame/);
  assert.match(source, /window\.scrollTo\(\{ top: savedScroll\.pageY \}\)/);
  assert.match(source, /viewport\.scrollTop = savedScroll\.listY/);
  assert.match(source, /rememberCurriculumScrollPosition\(\)/);
});

test("shared class filter panel separates search and view state from filter count", async () => {
  const source = await readFile(new URL("src/features/management/class-filter-panel.tsx", root), "utf8");

  assert.match(source, /filterCount\?: number/);
  assert.match(source, /quickSelectIds\?: string\[\]/);
  assert.match(source, /quickSelectGridClassName\?: string/);
  assert.match(source, /const quickSelects = selects\.filter/);
  assert.match(source, /const menuSelects = selects\.filter/);
  assert.match(source, /data-testid="class-filter-quick-selects"/);
  assert.match(source, /className=\{cn\("grid gap-2 sm:grid-cols-2 xl:grid-cols-4", quickSelectGridClassName\)\}/);
  assert.match(source, /quickSelects\.map\(renderSelectField\)/);
  assert.match(source, /menuSelects\.map\(renderSelectField\)/);
  assert.match(source, /const activeFilterCount = filterCount \?\? chips\.length/);
  assert.match(source, /const activeMenuFilterCount = quickSelects\.length > 0/);
  assert.match(source, /aria-label=\{searchPlaceholder\}/);
  assert.match(source, /data-testid="class-filter-popover-header"/);
  assert.match(source, /<PopoverContent align="end" className="w-\[min\(34rem,calc\(100vw-2rem\)\)\] p-0">/);
  assert.match(source, /<p className="truncate text-sm font-semibold text-foreground">필터<\/p>/);
});
