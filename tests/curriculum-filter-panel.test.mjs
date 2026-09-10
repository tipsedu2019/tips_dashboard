import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

test("curriculum workspace reuses the class management filter panel", async () => {
  const source = await readFile(new URL("src/features/academic/curriculum-workspace.tsx", root), "utf8");

  assert.match(source, /@\/features\/management\/class-filter-panel/);
  assert.match(source, /<ClassFilterPanel\s+selects=\{filterSelects\}/);
  assert.doesNotMatch(source, /AcademicFilterToolbar/);
  assert.doesNotMatch(source, /id: "period"/);
  assert.match(source, /label: "수업 상태"/);
  assert.match(source, /id: "classroom"/);
  assert.doesNotMatch(source, /footerAction=\{|Popover/);
  assert.doesNotMatch(source, /label: <>보기/);
  assert.doesNotMatch(source, /label: <>검색어/);
  assert.doesNotMatch(source, /mt-3 flex flex-wrap items-center gap-2/);
});

test("legacy curriculum model retains group matching for timetable-compatible records", async () => {
  const source = await readFile(new URL("src/features/academic/records.js", root), "utf8");

  assert.match(source, /buildClassGroupContext\(eligibleClasses, classTerms, classGroups, classGroupMembers\)/);
  assert.match(source, /rowMatchesClassGroup\(row, selectedGroupValues\)/);
  assert.match(source, /row\.statusFilter === selectedStatus/);
  assert.match(source, /classroomOptions: buildCatalogBackedOptions/);
});

test("curriculum workspace does not construct or restore legacy period options", async () => {
  const workspaceSource = await readFile(new URL("src/features/academic/curriculum-workspace.tsx", root), "utf8");

  assert.doesNotMatch(workspaceSource, /pickDefaultPeriodValue|readDefaultPeriodPreference/);
  assert.doesNotMatch(workspaceSource, /classGroupOptions|filterOptions\.periods|normalizedPeriod|periodOptions/);
  assert.doesNotMatch(workspaceSource, /학기 미정/);
});

test("curriculum work queue shows actionable planning workload without a repeated summary", async () => {
  const source = await readFile(new URL("src/features/academic/curriculum-workspace.tsx", root), "utf8");

  assert.match(source, /value: "update", label: "진도 미배정"/);
  assert.doesNotMatch(source, /summaryLabel=/);
  assert.doesNotMatch(source, /미배정 회차 \$\{model\.summary\.pendingSessions\}회/);
});

test("curriculum overview has a PC-first work queue, dense table shell, and shared numbered pager", async () => {
  const source = await readFile(new URL("src/features/academic/curriculum-workspace.tsx", root), "utf8");
  const modelSource = await readFile(new URL("src/features/academic/records.js", root), "utf8");

  assert.match(source, /const curriculumWorkQueueItems = useMemo/);
  assert.match(source, /CURRICULUM_VIEW_MODES\.map/);
  assert.match(source, /const visibleViewRows = model\.rows/);
  assert.match(source, /data-testid="curriculum-work-queue"/);
  assert.match(source, /aria-label="계획 상태"/);
  assert.match(source, /aria-pressed=\{viewMode === item\.value\}/);
  assert.match(source, /import \{ DataTablePagination \} from "@\/components\/data-table\/data-table-pagination"/);
  assert.match(source, /useAcademicWorkspaceData\(\{\s*mode: "curriculum"/);
  assert.match(source, /cursor: null/);
  assert.match(source, /page: navigation\.page/);
  assert.match(source, /navigationKey: navigation\.key/);
  assert.match(source, /const visibleViewRows = model\.rows/);

  assert.match(source, /const curriculumViewModeCounts = model\.summary\.viewModeCounts/);
  assert.match(source, /data-testid="curriculum-mobile-list"/);
  assert.match(source, /data-testid=\{`curriculum-mobile-card-\$\{row\.id\}`\}/);
  assert.match(source, /data-testid="curriculum-desktop-scroll-anchor"/);
  assert.match(source, /<DataTableViewport/);
  assert.match(source, /max-h-\[38rem\]/);
  assert.doesNotMatch(source, /className="hidden h-\[38rem\]/);
  assert.match(source, /const curriculumViewModeCounts = model\.summary\.viewModeCounts/);
  assert.match(source, /\{visibleViewRows\.map\(\(row\) =>/);
  assert.match(source, /<DataTablePagination page=\{displayedPage\} pageSize=\{pageSize\} totalCount=\{totalCount\} loading=\{loading\}/);
  assert.match(source, /onPageChange=\{handlePageChange\} onPageSizeChange=\{setPageSizePreference\}/);
  assert.doesNotMatch(source, /CURRICULUM_CLASS_PAGE_SIZE/);
  assert.doesNotMatch(source, /loadMore/);
  assert.doesNotMatch(source, /hasMoreViewRows/);

  assert.doesNotMatch(source, /\{model\.summary\.totalSessions\}회차 · \{model\.summary\.linkedTextbooks\}권/);
  assert.doesNotMatch(source, /selectedClassId/);
  assert.doesNotMatch(source, /selectedRow/);
  assert.doesNotMatch(source, /aria-selected/);
  assert.doesNotMatch(source, /data-selected/);
  assert.match(source, /setViewMode\(item\.value\)/);
  assert.match(source, /viewMode === item\.value/);
  assert.match(source, /교재 미연결/);
  assert.match(source, /진도 미배정/);
  assert.match(source, /DataTableHeaderCell/);
  assert.match(source, /min-w-\[920px\]/);
  assert.match(source, /다음 작업<\/DataTableHeaderCell>/);
  assert.match(source, /const hasLinkedTextbooks = row\.textbookCount > 0/);

  assert.match(modelSource, /const progressTargetSessions = textbookCount > 0/);
  assert.match(modelSource, /Number\(session\.textbookEntryCount \|\| 0\) > 0/);
  assert.doesNotMatch(modelSource, /scheduleState !== "exception" && scheduleState !== "tbd"/);
  assert.match(source, /const progressTargetSessionCount = row\.progressTargetSessions \?\? row\.totalSessions/);
  assert.match(source, /formatProgressPrimary\(row\.plannedProgressSessions, progressTargetSessionCount\)/);
  assert.match(source, /value=\{row\.progressTargetPercent\}/);

  assert.match(source, /교재 연결 필요/);
  assert.doesNotMatch(source, /교재를 연결한 뒤 회차별 진도를 배정합니다\./);
});

test("curriculum workspace delegates all filters and numbered navigation to the scoped service", async () => {
  const source = await readFile(new URL("src/features/academic/curriculum-workspace.tsx", root), "utf8");
  const hookSource = await readFile(new URL("src/features/academic/use-academic-workspace-data.ts", root), "utf8");
  assert.doesNotMatch(source, /periodId:/);
  assert.match(source, /\n\s+search,/);
  assert.match(source, /status,/);
  assert.match(source, /subject,/);
  assert.match(source, /grade,/);
  assert.match(source, /teacher,/);
  assert.match(source, /classroom,/);
  assert.match(source, /viewMode,/);
  assert.match(source, /page: navigation\.page/);
  assert.match(source, /navigationKey: navigation\.key/);
  assert.match(source, /return goToPage\(page\)/);
  assert.match(hookSource, /loadCurriculumDetail/);
  assert.match(hookSource, /createNumberedPageController/);
  assert.match(hookSource, /readCurriculumNumberedPage/);
  assert.match(hookSource, /const filters = \{ periodId: null,/);
  assert.match(hookSource, /useDataTablePageSize\("academic:curriculum"\)/);
  assert.match(hookSource, /successfulRequest/);
  assert.match(hookSource, /dataMatchesCurrentScope/);
  assert.match(hookSource, /const \{ user, role, loading: authLoading \} = useAuth\(\)/);
  assert.match(hookSource, /createAcademicReadService/);
  assert.doesNotMatch(hookSource, /app_metadata\?\.role/);
  assert.match(source, /const renderData = curriculumData/);
  assert.match(source, /if \(loading && !renderData\)/);
  assert.match(source, /onClick=\{\(\) => void refresh\(\)\}/);
  assert.match(source, /다시 시도/);
  assert.doesNotMatch(source, /setPeriod|readDefaultPeriodPreference|pickDefaultPeriodValue/);
  assert.doesNotMatch(source, /\.slice\(0, classListLimit\)/);
  assert.doesNotMatch(source, /loadingMore/);
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
  assert.doesNotMatch(source, /PopoverTrigger/);
});

test("curriculum row action opens the lesson design modal route", async () => {
  const source = await readFile(new URL("src/features/academic/curriculum-workspace.tsx", root), "utf8");
  const actionSource = await readFile(new URL("src/features/academic/academic-read-service.js", root), "utf8");

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
  assert.match(source, /return resolveCurriculumDesignAction\(row\)/);
  assert.match(actionSource, /Number\(row\.textbookCount \|\| 0\) <= 0/);
  assert.match(actionSource, /label: "교재"/);
  assert.match(actionSource, /tab: "curriculum"/);
  assert.match(actionSource, /sectionId: "lesson-design-textbooks"/);
  assert.match(actionSource, /Number\(row\.totalSessions \|\| 0\) <= 0/);
  assert.match(actionSource, /tab: "schedule"/);
  assert.match(actionSource, /Number\(row\.delayedProgressSessions \|\| 0\) > 0/);
  assert.doesNotMatch(actionSource, /Number\(row\.delayedSessions \|\| 0\) > 0/);
  assert.match(actionSource, /sectionId: "lesson-design-periods"/);
  assert.match(actionSource, /sectionId: "lesson-design-board"/);
  assert.match(source, /rowDesignAction\.label/);
  assert.match(source, /buildLessonDesignHref\(\s*row\.id,\s*rowDesignAction\.sectionId,\s*rowDesignAction\.sessionId,\s*curriculumReturnPath,\s*\)/);
});

test("curriculum row actions show the next work reason before navigation", async () => {
  const source = await readFile(new URL("src/features/academic/curriculum-workspace.tsx", root), "utf8");
  const actionSource = await readFile(new URL("src/features/academic/academic-read-service.js", root), "utf8");

  assert.match(actionSource, /reason: "교재 연결 필요"/);
  assert.match(actionSource, /reason: "회차 생성 필요"/);
  assert.match(actionSource, /reason: `미배정 \$\{Number\(row\.delayedProgressSessions \|\| 0\)\}회`/);
  assert.match(actionSource, /reason: "기본 정보 확인"/);
  assert.match(source, /data-testid="curriculum-row-next-action"/);
  assert.match(source, /rowDesignAction\.reason/);
  assert.match(source, /aria-label=\{`\$\{row\.title\} \$\{rowDesignAction\.label\} \$\{rowDesignAction\.reason\}`\}/);
});

test("completed curriculum rows open basic class detail without stale section targets", async () => {
  const source = await readFile(new URL("src/features/academic/academic-read-service.js", root), "utf8");

  assert.match(source, /return \{[\s\S]*?label: "보기",[\s\S]*?tab: "basic",[\s\S]*?sectionId: "",[\s\S]*?sessionId: "",[\s\S]*?reason: "기본 정보 확인",[\s\S]*?\};/);
  assert.doesNotMatch(source, /label: "보기",[\s\S]*?tab: "basic",[\s\S]*?sectionId: "lesson-design-board"/);
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
  assert.match(source, /params\.delete\("period"\)/);
  assert.match(source, /\["view", normalizeCurriculumViewMode\(state\.viewMode\), "all"\]/);
  assert.match(source, /params\.delete\("classId"\)/);
  assert.match(source, /const curriculumReturnPath = useMemo/);
  assert.match(source, /buildCurriculumListHref\(pathname, searchParamString, curriculumQueryState\)/);
  assert.match(source, /router\.replace\(nextHref, \{ scroll: false \}\)/);
  assert.doesNotMatch(source, /setPeriod|id: "period"|label: "기간"/);
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
  assert.match(source, /querySelector<HTMLElement>\('\[data-slot="data-table-viewport"\]'\)/);
  assert.match(source, /window\.requestAnimationFrame/);
  assert.match(source, /window\.scrollTo\(\{ top: savedScroll\.pageY \}\)/);
  assert.match(source, /viewport\.scrollTop = savedScroll\.listY/);
  assert.match(source, /rememberCurriculumScrollPosition\(\)/);
});

test("shared class filter panel exposes all conditions and reset directly", async () => {
  const source = await readFile(new URL("src/features/management/class-filter-panel.tsx", root), "utf8");
  assert.match(source, /<DataTableFilters/);
  assert.match(source, /selects\.map\(renderSelectField\)/);
  assert.match(source, /aria-label=\{searchPlaceholder\}/);
  assert.match(source, /onClick=\{onReset\}/);
  assert.doesNotMatch(source, /Popover|menuSelects|quickSelects|filterCount|ClassFilterPanelChip/);
});
