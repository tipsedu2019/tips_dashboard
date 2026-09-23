import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { buildClassScheduleRouteModel } from "../src/features/operations/records.js";

// Retired progress/textbook UI contracts are covered at their current boundaries:
// class-textbook-picker-model.test.mjs, schedule-only-plan.test.mjs and
// class-schedule-draft-navigation.test.mjs exercise filtering, history and live controls.
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

test("lesson design opens as a contained modal with its own scroll viewport", async () => {
  const source = await readSource("src/features/operations/class-schedule-workspace.tsx");

  assert.match(source, /data-testid="lesson-design-modal-dialog"/);
  assert.match(source, /<DialogTitle className="shrink-0 truncate text-base font-semibold">\{lessonDesignTitle\}<\/DialogTitle>/);
  assert.match(source, /data-testid="lesson-design-dialog-scroll"/);
  assert.match(source, /data-testid="lesson-design-dialog-scroll"\s*style=\{\{ overflowAnchor: "none" \}\}/);
  assert.match(source, /className="[^"]*max-h-\[calc\(100dvh-5rem\)\][^"]*w-\[calc\(100vw-2rem\)\][^"]*max-w-6xl[^"]*overflow-hidden[^"]*p-0[^"]*"/);
  assert.match(source, /className="[^"]*min-h-0[^"]*flex-1[^"]*overflow-y-auto[^"]*overscroll-contain[^"]*scroll-pb-28[^"]*"/);
  assert.doesNotMatch(source, /data-testid="lesson-design-fullscreen-dialog"/);
  assert.doesNotMatch(source, /!inset-0/);
  assert.doesNotMatch(source, /w-screen/);
  assert.doesNotMatch(source, /!rounded-none/);
});

