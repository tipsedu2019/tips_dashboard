import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { buildClassScheduleRouteModel } from "../src/features/operations/records.js";

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

test("lesson design modal opens fullscreen with its own scroll viewport", async () => {
  const source = await readSource("src/features/operations/class-schedule-workspace.tsx");

  assert.match(source, /data-testid="lesson-design-fullscreen-dialog"/);
  assert.match(source, /<DialogTitle className="sr-only">\{lessonDesignTitle\}<\/DialogTitle>/);
  assert.match(source, /className="[^"]*fixed[^"]*!inset-0[^"]*!flex[^"]*h-dvh[^"]*w-screen[^"]*!max-w-none[^"]*!translate-x-0[^"]*!translate-y-0[^"]*!rounded-none[^"]*overflow-hidden[^"]*"/);
  assert.match(source, /data-testid="lesson-design-dialog-scroll"/);
  assert.match(source, /className="[^"]*min-h-0[^"]*flex-1[^"]*overflow-y-auto[^"]*overscroll-contain[^"]*scroll-pb-28[^"]*"/);
  assert.doesNotMatch(source, /h-\[92vh\] w-\[98vw\] max-w-\[1600px\]/);
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
  assert.match(source, /xl:grid-cols-\[minmax\(18rem,0\.85fr\)_minmax\(34rem,1\.45fr\)\]/);
  assert.doesNotMatch(source, /2xl:grid-cols-\[minmax\(18rem,0\.85fr\)_minmax\(34rem,1\.45fr\)\]/);
  assert.match(
    source,
    /data-lesson-period-sidebar="true"[\s\S]*className="[^"]*xl:col-start-1[^"]*xl:pr-5[^"]*"/,
  );
  assert.match(
    source,
    /id=\{LESSON_DESIGN_SECTION_IDS\.calendar\}[\s\S]*className="[^"]*xl:col-start-2[^"]*xl:row-span-2[^"]*xl:border-l[^"]*xl:border-t-0[^"]*xl:px-5[^"]*"/,
  );
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

test("curriculum overview uses row actions instead of a duplicated detail panel", async () => {
  const source = await readSource("src/features/academic/curriculum-workspace.tsx");
  const workspaceSource = await readSource("src/features/operations/class-schedule-workspace.tsx");

  assert.doesNotMatch(source, /function getSessionSummaryLinkKey/);
  assert.doesNotMatch(source, /selectedRow\.sessionSummaries\.slice\(0, 8\)/);
  assert.doesNotMatch(source, /data-testid="curriculum-detail-actions"/);
  assert.doesNotMatch(source, /className="grid gap-6/);
  assert.doesNotMatch(source, /selectedRow/);
  assert.equal(source.match(/<section className=/g)?.length || 0, 1);
  assert.match(source, /const rowDesignAction = getCurriculumDesignAction\(row\)/);
  assert.match(source, /buildLessonDesignHref\(\s*row\.id,\s*rowDesignAction\.sectionId,\s*rowDesignAction\.sessionId,\s*curriculumReturnPath,\s*\)/);
  assert.match(
    workspaceSource,
    /sessionId:\s*isLessonDesignPage \|\| requestedLessonDesignSectionId \|\| requestedSessionId\s*\?\s*selectedLessonSessionId\s*: ""/,
  );
  assert.doesNotMatch(source, /업데이트 필요/);
});

test("lesson design can return to the originating class management context", async () => {
  const workspaceSource = await readSource("src/features/operations/class-schedule-workspace.tsx");
  const managementSource = await readSource("src/features/management/management-page.tsx");

  assert.match(managementSource, /const buildClassDetailReturnPath = \(/);
  assert.match(managementSource, /params\.set\("returnTo", requestedClassReturnPath\)/);
  assert.match(managementSource, /params\.set\("returnTo", buildClassDetailReturnPath\(normalizeClassDetailTab\(options\.returnTab\)\)\)/);
  assert.match(workspaceSource, /function normalizeAdminReturnPath/);
  assert.match(workspaceSource, /const requestedLessonReturnPath = normalizeAdminReturnPath\(searchParams\.get\("returnTo"\)\)/);
  assert.match(workspaceSource, /params\.delete\("returnTo"\)/);
  assert.match(workspaceSource, /if \(requestedLessonReturnPath\) \{[\s\S]*router\.replace\(requestedLessonReturnPath, \{ scroll: false \}\)/);
  assert.match(workspaceSource, /const lessonDesignReturnLabel = requestedLessonReturnPath\.includes\("\/admin\/classes"\)/);
  assert.match(workspaceSource, /\{lessonDesignReturnLabel\}/);
});

test("lesson design keeps return action reachable in the bottom save bar", async () => {
  const workspaceSource = await readSource("src/features/operations/class-schedule-workspace.tsx");

  assert.match(workspaceSource, /data-testid="lesson-design-bottom-action-bar"/);
  assert.match(workspaceSource, /requestedLessonReturnPath \? \(/);
  assert.match(workspaceSource, /data-testid="lesson-design-bottom-return"/);
  assert.match(workspaceSource, /aria-label=\{lessonDesignReturnLabel\}/);
  assert.match(workspaceSource, /onClick=\{closeLessonDesignWorkspace\}/);
  assert.match(workspaceSource, /requestedLessonReturnPath\.includes\("\/admin\/classes"\) \? "수업 상세" : "수업계획"/);
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
  assert.match(source, /data-testid=\{`lesson-textbook-remove-\$\{book\.textbookId\}`\}/);
  assert.match(source, />\s*연결 해제\s*<\/Button>/);
  assert.match(source, /handleRemoveLessonTextbook\(book\.textbookId\)/);
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
  assert.match(source, /const isLessonDesignRouteActive = isLessonDesignPage \|\| searchParams\.get\("lessonDesign"\) === "1"/);
  assert.match(source, /requestedLessonDesignSectionId === LESSON_DESIGN_SECTION_IDS\.board \|\|\s*requestedLessonDesignSectionId === LESSON_DESIGN_SECTION_IDS\.textbooks/);
  assert.match(source, /navigateToLessonDesignSection\(LESSON_DESIGN_SECTION_IDS\.periods\)/);
  assert.match(source, /navigateToLessonDesignSection\(LESSON_DESIGN_SECTION_IDS\.board\)/);
  assert.match(source, /currentParams: new URLSearchParams\(searchParams\.toString\(\)\)/);
  assert.match(source, /router\.replace\(`\$\{pathname\}\?\$\{nextParams\.toString\(\)\}`, \{ scroll: false \}\);/);
  assert.doesNotMatch(source, /if \(isLessonDesignPage && row\) \{/);
  assert.match(source, /isLessonDesignProgressMode \? \(/);
  assert.match(source, /renderLessonMonthSessionDetails\(periodSessions, \{ showTextbookPlans: false \}\)/);
  assert.match(
    source,
    /renderLessonMonthSessionDetails\(\[selectedLessonSession\], \{\s*showScheduleControls: false,\s*showTextbookPlans: true,\s*\}\)/,
  );
  assert.match(source, /sectionId: LESSON_DESIGN_SECTION_IDS\.board/);
  assert.match(
    source,
    /sectionId:\s*isLessonDesignRouteActive\s*\?\s*requestedLessonDesignSectionId \|\|\s*\(isLessonDesignPage && selectedLessonSessionId \? LESSON_DESIGN_SECTION_IDS\.board : ""\)\s*: ""/,
  );
  assert.doesNotMatch(
    source,
    /sectionId:\s*isLessonDesignPage\s*\?\s*requestedLessonDesignSectionId \|\|\s*\(selectedLessonSessionId \? LESSON_DESIGN_SECTION_IDS\.board : ""\)\s*: ""/,
  );
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
  const databaseStart = source.indexOf('data-testid="class-schedule-database-view"');
  const listSection = source.slice(databaseStart, source.indexOf("\n  );\n\n  return (", databaseStart));

  assert.match(listSection, /<Table className="min-w-\[1180px\] table-fixed">/);
  assert.match(listSection, /<colgroup>/);
  assert.match(listSection, /<col className="w-\[22%\]" \/>/);
  assert.match(listSection, /<col className="w-\[20%\]" \/>/);
  assert.match(listSection, /<col className="w-\[18%\]" \/>/);
  assert.match(listSection, /<TableHead>다음 작업<\/TableHead>/);
  assert.match(listSection, /<TableHead className="text-right">작업<\/TableHead>/);
  assert.match(listSection, /<TableCell className="align-top whitespace-normal">/);
  assert.match(listSection, /className="min-w-0 space-y-2/);
  assert.match(listSection, /className="font-medium leading-5 break-keep"/);
  assert.match(listSection, /data-testid=\{`class-schedule-database-row-\$\{row\.id\}`\}/);
  assert.doesNotMatch(source, /선택한 반 진행 상세/);
});

test("class schedule overview uses mobile cards instead of a clipped wide table", async () => {
  const source = await readSource("src/features/operations/class-schedule-workspace.tsx");
  const databaseStart = source.indexOf('data-testid="class-schedule-database-view"');
  const listSection = source.slice(databaseStart, source.indexOf("\n  );\n\n  return (", databaseStart));

  assert.match(listSection, /data-testid="class-schedule-sync-group-bar"/);
  assert.match(listSection, /data-testid="class-schedule-mobile-list"/);
  assert.match(listSection, /className="grid gap-2 md:hidden"/);
  assert.match(listSection, /data-testid=\{`class-schedule-mobile-card-\$\{row\.id\}`\}/);
  assert.match(listSection, /row\.scheduleLabel \|\| "시간표 미정"/);
  assert.match(listSection, /계획 \{row\.latestPlannedSessionIndex\}회차 · 실제 \{row\.latestActualSessionIndex\}회차/);
  assert.match(listSection, /snapshot\?\.pendingSessionSummary/);
  assert.match(listSection, /<ScrollArea className="hidden h-\[44rem\] md:block">/);
});

test("class schedule work queue summarizes pending sessions without exposing raw ids", () => {
  const model = buildClassScheduleRouteModel({
    classes: [
      {
        id: "class-1",
        name: "고1 공통수학",
        subject: "수학",
        schedule_plan: {
          sessions: [
            { id: "550e8400-e29b-41d4-a716-446655440000", progressStatus: "pending" },
            { id: "session:2026-07-15:period-177458:active", progressStatus: "pending" },
            { id: "session-1", sessionNumber: 1, progressStatus: "pending" },
            { id: "session-2", sessionNumber: 2, progressStatus: "pending" },
            { id: "duplicate-session-2", sessionNumber: 2, progressStatus: "pending" },
          ],
        },
      },
    ],
  });

  assert.equal(model.rows[0].pendingSessionSummary, "1회차, 2회차 · 회차 정보 확인 2건");
  assert.doesNotMatch(model.rows[0].pendingSessionSummary, /550e8400|session:2026|duplicate-session/);
});

test("class schedule overview opens the official class schedule detail with preserved context", async () => {
  const source = await readSource("src/features/operations/class-schedule-workspace.tsx");
  const databaseStart = source.indexOf('data-testid="class-schedule-database-view"');
  const listSection = source.slice(databaseStart, source.indexOf("\n  );\n\n  return (", databaseStart));

  assert.match(source, /const CLASS_SCHEDULE_SCROLL_STORAGE_PREFIX = "tips:class-schedule-database-scroll:"/);
  assert.match(source, /function buildClassScheduleListHref/);
  assert.match(source, /function buildOfficialClassScheduleDetailHref/);
  assert.match(source, /params\.set\("tab", "schedule"\)/);
  assert.match(source, /params\.set\("section", resolvedSectionId\)/);
  assert.match(source, /params\.set\("sessionId", resolvedSessionId\)/);
  assert.match(source, /params\.set\("returnTo", normalizedReturnTo\)/);
  assert.match(source, /const \[search, setSearch\] = useState\(\(\) => text\(searchParams\.get\("q"\)\)\)/);
  assert.match(source, /const classScheduleReturnPath = useMemo/);
  assert.match(source, /router\.replace\(nextHref, \{ scroll: false \}\)/);
  assert.match(source, /const rememberClassScheduleListPosition = useCallback/);
  assert.match(source, /data-testid="class-schedule-desktop-scroll-anchor"/);
  assert.match(source, /const openClassScheduleOfficialDetail = useCallback/);
  assert.match(source, /router\.push\(buildOfficialClassScheduleDetailHref/);
  assert.match(listSection, /role="link"/);
  assert.match(listSection, /onClick=\{\(\) => openClassScheduleOfficialDetail\(row, nextSessionId, LESSON_DESIGN_SECTION_IDS\.periods\)\}/);
  assert.match(listSection, /onKeyDown=\{\(event\) => handleClassScheduleRowKeyDown\(event, row, nextSessionId, LESSON_DESIGN_SECTION_IDS\.periods\)\}/);
  assert.match(listSection, /href=\{buildOfficialClassScheduleDetailHref\(row, nextSessionId, LESSON_DESIGN_SECTION_IDS\.periods, classScheduleReturnPath\)\}/);
  assert.doesNotMatch(listSection, /onClick=\{\(\) => setSelectedClassId\(row\.id\)\}/);
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
