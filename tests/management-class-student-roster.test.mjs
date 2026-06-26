import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  normalizeClassManagementRecord,
  normalizeStudentManagementRecord,
} from "../src/features/management/records.js";

const root = new URL("../", import.meta.url);

test("class student rosters never use raw UUIDs as display names", async () => {
  const hookSource = await readFile(new URL("src/features/management/use-management-records.ts", root), "utf8");
  const pageSource = await readFile(new URL("src/features/management/management-page.tsx", root), "utf8");
  const tableSource = await readFile(new URL("src/features/management/management-data-table.tsx", root), "utf8");

  assert.match(hookSource, /const studentName = textValue\(student\?\.name\)/);
  assert.match(hookSource, /name: studentName \|\| "학생 정보 확인 필요"/);
  assert.doesNotMatch(hookSource, /name: textValue\(student\?\.name\) \|\| id/);

  assert.match(pageSource, /function isUuidLike/);
  assert.match(pageSource, /function getMissingRelatedTitle/);
  assert.match(pageSource, /kind === "classes"\) return "학생 정보 확인 필요"/);
  assert.match(pageSource, /return isUuidLike\(id\) \? fallbackTitle : id/);
  assert.doesNotMatch(pageSource, /return id \? \{ id, name: id \} : null/);

  assert.match(tableSource, /function isUuidLike/);
  assert.match(tableSource, /const rawName = student\.name \|\| ""/);
  assert.match(tableSource, /: "학생 정보 확인 필요"/);
  assert.doesNotMatch(tableSource, /const name = student\.name \|\| student\.id \|\| "학생"/);
});

