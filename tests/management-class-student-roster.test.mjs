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

test("management roster writes are readiness-gated and use the atomic roster RPC", async () => {
  const serviceSource = await readFile(new URL("src/features/management/management-service.js", root), "utf8");
  const assignSource = serviceSource.match(/async assignStudentToClass[\s\S]*?return \{ student: nextStudent, class: nextClass \};/)?.[0] || "";
  const removeSource = serviceSource.match(/async removeStudentFromClass[\s\S]*?return \{ student: nextStudent, class: nextClass \};/)?.[0] || "";

  assert.match(serviceSource, /createRegistrationRuntimeProbe/);
  assert.match(serviceSource, /probeRegistrationRuntime/);
  assert.match(serviceSource, /데이터 전환 중/);
  assert.match(serviceSource, /invalidateRegistrationRuntimeAfterReadyFailure/);
  assert.match(serviceSource, /isMissingRegistrationRosterRpc/);
  assert.match(assignSource, /set_student_class_roster_mode/);
  assert.match(assignSource, /p_expected_mode:\s*previousMode \|\| "removed"/);
  assert.match(assignSource, /buildCommittedRosterRecords/);
  assert.match(removeSource, /set_student_class_roster_mode/);
  assert.match(removeSource, /p_next_mode:\s*"removed"/);
  assert.match(removeSource, /p_expected_mode:\s*previousMode \|\| "removed"/);
  assert.match(removeSource, /buildCommittedRosterRecords/);
  assert.match(serviceSource, /stripReadyStudentWriteFields/);
  assert.match(serviceSource, /stripReadyClassWriteFields/);
  assert.match(serviceSource, /assertStudentPhysicalDeleteAllowed/);
  assert.match(serviceSource, /student_class_enrollment_history/);
  assert.match(serviceSource, /ops_registration_enrollments/);
  assert.match(serviceSource, /assertCommittedRosterProjection/);
  assert.match(serviceSource, /연결 또는 수강 이력이 있는 학생은 퇴원 처리하세요/);
});

