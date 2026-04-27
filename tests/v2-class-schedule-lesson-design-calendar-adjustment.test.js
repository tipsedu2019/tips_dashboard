import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(testDir, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("lesson-design calendar supports direct draft adjustments without noisy empty-day badges", () => {
  const source = read("v2/src/features/operations/class-schedule-workspace.tsx");

  assert.match(source, /applyCalendarDateToggle/);
  assert.match(source, /const \[lessonCalendarDragSource, setLessonCalendarDragSource\] = useState\(""\)/);
  assert.match(source, /const \[lessonCalendarDropTarget, setLessonCalendarDropTarget\] = useState\(""\)/);
  assert.match(source, /const \[selectedLessonCalendarDate, setSelectedLessonCalendarDate\] = useState\(""\)/);
  assert.match(source, /const buildNextLessonPlanDraft = useCallback\(/);
  assert.match(source, /const syncLessonDesignDraftSnapshot = useCallback\(/);
  assert.match(source, /const lessonPlanDraftRef = useRef<Record<string, unknown> \| null>\(null\)/);
  assert.match(source, /findLessonDesignSessionByDate/);
  assert.match(source, /const handleLessonCalendarSelect = useCallback\(/);
  assert.match(source, /const handleLessonCalendarToggle = useCallback\(/);
  assert.match(source, /const handleLessonCalendarDateClick = useCallback\(/);
  assert.match(source, /if \(selectedLessonCalendarDate !== dateKey\) \{[\s\S]*handleLessonCalendarSelect\(dateKey\);[\s\S]*return;/);
  assert.match(source, /applyCalendarDateToggle\(current, dateKey, meta\)/);
  assert.match(source, /const handleLessonCalendarDrop = useCallback\(/);
  assert.match(source, /\(targetDate: string, meta: \{ hasSession: boolean \}\)/);
  assert.match(source, /meta\.hasSession \|\|/);
  assert.match(source, /applyCalendarDateSubstitution\(current, sourceDate, targetDate\)/);
  assert.match(source, /setSelectedLessonPeriodId\("all"\)/);
  assert.match(source, /setSelectedLessonScheduleState\("all"\)/);
  assert.match(source, /draggable=\{Boolean\(primarySession\) && primarySession\?\.scheduleState !== "makeup"\}/);
  assert.match(source, /event\.dataTransfer\.setData\("text\/plain", dateKey\)/);
  assert.match(source, /setLessonCalendarDragSource\(dateKey\)/);
  assert.match(source, /setSelectedLessonCalendarDate\(dateKey\)/);
  assert.match(source, /setLessonCalendarDropTarget\(dateKey\)/);
  assert.match(source, /handleLessonCalendarDrop\(dateKey, \{/);
  assert.match(source, /hasSession: Boolean\(primarySession\)/);
  assert.match(source, /data-lesson-calendar-date=\{dateKey\}/);
  assert.match(source, /data-lesson-calendar-state=\{primarySession\?\.scheduleState \|\| ""\}/);
  assert.match(source, /handleLessonCalendarDateClick\(dateKey, \{/);
  assert.doesNotMatch(source, /handleLessonSessionStateCycle\(primarySession\)/);
  assert.match(source, /preferredScheduleState = meta\.hasSession/);
  assert.match(source, /getNextRegularScheduleState\(currentScheduleState, Boolean\(currentStateEntry\.makeupDate\)\)/);
  assert.match(source, /preferScheduleState: preferredScheduleState/);
  assert.match(source, /setSelectedLessonCalendarDate\(sourceDate\)/);
  assert.match(source, /setLessonMonthDetailsOpen\(true\)/);
  assert.match(source, /scrollLessonDesignSelectedSessionEditorAfterRender\(\)/);
  assert.match(source, /LESSON_DESIGN_SELECTED_SESSION_EDITOR_ID/);
  assert.match(source, /getNextRegularScheduleState/);
  assert.match(source, /if \(hasSubstitution\) \{[\s\S]*return "active" as const/);
  assert.match(source, /if \(scheduleState === "exception"\) \{[\s\S]*return "makeup" as const/);
  assert.match(source, /if \(scheduleState === "makeup"\) \{[\s\S]*return "tbd" as const/);
  assert.match(source, /getScheduleStateSurface/);
  assert.match(source, /buildLessonScheduleConnectionLabel/);
  assert.match(source, /scheduleConnectionLabel/);
  assert.match(source, /휴강 후 \$\{formatScheduleDateLabel\(makeup\)\} 보강/);
  assert.match(source, /휴강의 보강/);
  assert.match(source, /보강일 미지정/);
  assert.match(source, /compareLessonSessionsByDate/);
  assert.match(source, /const periodSessions = filteredLessonSessions/);
  assert.match(source, /session\.periodId === period\.id/);
  assert.match(source, /\.sort\(compareLessonSessionsByDate\)/);
  assert.doesNotMatch(source, /<Badge variant="outline" className="rounded-full px-1\.5 text-\[10px\]">\s*추가 수업\s*<\/Badge>/);
  assert.doesNotMatch(source, /생성 \{month\.activeCount\}회 · 대기 \{month\.pendingCount\}회/);
  assert.doesNotMatch(source, /<Badge variant="outline">\{month\.label\}<\/Badge>/);
  assert.doesNotMatch(source, /<ScrollArea className="mt-4 h-\[30rem\]/);
  assert.doesNotMatch(source, /xl:h-\[calc\(100vh-/);
  assert.doesNotMatch(source, /className="min-h-0 rounded-\[1\.5rem\] border bg-background\/95 px-4 py-4 shadow-sm/);
  assert.doesNotMatch(source, /className="min-h-0 rounded-\[1\.5rem\] border bg-background\/90 p-4 shadow-sm/);
  assert.doesNotMatch(source, /className="min-h-0 rounded-\[1\.5rem\] border bg-background\/95 p-4 shadow-sm/);
});

test("lesson-design calendar cycles session dates through normal cancel makeup undecided", async () => {
  const plannerModule = await import(pathToFileURL(path.join(root, "v2/src/lib/class-schedule-planner.js")).href);
  const { applyCalendarDateToggle } = plannerModule;
  const date = "2026-04-03";

  const canceled = applyCalendarDateToggle({ sessionStates: {} }, date, { hasSession: true });
  assert.equal(canceled.sessionStates[date].state, "exception");

  const makeup = applyCalendarDateToggle(canceled, date, { hasSession: true });
  assert.equal(makeup.sessionStates[date].state, "makeup");

  const undecided = applyCalendarDateToggle(makeup, date, { hasSession: true });
  assert.equal(undecided.sessionStates[date].state, "tbd");

  const normal = applyCalendarDateToggle(undecided, date, { hasSession: true });
  assert.equal(normal.sessionStates[date], undefined);
});

test("lesson-design calendar cancels dragged makeup pairs back to a normal original lesson", async () => {
  const plannerModule = await import(pathToFileURL(path.join(root, "v2/src/lib/class-schedule-planner.js")).href);
  const { applyCalendarDateSubstitution, applyCalendarDateToggle } = plannerModule;
  const originalDate = "2026-04-03";
  const makeupDate = "2026-04-08";

  const substituted = applyCalendarDateSubstitution({ sessionStates: {} }, originalDate, makeupDate);
  assert.equal(substituted.sessionStates[originalDate].state, "exception");
  assert.equal(substituted.sessionStates[originalDate].makeupDate, makeupDate);

  const normal = applyCalendarDateToggle(substituted, originalDate, { hasSession: true });
  assert.equal(normal.sessionStates[originalDate], undefined);

  const exception = applyCalendarDateToggle(normal, originalDate, { hasSession: true });
  assert.equal(exception.sessionStates[originalDate].state, "exception");

  const makeup = applyCalendarDateToggle(exception, originalDate, { hasSession: true });
  assert.equal(makeup.sessionStates[originalDate].state, "makeup");

  const tbd = applyCalendarDateToggle(makeup, originalDate, { hasSession: true });
  assert.equal(tbd.sessionStates[originalDate].state, "tbd");
});

test("lesson-design selected-session editor sits under the selected month session", () => {
  const source = read("v2/src/features/operations/class-schedule-workspace.tsx");

  assert.match(source, /month-session-edit-/);
  assert.match(source, /const handlePeriodDetailToggle = \(\) => \{/);
  assert.match(source, /renderLessonMonthSessionDetails\(periodSessions\)/);
  assert.match(source, /aria-expanded=\{isPeriodDetailsOpen\}/);
  assert.match(source, /setLessonMonthDetailsOpen\(\(current\) =>[\s\S]*\? !current : true/);
  assert.doesNotMatch(source, /month-tab-/);
  assert.doesNotMatch(source, /role="tab"/);
  assert.doesNotMatch(source, /aria-selected=\{isActiveMonth\}/);
  assert.doesNotMatch(source, /activeLessonMonthSessions\.map\(\(session\) =>/);
  assert.doesNotMatch(source, /const hasSelectedActiveMonthSession = selectedLessonSession\?\.monthKey === activeLessonMonthKey/);
  assert.doesNotMatch(source, /aria-expanded=\{isMonthOpen\}/);
  assert.doesNotMatch(source, /const hasSelectedSession = selectedLessonSession\?\.monthKey === month\.key/);
  assert.match(source, /isSelectedSession && selectedLessonSession \? \(/);
  assert.doesNotMatch(source, /<p className="text-xs font-medium text-muted-foreground">선택 회차 수정<\/p>/);
  assert.match(source, /onPointerDown=\{\(\) => setSelectedLessonSessionId\(session\.id\)\}/);
  assert.match(source, /handleLessonSessionMemoChange\(selectedLessonSession, event\.target\.value\)/);
  assert.match(source, /handleLessonSessionMakeupDateDirectChange\(selectedLessonSession, event\.target\.value\)/);
  assert.match(source, /handleLessonSessionSubstitution\(\s*selectedLessonSession,\s*selectedLessonSessionEditableMakeupDate,/);
  assert.match(source, /handleLessonSessionClearSubstitution\(selectedLessonSession\)/);
  assert.match(source, />\s*정상\s*<\/Button>/);
  assert.match(source, />\s*휴강\s*<\/Button>/);
  assert.match(source, />\s*보강\s*<\/Button>/);
  assert.match(source, />\s*미정\s*<\/Button>/);
  assert.doesNotMatch(source, /<p className="text-xs font-medium text-muted-foreground">보강일<\/p>/);
});
