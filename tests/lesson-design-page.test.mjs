import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

async function readSource(pathname) {
  return readFile(new URL(pathname, root), "utf8");
}

test("shared lesson design workspace content does not depend on dialog title primitives", async () => {
  const source = await readSource("src/features/operations/class-schedule-workspace.tsx");
  const workspaceContentMatch = source.match(
    /const lessonDesignWorkspaceContent = \(([\s\S]*?)\r?\n\r?\n  const classScheduleWorkspaceContent = \(/,
  );

  assert.ok(workspaceContentMatch, "lesson design workspace content block should exist");
  assert.doesNotMatch(workspaceContentMatch[1], /DialogHeader/);
  assert.doesNotMatch(workspaceContentMatch[1], /DialogTitle/);
  assert.doesNotMatch(workspaceContentMatch[1], /DialogDescription/);
});

test("lesson design page keeps schedule controls direct and non-duplicative", async () => {
  const source = await readSource("src/features/operations/class-schedule-workspace.tsx");
  const plannerSource = await readSource("src/lib/class-schedule-planner.js");

  assert.doesNotMatch(source, /월 기준 회차/);
  assert.doesNotMatch(source, /handleLessonGlobalSessionCountChange/);
  assert.match(plannerSource, /const globalSessionCount = getRecommendedSessionCount\(selectedDays\);/);
  assert.match(source, /selectedDays\.length > 0 \? selectedDays\.length \* 4 : 0/);
  assert.match(source, /lessonCalendarMonths\.map\(\(month\) =>/);
  assert.match(source, /월 선택/);
  assert.match(source, /2xl:grid-cols-\[minmax\(18rem,0\.85fr\)_minmax\(34rem,1\.45fr\)\]/);
  assert.doesNotMatch(source, /aria-label="수업 일정 현황"/);
  assert.doesNotMatch(source, /생성 \{month\.activeCount\}회 · 대기 \{month\.pendingCount\}회/);
  assert.doesNotMatch(source, /<Badge variant="outline">\{month\.label\}<\/Badge>/);
  assert.doesNotMatch(source, /rounded-3xl border bg-background shadow-sm/);
  assert.doesNotMatch(source, /lessonStatusCounts/);
  assert.doesNotMatch(source, /setSelectedLessonStatus/);
  assert.doesNotMatch(source, /lessonScheduleStateCounts/);
  assert.doesNotMatch(source, /calendar-jump-/);
  assert.doesNotMatch(source, /setSelectedLessonScheduleState\(value\)/);
});

test("lesson design period add follows the previous period month sequence", async () => {
  const source = await readSource("src/features/operations/class-schedule-workspace.tsx");
  const plannerSource = await readSource("src/lib/class-schedule-planner.js");

  assert.match(source, /getNextBillingPeriodMonth/);
  assert.match(source, /const nextMonth = lastPeriod \? getNextBillingPeriodMonth\(lastPeriod\) : 1;/);
  assert.match(source, /month: nextMonth/);
  assert.match(source, /label: `\$\{nextMonth\}월`/);
  assert.doesNotMatch(source, /month: nextPeriodIndex/);
  assert.match(plannerSource, /export function getNextBillingPeriodMonth/);
});

test("lesson design session timeline connects through centered markers", async () => {
  const source = await readSource("src/features/operations/class-schedule-workspace.tsx");

  assert.match(source, /"absolute left-3 w-px -translate-x-1\/2 bg-border"/);
  assert.match(source, /isFirstFlowItem \? "top-1\/2" : "-top-3"/);
  assert.match(source, /isLastFlowItem \? "bottom-1\/2" : "-bottom-3"/);
  assert.match(source, /"absolute left-3 top-1\/2 z-10 flex size-4 -translate-x-1\/2 -translate-y-1\/2/);
  assert.doesNotMatch(source, /absolute left-5 top-10 bottom-10 w-px bg-border/);
  assert.doesNotMatch(source, /absolute -left-7 top-5/);
});

test("lesson design keeps every generated month visible while focusing one month", async () => {
  const source = await readSource("src/features/operations/class-schedule-workspace.tsx");

  assert.match(source, /function getAllLessonMonthKeys/);
  assert.match(source, /return matchesPeriod && matchesScheduleState;/);
  assert.match(source, /setSelectedLessonMonthKeys\(getAllLessonMonthKeys\(monthSummaries\)\)/);
  assert.match(source, /setFocusedLessonMonthKey\(focusedMonthKeys\[0\] \|\| ""\)/);
  assert.match(source, /function getLessonCalendarMonthSurfaceStyle/);
  assert.match(source, /function getLessonCalendarSessionSurfaceStyle/);
  assert.match(source, /state && state !== "active"/);
  assert.match(source, /data-lesson-calendar-month=\{month\.key\}/);
  assert.match(source, /style=\{monthSurfaceStyle\}/);
  assert.match(source, /style=\{primarySessionSurfaceStyle\}/);
  assert.match(source, /data-lesson-calendar-session-id=\{primarySession\?\.id \|\| ""\}/);
  assert.match(source, /data-lesson-calendar-accent=\{primarySessionAccentColor\}/);
  assert.match(source, /session\.billingColor \|\| accentColor/);
  assert.doesNotMatch(source, /2xl:sticky 2xl:top-20/);
  assert.doesNotMatch(source, /2xl:max-h-\[calc\(100vh-6rem\)\]/);
  assert.match(source, /data-lesson-period-sidebar="true"/);
  assert.match(source, /data-lesson-period-session-id=\{session\.id\}/);
  assert.match(source, /function scrollLessonDesignSessionPair/);
  assert.match(source, /scrollElementInsideContainerToCenter/);
  assert.match(source, /scrollMode: "sync"/);
  assert.match(source, /const periodSessionMonthKeys = \[/);
  assert.match(source, /!text\(session\.periodId\) && periodStartMonthKey && session\.monthKey === periodStartMonthKey/);
  assert.match(source, /const periodHasActiveMonth = periodSessionMonthKeys\.includes\(activeLessonMonthKey\)/);
  assert.match(source, /periodSessions\.some\(\(session\) => session\.id === selectedLessonSession\?\.id\)/);
  assert.match(source, /id=\{getLessonDesignPeriodDetailId\(monthKey\)\}/);
  assert.doesNotMatch(source, /return matchesMonth && matchesPeriod && matchesScheduleState;/);
  assert.doesNotMatch(source, /setSelectedLessonMonthKeys\(\[scopedSession\.monthKey\]\)/);
});

test("lesson design connects textbooks before assigning session ranges", async () => {
  const source = await readSource("src/features/operations/class-schedule-workspace.tsx");
  const plannerSource = await readSource("src/lib/class-schedule-planner.js");

  assert.match(source, /수업교재/);
  assert.match(source, /handleAddLessonTextbook/);
  assert.match(source, /currentBooks\.length === 0 \? firstSessionId : selectedSessionId \|\| firstSessionId/);
  assert.match(source, /lessonPlanSourceKeyRef/);
  assert.match(source, /lessonPlanSourceKeyRef\.current === lessonPlanSourceKey/);
  assert.match(source, /handleLessonTextbookCatalogChange/);
  assert.match(source, /handleLessonTextbookCatalogRange/);
  assert.match(source, /normalizeLessonSubjectKey/);
  assert.match(source, /buildLessonTextbookSubjectFilterOptions/);
  assert.match(source, /matchesLessonSubjectFilter/);
  assert.match(source, /getLessonSubjectDisplayLabel/);
  assert.match(source, /const allMonthKeys = getAllLessonMonthKeys\(nextLessonDesignSnapshot\.monthSummaries\)/);
  assert.match(source, /const nextSelectedMonthKeys = allMonthKeys/);
  assert.match(source, /setFocusedLessonMonthKey\(targetSession\?\.monthKey \|\| requestedMonthKeys\[0\] \|\| nextSelectedMonthKeys\[0\] \|\| ""\)/);
  assert.match(source, /monthKeys: requestedLessonMonthKeys/);
  assert.match(source, /\.find\(\(entries\) => Array\.isArray\(entries\) && entries\.length > 0\)/);
  assert.match(source, /const textbookEntrySources = planOverride/);
  assert.match(source, /진도 편집/);
  assert.match(source, /교재 범위 미지정/);
  assert.match(plannerSource, /area: textbook\.area \|\| ""/);
  assert.match(plannerSource, /subSubject: textbook\.subSubject \|\| ""/);
});

test("lesson design summarizes generated sessions in one pass", async () => {
  const source = await readSource("src/features/operations/class-schedule-workspace.tsx");

  assert.match(source, /function buildLessonDesignSessionSummary/);
  assert.match(source, /const monthSummaryMap = new Map/);
  assert.match(source, /const periodSessionCounts = new Map/);
  assert.match(source, /const sessionSummary = buildLessonDesignSessionSummary\(sessions, periodSummaries\)/);
  assert.match(source, /periodSummariesWithSessionCounts/);
  assert.match(source, /monthSummaries: \[\.\.\.monthSummaryMap\.values\(\)\]\.sort/);
  assert.doesNotMatch(source, /const monthSummaries = \[\.\.\.new Set\(sessions\.map/);
  assert.doesNotMatch(source, /const completedSessionCount = sessions\.filter/);
  assert.doesNotMatch(source, /const updatedSessionCount = sessions\.filter/);
  assert.doesNotMatch(source, /const undatedSessions = sessions\.filter/);
});

test("lesson design ranks class-fit textbooks and keeps session range entry manual", async () => {
  const source = await readSource("src/features/operations/class-schedule-workspace.tsx");

  assert.match(source, /function scoreLessonTextbookCandidate/);
  assert.match(source, /function findMatchingLessonSessionRecord/);
  assert.match(source, /if \(sessionId\) \{/);
  assert.match(source, /plannerGrade/);
  assert.match(source, /score: scoreLessonTextbookCandidate\(book, lessonDesignSnapshot\)/);
  assert.match(source, /right\.score - left\.score/);
  assert.match(source, /lessonTextbookProgressSessions/);
  assert.match(source, /selectedLessonTextbookProgressSessionIndex/);
  assert.match(source, /lessonTextbookCompletedSessionCount/);
  assert.match(source, /lessonTextbookPendingSessionCount/);
  assert.match(source, /lessonTextbookOutOfRangeSessionCount/);
  assert.match(source, /selectedLessonSessionSummaryLabel/);
  assert.match(source, /selectedLessonSessionRangeStateLabel/);
  assert.match(source, /applyTextbookPlanRangeField/);
  assert.match(source, /handleLessonTextbookPlanChange/);
  assert.match(source, /handleIncludeLessonSessionInTextbookRange/);
  assert.match(source, /markPendingLessonSessionSelection\(sessionId\)/);
  assert.match(source, /시작 범위/);
  assert.match(source, /종료 범위/);
  assert.match(source, /표시 문구/);
  assert.match(source, /계획 메모/);
  assert.match(source, /placeholder="예: p\.12"/);
  assert.match(source, /placeholder="예: p\.18"/);
  assert.match(source, /placeholder="예: 1단원 개념"/);
  assert.match(source, /placeholder="메모"/);
  assert.match(source, /aria-label=\{`\$\{entry\.textbookTitle\} \$\{selectedLessonSession\.label\} 시작 범위`\}/);
  assert.match(source, /aria-label=\{`\$\{entry\.textbookTitle\} \$\{selectedLessonSession\.label\} 종료 범위`\}/);
  assert.match(source, /aria-label=\{`\$\{entry\.textbookTitle\} \$\{selectedLessonSession\.label\} 표시 문구`\}/);
  assert.match(source, /aria-label=\{`\$\{entry\.textbookTitle\} \$\{selectedLessonSession\.label\} 계획 메모`\}/);
  assert.doesNotMatch(source, /교재 프리셋/);
  assert.doesNotMatch(source, /목차 프리셋/);
  assert.doesNotMatch(source, /buildDerivedLessonRangePresets/);
  assert.doesNotMatch(source, /handleLessonTextbookPlanAutoFill/);
  assert.doesNotMatch(source, /auto-fill-current-session/);
  assert.doesNotMatch(source, /auto-fill-following-sessions/);
  assert.match(source, /기간에 포함/);
  assert.match(source, /전체 기간/);
  assert.match(source, /현재 회차부터/);
  assert.doesNotMatch(source, /현재 회차 자동 배정/);
  assert.doesNotMatch(source, /이후 회차 자동 배정/);
  assert.doesNotMatch(source, />\s*회차 자동\s*</);
  assert.doesNotMatch(source, />\s*이후 자동\s*</);
  assert.match(source, /const generatedSessionLabel =/);
  assert.doesNotMatch(source, /"0회차"/);
  assert.doesNotMatch(source, /title=\{preset\.label\}/);
  assert.doesNotMatch(source, /preset\.label\.startsWith\(`\$\{entry\.scopeLabel\} `\)/);
  assert.match(source, /이전 회차/);
  assert.doesNotMatch(source, /다음 미배정/);
  assert.match(source, /진도 \{lessonTextbookCompletedSessionCount\}\/\{lessonTextbookProgressSessions\.length\}/);
  assert.match(source, /미배정 \{lessonTextbookPendingSessionCount\}/);
  assert.match(source, /\{selectedLessonSessionAssignedTextbookCount\}\/\{selectedLessonSession\.textbookEntries\.length\}권 배정/);
  assert.match(source, /Math\.max\(selectedLessonTextbookProgressSessionIndex \+ 1, 1\)/);
  assert.match(source, /\{lessonTextbookProgressSessions\.length\}회/);
  assert.doesNotMatch(source, /\{Math\.max\(selectedLessonSessionIndex \+ 1, 1\)\}\/\{filteredLessonSessions\.length\}회/);
  assert.match(source, /다음 회차/);
  assert.match(source, /교재별 진도/);
  assert.doesNotMatch(source, /\$\{textbookEntrySummaries\.length\}개 교재 범위/);
});

test("curriculum overview links each session to its range editor", async () => {
  const source = await readSource("src/features/academic/curriculum-workspace.tsx");
  const workspaceSource = await readSource("src/features/operations/class-schedule-workspace.tsx");

  assert.match(source, /function getSessionSummaryLinkKey/);
  assert.match(source, /selectedRow\.sessionSummaries\.slice\(0, 8\)\.map\(\(session, sessionIndex\) =>/);
  assert.match(source, /key=\{getSessionSummaryLinkKey\(session, sessionIndex\)\}/);
  assert.doesNotMatch(source, /key=\{session\.sessionId \|\| `\$\{session\.sessionOrder\}/);
  assert.match(source, /buildLessonDesignHref\(\s*selectedRow\.id,\s*session\.sessionId \|\| "",\s*"lesson-design-periods"/);
  assert.match(workspaceSource, /sessionId: isLessonDesignPage \? selectedLessonSessionId : ""/);
  assert.match(source, /session\.planSummary \|\| "범위 미지정"/);
  assert.match(source, /session\.hasPlanContent \? "배정" : "대기"/);
  assert.doesNotMatch(source, /업데이트 필요/);
});

test("lesson design session query sync does not override local session clicks", async () => {
  const source = await readSource("src/features/operations/class-schedule-workspace.tsx");

  assert.match(source, /lastRequestedLessonSessionKeyRef/);
  assert.match(source, /pendingLessonSessionNavigationKeyRef/);
  assert.match(source, /lastSyncedLessonSessionPairKeyRef/);
  assert.match(source, /markPendingLessonSessionSelection/);
  assert.match(source, /options: \{ sessionId\?: string; monthKeys\?: string\[\]; sectionId\?: string \}/);
  assert.match(source, /sectionId: targetSectionId/);
  assert.match(source, /requestedLessonSessionKey/);
  assert.match(source, /const nextLessonSessionKey = `\$\{text\(row\?\.id \|\| selectedRow\?\.id \|\| selectedClassId\)\}:\$\{resolvedSessionId\}`/);
  assert.match(source, /pendingLessonSessionNavigationKeyRef\.current = nextLessonSessionKey/);
  assert.match(
    source,
    /pendingLessonSessionNavigationKeyRef\.current &&\s*pendingLessonSessionNavigationKeyRef\.current !== requestedLessonSessionKey/,
  );
  assert.match(source, /pendingLessonSessionNavigationKeyRef\.current === requestedLessonSessionKey/);
  assert.match(source, /pendingLessonSessionNavigationKeyRef\.current = ""/);
  assert.match(
    source,
    /lastRequestedLessonSessionKeyRef\.current === requestedLessonSessionKey &&\s*selectedLessonSessionId === resolvedRequestedSession\.id/,
  );
  assert.match(source, /lastRequestedLessonSessionKeyRef\.current = requestedLessonSessionKey/);
  assert.match(source, /requestedLessonDesignSectionId === LESSON_DESIGN_SECTION_IDS\.periods/);
  assert.match(source, /setLessonMonthDetailsOpen\(true\)/);
  assert.match(source, /scrollLessonDesignSessionPairAfterRender\(resolvedRequestedSession\.id\)/);
  assert.match(source, /markPendingLessonSessionSelection\(periodSelectedSession\.id\)/);
  assert.doesNotMatch(source, /setSelectedLessonSessionId\(periodSelectedSession\.id\)/);
  assert.match(source, /options: \{ scroll\?: boolean \} = \{\}/);
  assert.match(source, /scroll: scrollMode !== "none" && scrollMode !== "sync"/);
  assert.match(source, /scrollMode\?: "editor" \| "section" \| "sync" \| "none"/);
  assert.match(source, /scrollLessonDesignPeriodDetailAfterRender/);
  assert.match(source, /scrollLessonDesignSessionPairAfterRender/);
  assert.match(
    source,
    /requestedLessonDesignSectionId === LESSON_DESIGN_SECTION_IDS\.periods && selectedSessionId[\s\S]*scrollLessonDesignSessionPair\(selectedSessionId\)/,
  );
  assert.match(
    source,
    /requestedLessonDesignSectionId !== LESSON_DESIGN_SECTION_IDS\.periods[\s\S]*lastSyncedLessonSessionPairKeyRef\.current = ""[\s\S]*scrollLessonDesignSessionPairAfterRender\(selectedLessonSession\.id\)/,
  );
  assert.match(source, /if \(meta\.hasSession\) \{[\s\S]*handleLessonCalendarSelect\(dateKey\);[\s\S]*return;/);
  assert.match(
    source,
    /if \(primarySession\) \{[\s\S]*focusLessonDesignSession\(primarySession\.id,[\s\S]*scrollMode: "sync"/,
  );
});

test("lesson design separates textbook finder and connected textbook ranges", async () => {
  const source = await readSource("src/features/operations/class-schedule-workspace.tsx");

  assert.match(source, /lessonTextbookSubjectFilter/);
  assert.match(source, /lessonTextbookCategoryFilter/);
  assert.match(source, /lessonTextbookPublisherFilter/);
  assert.match(source, /isLessonTextbookFinderOpen/);
  assert.match(source, /isLessonTextbookFinderVisible/);
  assert.match(source, /lessonTextbookFinderHasQuery/);
  assert.match(source, /hasLessonTextbooks/);
  assert.match(source, /getLessonTextbookScheduleRangeLabel/);
  assert.match(source, /startSessionId/);
  assert.match(source, /endSessionId/);
  assert.match(source, /return matchesPeriod && matchesScheduleState;/);
  assert.doesNotMatch(source, /selectedMonthSet\.has\(session\.monthKey\)/);
  assert.match(source, /session\.periodId === selectedLessonPeriodId/);
  assert.match(source, /session\.scheduleState === selectedLessonScheduleState/);
  assert.match(source, /sortLessonSessionRecords/);
  assert.match(source, /primarySession\?\.textbookEntries/);
  assert.match(source, /lessonTextbookFilterSummary/);
  assert.match(source, /후보 \{lessonTextbookOptions\.length\}/);
  assert.match(source, /setIsLessonTextbookFinderOpen\(false\)/);
  assert.match(source, /setIsLessonTextbookFinderOpen\(true\)/);
  assert.match(source, /const deferredLessonTextbookSearch = useDeferredValue\(lessonTextbookSearch\)/);
  assert.match(source, /const query = text\(deferredLessonTextbookSearch\)\.toLowerCase\(\)/);
  assert.match(source, /type="search"[\s\S]*value=\{lessonTextbookSearch\}/);
  assert.match(source, /autoComplete="off"[\s\S]*enterKeyHint="search"/);
  assert.match(source, /const candidates: Array<\{ book: Record<string, unknown>; score: number; title: string \}> = \[\]/);
  assert.match(source, /for \(const book of data\.textbooks\)/);
  assert.match(source, /score: scoreLessonTextbookCandidate\(book, lessonDesignSnapshot\)/);
  assert.match(source, /return scoreGap \|\| left\.title\.localeCompare\(right\.title, "ko"\)/);
  assert.doesNotMatch(source, /onPointerDown=\{\(\) => \{\s*if \(!isLessonTextbookFinderVisible\)/);
  assert.match(source, /교재 추가/);
  assert.match(source, /목록 닫기/);
  assert.match(source, /수업교재 검색 지우기/);
  assert.match(source, /lesson-textbook-finder/);
  assert.match(source, /aria-expanded=\{isLessonTextbookFinderVisible\}/);
  assert.match(source, /isLessonDesignProgressMode && !hasLessonTextbooks \? "교재 연결 필요" : "저장"/);
  assert.doesNotMatch(source, /xl:sticky xl:top-20/);
  assert.match(source, /isLessonDesignProgressMode && hasLessonTextbooks \? \(/);
  assert.match(source, /교재 기간 밖/);
  assert.match(source, /기간 밖/);
  assert.match(source, /id=\{LESSON_DESIGN_SECTION_IDS\.board\}[\s\S]*relative z-\[1\] min-w-0 border-t bg-background py-6/);
  assert.match(source, /onPointerDown=\{\(\) => markPendingLessonSessionSelection\(session\.id\)\}/);
  assert.match(source, /onMouseDown=\{\(\) => markPendingLessonSessionSelection\(session\.id\)\}/);
  assert.match(source, /data-testid=\{`lesson-board-session-\$\{session\.id\}`\}/);
  assert.match(source, /data-testid=\{`lesson-textbook-candidate-\$\{bookId\}`\}/);
  assert.match(source, /id="lesson-session-jump"/);
  assert.match(source, /lessonSessionIndexById/);
  assert.match(source, /filteredLessonSessionById/);
  assert.match(source, /lessonDesignSessionById/);
  assert.match(source, /firstPendingLessonSession/);
  assert.match(source, /filteredLessonSessionById\.has\(current\)/);
  assert.match(source, /filteredLessonSessionById\.get\(selectedLessonSessionId\)/);
  assert.match(source, /lessonDesignSessionById\.get\(resolvedSessionId\)/);
  assert.match(source, /lessonSessionJumpOptions/);
  assert.match(source, /\{lessonSessionJumpOptions\.map\(\(session\) => \(/);
  assert.doesNotMatch(source, /\{filteredLessonSessions\.map\(\(session\) => \(\s*<option key=\{`lesson-session-jump/);
  assert.match(source, /focusLessonDesignSession\(previousLessonSession\.id/);
  assert.match(source, /focusLessonDesignSession\(nextLessonSession\.id/);
  assert.match(source, /aria-pressed=\{isSelected\}/);
  assert.match(source, /textbookSessionCount/);
  assert.match(source, /outsideTextbookRangeCount/);
  assert.match(source, /대상 \{group\.textbookSessionCount\}/);
  assert.match(source, /기간 밖 \{group\.outsideTextbookRangeCount\}/);
  assert.doesNotMatch(source, /대상 \{group\.sessions\.filter\(\(session\) => session\.textbookEntries\.length > 0\)\.length\}/);
  assert.match(source, /lessonTextbookSelectedCount > 0 \? "max-h-44" : "max-h-\[22rem\]"/);
  assert.doesNotMatch(source, /xl:max-h-\[calc\(100vh-12rem\)\] xl:overflow-y-auto/);
  assert.match(source, /md:grid-cols-\[6rem_minmax\(8rem,1fr\)_minmax\(8rem,1fr\)\]/);
  assert.match(source, /h-7 rounded-md px-2 text-xs/);
  assert.match(source, /\$\{textbookEntrySummaries\.length\}권 범위 미배정/);
  assert.doesNotMatch(source, /\$\{primaryTextbookEntry\.textbookTitle\} · 범위 미배정/);
  assert.doesNotMatch(source, /lessonTextbookWorkspaceSummary/);
  assert.match(source, /plannedTextbookCount/);
  assert.match(source, /sessionPlanStateLabel/);
  assert.match(source, /selectedLessonSession\.textbookEntries\.map\(\(entry\) =>/);
  assert.doesNotMatch(source, /sticky top-0 z-20/);
  assert.doesNotMatch(source, /2xl:sticky 2xl:top-20/);
  assert.match(source, /aria-pressed=\{isLessonDesignProgressMode\}/);
});

test("lesson design splits schedule generation from progress generation", async () => {
  const source = await readSource("src/features/operations/class-schedule-workspace.tsx");

  assert.match(source, /lessonDesignActiveMode/);
  assert.match(source, /isLessonDesignProgressMode/);
  assert.match(source, /navigateToLessonDesignSection\(LESSON_DESIGN_SECTION_IDS\.periods\)/);
  assert.match(source, /navigateToLessonDesignSection\(LESSON_DESIGN_SECTION_IDS\.board\)/);
  assert.match(source, /isLessonDesignProgressMode \? \(/);
  assert.match(source, /renderLessonMonthSessionDetails\(periodSessions, \{ showTextbookPlans: false \}\)/);
  assert.match(
    source,
    /renderLessonMonthSessionDetails\(\[selectedLessonSession\], \{\s*showScheduleControls: false,\s*showTextbookPlans: true,\s*\}\)/,
  );
  assert.match(source, /sectionId: LESSON_DESIGN_SECTION_IDS\.board/);
});

test("lesson design keeps navigation, recovery, and save actions stable", async () => {
  const source = await readSource("src/features/operations/class-schedule-workspace.tsx");

  assert.match(source, /function resolveRequestedLessonDesignSession/);
  assert.match(source, /scrollLessonDesignSectionAfterRender/);
  assert.match(source, /data-testid="lesson-design-mode-tabs"/);
  assert.match(source, /data-testid="lesson-design-page-scroll"/);
  assert.match(source, /aria-label="수업 설계 작업 영역"/);
  assert.match(source, /tabIndex=\{0\}/);
  assert.match(source, /h-\[calc\(100dvh-var\(--header-height\)-2rem\)\] overflow-y-auto overscroll-contain/);
  assert.match(source, /data-testid="lesson-design-bottom-action-bar"/);
  assert.match(source, /fixed bottom-4 right-4 z-30/);
  assert.match(source, /data-testid="lesson-design-progress-editor"/);
  assert.match(source, /data-testid="lesson-design-progress-editor"[\s\S]*overflow-x-hidden/);
  assert.match(source, /2xl:sticky 2xl:top-\[calc\(var\(--header-height\)\+1rem\)\]/);
  assert.match(source, /2xl:max-h-\[calc\(100dvh-var\(--header-height\)-6\.5rem\)\] 2xl:self-start 2xl:overflow-y-auto/);
  assert.match(source, /\[content-visibility:auto\]/);
  assert.match(source, /const canScrollInside =/);
  assert.match(source, /window\.getComputedStyle\(scrollContainer\)\.overflowY/);
  assert.match(source, /const requestedLessonSessionKey = `\$\{requestedClassId\}:\$\{resolvedRequestedSession\.id\}`/);
  assert.match(source, /lastRequestedLessonSessionKeyRef\.current = requestedLessonSessionKey/);
  assert.match(source, /sessionId: resolvedRequestedSession\.id/);
});

test("class schedule overview keeps dense list columns from colliding", async () => {
  const source = await readSource("src/features/operations/class-schedule-workspace.tsx");
  const listSection = source.slice(
    source.indexOf('<p className="text-sm font-semibold text-foreground">수업 목록</p>'),
    source.indexOf('<p className="text-sm font-semibold text-foreground">동기 그룹</p>'),
  );

  assert.match(listSection, /<Table className="min-w-\[980px\] table-fixed">/);
  assert.match(listSection, /<colgroup>/);
  assert.match(listSection, /<col className="w-\[24%\]" \/>/);
  assert.match(listSection, /<col className="w-\[28%\]" \/>/);
  assert.match(listSection, /<col className="w-\[18%\]" \/>/);
  assert.match(listSection, /<TableCell className="align-top whitespace-normal">/);
  assert.match(listSection, /className="min-w-0 space-y-2/);
  assert.match(listSection, /className="font-medium leading-5 break-keep"/);
});

test("class schedule overview uses mobile cards instead of a clipped wide table", async () => {
  const source = await readSource("src/features/operations/class-schedule-workspace.tsx");
  const listSection = source.slice(
    source.indexOf('<p className="text-sm font-semibold text-foreground">수업 목록</p>'),
    source.indexOf('<p className="text-sm font-semibold text-foreground">동기 그룹</p>'),
  );

  assert.match(listSection, /data-testid="class-schedule-mobile-list"/);
  assert.match(listSection, /className="grid gap-2 md:hidden"/);
  assert.match(listSection, /data-testid=\{`class-schedule-mobile-card-\$\{row\.id\}`\}/);
  assert.match(listSection, /row\.scheduleLabel \|\| "시간표 미정"/);
  assert.match(listSection, /계획 \{row\.latestPlannedSessionIndex\}회차 · 실제 \{row\.latestActualSessionIndex\}회차/);
  assert.match(listSection, /<ScrollArea className="hidden h-\[34rem\] pr-4 md:block">/);
});

test("lesson design exposes a compact PC work queue only when it adds progress value", async () => {
  const source = await readSource("src/features/operations/class-schedule-workspace.tsx");

  assert.match(source, /const lessonDesignWorkQueueItems = isLessonDesignProgressMode/);
  assert.match(source, /: \[\]/);
  assert.match(source, /isLessonDesignProgressMode && lessonDesignWorkQueueItems\.length > 0/);
  assert.match(source, /data-testid="lesson-design-work-queue"/);
  assert.match(source, /lessonTextbookSelectedCount/);
  assert.match(source, /lessonTextbookPendingSessionCount/);
  assert.match(source, /lessonTextbookOutOfRangeSessionCount/);
  assert.match(source, /nextPendingLessonSession/);
  assert.match(source, /firstOutOfRangeLessonSession/);
  assert.match(source, /selectedLessonSessionSummaryLabel/);
  assert.match(source, /scrollLessonDesignSection\(item\.sectionId\)/);
  assert.match(source, /focusLessonDesignSession\(item\.targetSessionId/);
  assert.match(source, /targetSessionId/);
  assert.match(source, /label: "기간 밖"/);
  assert.match(source, /lg:grid-cols-5/);
  assert.doesNotMatch(source, /key: "periods"[\s\S]*key: "state"/);
});

test("lesson design presents compact filters, selected rows, and mobile-safe sessions", async () => {
  const source = await readSource("src/features/operations/class-schedule-workspace.tsx");

  assert.match(source, /data-testid="lesson-textbook-filter-chips"/);
  assert.match(source, /data-testid="lesson-mobile-session-list"/);
  assert.match(source, /data-testid="lesson-desktop-calendar"/);
  assert.match(source, /data-lesson-session-selected=\{isSelected \? "true" : "false"\}/);
  assert.match(source, /data-lesson-selected-editor=\{isSelectedSession \? "true" : "false"\}/);
  assert.doesNotMatch(source, /auto-fill-current-session/);
  assert.doesNotMatch(source, /auto-fill-following-sessions/);
});