test("class management accepts legacy class detail tab URLs without rendering detail tabs", async () => {
  const pageSource = await readFile(new URL("src/features/management/management-page.tsx", root), "utf8");

  assert.match(pageSource, /useSearchParams/);
  assert.match(pageSource, /const requestedClassId = kind === "classes" \? text\(searchParams\.get\("classId"\)\) : ""/);
  assert.match(pageSource, /const requestedClassReturnPath = kind === "classes" \? normalizeReturnToPath\(searchParams\.get\("returnTo"\)\) : ""/);
  assert.match(pageSource, /const requestedClassDetailStudentId = kind === "classes" \? text\(searchParams\.get\("studentId"\)\) : ""/);
  assert.match(pageSource, /const CLASS_DETAIL_TABS = \[/);
  assert.match(pageSource, /\{ value: "basic", label: "기본" \}/);
  assert.match(pageSource, /\{ value: "students", label: "학생" \}/);
  assert.doesNotMatch(pageSource, /\{ value: "schedule", label: "일정" \}/);
  assert.doesNotMatch(pageSource, /\{ value: "curriculum", label: "교재·진도" \}/);
  assert.doesNotMatch(pageSource, /\{ value: "counseling", label: "상담" \}/);
  assert.match(pageSource, /params\.set\("classId", classId\)/);
  assert.match(pageSource, /params\.set\("tab", tab\)/);
  assert.match(pageSource, /params\.set\("studentId", options\.studentId\)/);
  assert.match(pageSource, /params\.delete\("studentId"\)/);
  assert.match(pageSource, /openRow\(targetRow, \{[\s\S]*tab: requestedClassDetailTab[\s\S]*syncRoute: false/);
  assert.match(pageSource, /data-testid="class-official-summary-bar"/);
  assert.match(pageSource, /data-testid="class-detail-return-to-work-queue"/);
  assert.match(pageSource, /router\.push\(requestedClassReturnPath\)/);
  assert.match(pageSource, /function getClassReturnPathLabel\(path: string\)/);
  assert.match(pageSource, /if \(path\.startsWith\("\/admin\/class-schedule"\)\) return "수업일정"/);
  assert.match(pageSource, /if \(path\.startsWith\("\/admin\/curriculum"\)\) return "수업계획"/);
  assert.match(pageSource, /\{getClassReturnPathLabel\(requestedClassReturnPath\)\}/);
  assert.match(pageSource, /params\.delete\("returnTo"\)/);
  assert.doesNotMatch(pageSource, /data-testid="class-official-detail-tabs"/);
  assert.match(pageSource, /data-testid="class-detail-basic-section"/);
  assert.match(pageSource, /data-testid="class-detail-students-section"/);
  assert.doesNotMatch(pageSource, /<TabsContent value="schedule"/);
  assert.doesNotMatch(pageSource, /<TabsContent value="curriculum"/);
  assert.doesNotMatch(pageSource, /\{renderClassSchedulePanel\(\)\}/);
  assert.doesNotMatch(pageSource, /\{renderClassCurriculumPanel\(\)\}/);
  assert.doesNotMatch(pageSource, /data-testid="class-detail-counseling-tab"/);
  assert.match(pageSource, /const buildClassDetailReturnPath = \(/);
  assert.match(pageSource, /params\.set\("studentId", options\.studentId\)/);
  assert.match(pageSource, /params\.set\("returnTo", requestedClassReturnPath\)/);
});

test("class management keeps progress out while allowing direct textbook links in the detail dialog", async () => {
  const pageSource = await readFile(new URL("src/features/management/management-page.tsx", root), "utf8");
  const hookSource = await readFile(new URL("src/features/management/use-management-records.ts", root), "utf8");
  const pickerSource = await readFile(new URL("src/features/management/class-textbook-picker.tsx", root), "utf8");
  const pickerModelSource = await readFile(new URL("src/features/management/class-textbook-picker-model.ts", root), "utf8");
  const detailStart = pageSource.indexOf('data-testid="class-official-detail"');
  const detailEnd = pageSource.indexOf("<DialogFooter", detailStart);
  const detailSource = pageSource.slice(detailStart, detailEnd);

  assert.ok(detailStart >= 0 && detailEnd > detailStart);
  assert.match(detailSource, /data-testid="class-detail-basic-section"/);
  assert.match(detailSource, /renderClassTextbookManagement\(\)/);
  assert.match(pageSource, /data-testid="class-textbook-management"/);
  assert.match(pageSource, /payload\.textbook_ids = textbookIds/);
  assert.match(pageSource, /<ClassTextbookPicker/);
  assert.match(pageSource, /key=\{`\$\{selectedRow\.id\}:\$\{form\.subject\}:\$\{form\.grade\}`\}/);
  assert.match(pageSource, /classRecord=\{\{ \.\.\.raw, subject: form\.subject, grade: form\.grade \}\}/);
  assert.match(hookSource, /available_textbooks:/);
  assert.match(hookSource, /school_levels:/);
  assert.match(hookSource, /grade_levels:/);
  assert.match(hookSource, /sub_subject:/);
  assert.match(pickerSource, /전체 보기/);
  assert.match(pickerSource, /교재 검색 또는 선택/);
  assert.match(pickerSource, /조건에 맞는 교재 없음/);
  assert.match(pickerSource, /max-h-72 overscroll-contain overflow-y-auto/);
  assert.match(pickerSource, /aria-label="학교 구분"/);
  assert.match(pickerSource, /aria-label="세부과목"/);
  assert.match(pickerModelSource, /getDefaultClassTextbookFilters/);
  assert.match(pickerModelSource, /filterClassTextbookCandidates/);
  assert.match(detailSource, /data-testid="class-detail-students-section"/);
  assert.doesNotMatch(detailSource, /<TabsContent value="schedule"/);
  assert.doesNotMatch(detailSource, /<TabsContent value="curriculum"/);
  assert.doesNotMatch(detailSource, /\{renderClassSchedulePanel\(\)\}/);
  assert.doesNotMatch(detailSource, /\{renderClassCurriculumPanel\(\)\}/);
});

test("management pickers share labeled compact filter surfaces and textbook candidates omit publisher pills", async () => {
  const pageSource = await readFile(new URL("src/features/management/management-page.tsx", root), "utf8");
  const pickerSource = await readFile(new URL("src/features/management/class-textbook-picker.tsx", root), "utf8");
  const filterSource = await readFile(new URL("src/features/management/picker-filter-surface.tsx", root), "utf8").catch(() => "");
  const candidateStart = pickerSource.indexOf("candidates.map");
  const candidateSource = pickerSource.slice(candidateStart);

  assert.match(filterSource, /export function PickerFilterSurface/);
  assert.match(filterSource, /export function PickerFilterField/);
  assert.match(filterSource, /export const PICKER_FILTER_TRIGGER_CLASS_NAME/);
  assert.match(pickerSource, /<PickerFilterField label="과목">[\s\S]*<PickerFilterField label="세부과목">[\s\S]*<PickerFilterField label="학교 구분">[\s\S]*<PickerFilterField label="학년">/);
  assert.match(pageSource, /<PickerFilterField label="과목">[\s\S]*<PickerFilterField label="학년">/);
  assert.match(pageSource, /<PickerFilterField label="학년">[\s\S]*<PickerFilterField label="학교">/);
  assert.doesNotMatch(candidateSource, /key: "publisher"/);
  assert.match(pickerSource, /placeholder="교재명, 출판사 검색"/);
});

test("student class picker shows class subject metadata and keeps its long menu scrollable inside the dialog", async () => {
  const pageSource = await readFile(new URL("src/features/management/management-page.tsx", root), "utf8");
  const pillSource = await readFile(new URL("src/features/management/picker-meta-pills.tsx", root), "utf8").catch(() => "");

  assert.match(pageSource, /function getClassCandidateMetaItems\(record\?: RelatedRecord\)/);
  assert.match(pageSource, /key: "subject"/);
  assert.match(pageSource, /key: "grade"/);
  assert.match(pageSource, /key: "schedule"/);
  assert.match(pageSource, /key: "teacher"/);
  assert.match(pageSource, /key: "classroom"/);
  assert.match(pageSource, /<PickerMetaPills items=\{getClassCandidateMetaItems\(record\)\}/);
  assert.match(pillSource, /rounded-full/);
  assert.match(pageSource, /<Popover modal open=\{relationPickerOpen\}/);
  assert.match(pageSource, /max-h-72 overscroll-contain overflow-y-auto/);
});

test("student class picker narrows by subject first and grade second", async () => {
  const pageSource = await readFile(new URL("src/features/management/management-page.tsx", root), "utf8");
  const modelSource = await readFile(new URL("src/features/management/student-class-picker-model.ts", root), "utf8");

  const subjectIndex = pageSource.indexOf('aria-label="수업 과목"');
  const gradeIndex = pageSource.indexOf('aria-label="수업 학년"');
  assert.ok(subjectIndex >= 0 && gradeIndex > subjectIndex);
  assert.match(pageSource, /getDefaultStudentClassPickerFilters/);
  assert.match(pageSource, /filterStudentClassCandidates/);
  assert.match(pageSource, /전체 과목/);
  assert.match(pageSource, /전체 학년/);
  assert.match(modelSource, /getStudentClassSubjectOptions/);
  assert.match(modelSource, /getStudentClassGradeOptions/);
  assert.match(modelSource, /normalizeGrade\(classRecord\.grade\) !== selectedGrade/);
});

test("class student picker narrows by grade first and school second", async () => {
  const pageSource = await readFile(new URL("src/features/management/management-page.tsx", root), "utf8");
  const gradeIndex = pageSource.indexOf('aria-label="학생 학년"');
  const schoolIndex = pageSource.indexOf('aria-label="학생 학교"');

  assert.ok(gradeIndex >= 0 && schoolIndex > gradeIndex);
  assert.match(pageSource, /getDefaultClassStudentPickerFilters/);
  assert.match(pageSource, /getClassStudentGradeOptions/);
  assert.match(pageSource, /getClassStudentSchoolOptions/);
  assert.match(pageSource, /filterClassStudentCandidates/);
});

test("class textbook picker follows subject-detail then school-grade order and matches the roster selector surface", async () => {
  const pageSource = await readFile(new URL("src/features/management/management-page.tsx", root), "utf8");
  const pickerSource = await readFile(new URL("src/features/management/class-textbook-picker.tsx", root), "utf8");
  const subjectIndex = pickerSource.indexOf('aria-label="과목"');
  const subSubjectIndex = pickerSource.indexOf('aria-label="세부과목"');
  const schoolIndex = pickerSource.indexOf('aria-label="학교 구분"');
  const gradeIndex = pickerSource.indexOf('aria-label="학년"');

  assert.ok(subjectIndex >= 0 && subSubjectIndex > subjectIndex);
  assert.ok(schoolIndex > subSubjectIndex && gradeIndex > schoolIndex);
  assert.match(pageSource, /data-testid="class-textbook-picker-panel"/);
  assert.match(pageSource, /교재 선택/);
  assert.match(pageSource, /연결 교재/);
  assert.match(pickerSource, /교재 검색 또는 선택/);
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

test("class detail ignores lesson-design section targets owned by curriculum planning", async () => {
  const pageSource = await readFile(new URL("src/features/management/management-page.tsx", root), "utf8");
  const detailStart = pageSource.indexOf('data-testid="class-official-detail"');
  const detailEnd = pageSource.indexOf("<DialogFooter", detailStart);
  const detailSource = pageSource.slice(detailStart, detailEnd);

  assert.match(pageSource, /const requestedClassDetailSection = kind === "classes" \? text\(searchParams\.get\("section"\)\) : ""/);
  assert.match(pageSource, /const requestedClassDetailSessionId = kind === "classes" \? text\(searchParams\.get\("sessionId"\)\) : ""/);
  assert.ok(detailStart >= 0 && detailEnd > detailStart);
  assert.doesNotMatch(pageSource, /document\.getElementById\(getClassDetailSectionTargetId\(/);
  assert.doesNotMatch(pageSource, /scrollRequestedClassDetailSection/);
  assert.doesNotMatch(pageSource, /activeClassDetailTab !== "schedule"/);
  assert.doesNotMatch(pageSource, /activeClassDetailTab !== "curriculum"/);
  assert.doesNotMatch(detailSource, /data-class-detail-focused=\{isCurriculumWorkPanelFocused \? "true" : undefined\}/);
  assert.doesNotMatch(detailSource, /data-class-detail-focused=\{shouldHighlightScheduleView \? "true" : undefined\}/);
});

test("class detail tab changes preserve only student row targets", async () => {
  const pageSource = await readFile(new URL("src/features/management/management-page.tsx", root), "utf8");

  assert.doesNotMatch(pageSource, /const shouldKeepStudentTarget = nextTab === "students" && requestedClassDetailStudentId/);
  assert.doesNotMatch(pageSource, /studentId: shouldKeepStudentTarget \? requestedClassDetailStudentId : ""/);
  assert.doesNotMatch(pageSource, /const shouldKeepSection = getClassDetailTabForSection\(requestedClassDetailSection\) === nextTab/);
  assert.doesNotMatch(pageSource, /section: shouldKeepSection \? requestedClassDetailSection : ""/);
  assert.doesNotMatch(pageSource, /sessionId: shouldKeepSection/);
  assert.doesNotMatch(pageSource, /section: nextTab === "schedule" \|\| nextTab === "curriculum" \? requestedClassDetailSection : ""/);
});

test("class management detail no longer owns lesson-design navigation", async () => {
  const pageSource = await readFile(new URL("src/features/management/management-page.tsx", root), "utf8");
  const detailStart = pageSource.indexOf('data-testid="class-official-detail"');
  const detailEnd = pageSource.indexOf("<DialogFooter", detailStart);
  const detailSource = pageSource.slice(detailStart, detailEnd);

  assert.ok(detailStart >= 0 && detailEnd > detailStart);
  assert.doesNotMatch(detailSource, /buildLessonDesignFromClassDetailHref/);
  assert.doesNotMatch(detailSource, /\/admin\/curriculum\/lesson-design\?/);
  assert.doesNotMatch(pageSource, /options\.section \|\|[\s\n]*requestedClassDetailSection \|\|/);
  assert.doesNotMatch(pageSource, /options\.sessionId \|\| requestedClassDetailSessionId/);
});

test("class student detail tab shows operational roster context and waitlist promotion", async () => {
  const pageSource = await readFile(new URL("src/features/management/management-page.tsx", root), "utf8");
  const serviceSource = await readFile(new URL("src/features/management/management-service.js", root), "utf8");
  const rosterStart = pageSource.indexOf('data-testid={kind === "classes" ? (modeLabel === "수강" ? "class-enrolled-student-roster" : "class-waitlist-student-roster") : undefined}');
  const rosterEnd = pageSource.indexOf("          ) : ids.map((id) => (", rosterStart);
  const rosterSource = pageSource.slice(rosterStart, rosterEnd);

  assert.ok(rosterStart >= 0 && rosterEnd > rosterStart);
  assert.match(pageSource, /data-testid=\{kind === "classes" \? "class-student-roster-panel" : undefined\}/);
  assert.doesNotMatch(pageSource, /data-testid="class-student-roster-summary"/);
  assert.doesNotMatch(pageSource, />\{relationLabel\} 관리<\/div>/);
  assert.match(pageSource, /data-testid=\{kind === "classes" \? \(modeLabel === "수강" \? "class-enrolled-student-roster" : "class-waitlist-student-roster"\) : undefined\}/);
  assert.match(pageSource, /data-testid="class-roster-student-row"/);
  assert.match(pageSource, /data-class-roster-student-id=\{id\}/);
  assert.match(pageSource, /CLASS_ROSTER_GRID_CLASS_NAME/);
  assert.match(pageSource, /getStudentSchoolValue\(record\)/);
  assert.match(pageSource, /getStudentGradeValue\(record\)/);
  assert.match(pageSource, />학교<\/div>/);
  assert.match(pageSource, />학년<\/div>/);
  assert.match(pageSource, /학생 연락처/);
  assert.match(pageSource, /학부모 연락처/);
  assert.doesNotMatch(pageSource, /relatedMeta\(record\) \|\| "학생 정보 확인 필요"/);
  assert.doesNotMatch(pageSource, /Badge variant=\{modeLabel === "수강" \? "default" : "secondary"\}\>\{modeLabel\}<\/Badge>/);
  assert.doesNotMatch(pageSource, /Badge variant="outline"\>\{text\(record\?\.status\)\}<\/Badge>/);
  assert.doesNotMatch(pageSource, /상담 메모/);
  assert.doesNotMatch(pageSource, /const handleClassStudentCounselingOpen = \(studentId: string\) =>/);
  assert.doesNotMatch(pageSource, /writeClassDetailRoute\(selectedRow\.id, "counseling", \{ studentId: targetStudentId \}\)/);
  assert.doesNotMatch(pageSource, />\s*상담\s*<\/Button>/);
  assert.match(pageSource, /등록 전환/);
  assert.match(pageSource, /modeLabel !== "수강" \? \(/);
  assert.match(pageSource, /handleRelationModeChange\(id, "enrolled"\)/);
  assert.doesNotMatch(rosterSource, />대기로 이동<\/Button>/);
  assert.doesNotMatch(rosterSource, /"waitlist"/);

  assert.match(serviceSource, /const nextClassWaitlistIds = enrolled[\s\S]*removeId\(getClassWaitlistIds\(classItem\), safeStudentId\)/);
  assert.match(serviceSource, /waitlist_student_ids: nextClassWaitlistIds/);
  assert.match(serviceSource, /waitlistStudentIds: nextClassWaitlistIds/);
});

test("class roster student names confirm before opening student detail", async () => {
  const pageSource = await readFile(new URL("src/features/management/management-page.tsx", root), "utf8");
  const rosterStart = pageSource.indexOf('data-testid={kind === "classes" ? (modeLabel === "수강" ? "class-enrolled-student-roster" : "class-waitlist-student-roster") : undefined}');
  const rosterEnd = pageSource.indexOf("          ) : ids.map((id) => (", rosterStart);
  const rosterSource = pageSource.slice(rosterStart, rosterEnd);

  assert.ok(rosterStart >= 0 && rosterEnd > rosterStart);
  assert.match(pageSource, /const \[pendingClassStudentDetailId, setPendingClassStudentDetailId\] = useState\(""\)/);
  assert.match(rosterSource, /data-testid="class-roster-student-name-link"/);
  assert.match(rosterSource, /onClick=\{\(\) => setPendingClassStudentDetailId\(id\)\}/);
  assert.match(pageSource, /data-testid="class-student-detail-confirm-dialog"/);
  assert.match(pageSource, /<DialogTitle>학생 상세로 이동<\/DialogTitle>/);
  assert.match(pageSource, /const confirmClassStudentDetailOpen = \(\) => \{/);
  assert.match(pageSource, /handleClassStudentDetailOpen\(targetStudentId\)/);
  assert.doesNotMatch(rosterSource, /data-testid="class-student-official-link"/);
  assert.doesNotMatch(rosterSource, />학생 상세<\/Button>/);
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

test("class detail shows basic information and student management in one continuous screen", async () => {
  const pageSource = await readFile(new URL("src/features/management/management-page.tsx", root), "utf8");
  const detailStart = pageSource.indexOf('data-testid="class-official-detail"');
  const detailEnd = pageSource.indexOf("<DialogFooter", detailStart);
  const detailSource = pageSource.slice(detailStart, detailEnd);
  const basicIndex = detailSource.indexOf('data-testid="class-detail-basic-section"');
  const studentIndex = detailSource.indexOf('data-testid="class-detail-students-section"');

  assert.ok(detailStart >= 0 && detailEnd > detailStart);
  assert.ok(basicIndex >= 0, "basic section should be rendered in the class detail body");
  assert.ok(studentIndex > basicIndex, "student management should be placed below basic class fields");
  assert.doesNotMatch(detailSource, /<Tabs/);
  assert.doesNotMatch(detailSource, /<TabsList/);
  assert.doesNotMatch(detailSource, /<TabsTrigger/);
  assert.doesNotMatch(detailSource, /<TabsContent/);
  assert.match(detailSource, /renderEditableFields\("detail", \[[\s\S]*"classGroupIds"[\s\S]*\]\)/);
  assert.doesNotMatch(detailSource, /수업 빠른 이동/);
  assert.doesNotMatch(detailSource, />기본 정보<\/div>/);
  assert.doesNotMatch(detailSource, /\{renderClassAuditTimeline\(\)\}/);
  assert.match(detailSource, /\{renderClassScheduleSlotEditor\(\)\}[\s\S]*data-testid="class-detail-students-section"[\s\S]*\{renderRelationManagementSection\(\)\}/);
});

test("class detail close ignores stale classId route state until the URL is cleared", async () => {
  const pageSource = await readFile(new URL("src/features/management/management-page.tsx", root), "utf8");

  assert.match(pageSource, /useRef/);
  assert.match(pageSource, /const classDetailRouteClearPendingRef = useRef\(false\)/);
  assert.match(pageSource, /classDetailRouteClearPendingRef\.current = true/);
  assert.match(pageSource, /if \(classDetailRouteClearPendingRef\.current\) \{[\s\n]*return;[\s\n]*\}/);
  assert.match(pageSource, /if \(kind === "classes" && !requestedClassId\) \{[\s\n]*classDetailRouteClearPendingRef\.current = false;[\s\n]*\}/);
});

test("student detail close ignores stale studentId route state until the URL is cleared", async () => {
  const pageSource = await readFile(new URL("src/features/management/management-page.tsx", root), "utf8");

  assert.match(pageSource, /const studentDetailRouteClearPendingRef = useRef\(false\)/);
  assert.match(pageSource, /studentDetailRouteClearPendingRef\.current = true/);
  assert.match(pageSource, /if \(studentDetailRouteClearPendingRef\.current\) \{[\s\n]*return;[\s\n]*\}/);
  assert.match(pageSource, /if \(kind === "students" && !requestedStudentId\) \{[\s\n]*studentDetailRouteClearPendingRef\.current = false;[\s\n]*\}/);
});

test("class management no longer renders schedule detail content", async () => {
  const pageSource = await readFile(new URL("src/features/management/management-page.tsx", root), "utf8");
  const recordsSource = await readFile(new URL("src/features/academic/records.js", root), "utf8");
  const typeSource = await readFile(new URL("src/features/academic/records.d.ts", root), "utf8");
  const detailStart = pageSource.indexOf('data-testid="class-official-detail"');
  const detailEnd = pageSource.indexOf("<DialogFooter", detailStart);
  const detailSource = pageSource.slice(detailStart, detailEnd);

  assert.ok(detailStart >= 0 && detailEnd > detailStart);
  assert.doesNotMatch(detailSource, /data-testid="class-schedule-official-panel"/);
  assert.doesNotMatch(detailSource, /\{renderClassSchedulePanel\(\)\}/);
  assert.doesNotMatch(pageSource, /renderEditableFields\("detail", \["teacher", "schedule", "classroom", "classGroupIds"\]\)/);
  assert.doesNotMatch(detailSource, /data-testid="class-schedule-session-create-work-panel"/);
  assert.doesNotMatch(detailSource, /data-testid="class-schedule-exception-work-panel"/);
  assert.doesNotMatch(detailSource, /data-testid="class-schedule-exception-create"/);
  assert.doesNotMatch(detailSource, /data-testid="class-schedule-exception-edit"/);
  assert.doesNotMatch(detailSource, /section: "lesson-design-periods"/);
  assert.doesNotMatch(detailSource, /sessionId: getCurriculumSessionStableId\(session\)/);
  assert.doesNotMatch(detailSource, /회차 수정/);

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

  assert.doesNotMatch(pageSource, /const curriculumSummaryLabel = getClassSummaryCurriculumLabel\(selectedRow\)/);
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
  assert.doesNotMatch(pageSource, /activeClassDetailTab !== "students"/);
  assert.match(pageSource, /\}, \[dialogMode, kind, relatedRows\.length, requestedClassDetailStudentId, selectedRow\?\.id\]\)/);
});

test("class student add control uses one picker and confirms direct enrolled or waitlist actions", async () => {
  const pageSource = await readFile(new URL("src/features/management/management-page.tsx", root), "utf8");

  assert.match(pageSource, /data-testid=\{kind === "classes" \? "class-relation-picker" : undefined\}/);
  assert.match(pageSource, /data-testid=\{kind === "classes" \? "class-relation-picker-search" : undefined\}/);
  assert.match(pageSource, /data-testid="class-relation-confirm-dialog"/);
  assert.match(pageSource, /const \[pendingRelationMode, setPendingRelationMode\] = useState<"enrolled" \| "waitlist" \| null>\(null\)/);
  assert.match(pageSource, /const requestRelationSave = \(mode: "enrolled" \| "waitlist"\) =>/);
  assert.match(pageSource, /requestRelationSave\("enrolled"\)/);
  assert.match(pageSource, /requestRelationSave\("waitlist"\)/);
  assert.match(pageSource, /const confirmRelationSave = \(\) =>/);
  assert.match(pageSource, /handleRelationSave\(pendingRelationMode\)/);
  assert.match(pageSource, /kind === "students" \? "수강 추가" : "등록 추가"/);
  assert.match(pageSource, />대기 추가<\/Button>/);
  assert.doesNotMatch(pageSource, /const \[relationMode, setRelationMode\]/);
  assert.doesNotMatch(pageSource, /aria-pressed=\{relationMode ===/);
  assert.doesNotMatch(pageSource, />상태<\/Label>/);
  assert.doesNotMatch(pageSource, /relationMode === "enrolled" \? "등록 추가" : "대기 추가"/);
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

  assert.doesNotMatch(pageSource, /const CLASS_MOBILE_ACTION_TABS = CLASS_DETAIL_TABS/);
  assert.match(pageSource, /const renderClassMobileActionBar = \(\) =>/);
  assert.match(pageSource, /data-testid="class-detail-mobile-action-bar"/);
  assert.match(pageSource, /sticky bottom-0/);
  assert.doesNotMatch(pageSource, /fixed inset-x-4 bottom-4/);
  assert.match(pageSource, /md:hidden/);
  assert.doesNotMatch(pageSource, /CLASS_MOBILE_ACTION_TABS\.map\(\(tab\) =>/);
  assert.doesNotMatch(pageSource, /data-testid=\{`class-detail-mobile-tab-\$\{tab\.value\}`\}/);
  assert.doesNotMatch(pageSource, /handleClassDetailTabChange/);
  assert.doesNotMatch(pageSource, /grid-cols-\[repeat\(3,minmax\(0,1fr\)\)\]/);
  assert.match(pageSource, /const mobileSaveStatus = renderSaveStatus\(\)/);
  assert.match(pageSource, /data-testid="class-detail-mobile-save-status"/);
  assert.match(pageSource, /\{mobileSaveStatus\}/);
  assert.match(pageSource, /data-testid="class-detail-mobile-save"/);
  assert.match(pageSource, /onClick=\{handleDetailSave\}/);
  assert.match(pageSource, /<span className="ml-1\.5 max-w-full truncate">\{saving \? "저장 중" : "저장"\}<\/span>/);
  assert.match(pageSource, /pb-28 md:pb-0/);
  assert.doesNotMatch(pageSource, /pb-24 md:pb-0/);
  assert.match(pageSource, /\{renderClassMobileActionBar\(\)\}/);
});

test("class official detail dialog stacks above sticky database headers", async () => {
  const pageSource = await readFile(new URL("src/features/management/management-page.tsx", root), "utf8");

  assert.match(pageSource, /<DialogContent[\s\S]*className="[^"]*z-\[80\][^"]*"/);
  assert.match(pageSource, /showCloseButton=\{kind !== "classes" \|\| !isDetail\}/);
  assert.match(pageSource, /<DialogHeader className=\{isDetail && kind === "classes" \? "sr-only" : "pr-10"\}>/);
  assert.match(pageSource, /<DialogTitle className=\{isDetail && kind === "classes" \? undefined : "break-keep pr-2 leading-6"\}>/);
  assert.match(pageSource, /data-testid="class-official-detail"/);
});

test("class detail summary replaces the visible dialog title and keeps close action sticky", async () => {
  const pageSource = await readFile(new URL("src/features/management/management-page.tsx", root), "utf8");
  const dialogStart = pageSource.indexOf("<DialogContent");
  const detailStart = pageSource.indexOf('data-testid="class-official-detail"', dialogStart);
  const summaryStart = pageSource.indexOf("const renderClassSummaryBar = () =>");
  const summaryEnd = pageSource.indexOf("  const renderRelationManagementSection", summaryStart);
  const detailSource = pageSource.slice(detailStart, pageSource.indexOf("<DialogFooter", detailStart));
  const summarySource = pageSource.slice(summaryStart, summaryEnd);

  assert.ok(dialogStart >= 0 && detailStart > dialogStart);
  assert.ok(summaryStart >= 0 && summaryEnd > summaryStart);
  assert.match(pageSource, /<DialogHeader className=\{isDetail && kind === "classes" \? "sr-only" : "pr-10"\}>/);
  assert.match(pageSource, /showCloseButton=\{kind !== "classes" \|\| !isDetail\}/);
  assert.match(detailSource, /\{renderClassSummaryBar\(\)\}[\s\S]*<section data-testid="class-detail-basic-section"/);
  assert.match(summarySource, /data-testid="class-detail-sticky-close"/);
  assert.match(summarySource, /aria-label="수업 상세 닫기"/);
  assert.match(summarySource, /onClick=\{\(\) => handleDialogOpenChange\(false\)\}/);
  assert.match(summarySource, /\{selectedRow\.title\} 수업정보/);
  assert.doesNotMatch(detailSource, /<div className="mt-1 truncate text-base font-semibold text-foreground">\{selectedRow\.title\}<\/div>[\s\S]*<div className="mt-0\.5 truncate text-sm text-muted-foreground">/);
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

test("class official summary removes redundant identity and state badges", async () => {
  const pageSource = await readFile(new URL("src/features/management/management-page.tsx", root), "utf8");
  const summaryStart = pageSource.indexOf("const renderClassSummaryBar = () =>");
  const summaryEnd = pageSource.indexOf("  const renderRelationManagementSection", summaryStart);
  const summarySource = pageSource.slice(summaryStart, summaryEnd);

  assert.ok(summaryStart >= 0 && summaryEnd > summaryStart);
  assert.match(pageSource, /const scheduleSummary = formatClassScheduleDisplayLines\([\s\S]*formatClassScheduleSlots\(getClassScheduleSlotsFromForm\(\)\)\.schedule,[\s\S]*\)\.join\(", "\) \|\| "시간 미정"/);
  assert.doesNotMatch(summarySource, /const periodLabel = getClassPeriodLabel/);
  assert.doesNotMatch(summarySource, /const subject =/);
  assert.doesNotMatch(summarySource, /const status =/);
  assert.doesNotMatch(summarySource, /const grade =/);
  assert.doesNotMatch(summarySource, /data-testid="class-summary-period-status"/);
  assert.doesNotMatch(summarySource, /\{grade \? <Badge/);
  assert.doesNotMatch(summarySource, /\{subject \? <Badge/);
  assert.doesNotMatch(summarySource, /<Badge variant="secondary">\{periodLabel\}<\/Badge>/);
  assert.match(pageSource, /\{summaryMetaItems\.map\(\(item\) => \(/);
  assert.match(pageSource, /<span key=\{item\.label\} className="inline-flex max-w-full items-center gap-1 rounded-full border bg-background px-2 py-1 text-xs text-muted-foreground">/);
  assert.match(pageSource, /<span className="truncate font-medium text-foreground">\{item\.value\}<\/span>/);
  assert.match(pageSource, /\{ label: "요일\/시간", value: scheduleSummary \}/);
  assert.match(pageSource, /\{ label: "선생님", value: teacher \}/);
  assert.match(pageSource, /\{ label: "강의실", value: classroom \}/);
  assert.match(pageSource, /renderEditableFields\("detail", \[[\s\S]*"classGroupIds"[\s\S]*"status"[\s\S]*\]\)/);
  assert.match(pageSource, /data-testid="class-official-summary-bar" className="sticky top-0 z-20 -mx-4 border-b bg-background px-4 py-3 before:absolute before:inset-x-0 before:-top-4 before:h-4 before:bg-background sm:-mx-6 sm:px-6 sm:before:-top-6 sm:before:h-6"/);
  assert.match(pageSource, /const capacitySummary = capacity > 0[\s\S]*\? `\$\{registeredCount\}명 \(\$\{waitlistCount\}명\) \/ \$\{capacity\}명`[\s\S]*: `\$\{registeredCount\}명 \(\$\{waitlistCount\}명\)`/);
  assert.match(pageSource, />등록 \(대기\) \/ 정원<\/div>/);
  assert.match(pageSource, /\{capacitySummary\}/);
  assert.doesNotMatch(pageSource, />등록\/대기<\/div>/);
  assert.doesNotMatch(pageSource, /grid grid-cols-2 gap-2 text-sm/);
  assert.doesNotMatch(pageSource, /data-testid="class-audit-summary"/);
  assert.doesNotMatch(pageSource, /auditInfo\.label/);
});

test("class database groups matching schedule times and stacks multi-value resources", async () => {
  const tableSource = await readFile(new URL("src/features/management/management-data-table.tsx", root), "utf8");

  assert.match(tableSource, /formatClassScheduleDisplayLines/);
  assert.match(tableSource, /splitClassResourceDisplayValues/);
  assert.match(tableSource, /function renderClassResourceCell/);
  assert.match(tableSource, /cell: \(\{ row \}\) => renderClassResourceCell\(/);
});

test("class official summary roster count jumps to the student roster section", async () => {
  const pageSource = await readFile(new URL("src/features/management/management-page.tsx", root), "utf8");

  assert.match(pageSource, /const scrollClassRosterIntoView = \(\) => \{/);
  assert.match(pageSource, /document\.getElementById\("class-detail-students-section"\)\?\.scrollIntoView\(\{ behavior: "smooth", block: "start" \}\)/);
  assert.match(pageSource, /data-testid="class-summary-roster-jump"/);
  assert.match(pageSource, /onClick=\{scrollClassRosterIntoView\}/);
  assert.match(pageSource, /<div id="class-detail-students-section" data-testid="class-detail-students-section" className="space-y-4">/);
});

test("class detail basic fields use the requested operator order", async () => {
  const pageSource = await readFile(new URL("src/features/management/management-page.tsx", root), "utf8");
  const detailStart = pageSource.indexOf('data-testid="class-official-detail"');
  const detailEnd = pageSource.indexOf("<DialogFooter", detailStart);
  const detailSource = pageSource.slice(detailStart, detailEnd);

  assert.ok(detailStart >= 0 && detailEnd > detailStart);
  assert.match(pageSource, /const classGroupField: Field = \{ name: "classGroupIds", label: "기간", placeholder: "기간 선택" \}/);
  assert.match(pageSource, /fieldName === "classGroupIds" \? classGroupField : FORM_FIELDS\[kind\]\.find\(\(field\) => field\.name === fieldName\)/);
  assert.match(pageSource, /kind === "classes" \? \[\.\.\.FORM_FIELDS\[kind\], classGroupField\] : FORM_FIELDS\[kind\]/);
  assert.match(pageSource, /fieldsToRender\.map\(\(field\) => \{/);
  assert.doesNotMatch(pageSource, /FORM_FIELDS\[kind\]\.filter\(\(field\) => !fieldNames \|\| fieldNames\.includes\(field\.name\)\)\.map/);
  assert.match(pageSource, /const fieldWrapperClassName = cn\("space-y-2", field\.multiline \|\| \(kind === "classes" && scope === "detail" && field\.name === "name"\) \? "sm:col-span-2" : ""\)/);
  assert.match(detailSource, /renderEditableFields\("detail", \[[\s\S]*"grade"[\s\S]*"subject"[\s\S]*"name"[\s\S]*"capacity"[\s\S]*"fee"[\s\S]*"classGroupIds"[\s\S]*"status"[\s\S]*\]\)/);
  assert.doesNotMatch(detailSource, /renderEditableFields\("detail", \[[\s\S]*"name"[\s\S]*"status"[\s\S]*"subject"[\s\S]*"grade"[\s\S]*"capacity"[\s\S]*"fee"[\s\S]*"classGroupIds"[\s\S]*\]\)/);
});

test("class detail basic section uses structured schedule slots instead of free-text teacher time room fields", async () => {
  const pageSource = await readFile(new URL("src/features/management/management-page.tsx", root), "utf8");
  const scheduleSource = await readFile(new URL("src/features/management/class-schedule-slots.ts", root), "utf8");
  const detailStart = pageSource.indexOf('data-testid="class-official-detail"');
  const detailEnd = pageSource.indexOf("<DialogFooter", detailStart);
  const detailSource = pageSource.slice(detailStart, detailEnd);

  assert.ok(detailStart >= 0 && detailEnd > detailStart);
  assert.match(pageSource, /\{ name: "schedule", label: "요일\/시간", placeholder: "월 18:00-20:00" \}/);
  assert.match(pageSource, /type ClassScheduleSlot,/);
  assert.match(pageSource, /from "\.\/class-schedule-slots"/);
  assert.match(scheduleSource, /export type ClassScheduleSlot = \{/);
  assert.match(scheduleSource, /export function parseClassScheduleSlots/);
  assert.match(scheduleSource, /export function formatClassScheduleSlots/);
  assert.match(pageSource, /const renderClassScheduleSlotEditor = \(\) =>/);
  assert.match(pageSource, /data-testid="class-schedule-slot-editor"/);
  assert.match(pageSource, /data-testid="class-schedule-slot-row"/);
  assert.match(pageSource, /const addClassScheduleSlot = \(\) =>/);
  assert.match(pageSource, /const updateClassScheduleSlot = \(index: number, patch: Partial<ClassScheduleSlot>\) =>/);
  assert.match(pageSource, /const removeClassScheduleSlot = \(index: number\) =>/);
  assert.doesNotMatch(detailSource, /renderEditableFields\("detail", \[[\s\S]*"teacher"[\s\S]*"schedule"[\s\S]*"classroom"[\s\S]*\]\)/);
  assert.match(detailSource, /\{renderClassScheduleSlotEditor\(\)\}/);
  assert.doesNotMatch(detailSource, /\{renderClassSchedulePanel\(\)\}/);
});

test("class schedule slot editor keeps blank added rows and uses the makeup time picker pattern", async () => {
  const pageSource = await readFile(new URL("src/features/management/management-page.tsx", root), "utf8");
  const timePickerSource = await readFile(new URL("src/components/ui/date-time-picker.tsx", root), "utf8");

  assert.match(pageSource, /import \{ TimePickerControl \} from "@\/components\/ui\/date-time-picker"/);
  assert.match(timePickerSource, /const TIME_OPTION_STEP_MINUTES = 10/);
  assert.doesNotMatch(timePickerSource, /const TIME_OPTION_STEP_MINUTES = 15/);
  assert.match(pageSource, /const \[classScheduleSlots, setClassScheduleSlots\] = useState<ClassScheduleSlot\[\]>\(\[\]\)/);
  assert.match(pageSource, /setClassScheduleSlots\(kind === "classes" \? parseClassScheduleSlots\(nextForm\.schedule, nextForm\.teacher, nextForm\.classroom\) : \[\]\)/);
  assert.match(pageSource, /setClassScheduleSlots\(nextSlots\)/);
  assert.match(pageSource, /TimePickerControl[\s\S]*ariaLabel=\{`수업시간 \$\{index \+ 1\} 시작시각`\}/);
  assert.match(pageSource, /TimePickerControl[\s\S]*ariaLabel=\{`수업시간 \$\{index \+ 1\} 종료시각`\}/);
  assert.match(pageSource, /aria-label=\{`수업시간 \$\{index \+ 1\} 시작시각 초기화`\}/);
  assert.match(pageSource, /aria-label=\{`수업시간 \$\{index \+ 1\} 종료시각 초기화`\}/);
  assert.doesNotMatch(pageSource, /type="time"/);
});

test("class tuition field edits in ten-thousand won units", async () => {
  const pageSource = await readFile(new URL("src/features/management/management-page.tsx", root), "utf8");

  assert.match(pageSource, /const CLASS_TUITION_UNIT_WON = 10000/);
  assert.match(pageSource, /function ClassTuitionManwonInput/);
  assert.match(pageSource, /data-testid="class-tuition-manwon-input"/);
  assert.match(pageSource, /aria-label="수업료 1만원 올리기"/);
  assert.match(pageSource, /aria-label="수업료 1만원 내리기"/);
  assert.match(pageSource, /onWheel=\{handleWheel\}/);
  assert.match(pageSource, /onTouchMove=\{handleTouchMove\}/);
  assert.match(pageSource, /만원<\/span>/);
  assert.match(pageSource, /commitManwon\(nextManwon\)/);
  assert.match(pageSource, /String\(nextAmount \* CLASS_TUITION_UNIT_WON\)/);
  assert.match(pageSource, /kind === "classes" && field\.name === "fee"/);
  assert.doesNotMatch(pageSource, /id=\{id\}[\s\S]*name=\{field\.name\}[\s\S]*type=\{field\.type \|\| "text"\}[\s\S]*field\.name === "fee"/);
});

test("class capacity uses the same compact stepper pattern as tuition", async () => {
  const pageSource = await readFile(new URL("src/features/management/management-page.tsx", root), "utf8");

  assert.match(pageSource, /function ClassCapacityInput/);
  assert.match(pageSource, /data-testid="class-capacity-input"/);
  assert.match(pageSource, /aria-label="정원 1명 올리기"/);
  assert.match(pageSource, /aria-label="정원 1명 내리기"/);
  assert.match(pageSource, /kind === "classes" && field\.name === "capacity"/);
  assert.doesNotMatch(pageSource, /id="classes-detail-capacity"[\s\S]{0,500}type="number"/);
});

test("class roster uses explicit enrollment labels", async () => {
  const pageSource = await readFile(new URL("src/features/management/management-page.tsx", root), "utf8");

  assert.match(pageSource, /renderRelationList\("수강 학생", classEnrolledStudentIds, "수강"\)/);
  assert.match(pageSource, /\{modeLabel === "수강" \? "수강 해제" : "대기 해제"\}/);
  assert.doesNotMatch(pageSource, /renderRelationList\("등록 학생", classEnrolledStudentIds/);
});

test("class schedule add copies the previous row and advances only the day", async () => {
  const pageSource = await readFile(new URL("src/features/management/management-page.tsx", root), "utf8");

  assert.match(pageSource, /function getNextClassScheduleDay\(day: string\)/);
  assert.match(pageSource, /const currentIndex = CLASS_SCHEDULE_DAYS\.indexOf\(day as \(typeof CLASS_SCHEDULE_DAYS\)\[number\]\)/);
  assert.match(pageSource, /return CLASS_SCHEDULE_DAYS\[\(currentIndex \+ 1\) % CLASS_SCHEDULE_DAYS\.length\]/);
  assert.match(pageSource, /function createNextClassScheduleSlot\(slots: ClassScheduleSlot\[\]\)/);
  assert.match(pageSource, /const source = slots\[slots\.length - 1\] \|\| createEmptyClassScheduleSlot\(\)/);
  assert.match(pageSource, /return \{ \.\.\.source, day: getNextClassScheduleDay\(source\.day\) \}/);
  assert.match(pageSource, /const slots = getClassScheduleSlotsFromForm\(\);[\s\n]*syncClassScheduleSlots\(\[[\s\n]*\.\.\.slots,[\s\n]*createNextClassScheduleSlot\(slots\),[\s\n]*\]\)/);
  assert.doesNotMatch(pageSource, /\.\.\.getClassScheduleSlotsFromForm\(\),[\s\n]*\{ day: "", startTime: "", endTime: "", teacher: "", classroom: "" \}/);
});

test("class schedule rows keep all five input columns equal to prevent overlap", async () => {
  const pageSource = await readFile(new URL("src/features/management/management-page.tsx", root), "utf8");

  assert.match(pageSource, /data-testid="class-schedule-slot-header"/);
  assert.match(pageSource, /const CLASS_SCHEDULE_SLOT_GRID_CLASS_NAME = "grid gap-2 md:grid-cols-\[repeat\(5,minmax\(0,1fr\)\)_2\.5rem\]"/);
  assert.match(pageSource, /className=\{cn\("hidden px-2 text-\[11px\] font-medium text-muted-foreground md:grid", CLASS_SCHEDULE_SLOT_GRID_CLASS_NAME\)\}/);
  assert.match(pageSource, />요일<\/div>[\s\S]*>시작시각<\/div>[\s\S]*>종료시각<\/div>[\s\S]*>선생님<\/div>[\s\S]*>강의실<\/div>/);
  assert.match(pageSource, /className=\{cn\(CLASS_SCHEDULE_SLOT_GRID_CLASS_NAME, "px-2 py-1"\)\}/);
  assert.doesNotMatch(pageSource, /className=\{cn\(CLASS_SCHEDULE_SLOT_GRID_CLASS_NAME, "rounded-md border bg-muted\/15 p-2"\)\}/);
  assert.match(pageSource, /<Label htmlFor=\{`\$\{rowId\}-day`\} className="text-\[11px\] font-medium text-muted-foreground md:sr-only">요일<\/Label>/);
  assert.match(pageSource, /<Label className="text-\[11px\] font-medium text-muted-foreground md:sr-only">시작시각<\/Label>/);
  assert.match(pageSource, /<Label className="text-\[11px\] font-medium text-muted-foreground md:sr-only">종료시각<\/Label>/);
  assert.match(pageSource, /<Label htmlFor=\{`\$\{rowId\}-teacher`\} className="text-\[11px\] font-medium text-muted-foreground md:sr-only">선생님<\/Label>/);
  assert.match(pageSource, /<Label htmlFor=\{`\$\{rowId\}-classroom`\} className="text-\[11px\] font-medium text-muted-foreground md:sr-only">강의실<\/Label>/);
  assert.match(pageSource, /<SelectTrigger id=\{`\$\{rowId\}-teacher`\} className="w-full min-w-0">/);
  assert.match(pageSource, /<SelectTrigger id=\{`\$\{rowId\}-classroom`\} className="w-full min-w-0">/);
  assert.doesNotMatch(pageSource, /minmax\(150px,1fr\)/);
  assert.doesNotMatch(pageSource, /minmax\(96px,0\.55fr\)/);
});

test("class schedule parser does not treat classroom aliases as teachers", async () => {
  const scheduleSource = await readFile(new URL("src/features/management/class-schedule-slots.ts", root), "utf8");

  assert.match(scheduleSource, /function looksLikeClassroomAlias\(value: unknown\)/);
  assert.match(scheduleSource, /const firstDetailIsTeacher = Boolean\(firstDetail && !looksLikeClassroomAlias\(firstDetail\)\)/);
  assert.match(scheduleSource, /teacher: firstDetailIsTeacher \? firstDetail : getFallbackValue\(teachers, slotIndex\)/);
  assert.match(scheduleSource, /classroom: firstDetailIsTeacher[\s\S]*: detailParts\[detailParts\.length - 1\] \|\| classroomsByDay\.get\(day\)/);
  assert.doesNotMatch(scheduleSource, /const teacher = detailParts\.length > 1 \? detailParts\[0\]/);
});

test("class schedule classroom choices are narrowed by the selected subject", async () => {
  const pageSource = await readFile(new URL("src/features/management/management-page.tsx", root), "utf8");

  assert.match(pageSource, /function getClassClassroomOptionsForSubject\(rawRows: Record<string, unknown>\[\], subject: string\)/);
  assert.match(pageSource, /const sourceRows = subjectRows\.length > 0 \? subjectRows : rawRows/);
  assert.match(pageSource, /classroom: getClassClassroomOptionsForSubject\(rawRows, selectedClassSubject\)/);
  assert.match(pageSource, /const classroomOptions = getClassClassroomOptionsForSubject\(rawRows, normalizedValue\)/);
  assert.match(pageSource, /if \(next\.classroom && classroomOptions\.length > 0 && !classroomOptions\.includes\(next\.classroom\)\) \{/);
  assert.match(pageSource, /next\.classroom = ""/);
});

test("class official summary hides active textbook progress status", async () => {
  const pageSource = await readFile(new URL("src/features/management/management-page.tsx", root), "utf8");
  const summaryStart = pageSource.indexOf("const renderClassSummaryBar = () =>");
  const summaryEnd = pageSource.indexOf("  const renderRelationManagementSection", summaryStart);
  const summarySource = pageSource.slice(summaryStart, summaryEnd);

  assert.ok(summaryStart >= 0 && summaryEnd > summaryStart);
  assert.doesNotMatch(summarySource, /const curriculumSummaryLabel = getClassSummaryCurriculumLabel\(selectedRow\)/);
  assert.doesNotMatch(summarySource, />교재·진도<\/div>/);
  assert.doesNotMatch(summarySource, /\{curriculumSummaryLabel\}/);
  assert.doesNotMatch(pageSource, />진도 상태<\/div>/);
});

test("class official summary omits repeated schedule teacher and classroom details", async () => {
  const pageSource = await readFile(new URL("src/features/management/management-page.tsx", root), "utf8");
  const scheduleSource = await readFile(new URL("src/features/management/class-schedule-slots.ts", root), "utf8");
  const summaryStart = pageSource.indexOf("const renderClassSummaryBar = () =>");
  const summaryEnd = pageSource.indexOf("  const renderRelationManagementSection", summaryStart);
  const summarySource = pageSource.slice(summaryStart, summaryEnd);

  assert.ok(summaryStart >= 0 && summaryEnd > summaryStart);
  assert.match(scheduleSource, /const hasSharedScheduleDetails = uniqueTeachers\.length <= 1 && uniqueClassrooms\.length <= 1/);
  assert.match(scheduleSource, /const details = hasSharedScheduleDetails \? "" : \[slot\.teacher, slot\.classroom\]\.filter\(Boolean\)\.join\(", "\)/);
  assert.match(summarySource, /const scheduleSummary = formatClassScheduleDisplayLines\([\s\S]*formatClassScheduleSlots\(getClassScheduleSlotsFromForm\(\)\)\.schedule,[\s\S]*\)\.join\(", "\) \|\| "시간 미정"/);
  assert.doesNotMatch(scheduleSource, /const details = \[slot\.teacher, slot\.classroom\]\.filter\(Boolean\)\.join\(", "\)/);
  assert.match(pageSource, /stripSharedScheduleDetails\(record\.schedule, teacher, classroom\)/);
});

test("class official summary hides next lesson and current session context", async () => {
  const pageSource = await readFile(new URL("src/features/management/management-page.tsx", root), "utf8");
  const summaryStart = pageSource.indexOf("const renderClassSummaryBar = () =>");
  const summaryEnd = pageSource.indexOf("  const renderRelationManagementSection", summaryStart);
  const summarySource = pageSource.slice(summaryStart, summaryEnd);

  assert.ok(summaryStart >= 0 && summaryEnd > summaryStart);
  assert.doesNotMatch(summarySource, /const scheduleSummaryLabel = getClassSummaryScheduleLabel\(selectedRow, schedule\)/);
  assert.doesNotMatch(summarySource, />일정<\/div>/);
  assert.doesNotMatch(summarySource, /\{scheduleSummaryLabel\}/);
});

test("class official summary omits the counseling decision strip", async () => {
  const pageSource = await readFile(new URL("src/features/management/management-page.tsx", root), "utf8");
  const summaryStart = pageSource.indexOf("const renderClassSummaryBar = () =>");
  const summaryEnd = pageSource.indexOf("  const renderRelationManagementSection", summaryStart);
  const summarySource = pageSource.slice(summaryStart, summaryEnd);

  assert.doesNotMatch(pageSource, /const remainingSeats = capacity > 0 \? Math\.max\(capacity - registeredCount, 0\) : null/);
  assert.doesNotMatch(pageSource, /const nextLessonLabel = nextSession \? getCurriculumSessionTitle\(nextSession, "다음 회차"\) : "회차 없음"/);
  assert.doesNotMatch(pageSource, /const decisionProgressLabel = delayedProgressCount > 0 \? `미배정 \$\{delayedProgressCount\}회` : latestProgressNote \|\| getClassCurriculumStateLabel\(selectedRow\)/);
  assert.doesNotMatch(pageSource, /data-testid="class-summary-decision-strip"/);
  assert.doesNotMatch(pageSource, />다음 작업</);
  assert.ok(summaryStart >= 0 && summaryEnd > summaryStart);
  assert.match(summarySource, />등록 \(대기\) \/ 정원<\/div>/);
  assert.match(summarySource, /\{capacitySummary\}/);
  assert.doesNotMatch(summarySource, />일정<\/div>/);
  assert.doesNotMatch(summarySource, />교재·진도<\/div>/);
});

test("class management ends classes through the status field and keeps audit data off the detail surface", async () => {
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
  assert.doesNotMatch(pageSource, /function getClassAuditInfo/);
  assert.doesNotMatch(pageSource, /data-testid="class-audit-summary"/);
  assert.doesNotMatch(pageSource, /function getClassAuditLogs\(row: ManagementRow\)/);
  assert.doesNotMatch(pageSource, /const renderClassAuditTimeline = \(\) =>/);
  assert.doesNotMatch(pageSource, /data-testid="class-audit-timeline"/);
  assert.doesNotMatch(pageSource, /최근 변경 이력/);
  assert.doesNotMatch(pageSource, /formatClassAuditAction\(item\.action\)/);
  assert.doesNotMatch(pageSource, /\{renderClassAuditTimeline\(\)\}/);
  assert.doesNotMatch(pageSource, /if \(kind === "classes"\) return service\.deleteClass\(row\.id\)/);
  assert.match(pageSource, /kind === "classes" \? undefined : canMutateRows \? \(row: ManagementRow\) =>/);
  assert.doesNotMatch(pageSource, /종강 처리/);
  assert.match(pageSource, /disabled=\{saving \|\| !canMutateRows\}/);

  assert.match(tableSource, /kind === "classes" \? null : \(/);
  assert.doesNotMatch(tableSource, /종강 처리/);
  assert.doesNotMatch(tableSource, /일괄 종강/);
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
  const hookSource = await readFile(new URL("src/features/management/use-management-records.ts", root), "utf8");
  const pageSource = await readFile(new URL("src/features/management/management-page.tsx", root), "utf8");
  const tableSource = await readFile(new URL("src/features/management/management-data-table.tsx", root), "utf8");

  assert.match(pageSource, /function getClassTeacherOptionsForSubject\(rawRows: Record<string, unknown>\[\], subject: string\)/);
  assert.match(hookSource, /readOptionalTable\("teacher_catalogs", "id,name,subjects,is_visible,sort_order"\)/);
  assert.match(hookSource, /available_teacher_catalogs: teacherCatalogs/);
  assert.match(pageSource, /function getClassTeacherCatalogOptionsForSubject/);
  assert.match(pageSource, /catalog\.is_visible !== false && isClassTeacherCatalogForSubject\(catalog, subject\)/);
  assert.match(pageSource, /\.\.\.catalogOptions,[\s\S]*\.\.\.sourceRows\.flatMap\(\(raw\) => getClassTeacherValues\(raw\)\)/);
  assert.match(pageSource, /const subjectRows = selectedSubject[\s\S]*rawRows\.filter\(\(raw\) => getClassSubjectValue\(raw\) === selectedSubject\)/);
  assert.match(pageSource, /const sourceRows = subjectRows\.length > 0 \? subjectRows : rawRows/);
  assert.match(pageSource, /teacher: getClassTeacherOptionsForSubject\(rawRows, selectedClassSubject\)/);
  assert.match(pageSource, /const selectedClassSubject = kind === "classes" \? text\(form\.subject\) : ""/);
  assert.match(pageSource, /if \(kind === "classes" && fieldName === "subject"\)/);
  assert.match(pageSource, /const teacherOptions = getClassTeacherOptionsForSubject\(rawRows, normalizedValue\)/);
  assert.match(pageSource, /if \(next\.teacher && teacherOptions\.length > 0 && !teacherOptions\.includes\(next\.teacher\)\)/);
  assert.match(pageSource, /next\.teacher = ""/);
  assert.match(tableSource, /function getManagementTeacherCatalogOptions/);
  assert.match(tableSource, /getManagementTeacherCatalogOptions\(tableSourceRows, selectedSubjectFilter\)/);
  assert.match(tableSource, /\[\.\.\.new Set\(\[\.\.\.catalogOptions, \.\.\.sourceRows\.flatMap\(\(row\) => getClassFilterValues\(row, filter\.id\)\)\]\)\]/);
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