test("class management exposes the official class detail tabs through URL state", async () => {
  const pageSource = await readFile(new URL("src/features/management/management-page.tsx", root), "utf8");

  assert.match(pageSource, /useSearchParams/);
  assert.match(pageSource, /const requestedClassId = kind === "classes" \? text\(searchParams\.get\("classId"\)\) : ""/);
  assert.match(pageSource, /const requestedClassReturnPath = kind === "classes" \? normalizeReturnToPath\(searchParams\.get\("returnTo"\)\) : ""/);
  assert.match(pageSource, /const requestedClassDetailStudentId = kind === "classes" \? text\(searchParams\.get\("studentId"\)\) : ""/);
  assert.match(pageSource, /const CLASS_DETAIL_TABS = \[/);
  assert.match(pageSource, /\{ value: "basic", label: "기본" \}/);
  assert.match(pageSource, /\{ value: "students", label: "학생" \}/);
  assert.match(pageSource, /\{ value: "schedule", label: "일정" \}/);
  assert.match(pageSource, /\{ value: "curriculum", label: "교재·진도" \}/);
  assert.doesNotMatch(pageSource, /\{ value: "counseling", label: "상담" \}/);
  assert.match(pageSource, /params\.set\("classId", classId\)/);
  assert.match(pageSource, /params\.set\("tab", tab\)/);
  assert.match(pageSource, /params\.set\("studentId", options\.studentId\)/);
  assert.match(pageSource, /params\.delete\("studentId"\)/);
  assert.match(pageSource, /openRow\(targetRow, \{[\s\S]*tab: requestedClassDetailTab[\s\S]*syncRoute: false/);
  assert.match(pageSource, /data-testid="class-official-summary-bar"/);
  assert.match(pageSource, /data-testid="class-detail-return-to-work-queue"/);
  assert.match(pageSource, /router\.push\(requestedClassReturnPath\)/);
  assert.match(pageSource, /params\.delete\("returnTo"\)/);
  assert.match(pageSource, /data-testid="class-official-detail-tabs"/);
  assert.match(pageSource, /data-testid="class-detail-students-tab"/);
  assert.match(pageSource, /data-testid="class-detail-schedule-tab"/);
  assert.match(pageSource, /data-testid="class-detail-curriculum-tab"/);
  assert.doesNotMatch(pageSource, /data-testid="class-detail-counseling-tab"/);
  assert.match(pageSource, /buildLessonDesignFromClassDetailHref/);
  assert.match(pageSource, /const buildClassDetailReturnPath = \(/);
  assert.match(pageSource, /params\.set\("studentId", options\.studentId\)/);
  assert.match(pageSource, /params\.set\("returnTo", requestedClassReturnPath\)/);
  assert.match(pageSource, /const resolvedReturnTab = options\.returnTab \|\| activeClassDetailTab/);
  assert.match(pageSource, /buildClassDetailReturnPath\(resolvedReturnTab/);
  assert.match(pageSource, /params\.set\("section", resolvedSection\)/);
});

test("class curriculum detail tab shows official textbook and progress context", async () => {
  const pageSource = await readFile(new URL("src/features/management/management-page.tsx", root), "utf8");

  assert.match(pageSource, /function getClassCurriculumSummary/);
  assert.match(pageSource, /function getClassTextbookCatalog/);
  assert.match(pageSource, /function getClassSessionSummaries/);
  assert.match(pageSource, /function getClassNextCurriculumSession/);
  assert.match(pageSource, /function getCurriculumSessionStableId/);
  assert.match(pageSource, /function getClassUnassignedProgressSessions/);
  assert.match(pageSource, /function getClassTextbookProgressSnapshot/);
  assert.match(pageSource, /function getTextbookEntryRangeLabel/);
  assert.match(pageSource, /const textbookProgressSnapshots = getClassTextbookProgressSnapshot\(selectedRow\)/);
  assert.match(pageSource, /const renderClassCurriculumPanel = \(\) =>/);
  assert.match(pageSource, /data-testid="class-curriculum-official-panel"/);
  assert.match(pageSource, /data-testid="class-curriculum-unassigned-work-panel"/);
  assert.match(pageSource, /진도 작업 큐/);
  assert.match(pageSource, /첫 미배정 처리/);
  assert.match(pageSource, /const firstUnassignedSessionId = firstUnassignedSession \? getCurriculumSessionStableId\(firstUnassignedSession\) : ""/);
  assert.match(pageSource, /buildLessonDesignFromClassDetailHref\(\{\s*section: "lesson-design-board",\s*sessionId: firstUnassignedSessionId,\s*\}\)/);
  assert.match(pageSource, /disabled=\{delayedProgressCount <= 0\}/);
  assert.match(pageSource, /교재별 영역/);
  assert.match(pageSource, /data-testid="class-curriculum-textbook-progress-card"/);
  assert.match(pageSource, /data-testid="class-curriculum-manage-textbook"/);
  assert.match(pageSource, /Settings2 className="size-3\.5"/);
  assert.match(pageSource, /연결·제거/);
  assert.match(pageSource, /data-testid="class-curriculum-connect-textbook"/);
  assert.match(pageSource, /buildLessonDesignFromClassDetailHref\(\{\s*section: "lesson-design-textbooks",\s*returnTab: "curriculum",\s*\}\)/);
  assert.match(pageSource, />\s*교재 연결\s*<\/Button>/);
  assert.match(pageSource, />최근 범위</);
  assert.match(pageSource, />다음 범위</);
  assert.match(pageSource, /다음 예정/);
  assert.match(pageSource, /미배정 회차/);
  assert.match(pageSource, /최근 진행 범위/);
  assert.match(pageSource, /교재·진도 편집/);
  assert.match(pageSource, /\{renderClassCurriculumPanel\(\)\}/);
});

test("curriculum session summaries preserve per-textbook ranges for official class details", async () => {
  const recordsSource = await readFile(new URL("src/features/academic/records.js", root), "utf8");
  const typeSource = await readFile(new URL("src/features/academic/records.d.ts", root), "utf8");

  assert.match(recordsSource, /function normalizeCurriculumTextbookEntry\(entry = \{\}\)/);
  assert.match(recordsSource, /const textbookId = text\(entry\?\.textbookId \|\| entry\?\.textbook_id \|\| entry\?\.id\)/);
  assert.match(recordsSource, /const rangeLabel = getPlanRangeLabel\(entry\)/);
  assert.match(recordsSource, /const normalizedTextbookEntries = toArray\(textbookEntries\)\.map\(normalizeCurriculumTextbookEntry\)\.filter\(Boolean\)/);
  assert.match(recordsSource, /textbookEntries: normalizedTextbookEntries/);
  assert.match(typeSource, /textbookEntries: Array<\{/);
  assert.match(typeSource, /rangeLabel: string/);
  assert.match(typeSource, /startRange: string/);
  assert.match(typeSource, /endRange: string/);
});

test("class detail focuses requested curriculum and schedule targets from URL", async () => {
  const pageSource = await readFile(new URL("src/features/management/management-page.tsx", root), "utf8");

  assert.match(pageSource, /function getClassDetailSectionTargetId/);
  assert.match(pageSource, /requestedClassDetailSection === "lesson-design-board"/);
  assert.match(pageSource, /requestedClassDetailSection === "lesson-design-periods"/);
  assert.match(pageSource, /document\.getElementById\(getClassDetailSectionTargetId\(/);
  assert.match(pageSource, /function scrollClassDetailTargetIntoView\(target: HTMLElement\)/);
  assert.match(pageSource, /target\.closest\('\[role="dialog"\]'\) as HTMLElement \| null/);
  assert.match(pageSource, /dialog\.scrollTop \+=/);
  assert.match(pageSource, /scrollClassDetailTargetIntoView\(target\)/);
  assert.match(pageSource, /requestedClassDetailSection === "lesson-design-textbooks"/);
  assert.match(pageSource, /const retryTimer = window\.setTimeout\(scrollRequestedClassDetailSection, 520\)/);
  assert.match(pageSource, /const finalRetryTimer = window\.setTimeout\(scrollRequestedClassDetailSection, 1500\)/);
  assert.match(pageSource, /id="class-curriculum-unassigned-work-panel"/);
  assert.match(pageSource, /id="class-curriculum-textbooks-panel"/);
  assert.match(pageSource, /data-testid="class-curriculum-textbooks-panel"/);
  assert.match(pageSource, /return sessionId \? `class-schedule-session-\$\{sessionId\}` : "class-schedule-session-view-panel"/);
  assert.match(pageSource, /id="class-schedule-session-view-panel"/);
  assert.match(pageSource, /id=\{`class-curriculum-session-\$\{firstUnassignedSessionId\}`\}/);
  assert.match(pageSource, /id=\{`class-schedule-session-\$\{sessionId\}`\}/);
  assert.match(pageSource, /data-class-detail-focused=\{isCurriculumWorkPanelFocused \? "true" : undefined\}/);
  assert.match(pageSource, /data-class-detail-focused=\{isTextbooksSectionRequested \? "true" : undefined\}/);
  assert.match(pageSource, /data-class-detail-focused=\{shouldHighlightScheduleView \? "true" : undefined\}/);
  assert.match(pageSource, /data-class-detail-focused=\{isFocusedScheduleSession \? "true" : undefined\}/);
  assert.match(pageSource, /ring-1 ring-primary\/30/);
});

test("class detail tab changes keep URL targets only when they belong to the active tab", async () => {
  const pageSource = await readFile(new URL("src/features/management/management-page.tsx", root), "utf8");

  assert.match(pageSource, /function getClassDetailTabForSection\(section: string\)/);
  assert.match(pageSource, /section === "lesson-design-board" \|\| section === "lesson-design-textbooks"/);
  assert.match(pageSource, /return "curriculum"/);
  assert.match(pageSource, /section === "lesson-design-periods"/);
  assert.match(pageSource, /return "schedule"/);
  assert.match(pageSource, /function isClassDetailSessionTargetSection\(section: string\)/);
  assert.match(pageSource, /const shouldKeepSection = getClassDetailTabForSection\(requestedClassDetailSection\) === nextTab/);
  assert.match(pageSource, /const shouldKeepStudentTarget = nextTab === "students" && requestedClassDetailStudentId/);
  assert.match(pageSource, /section: shouldKeepSection \? requestedClassDetailSection : ""/);
  assert.match(pageSource, /sessionId: shouldKeepSection && isClassDetailSessionTargetSection\(requestedClassDetailSection\) \? requestedClassDetailSessionId : ""/);
  assert.match(pageSource, /studentId: shouldKeepStudentTarget \? requestedClassDetailStudentId : ""/);
  assert.doesNotMatch(pageSource, /section: nextTab === "schedule" \|\| nextTab === "curriculum" \? requestedClassDetailSection : ""/);
});

test("class lesson-design links ignore stale section targets from other detail tabs", async () => {
  const pageSource = await readFile(new URL("src/features/management/management-page.tsx", root), "utf8");

  assert.match(pageSource, /function getDefaultLessonDesignSectionForClassTab\(tab: ClassDetailTab\)/);
  assert.match(pageSource, /return tab === "schedule" \? "lesson-design-periods" : "lesson-design-board"/);
  assert.match(pageSource, /const resolvedReturnTab = options\.returnTab \|\| activeClassDetailTab/);
  assert.match(pageSource, /const shouldUseRequestedSection =[\s\S]*!options\.section[\s\S]*getClassDetailTabForSection\(requestedClassDetailSection\) === resolvedReturnTab/);
  assert.match(pageSource, /shouldUseRequestedSection \? requestedClassDetailSection : ""/);
  assert.match(pageSource, /getDefaultLessonDesignSectionForClassTab\(resolvedReturnTab\)/);
  assert.match(pageSource, /const shouldUseRequestedSession =[\s\S]*!options\.sessionId[\s\S]*shouldUseRequestedSection[\s\S]*isClassDetailSessionTargetSection\(resolvedSection\)/);
  assert.match(pageSource, /options\.sessionId \|\| \(shouldUseRequestedSession \? requestedClassDetailSessionId : ""\)/);
  assert.match(pageSource, /buildClassDetailReturnPath\(resolvedReturnTab/);
  assert.doesNotMatch(pageSource, /options\.section \|\|[\s\n]*requestedClassDetailSection \|\|/);
  assert.doesNotMatch(pageSource, /options\.sessionId \|\| requestedClassDetailSessionId/);
});

test("class student detail tab shows operational roster context and waitlist promotion", async () => {
  const pageSource = await readFile(new URL("src/features/management/management-page.tsx", root), "utf8");
  const serviceSource = await readFile(new URL("src/features/management/management-service.js", root), "utf8");

  assert.match(pageSource, /data-testid=\{kind === "classes" \? "class-student-roster-panel" : undefined\}/);
  assert.match(pageSource, /data-testid="class-student-roster-summary"/);
  assert.match(pageSource, /data-testid=\{kind === "classes" \? \(modeLabel === "수강" \? "class-enrolled-student-roster" : "class-waitlist-student-roster"\) : undefined\}/);
  assert.match(pageSource, /data-testid="class-roster-student-row"/);
  assert.match(pageSource, /data-class-roster-student-id=\{id\}/);
  assert.match(pageSource, /잔여 자리/);
  assert.match(pageSource, /학생 연락처/);
  assert.match(pageSource, /학부모 연락처/);
  assert.doesNotMatch(pageSource, /상담 메모/);
  assert.doesNotMatch(pageSource, /const handleClassStudentCounselingOpen = \(studentId: string\) =>/);
  assert.doesNotMatch(pageSource, /writeClassDetailRoute\(selectedRow\.id, "counseling", \{ studentId: targetStudentId \}\)/);
  assert.doesNotMatch(pageSource, />\s*상담\s*<\/Button>/);
  assert.match(pageSource, /등록 전환/);
  assert.match(pageSource, /const nextMode = modeLabel === "수강" \? "waitlist" : "enrolled"/);
  assert.match(pageSource, /handleRelationModeChange\(id, nextMode\)/);

  assert.match(serviceSource, /const nextClassWaitlistIds = enrolled[\s\S]*removeId\(getClassWaitlistIds\(classItem\), safeStudentId\)/);
  assert.match(serviceSource, /waitlist_student_ids: nextClassWaitlistIds/);
  assert.match(serviceSource, /waitlistStudentIds: nextClassWaitlistIds/);
});

test("class detail first screen omits counseling surfaces delegated to MakeEdu", async () => {
  const pageSource = await readFile(new URL("src/features/management/management-page.tsx", root), "utf8");

  assert.doesNotMatch(pageSource, /const renderClassCounselingSnapshot = \(\) =>/);
  assert.doesNotMatch(pageSource, /data-testid="class-counseling-snapshot"/);
  assert.doesNotMatch(pageSource, /상담 빠른 확인/);
  assert.doesNotMatch(pageSource, /const renderClassOfficialQuickEditPanel = \(\) =>/);
  assert.doesNotMatch(pageSource, /data-testid="class-official-quick-edit-panel"/);
  assert.doesNotMatch(pageSource, /상담 중 기준 수정/);
  assert.doesNotMatch(pageSource, /\{renderClassCounselingSnapshot\(\)\}/);
  assert.doesNotMatch(pageSource, /\{renderClassOfficialQuickEditPanel\(\)\}/);
});

test("class schedule detail tab shows official session and exception context", async () => {
  const pageSource = await readFile(new URL("src/features/management/management-page.tsx", root), "utf8");
  const recordsSource = await readFile(new URL("src/features/academic/records.js", root), "utf8");
  const typeSource = await readFile(new URL("src/features/academic/records.d.ts", root), "utf8");

  assert.match(pageSource, /function getClassScheduleNextSession/);
  assert.match(pageSource, /function getClassScheduleCurrentSession/);
  assert.match(pageSource, /function getClassScheduleExceptionSessions/);
  assert.match(pageSource, /const renderClassSchedulePanel = \(\) =>/);
  assert.match(pageSource, /data-testid="class-schedule-official-panel"/);
  assert.match(pageSource, /다음 수업일/);
  assert.match(pageSource, /현재 회차/);
  assert.match(pageSource, /전체 회차/);
  assert.match(pageSource, /회차 보기/);
  assert.match(pageSource, /보강·휴강·예외/);
  assert.match(pageSource, /data-testid="class-schedule-session-view-panel"/);
  assert.match(pageSource, /data-testid="class-schedule-session-view-create"/);
  assert.match(pageSource, /data-testid="class-schedule-session-view-edit"/);
  assert.match(pageSource, /data-testid="class-schedule-session-row-edit"/);
  assert.match(pageSource, /sessions\.length <= 0 \? "회차 미생성" : `회차 \$\{sessions\.length\}회`/);
  assert.match(pageSource, /회차 생성/);
  assert.match(pageSource, /\{renderClassSchedulePanel\(\)\}/);
  assert.doesNotMatch(pageSource, /renderEditableFields\("detail", \["teacher", "schedule", "classroom", "classGroupIds"\]\)/);
  assert.doesNotMatch(pageSource, /data-testid="class-schedule-session-create-work-panel"/);
  assert.doesNotMatch(pageSource, /data-testid="class-schedule-exception-work-panel"/);
  assert.doesNotMatch(pageSource, /data-testid="class-schedule-exception-create"/);
  assert.doesNotMatch(pageSource, /data-testid="class-schedule-exception-edit"/);
  assert.match(pageSource, /section: "lesson-design-periods"/);
  assert.match(pageSource, /sessionId: getCurriculumSessionStableId\(session\)/);
  assert.match(pageSource, /회차 수정/);

  assert.match(recordsSource, /scheduleState = text\(session\?\.state \|\| session\?\.scheduleState \|\| session\?\.schedule_state\)/);
  assert.match(recordsSource, /makeupDate = text\(session\?\.makeupDate \|\| session\?\.makeup_date\)/);
  assert.match(typeSource, /scheduleState: string/);
  assert.match(typeSource, /makeupDate: string/);
});

test("class management shares curriculum summary data without dashboard warning strips", async () => {
  const hookSource = await readFile(new URL("src/features/management/use-management-records.ts", root), "utf8");
  const pageSource = await readFile(new URL("src/features/management/management-page.tsx", root), "utf8");

  assert.match(hookSource, /import \{ buildCurriculumWorkspaceModel \} from "\.\.\/academic\/records\.js"/);
  assert.match(hookSource, /function attachClassCurriculumSummary/);
  assert.match(hookSource, /readOptionalTable\("class_terms"\)/);
  assert.match(hookSource, /readOptionalTable\("textbooks"\)/);
  assert.match(hookSource, /readOptionalTable\("progress_logs"\)/);
  assert.match(hookSource, /curriculumModel = buildCurriculumWorkspaceModel/);
  assert.match(hookSource, /delayed_progress_sessions: curriculum\.delayedProgressSessions/);

  assert.match(pageSource, /function getClassSummaryCurriculumLabel/);
  assert.match(pageSource, /const curriculumSummaryLabel = getClassSummaryCurriculumLabel\(selectedRow\)/);
  assert.match(pageSource, /data-testid="class-official-summary-bar"/);
  assert.doesNotMatch(pageSource, /function getClassOperationalWarnings/);
  assert.doesNotMatch(pageSource, /ClassOperationalWarning/);
  assert.doesNotMatch(pageSource, /data-testid="class-operational-warnings"/);
  assert.doesNotMatch(pageSource, /data-testid="class-summary-primary-warning"/);
  assert.doesNotMatch(pageSource, /상담 확인 필요/);
  assert.match(pageSource, /data-testid="management-save-status"/);
  assert.match(pageSource, /setSaveNotice\("저장 완료"\)/);
});

test("class save failure makes preserved data explicit", async () => {
  const pageSource = await readFile(new URL("src/features/management/management-page.tsx", root), "utf8");

  assert.match(pageSource, /function getSaveErrorStatusLabel\(message: string\)/);
  assert.match(pageSource, /return `저장 실패 · 기존 데이터 유지 · \$\{message\}`/);
  assert.match(pageSource, /const saveErrorStatusLabel = getSaveErrorStatusLabel\(operationError\)/);
  assert.match(pageSource, /\{saveErrorStatusLabel\}/);
  assert.doesNotMatch(pageSource, />\s*저장 실패\s*<\/div>/);
});

test("class management does not route student issues into dashboard counseling", async () => {
  const hookSource = await readFile(new URL("src/features/management/use-management-records.ts", root), "utf8");
  const pageSource = await readFile(new URL("src/features/management/management-page.tsx", root), "utf8");

  assert.match(hookSource, /student\?\.latest_issue \|\|/);
  assert.match(hookSource, /student\?\.special_note \|\|/);
  assert.match(hookSource, /student\?\.important_note/);
  assert.match(hookSource, /counselingNote: textValue\(student\?\.counseling_note \|\| student\?\.counselingNote/);
  assert.doesNotMatch(pageSource, /function getClassCounselingAlertStudentId\(row: ManagementRow\)/);
  assert.doesNotMatch(pageSource, /getClassStudentSummaries\(row\)\.find\(\(student\) => getStudentLatestIssue\(student\)\)/);
  assert.doesNotMatch(pageSource, /id: "student-counseling-issue"/);
  assert.doesNotMatch(pageSource, /title: "상담 확인 필요"/);
  assert.doesNotMatch(pageSource, /tab: "counseling"/);
  assert.doesNotMatch(pageSource, /actionLabel: "상담 보기"/);
});

test("class student roster still focuses requested student rows", async () => {
  const pageSource = await readFile(new URL("src/features/management/management-page.tsx", root), "utf8");

  assert.match(pageSource, /const isFocusedRosterStudent = requestedClassDetailStudentId === id/);
  assert.match(pageSource, /id=\{`class-roster-student-\$\{id\}`\}/);
  assert.match(pageSource, /data-class-roster-focused=\{isFocusedRosterStudent \? "true" : undefined\}/);
  assert.match(pageSource, /document\.getElementById\(`class-roster-student-\$\{requestedClassDetailStudentId\}`\)/);
  assert.match(pageSource, /scrollClassDetailTargetIntoView\(row\)/);
  assert.match(pageSource, /const retryTimer = window\.setTimeout\(scrollFocusedRosterStudent, 450\)/);
  assert.match(pageSource, /activeClassDetailTab !== "students"/);
  assert.match(pageSource, /\}, \[activeClassDetailTab, dialogMode, kind, relatedRows\.length, requestedClassDetailStudentId, selectedRow\?\.id\]\)/);
});

test("class detail no longer renders operational warning panels", async () => {
  const pageSource = await readFile(new URL("src/features/management/management-page.tsx", root), "utf8");

  assert.doesNotMatch(pageSource, /function getClassDuplicatedRosterStudentId\(row: ManagementRow\)/);
  assert.doesNotMatch(pageSource, /id: "duplicated-roster-student"/);
  assert.doesNotMatch(pageSource, /id: "over-capacity"/);
  assert.doesNotMatch(pageSource, /id: "inactive-with-students"/);
  assert.doesNotMatch(pageSource, /const primaryClassWarning = selectedClassWarnings\[0\] \|\| null/);
  assert.doesNotMatch(pageSource, /data-testid="class-summary-primary-warning"/);
  assert.doesNotMatch(pageSource, /data-testid="class-summary-primary-warning-action"/);
  assert.doesNotMatch(pageSource, /handleClassWarningAction/);
});

test("class detail keeps mobile primary actions reachable at the bottom", async () => {
  const pageSource = await readFile(new URL("src/features/management/management-page.tsx", root), "utf8");

  assert.match(pageSource, /const CLASS_MOBILE_ACTION_TABS = CLASS_DETAIL_TABS/);
  assert.match(pageSource, /const renderClassMobileActionBar = \(\) =>/);
  assert.match(pageSource, /data-testid="class-detail-mobile-action-bar"/);
  assert.match(pageSource, /sticky bottom-0/);
  assert.doesNotMatch(pageSource, /fixed inset-x-4 bottom-4/);
  assert.match(pageSource, /md:hidden/);
  assert.match(pageSource, /CLASS_MOBILE_ACTION_TABS\.map\(\(tab\) =>/);
  assert.match(pageSource, /data-testid=\{`class-detail-mobile-tab-\$\{tab\.value\}`\}/);
  assert.match(pageSource, /aria-label=\{`\$\{tab\.label\} 보기`\}/);
  assert.match(pageSource, /onClick=\{\(\) => handleClassDetailTabChange\(tab\.value\)\}/);
  assert.match(pageSource, /\{tab\.icon\}/);
  assert.match(pageSource, /\{tab\.shortLabel\}/);
  assert.match(pageSource, /grid-cols-\[repeat\(5,minmax\(0,1fr\)\)\]/);
  assert.match(pageSource, /const mobileSaveStatus = renderSaveStatus\(\)/);
  assert.match(pageSource, /data-testid="class-detail-mobile-save-status"/);
  assert.match(pageSource, /\{mobileSaveStatus\}/);
  assert.match(pageSource, /data-testid="class-detail-mobile-save"/);
  assert.match(pageSource, /onClick=\{handleDetailSave\}/);
  assert.match(pageSource, /<span className="max-w-full truncate">\{saving \? "저장 중" : "저장"\}<\/span>/);
  assert.match(pageSource, /pb-32 md:pb-0/);
  assert.doesNotMatch(pageSource, /pb-24 md:pb-0/);
  assert.match(pageSource, /\{renderClassMobileActionBar\(\)\}/);
});

test("class official detail dialog stacks above sticky database headers", async () => {
  const pageSource = await readFile(new URL("src/features/management/management-page.tsx", root), "utf8");

  assert.match(pageSource, /DialogContent className="[^"]*z-\[80\][^"]*"/);
  assert.match(pageSource, /data-testid="class-official-detail"/);
});

test("class management database keeps list filters in the URL for cross-view returns", async () => {
  const tableSource = await readFile(new URL("src/features/management/management-data-table.tsx", root), "utf8");

  assert.match(tableSource, /usePathname,\s*useRouter,\s*useSearchParams/);
  assert.match(tableSource, /const CLASS_LIST_QUERY_PARAM_KEYS =/);
  assert.match(tableSource, /function getClassListQueryState/);
  assert.match(tableSource, /q: normalizeScalar\(params\.get\(CLASS_LIST_QUERY_PARAM_KEYS\.q\)\)/);
  assert.match(tableSource, /period: normalizeScalar\(params\.get\(CLASS_LIST_QUERY_PARAM_KEYS\.period\)\)/);
  assert.match(tableSource, /status: normalizeScalar\(params\.get\(CLASS_LIST_QUERY_PARAM_KEYS\.status\)\)/);
  assert.doesNotMatch(tableSource, /classType: normalizeScalar\(params\.get\(CLASS_LIST_QUERY_PARAM_KEYS\.classType\)\)/);
  assert.match(tableSource, /function buildClassListHref/);
  assert.match(tableSource, /router\.replace\(nextHref, \{ scroll: false \}\)/);
  assert.match(tableSource, /syncClassListQueryState\(\{ q: value \}\)/);
  assert.match(tableSource, /syncClassListQueryState\(\{ period: value \}\)/);
  assert.match(tableSource, /syncClassListQueryState\(\{ status: value \}\)/);
  assert.match(tableSource, /syncClassListQueryState\(\{ \[filter\.id\]: nextFilterValue \}\)/);
});

test("class official summary keeps the period visible as core class identity", async () => {
  const pageSource = await readFile(new URL("src/features/management/management-page.tsx", root), "utf8");

  assert.match(pageSource, /function getClassPeriodLabel\(row: ManagementRow\)/);
  assert.match(pageSource, /raw\.class_group_names \|\| raw\.classGroupNames/);
  assert.match(pageSource, /getClassAcademicYearOption\(raw\), getClassTermOption\(raw\)/);
  assert.match(pageSource, /const periodLabel = getClassPeriodLabel\(selectedRow\) \|\| "기간 미정"/);
  assert.match(pageSource, /<Badge variant="outline">\{periodLabel\}<\/Badge>/);
  assert.match(pageSource, /\{\[teacher, periodLabel, classroom\]\.filter\(Boolean\)\.join\(" · "\)\}/);
  assert.match(pageSource, /renderEditableFields\("detail", \[[\s\S]*"classGroupIds"[\s\S]*\]\)/);
});

test("class official summary shows the active textbook with progress status", async () => {
  const pageSource = await readFile(new URL("src/features/management/management-page.tsx", root), "utf8");

  assert.match(pageSource, /function getClassTextbookTitle\(book: Record<string, unknown>, index: number\)/);
  assert.match(pageSource, /function getClassSummaryCurriculumLabel\(row: ManagementRow\)/);
  assert.match(pageSource, /const textbooks = getClassTextbookCatalog\(row\)/);
  assert.match(pageSource, /const latestProgressNote = getClassLatestProgressNote\(row\)/);
  assert.match(pageSource, /const curriculumSummaryLabel = getClassSummaryCurriculumLabel\(selectedRow\)/);
  assert.match(pageSource, />교재·진도<\/div>/);
  assert.match(pageSource, /\{curriculumSummaryLabel\}/);
  assert.doesNotMatch(pageSource, />진도 상태<\/div>/);
});

test("class official summary shows next lesson and current session context", async () => {
  const pageSource = await readFile(new URL("src/features/management/management-page.tsx", root), "utf8");

  assert.match(pageSource, /function getClassSummaryScheduleLabel\(row: ManagementRow, fallbackSchedule: string\)/);
  assert.match(pageSource, /const nextSession = getClassScheduleNextSession\(row\)/);
  assert.match(pageSource, /const currentSession = getClassScheduleCurrentSession\(row\)/);
  assert.match(pageSource, /const totalSessions = getClassSessionCount\(row\) \|\| getClassSessionSummaries\(row\)\.length/);
  assert.match(pageSource, /`현재 \$\{currentOrder\}\/\$\{totalSessions\}회`/);
  assert.match(pageSource, /const scheduleSummaryLabel = getClassSummaryScheduleLabel\(selectedRow, schedule\)/);
  assert.match(pageSource, /\{scheduleSummaryLabel\}/);
});

test("class official summary omits the counseling decision strip", async () => {
  const pageSource = await readFile(new URL("src/features/management/management-page.tsx", root), "utf8");

  assert.doesNotMatch(pageSource, /const remainingSeats = capacity > 0 \? Math\.max\(capacity - registeredCount, 0\) : null/);
  assert.doesNotMatch(pageSource, /const nextLessonLabel = nextSession \? getCurriculumSessionTitle\(nextSession, "다음 회차"\) : "회차 없음"/);
  assert.doesNotMatch(pageSource, /const decisionProgressLabel = delayedProgressCount > 0 \? `미배정 \$\{delayedProgressCount\}회` : latestProgressNote \|\| getClassCurriculumStateLabel\(selectedRow\)/);
  assert.doesNotMatch(pageSource, /data-testid="class-summary-decision-strip"/);
  assert.doesNotMatch(pageSource, />다음 작업</);
  assert.match(pageSource, />일정<\/div>/);
  assert.match(pageSource, />정원<\/div>/);
  assert.match(pageSource, />등록\/대기<\/div>/);
  assert.match(pageSource, />교재·진도<\/div>/);
});

test("class management archives classes and shows audit-aware official details", async () => {
  const hookSource = await readFile(new URL("src/features/management/use-management-records.ts", root), "utf8");
  const pageSource = await readFile(new URL("src/features/management/management-page.tsx", root), "utf8");
  const serviceSource = await readFile(new URL("src/features/management/management-service.js", root), "utf8");
  const tableSource = await readFile(new URL("src/features/management/management-data-table.tsx", root), "utf8");
  const auditMigration = await readFile(new URL("supabase/migrations/20260429162000_teacher_account_link_audit.sql", root), "utf8");

  assert.match(hookSource, /function readOptionalClassAuditLogs/);
  assert.match(hookSource, /from\("dashboard_audit_logs"\)/);
  assert.match(hookSource, /function attachClassAuditSummary/);
  assert.match(hookSource, /latest_audit_action/);
  assert.match(hookSource, /updated_by_name: latestActor/);

  assert.match(pageSource, /import \{ useAuth \} from "@\/providers\/auth-provider"/);
  assert.match(pageSource, /const \{ canManageAll \} = useAuth\(\)/);
  assert.match(pageSource, /const canMutateRows = canManageAll/);
  assert.match(pageSource, /function getClassAuditInfo/);
  assert.match(pageSource, /data-testid="class-audit-summary"/);
  assert.match(pageSource, /function getClassAuditLogs\(row: ManagementRow\)/);
  assert.match(pageSource, /const renderClassAuditTimeline = \(\) =>/);
  assert.match(pageSource, /data-testid="class-audit-timeline"/);
  assert.match(pageSource, /최근 변경 이력/);
  assert.match(pageSource, /formatClassAuditAction\(item\.action\)/);
  assert.match(pageSource, /formatHistoryDate\(item\.changedAt \|\| item\.changed_at\)/);
  assert.match(pageSource, /\{renderClassAuditTimeline\(\)\}/);
  assert.match(pageSource, /service\.updateClass\(compact\(\{ status: ARCHIVED_CLASS_STATUS \}, kind, row\)\)/);
  assert.doesNotMatch(pageSource, /if \(kind === "classes"\) return service\.deleteClass\(row\.id\)/);
  assert.match(pageSource, /kind === "classes" \? "종강 처리"/);
  assert.match(pageSource, /disabled=\{saving \|\| !canMutateRows\}/);

  assert.match(tableSource, /kind === "classes" \? "일괄 종강"/);
  assert.match(serviceSource, /const ARCHIVED_CLASS_STATUS = "종강"/);
  assert.match(serviceSource, /\.update\(\{ status: ARCHIVED_CLASS_STATUS \}\)/);
  assert.match(auditMigration, /create trigger dashboard_audit_classes/);
});

test("class counseling view is not rendered in the dashboard", async () => {
  const hookSource = await readFile(new URL("src/features/management/use-management-records.ts", root), "utf8");
  const pageSource = await readFile(new URL("src/features/management/management-page.tsx", root), "utf8");
  const serviceSource = await readFile(new URL("src/features/management/management-service.js", root), "utf8");
  const migrationSource = await readFile(new URL("supabase/migrations/20260610120000_student_counseling_note.sql", root), "utf8");

  assert.match(hookSource, /readOptionalTable\("students"\)/);
  assert.match(pageSource, /function getStudentContactValue/);
  assert.doesNotMatch(pageSource, /function getStudentCounselingNote/);
  assert.doesNotMatch(pageSource, /data-testid="class-counseling-student-cards"/);
  assert.doesNotMatch(pageSource, /data-testid="class-counseling-student-card"/);
  assert.doesNotMatch(pageSource, /data-class-counseling-student-id=\{id\}/);
  assert.doesNotMatch(pageSource, /id=\{`class-counseling-card-\$\{id\}`\}/);
  assert.doesNotMatch(pageSource, /document\.getElementById\(`class-counseling-card-\$\{requestedClassDetailStudentId\}`\)/);
  assert.doesNotMatch(pageSource, /document\.getElementById\(`class-counseling-note-\$\{requestedClassDetailStudentId\}`\)/);
  assert.doesNotMatch(pageSource, /focusRequestedCounselingStudent/);
  assert.match(pageSource, /학생 연락처/);
  assert.match(pageSource, /학부모 연락처/);
  assert.doesNotMatch(pageSource, /상담 메모/);
  assert.doesNotMatch(pageSource, /handleCounselingNoteSave/);
  assert.doesNotMatch(pageSource, /service\.updateStudentCounselingNote/);
  assert.doesNotMatch(pageSource, /메모 저장/);
  assert.match(serviceSource, /async updateStudentCounselingNote/);
  assert.match(serviceSource, /\.update\(\{ counseling_note: trimText\(note\) \}\)/);
  assert.match(migrationSource, /add column if not exists counseling_note text not null default ''/);
});

test("class records use curriculum textbook count when class textbook ids are missing", () => {
  const row = normalizeClassManagementRecord({
    id: "class-1",
    name: "고1 수학",
    textbook_count: 2,
    student_ids: ["s1"],
  });

  assert.equal(row.metrics.textbookCount, 2);
  assert.match(row.metaSummary, /교재 2권/);
});

test("class detail hides the official class type from dashboard editing surfaces", async () => {
  const pageSource = await readFile(new URL("src/features/management/management-page.tsx", root), "utf8");
  const dataTableSource = await readFile(new URL("src/features/management/management-data-table.tsx", root), "utf8");
  const serviceSource = await readFile(new URL("src/features/management/management-service.js", root), "utf8");
  const recordsSource = await readFile(new URL("src/features/management/records.js", root), "utf8");
  const migrationSource = await readFile(new URL("supabase/migrations/20260610123000_class_type.sql", root), "utf8");
  const row = normalizeClassManagementRecord({
    id: "class-1",
    name: "고1 수학",
    class_type: "특강",
    subject: "수학",
  });

  assert.equal(row.raw.classType, "특강");
  assert.equal(row.metrics.classType, "특강");
  assert.match(row.metaSummary, /특강/);
  assert.match(row.searchText, /특강/);
  assert.doesNotMatch(pageSource, /\{ name: "classType", label: "수업 유형"/);
  assert.doesNotMatch(pageSource, /function getClassTypeValue/);
  assert.doesNotMatch(pageSource, /classType: uniqueSortedOptions/);
  assert.doesNotMatch(pageSource, /payload\.class_type = payload\.classType/);
  assert.doesNotMatch(pageSource, /detailMetric\("수업 유형", getClassTypeValue/);
  assert.doesNotMatch(pageSource, /<Badge variant="outline">\{classType\}<\/Badge>/);
  assert.doesNotMatch(dataTableSource, /"classType"/);
  assert.doesNotMatch(dataTableSource, /id: "classType"/);
  assert.doesNotMatch(dataTableSource, /header: "유형"/);
  assert.doesNotMatch(dataTableSource, /getClassTypeValue\(record\)/);
  assert.match(serviceSource, /class_type: getClassTypeValue\(record\)/);
  assert.match(recordsSource, /function getClassTypeValue/);
  assert.match(recordsSource, /class_type: classType/);
  assert.match(recordsSource, /classType/);
  assert.match(migrationSource, /add column if not exists class_type text not null default '정규'/);
});

test("class teacher choices are narrowed by the selected subject", async () => {
  const pageSource = await readFile(new URL("src/features/management/management-page.tsx", root), "utf8");

  assert.match(pageSource, /function getClassTeacherOptionsForSubject\(rawRows: Record<string, unknown>\[\], subject: string\)/);
  assert.match(pageSource, /const subjectRows = selectedSubject[\s\S]*rawRows\.filter\(\(raw\) => getClassSubjectValue\(raw\) === selectedSubject\)/);
  assert.match(pageSource, /const sourceRows = subjectRows\.length > 0 \? subjectRows : rawRows/);
  assert.match(pageSource, /teacher: getClassTeacherOptionsForSubject\(rawRows, selectedClassSubject\)/);
  assert.match(pageSource, /const selectedClassSubject = kind === "classes" \? text\(form\.subject\) : ""/);
  assert.match(pageSource, /if \(kind === "classes" && fieldName === "subject"\)/);
  assert.match(pageSource, /const teacherOptions = getClassTeacherOptionsForSubject\(rawRows, normalizedValue\)/);
  assert.match(pageSource, /if \(next\.teacher && teacherOptions\.length > 0 && !teacherOptions\.includes\(next\.teacher\)\)/);
  assert.match(pageSource, /next\.teacher = ""/);
});

test("student recent issues stay out of dashboard class counseling surfaces", async () => {
  const pageSource = await readFile(new URL("src/features/management/management-page.tsx", root), "utf8");
  const serviceSource = await readFile(new URL("src/features/management/management-service.js", root), "utf8");
  const recordsSource = await readFile(new URL("src/features/management/records.js", root), "utf8");
  const migrationSource = await readFile(new URL("supabase/migrations/20260610124000_student_recent_issue.sql", root), "utf8");
  const row = normalizeStudentManagementRecord({
    id: "student-1",
    name: "김학생",
    school: "대치고",
    grade: "고1",
    recent_issue: "학부모 전화 요청",
  });

  assert.equal(row.raw.recentIssue, "학부모 전화 요청");
  assert.equal(row.metrics.recentIssue, "학부모 전화 요청");
  assert.match(row.metaSummary, /특이사항 학부모 전화 요청/);
  assert.match(row.searchText, /학부모 전화 요청/);
  assert.doesNotMatch(pageSource, /\{ name: "recentIssue", label: "최근 특이사항"/);
  assert.doesNotMatch(pageSource, /function getStudentLatestIssue/);
  assert.doesNotMatch(pageSource, /data-testid="class-student-latest-issue"/);
  assert.doesNotMatch(pageSource, /최근 특이사항/);
  assert.doesNotMatch(pageSource, /getStudentLatestIssue\(record\)/);
  assert.match(serviceSource, /recent_issue: trimText\(record\.recentIssue \|\| record\.recent_issue/);
  assert.match(recordsSource, /function getStudentRecentIssue/);
  assert.match(recordsSource, /recent_issue: recentIssue/);
  assert.match(migrationSource, /add column if not exists recent_issue text not null default ''/);
});