test("lesson design close suppresses route-driven reopen until the close route is restored", async () => {
  const source = await readSource("src/features/operations/class-schedule-workspace.tsx");

  assert.match(source, /const requestLessonDesignClose = useCallback/);
  assert.match(source, /const isLessonDesignClosingRef = useRef\(false\);/);
  assert.match(
    source,
    /if \(isLessonDesignClosingRef\.current\) \{\s*return;\s*\}\s*requestNavigation\(\(\) => \{\s*isLessonDesignClosingRef\.current = true;/,
  );
  assert.match(source, /setLessonDesignOpen\(false\);\s*finishLessonDesignClose\(\);/);
  assert.match(
    source,
    /if \(!shouldOpenLessonDesign\) \{\s*isLessonDesignClosingRef\.current = false;\s*return;/,
  );
  assert.match(source, /if \(isLessonDesignClosingRef\.current\) \{\s*return;\s*\}/);
  assert.doesNotMatch(source, /lessonDesignCloseTimerRef/);
  assert.doesNotMatch(source, /window\.setTimeout\(finishLessonDesignClose, 200\)/);
  assert.match(source, /const handleLessonDesignOpenChange = useCallback\(\(open: boolean\) => \{[\s\S]*?requestLessonDesignClose\(\);/);
  assert.doesNotMatch(source, /setLessonDesignOpen\(open\);\s*if \(!open\)/);
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
  assert.doesNotMatch(source, /xl:grid-cols-\[minmax\(18rem,0\.85fr\)_minmax\(34rem,1\.45fr\)\]/);
  assert.match(
    source,
    /data-lesson-period-sidebar="true"[\s\S]*className="[^"]*xl:col-start-1[^"]*xl:sticky[^"]*xl:max-h-\[calc\(100dvh-8rem\)\][^"]*xl:overflow-y-auto[^"]*xl:pr-5[^"]*"/,
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

test("schedule mode keeps monthly sessions and calendar cells mutually aligned", async () => {
  const source = await readSource("src/features/operations/class-schedule-workspace.tsx");
  const periodSession = source.match(
    /function scrollLessonDesignPeriodSession\(\s*sessionId: string,[\s\S]*?\) \{([\s\S]*?)\r?\n\}/,
  );
  const sessionPair = source.match(
    /function scrollLessonDesignSessionPair\(sessionId: string\) \{([\s\S]*?)\r?\n\}/,
  );
  const periodToCalendar = source.match(
    /function scrollLessonDesignPeriodSessionToCalendar\([\s\S]*?\) \{([\s\S]*?)\r?\n\}/,
  );
  const periodToCalendarAfterRender = source.match(
    /function scrollLessonDesignPeriodSessionToCalendarAfterRender\(\s*sessionId: string,[\s\S]*?\) \{([\s\S]*?)\r?\n\}/,
  );
  const calendarSection = source.match(
    /<section\s+id=\{LESSON_DESIGN_SECTION_IDS\.calendar\}([\s\S]*?)\r?\n\s*<\/section>/,
  );
  const calendarToggle = source.match(
    /const handleLessonCalendarToggle = useCallback\(([\s\S]*?)\r?\n  const handleLessonCalendarDrop/,
  );
  const focusSession = source.match(
    /const focusLessonDesignSession = useCallback\(([\s\S]*?)\r?\n  useEffect\(\(\) => \{/,
  );

  assert.ok(periodSession, "period-only scrolling helper should exist");
  assert.ok(sessionPair, "session-pair scrolling helper should exist");
  assert.ok(periodToCalendar, "calendar boundary correction helper should exist");
  assert.ok(periodToCalendarAfterRender, "calendar-origin sidebar alignment helper should exist");
  assert.ok(calendarSection, "calendar section should exist");
  assert.ok(calendarToggle, "calendar toggle handler should exist");
  assert.ok(focusSession, "monthly session focus handler should exist");
  assert.match(periodSession[1], /scrollElementInsideContainerToCenter\(periodSidebar, periodTarget, \{[\s\S]*fallbackToDocument: false/);
  assert.doesNotMatch(periodSession[1], /data-lesson-calendar-session-id/);
  assert.match(sessionPair[1], /const calendarTarget = findLessonDesignElementByDataAttribute\("data-lesson-calendar-session-id", sessionId\)/);
  assert.match(sessionPair[1], /scrollLessonDesignCalendarSessionToPeriod\(dialogScroller, periodTarget, calendarTarget\)/);
  assert.match(source, /periodTarget\.closest\('\[data-lesson-period-sidebar="true"\]'\) as HTMLElement \| null/);
  assert.match(source, /scrollLessonDesignPeriodSessionToCalendar\(periodSidebar, periodTarget, calendarTarget\)/);
  assert.match(periodToCalendarAfterRender[1], /scrollLessonDesignPeriodSessionToCalendar\(periodSidebar, periodTarget, calendarTarget\)/);
  assert.match(periodToCalendarAfterRender[1], /preservedDialogScrollTop/);
  assert.match(periodToCalendarAfterRender[1], /dialogScroller\?\.scrollTo\(\{ top: preservedDialogScrollTop, behavior: "auto" \}\)/);
  assert.match(source, /function getLessonDesignDialogScrollTop\(\)/);
  assert.match(source, /const pendingLessonDesignDialogScrollTopRef = useRef<number \| null>\(null\);/);
  assert.match(source, /const pendingLessonDesignCalendarPointerScrollTopRef = useRef<number \| null>\(null\);/);
  assert.match(source, /useLayoutEffect\(\(\) => \{[\s\S]*pendingLessonDesignDialogScrollTopRef\.current/);
  assert.match(source, /const pendingLessonDesignPairSessionIdRef = useRef\(""\);/);
  assert.match(source, /const \[lessonDesignPairSyncRequest, setLessonDesignPairSyncRequest\] = useState\(0\);/);
  assert.match(
    source,
    /useLayoutEffect\(\(\) => \{[\s\S]*pendingLessonDesignPairSessionIdRef\.current[\s\S]*scrollLessonDesignSessionPair\(sessionId\)[\s\S]*\[lessonDesignPairSyncRequest\]\)/,
  );
  assert.doesNotMatch(source, /function restoreLessonDesignDialogScrollTopAfterRender/);
  assert.match(calendarToggle[1], /const nextFocusedSessionId = syncLessonDesignDraftSnapshot\(nextDraft, \{/);
  assert.match(calendarToggle[1], /const dialogScrollTop = Number\.isFinite\(pointerScrollTop\)/);
  assert.match(calendarToggle[1], /scrollLessonDesignPeriodSessionToCalendarAfterRender\(nextFocusedSessionId, dialogScrollTop\)/);
  assert.match(calendarToggle[1], /pendingLessonDesignDialogScrollTopRef\.current = dialogScrollTop/);
  assert.match(calendarToggle[1], /pendingLessonDesignCalendarPointerScrollTopRef\.current/);
  assert.doesNotMatch(calendarToggle[1], /scrollLessonDesignSelectedSessionEditorAfterRender/);
  assert.match(focusSession[1], /pendingLessonDesignPairSessionIdRef\.current = resolvedSessionId/);
  assert.match(focusSession[1], /setLessonDesignPairSyncRequest\(\(current\) => current \+ 1\)/);
  assert.doesNotMatch(source, /const shouldShowSessionTextbookBadge = showTextbookPlans/);
  assert.doesNotMatch(source, /const isSessionOutsideTextbookRange =\s*showTextbookPlans/);
  assert.doesNotMatch(source, /showTextbookPlans/);
  assert.match(source, /<p className="text-lg font-semibold text-foreground">월별 회차<\/p>/);
  assert.match(source, /handleLessonSessionRelease\(session\)/);
  assert.match(source, /aria-label=\{`\$\{session\.label\} 일정 해제`\}/);
  assert.doesNotMatch(calendarSection[1], /lessonDesignSnapshot\.plannerSchedule/);
  assert.match(source, /data-testid="lesson-design-title-meta"/);
  assert.match(source, /lessonDesignHeaderMeta\.map/);
  assert.match(source, /className="inline-flex items-center rounded-full border border-border\/70 bg-muted\/60 px-2\.5 py-1 text-xs font-medium text-foreground"/);
  assert.match(source, /const handleLessonCalendarPointerDown = useCallback/);
  assert.match(source, /onPointerDown=\{handleLessonCalendarPointerDown\}/);
  assert.doesNotMatch(source, /flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 pr-8/);
});

test("normalized session editor keeps time and resource fields behind an explicit disclosure", async () => {
  const source = await readSource("src/features/operations/class-schedule-workspace.tsx");
  const normalizedEditor = source.match(
    /normalizedLessonSessionDraft \? \(([\s\S]*?)\n\s*\) : \(\n\s*<>/,
  );

  assert.ok(normalizedEditor, "normalized session editor branch should exist");
  assert.match(
    source,
    /const \[normalizedLessonSessionDetailsOpenSessionId, setNormalizedLessonSessionDetailsOpenSessionId\] = useState\(""\);/,
  );
  assert.match(normalizedEditor[1], /data-testid="normalized-lesson-session-details-toggle"/);
  assert.match(normalizedEditor[1], /aria-expanded=\{isNormalizedSessionDetailsOpen\}/);
  assert.match(normalizedEditor[1], /\{isNormalizedSessionDetailsOpen \? \(/);
  assert.match(normalizedEditor[1], /data-testid="normalized-lesson-session-details"/);
  assert.ok(
    normalizedEditor[1].indexOf('data-testid="normalized-lesson-session-details"') <
      normalizedEditor[1].indexOf("<span>선생님</span>"),
    "teacher selection must stay inside the collapsed schedule-details section",
  );
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

test("lesson design keeps every generated month visible while focusing one month", async () => {
  const source = await readSource("src/features/operations/class-schedule-workspace.tsx");

  assert.match(source, /function getAllLessonMonthKeys/);
  assert.match(source, /return matchesPeriod && matchesScheduleState;/);
  assert.match(source, /setSelectedLessonMonthKeys\(getAllLessonMonthKeys\(monthSummaries\)\)/);
  assert.match(source, /setFocusedLessonMonthKey\(focusedMonthKeys\[0\] \|\| ""\)/);
  assert.match(source, /function getLessonCalendarSessionSurfaceStyle/);
  assert.match(source, /state && state !== "active"/);
  assert.match(source, /data-lesson-calendar-month=\{month\.key\}/);
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

test("lesson calendar applies one toggle on the first click for existing and empty dates", async () => {
  const source = await readSource("src/features/operations/class-schedule-workspace.tsx");
  const dateClickHandler = source.match(
    /const handleLessonCalendarDateClick = useCallback\(([\s\S]*?)\r?\n  const handleLessonPeriodChange/,
  );

  assert.ok(dateClickHandler, "calendar date click handler should exist");
  assert.doesNotMatch(dateClickHandler[1], /if \(meta\.hasSession\)/);
  assert.doesNotMatch(dateClickHandler[1], /selectedLessonCalendarDate !== dateKey/);
  assert.match(dateClickHandler[1], /handleLessonCalendarToggle\(dateKey, meta\)/);

  assert.match(
    source,
    /onClick=\{\(\) => \{[\s\S]*?handleLessonCalendarDateClick\(dateKey, \{[\s\S]*?hasSession: Boolean\(primarySession\)/,
  );
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

test("lesson design keeps return handling after class management delegates planning navigation", async () => {
  const workspaceSource = await readSource("src/features/operations/class-schedule-workspace.tsx");
  const managementSource = await readSource("src/features/management/management-page.tsx");

  assert.match(managementSource, /const buildClassDetailReturnPath = \(/);
  assert.match(managementSource, /buildClassRosterReturnPath\(window\.location\.search, selectedRow\.id, tab, options\.studentId\)/);
  assert.doesNotMatch(managementSource, /buildLessonDesignFromClassDetailHref/);
  assert.doesNotMatch(managementSource, /\/admin\/curriculum\/lesson-design\?/);
  assert.match(workspaceSource, /function normalizeAdminReturnPath/);
  assert.match(workspaceSource, /const requestedLessonReturnPath = normalizeAdminReturnPath\(searchParams\.get\("returnTo"\)\)/);
  assert.match(workspaceSource, /params\.delete\("returnTo"\)/);
  assert.match(workspaceSource, /if \(requestedLessonReturnPath\) \{[\s\S]*router\.replace\(requestedLessonReturnPath, \{ scroll: false \}\)/);
  assert.match(workspaceSource, /function getLessonDesignReturnLabel\(requestedLessonReturnPath: string\)/);
  assert.match(workspaceSource, /if \(requestedLessonReturnPath\.includes\("\/admin\/classes"\)\) return "수업 상세"/);
  assert.match(workspaceSource, /if \(requestedLessonReturnPath\.includes\("\/admin\/class-schedule"\)\) return "수업일정"/);
  assert.match(workspaceSource, /return "수업계획"/);
  assert.match(workspaceSource, /const lessonDesignReturnLabel = getLessonDesignReturnLabel\(requestedLessonReturnPath\)/);
  assert.match(workspaceSource, /const lessonDesignReturnActionLabel = getLessonDesignReturnActionLabel\(lessonDesignReturnLabel\)/);
  assert.match(workspaceSource, /\{lessonDesignReturnActionLabel\}/);
});

test("lesson design keeps the modal return action with schedule actions", async () => {
  const workspaceSource = await readSource("src/features/operations/class-schedule-workspace.tsx");

  assert.match(workspaceSource, /data-testid="lesson-design-bottom-action-bar"/);
  assert.match(workspaceSource, /requestedLessonReturnPath && !isLessonDesignPage \? \(/);
  assert.match(workspaceSource, /data-testid="lesson-design-bottom-return"/);
  assert.match(workspaceSource, /aria-label=\{lessonDesignReturnActionLabel\}/);
  assert.match(workspaceSource, /onClick=\{requestLessonDesignClose\}/);
  assert.match(workspaceSource, /\{lessonDesignReturnLabel\}/);
  assert.doesNotMatch(workspaceSource, /requestedLessonReturnPath\.includes\("\/admin\/classes"\) \? "수업 상세" : "수업계획"/);
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
  assert.match(source, /scrollLessonDesignPeriodSessionAfterRender\(resolvedRequestedSession\.id\)/);
  assert.match(source, /markPendingLessonSessionSelection\(periodSelectedSession\.id\)/);
  assert.doesNotMatch(source, /setSelectedLessonSessionId\(periodSelectedSession\.id\)/);
  assert.match(source, /options: \{ scroll\?: boolean \} = \{\}/);
  assert.match(source, /scroll: scrollMode !== "none" && scrollMode !== "sync"/);
  assert.match(source, /scrollMode\?: "editor" \| "section" \| "sync" \| "none"/);
  assert.match(source, /const preservedLessonDesignSectionScrollKeyRef = useRef\(""\);/);
  assert.match(
    source,
    /if \(scrollMode === "none"\) \{\s*preservedLessonDesignSectionScrollKeyRef\.current = \[\s*text\(targetRow\?\.id\),\s*resolvedSessionId,\s*targetSectionId,\s*\]\.join\(":"\);/,
  );
  assert.match(
    source,
    /if \(preservedLessonDesignSectionScrollKeyRef\.current === scrollKey\) \{\s*preservedLessonDesignSectionScrollKeyRef\.current = "";\s*lastScrolledLessonDesignSectionKeyRef\.current = scrollKey;\s*return;/,
  );
  assert.match(source, /pendingLessonDesignPairSessionIdRef\.current = resolvedSessionId/);
  assert.match(source, /setLessonDesignPairSyncRequest\(\(current\) => current \+ 1\)/);
  assert.match(
    source,
    /requestedLessonDesignSectionId === LESSON_DESIGN_SECTION_IDS\.periods && selectedSessionId[\s\S]*scrollLessonDesignPeriodSession\(selectedSessionId\)/,
  );
  assert.match(
    source,
    /requestedLessonDesignSectionId !== LESSON_DESIGN_SECTION_IDS\.periods[\s\S]*lastSyncedLessonSessionPairKeyRef\.current = ""[\s\S]*scrollLessonDesignPeriodSessionAfterRender\(selectedLessonSession\.id\)/,
  );
});

test("lesson design modal removes the readiness jump strip", async () => {
  const source = await readSource("src/features/operations/class-schedule-workspace.tsx");
  const workspaceContentMatch = source.match(
    /const lessonDesignWorkspaceContent = \(([\s\S]*?)\r?\n\r?\n  const classScheduleWorkspaceContent = \(/,
  );

  assert.ok(workspaceContentMatch, "lesson design workspace content block should exist");
  assert.doesNotMatch(workspaceContentMatch[1], />저장 전 확인<\/span>/);
  assert.doesNotMatch(workspaceContentMatch[1], /lessonDesignReadinessActions\.map/);
  assert.doesNotMatch(workspaceContentMatch[1], /scrollLessonDesignSection\(action\.sectionId\)/);
  assert.match(source, /lessonDesignSnapshot\.saveReadiness\.ready/);
});

test("lesson design keeps navigation, recovery, and save actions stable", async () => {
  const source = await readSource("src/features/operations/class-schedule-workspace.tsx");

  assert.match(source, /function resolveRequestedLessonDesignSession/);
  assert.match(source, /scrollLessonDesignSectionAfterRender/);
  assert.match(source, /data-testid="lesson-design-page-scroll"/);
  assert.match(source, /aria-label="일정 편성 작업 영역"/);
  assert.match(source, /tabIndex=\{0\}/);
  assert.match(source, /data-testid="lesson-design-bottom-action-bar"/);
  assert.doesNotMatch(source, /data-testid="lesson-design-progress-editor"/);
  assert.doesNotMatch(source, /id="lesson-session-jump"/);
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
  assert.match(listSection, /scheduleProgressState === "accepted" \? `계획 \$\{row\.latestPlannedSessionIndex\}회차 · 실제 \$\{row\.latestActualSessionIndex\}회차` : "회차는 상세에서 확인"/);
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
  const detailHrefStart = source.indexOf("function buildOfficialClassScheduleDetailHref");
  const detailHrefSource = source.slice(detailHrefStart, source.indexOf("\nfunction ", detailHrefStart + 1));

  assert.match(source, /const CLASS_SCHEDULE_SCROLL_STORAGE_PREFIX = "tips:class-schedule-database-scroll:"/);
  assert.match(source, /function buildClassScheduleListHref/);
  assert.match(source, /function buildOfficialClassScheduleDetailHref/);
  assert.match(detailHrefSource, /params\.set\("tab", "basic"\)/);
  assert.doesNotMatch(detailHrefSource, /params\.set\("tab", "schedule"\)/);
  assert.doesNotMatch(detailHrefSource, /params\.set\("section", resolvedSectionId\)/);
  assert.doesNotMatch(detailHrefSource, /params\.set\("sessionId", resolvedSessionId\)/);
  assert.match(detailHrefSource, /params\.set\("returnTo", normalizedReturnTo\)/);
  assert.match(source, /const \[search, setSearch\] = useState\(\(\) => text\(searchParams\.get\("q"\)\)\)/);
  assert.match(source, /const classScheduleReturnPath = useMemo/);
  assert.match(source, /router\.replace\(nextHref, \{ scroll: false \}\)/);
  assert.match(source, /const rememberClassScheduleListPosition = useCallback/);
  assert.match(source, /data-testid="class-schedule-desktop-scroll-anchor"/);
  assert.match(source, /const openClassScheduleOfficialDetail = useCallback/);
  assert.match(source, /router\.push\(buildOfficialClassScheduleDetailHref/);
  assert.match(listSection, /role="link"/);
  assert.match(listSection, /onClick=\{\(\) => openClassScheduleOfficialDetail\(row\)\}/);
  assert.match(listSection, /onKeyDown=\{\(event\) => handleClassScheduleRowKeyDown\(event, row\)\}/);
  assert.match(listSection, /href=\{buildOfficialClassScheduleDetailHref\(row, classScheduleReturnPath\)\}/);
  assert.doesNotMatch(listSection, /onClick=\{\(\) => setSelectedClassId\(row\.id\)\}/);
});

test("lesson design presents mobile-safe sessions and the selected schedule editor", async () => {
  const source = await readSource("src/features/operations/class-schedule-workspace.tsx");

  assert.match(source, /data-testid="lesson-mobile-session-list"/);
  assert.match(source, /data-testid="lesson-desktop-calendar"/);
  assert.match(source, /data-lesson-selected-editor=\{isSelectedSession \? "true" : "false"\}/);
  assert.doesNotMatch(source, /auto-fill-current-session/);
  assert.doesNotMatch(source, /auto-fill-following-sessions/);
});
