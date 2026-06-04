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
  const queueStart = source.indexOf('data-testid="curriculum-work-queue"');
  const queueEnd = source.indexOf('<div className="px-4 lg:px-6">', queueStart + 1);
  const queueBlock = source.slice(queueStart, queueEnd);

  assert.match(source, /const CURRICULUM_WORK_QUEUE_VALUES = new Set\(\["operations", "unlinked", "unscheduled", "update"\]\)/);
  assert.match(source, /const CURRICULUM_WORK_QUEUE_MODES = CURRICULUM_VIEW_MODES\.filter\(\(mode\) => CURRICULUM_WORK_QUEUE_VALUES\.has\(mode\.value\)\)/);
  assert.match(source, /const curriculumWorkQueueItems = useMemo/);
  assert.match(source, /CURRICULUM_WORK_QUEUE_MODES\.map/);
  assert.match(queueBlock, /xl:grid-cols-4/);
  assert.match(source, /\[data\.operationTasks, model\.rows\]/);
  assert.match(source, /data-testid="curriculum-work-queue"/);
  assert.match(source, /data-testid="curriculum-view-mode-tabs"/);
  assert.match(source, /className="hidden flex-wrap items-center gap-1 lg:flex"/);
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
  assert.match(source, /<ScrollArea className="hidden h-\[38rem\] \[contain-intrinsic-size:640px\] \[content-visibility:auto\] md:block">/);
  assert.match(source, /for \(const row of model\.rows\)/);
  assert.match(source, /counts\.unlinked \+= 1/);
  assert.match(source, /counts\.unscheduled \+= 1/);
  assert.match(source, /counts\.update \+= 1/);
  assert.match(source, /counts\.done \+= 1/);
  assert.match(source, /counts\.operations \+= 1/);
  assert.doesNotMatch(source, /rowMatchesViewMode\(row, mode\.value\)/);
  assert.match(source, /\{visibleViewRows\.map\(\(row\) =>/);
  assert.match(source, /setClassListLimitsByScope\(\(current\) => \(\{/);
  assert.match(source, /\[classListScopeKey\]: \(current\[classListScopeKey\] \|\| CURRICULUM_CLASS_PAGE_SIZE\) \+ CURRICULUM_CLASS_PAGE_SIZE/);
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

test("curriculum work queue opens the first actionable class directly", async () => {
  const source = await readFile(new URL("src/features/academic/curriculum-workspace.tsx", root), "utf8");

  assert.match(source, /function findFirstCurriculumQueueRow/);
  assert.match(source, /const firstRow = findFirstCurriculumQueueRow\(model\.rows, mode\.value, data\.operationTasks, todayDayLabel\)/);
  assert.match(source, /const queueAction = item\.firstRow \? getCurriculumDesignAction\(item\.firstRow\) : null/);
  assert.match(source, /setSelectedClassId\(text\(item\.firstRow\?\.id \|\| ""\)\)/);
  assert.match(source, /buildLessonDesignHref\(text\(item\.firstRow\.id\), queueAction\.sessionId, queueAction\.sectionId\)/);
  assert.match(source, /data-testid=\{`curriculum-work-queue-\$\{item\.value\}`\}/);
  assert.match(source, /대상 없음/);
  assert.match(source, /바로 열기/);
});

test("curriculum work queue prioritizes today's actionable classes", async () => {
  const source = await readFile(new URL("src/features/academic/curriculum-workspace.tsx", root), "utf8");
  const queueStart = source.indexOf('data-testid="curriculum-work-queue"');
  const queueEnd = source.indexOf('<div className="px-4 lg:px-6">', queueStart + 1);
  const queueBlock = source.slice(queueStart, queueEnd);

  assert.match(source, /const KOREAN_DAY_LABELS = \["일", "월", "화", "수", "목", "금", "토"\]/);
  assert.match(source, /function getTodayDayLabel/);
  assert.match(source, /function rowHasScheduleOnDay/);
  assert.match(source, /function compareCurriculumQueueRows/);
  assert.match(source, /if \(queueMode === "operations" && stateGap !== 0\) return stateGap/);
  assert.match(source, /function getCurriculumViewRows/);
  assert.match(source, /const todayDayLabel = useMemo\(\(\) => getTodayDayLabel\(\), \[\]\)/);
  assert.match(source, /return\s+getCurriculumViewRows\(model\.rows, viewMode, data\.operationTasks, todayDayLabel\)/);
  assert.match(source, /sortCurriculumQueueRows\(rows, queueMode, operationTasks, todayDayLabel\)\[0\] \|\| null/);
  assert.match(source, /rowHasScheduleOnDay\(firstRow, todayDayLabel\)/);
  assert.match(queueBlock, /item\.firstRowIsToday/);
  assert.match(queueBlock, /오늘 수업/);
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

test("curriculum detail shows timetable slots with a direct edit action", async () => {
  const [source, modelSource] = await Promise.all([
    readFile(new URL("src/features/academic/curriculum-workspace.tsx", root), "utf8"),
    readFile(new URL("src/features/academic/records.js", root), "utf8"),
  ]);

  assert.match(modelSource, /const scheduleSlots = parseAcademicSchedule\(classItem\?\.schedule, classItem\)/);
  assert.match(modelSource, /scheduleSlots,/);
  assert.match(source, /function getCurriculumScheduleSlots/);
  assert.match(source, /const selectedRowScheduleSlots = selectedRow \? getCurriculumScheduleSlots\(selectedRow\) : \[\]/);
  assert.match(source, /data-testid="curriculum-detail-timetable"/);
  assert.match(source, /시간표/);
  assert.match(source, /selectedRowScheduleSlots\.map/);
  assert.match(source, /slot\.day/);
  assert.match(source, /slot\.start/);
  assert.match(source, /slot\.end/);
  assert.match(source, /slot\.teacher/);
  assert.match(source, /slot\.classroom/);
  assert.match(source, /시간표 미정/);
  assert.match(source, /시간표 수정/);
});

test("curriculum detail surfaces registration, transfer, and withdrawal impact", async () => {
  const [source, dataHookSource] = await Promise.all([
    readFile(new URL("src/features/academic/curriculum-workspace.tsx", root), "utf8"),
    readFile(new URL("src/features/academic/use-academic-workspace-data.ts", root), "utf8"),
  ]);

  assert.match(dataHookSource, /type AcademicOperationImpactTask/);
  assert.match(dataHookSource, /operationTasks: AcademicOperationImpactTask\[\]/);
  assert.match(dataHookSource, /readOperationImpactTasks/);
  assert.match(dataHookSource, /ops_tasks/);
  assert.match(dataHookSource, /ops_registration_details/);
  assert.match(dataHookSource, /ops_withdrawal_details/);
  assert.match(dataHookSource, /ops_transfer_details/);

  assert.match(source, /type CurriculumOperationImpactItem/);
  assert.match(source, /function getCurriculumOperationImpactItems/);
  assert.match(source, /const selectedRowOperationImpacts = selectedRow \? getCurriculumOperationImpactItems\(selectedRow, data\.operationTasks\) : \[\]/);
  assert.match(source, /data-testid="curriculum-operation-impact"/);
  assert.match(source, /등록\/전반\/퇴원 영향/);
  assert.match(source, /등록 예정/);
  assert.match(source, /전반 나감/);
  assert.match(source, /전반 들어옴/);
  assert.match(source, /퇴원 예정/);
  assert.match(source, /function getCurriculumOperationImpactPlanState/);
  assert.match(source, /item\.planStateLabel/);
  assert.match(source, /영향 회차 없음/);
  assert.match(source, /영향 진도 미배정/);
  assert.match(source, /수업계획 확인/);
  assert.match(source, /진행 중 등록\/전반\/퇴원 없음/);
  assert.match(source, /buildCurriculumOperationImpactHref\(item\)/);
  assert.match(source, /item\.type === "registration" \? "\/admin\/registration"/);
  assert.match(source, /taskId: item\.id/);
  assert.match(source, /planFixHref: buildCurriculumOperationImpactPlanFixHref\(row, item\.sessionLabel, planState\.label\)/);
  assert.match(source, /function buildCurriculumOperationImpactPlanFixHref/);
  assert.match(source, /수업계획 수정/);
  assert.match(source, /href=\{item\.planFixHref\}/);
  assert.match(source, /lesson-design-textbooks/);
  assert.match(source, /lesson-design-periods/);
  assert.match(source, /lesson-design-board/);
});

test("curriculum queue can isolate classes impacted by registration, transfer, and withdrawal work", async () => {
  const source = await readFile(new URL("src/features/academic/curriculum-workspace.tsx", root), "utf8");

  assert.match(source, /\{ value: "operations", label: "등록\/전반\/퇴원" \}/);
  assert.match(source, /function rowMatchesViewMode\(row: Record<string, unknown>, viewMode: string, operationTasks: Array<Record<string, unknown>> = \[\]\)/);
  assert.match(source, /if \(viewMode === "operations"\) \{/);
  assert.match(source, /return getCurriculumOperationImpactItems\(row, operationTasks\)\.length > 0/);
  assert.match(source, /getCurriculumViewRows\(model\.rows, viewMode, data\.operationTasks, todayDayLabel\)/);
  assert.match(source, /if \(getCurriculumOperationImpactItems\(row, data\.operationTasks\)\.length > 0\) counts\.operations \+= 1/);
  assert.match(source, /findFirstCurriculumQueueRow\(model\.rows, mode\.value, data\.operationTasks, todayDayLabel\)/);
  assert.match(source, /item\.value === "operations"/);
  assert.match(source, /영향 보기/);
  assert.match(source, /xl:grid-cols-4/);
});

test("curriculum operation queue exposes the first impact and direct plan fix", async () => {
  const source = await readFile(new URL("src/features/academic/curriculum-workspace.tsx", root), "utf8");
  const queueStart = source.indexOf('data-testid="curriculum-work-queue"');
  const queueEnd = source.indexOf('<div className="px-4 lg:px-6">', queueStart + 1);
  const queueBlock = source.slice(queueStart, queueEnd);

  assert.match(queueBlock, /const firstOperationImpact = item\.firstRow && isOperationQueue/);
  assert.match(queueBlock, /getCurriculumOperationImpactItems\(item\.firstRow, data\.operationTasks\)\[0\]/);
  assert.match(queueBlock, /firstOperationImpact\?\.label/);
  assert.match(queueBlock, /firstOperationImpact\?\.studentName/);
  assert.match(queueBlock, /firstOperationImpact\?\.dateLabel/);
  assert.match(queueBlock, /firstOperationImpact\?\.planStateLabel/);
  assert.match(queueBlock, /href=\{firstOperationImpact\.planFixHref\}/);
  assert.match(queueBlock, /aria-label=\{`\$\{text\(item\.firstRow\.title\)\} \$\{firstOperationImpact\.planStateLabel\} 바로 수정`\}/);
  assert.match(queueBlock, /수업계획 수정/);
});

test("curriculum operation impacts expose source task and lesson plan actions together", async () => {
  const source = await readFile(new URL("src/features/academic/curriculum-workspace.tsx", root), "utf8");
  const queueStart = source.indexOf('data-testid="curriculum-work-queue"');
  const queueEnd = source.indexOf('<div className="px-4 lg:px-6">', queueStart + 1);
  const queueBlock = source.slice(queueStart, queueEnd);
  const detailStart = source.indexOf('data-testid="curriculum-operation-impact"');
  const detailEnd = source.indexOf('data-testid="curriculum-sessions"', detailStart);
  const detailBlock = source.slice(detailStart, detailEnd);

  assert.match(queueBlock, /href=\{buildCurriculumOperationImpactHref\(firstOperationImpact\)\}/);
  assert.match(queueBlock, /업무 열기/);
  assert.match(queueBlock, /href=\{firstOperationImpact\.planFixHref\}/);
  assert.match(queueBlock, /수업계획 수정/);
  assert.match(detailBlock, /<Badge variant=\{item\.planStateVariant\}>\{item\.planStateLabel\}<\/Badge>[\s\S]*href=\{buildCurriculumOperationImpactHref\(item\)\}[\s\S]*업무 열기/);
  assert.match(detailBlock, /href=\{item\.planFixHref\}/);
});

test("curriculum operation queue has a clear empty state", async () => {
  const source = await readFile(new URL("src/features/academic/curriculum-workspace.tsx", root), "utf8");
  const queueStart = source.indexOf('data-testid="curriculum-work-queue"');
  const queueEnd = source.indexOf('<div className="px-4 lg:px-6">', queueStart + 1);
  const queueBlock = source.slice(queueStart, queueEnd);

  assert.match(queueBlock, /const queueEmptyLabel = isOperationQueue \? "진행 중 영향 없음" : "대상 없음"/);
  assert.match(queueBlock, /const queueDoneLabel = isOperationQueue \? "영향 없음" : "처리 없음"/);
  assert.match(queueBlock, /\{text\(item\.firstRow\?\.title\) \|\| queueEmptyLabel\}/);
  assert.match(queueBlock, /\{queueDoneLabel\}/);
});

test("curriculum operation impacts prioritize plan gaps before checked impacts", async () => {
  const source = await readFile(new URL("src/features/academic/curriculum-workspace.tsx", root), "utf8");
  const helperStart = source.indexOf("function getCurriculumOperationImpactSortWeight");
  const helperEnd = source.indexOf("function CurriculumWorkspaceSkeleton", helperStart);
  const helperBlock = source.slice(helperStart, helperEnd);

  assert.match(helperBlock, /function getCurriculumOperationImpactSortWeight\(planStateLabel: string\)/);
  assert.match(helperBlock, /case "영향 회차 없음":/);
  assert.match(helperBlock, /case "영향 진도 미배정":/);
  assert.match(helperBlock, /case "회차 미생성":/);
  assert.match(helperBlock, /case "교재 미연결":/);
  assert.match(helperBlock, /case "회차 미정":/);
  assert.match(helperBlock, /case "수업계획 확인":/);
  assert.match(helperBlock, /getCurriculumOperationImpactSortWeight\(left\.planStateLabel\) - getCurriculumOperationImpactSortWeight\(right\.planStateLabel\)/);
  assert.match(helperBlock, /left\.dateLabel\.localeCompare\(right\.dateLabel, "ko"\)/);
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
  assert.match(source, /data-testid="class-filter-popover-header"/);
  assert.match(source, /<PopoverContent align="end" className="w-\[min\(34rem,calc\(100vw-2rem\)\)\] p-0">/);
  assert.match(source, /<p className="truncate text-sm font-semibold text-foreground">필터<\/p>/);
});
