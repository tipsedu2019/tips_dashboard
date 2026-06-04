import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

const ko = {
  add: "\ucd94\uac00",
  approvals: "\uc804\uc790\uacb0\uc7ac",
  board: "\ubcf4\ub4dc",
  calendar: "\uc77c\uc815",
  class: "\uc218\uc5c5",
  completed: "\uc644\ub8cc",
  doneOpen: "\ub2e4\uc2dc \uc5f4\uae30",
  filters: "\ud544\ud130",
  inbox: "\ubc1b\uc740\ud568",
  mine: "\ub0b4 \ub2f4\ub2f9",
  overdue: "\uc9c0\uc5f0",
  registration: "\ub4f1\ub85d",
  recurring: "\ubc18\ubcf5 \uc5c5\ubb34",
  scheduleAll: "\uc804\uccb4 \uc77c\uc815",
  student: "\ud559\uc0dd",
  teacher: "\uc120\uc0dd\ub2d8",
  today: "\uc624\ub298",
  todo: "\ud560 \uc77c",
  taskbox: "\uc5c5\ubb34\ud568",
  transfer: "\uc804\ubc18",
  unassigned: "\ubbf8\uc815\ub9ac",
  upcoming: "\uc608\uc815",
  withdrawal: "\ud1f4\uc6d0",
  wordRetest: "\ub2e8\uc5b4 \uc7ac\uc2dc\ud5d8",
  automations: "\uc790\ub3d9\ud654 \uaddc\uce59",
};

async function readSource(pathname) {
  return readFile(new URL(pathname, root), "utf8");
}

async function pathExists(pathname) {
  try {
    await access(new URL(pathname, root));
    return true;
  } catch {
    return false;
  }
}

function assertIncludesAll(source, values) {
  for (const value of values) {
    assert.ok(source.includes(value), value);
  }
}

function assertInOrder(source, values) {
  let cursor = -1;
  for (const value of values) {
    const index = source.indexOf(value, cursor + 1);
    assert.ok(index > cursor, `${value} should appear after the previous expected value`);
    cursor = index;
  }
}

test("/admin/tasks is a focused Todoist-style todo workspace", async () => {
  const [pageSource, workspaceSource] = await Promise.all([
    readSource("src/app/admin/tasks/page.tsx"),
    readSource("src/features/tasks/ops-task-workspace.tsx"),
  ]);

  assert.match(pageSource, /<OpsTaskWorkspace workspace="todo" \/>/);
  assert.doesNotMatch(pageSource, /redirect\(/);

  assertIncludesAll(workspaceSource, [
    'type TodoViewKey = "inbox" | "today" | "upcoming" | "mine" | "board" | "calendar" | "filters" | "recurring" | "automations" | "completed"',
    "TODO_VIEW_TABS",
    ko.inbox,
    ko.today,
    ko.upcoming,
    ko.mine,
    ko.board,
    ko.calendar,
    ko.filters,
    ko.recurring,
    ko.automations,
    ko.completed,
    "parseTodoistQuickAdd",
    "quickDateTimeForNextWeekday",
    "normalizeQuickAddTimeToken",
    "getQuickAddAssigneeDirective",
    "getQuickAddDueDirective",
    "resolveQuickAddAssigneeId",
    "withTime",
    "data-testid=\"todo-quick-add-input\"",
    'token.startsWith("@")',
    'token.startsWith("#")',
    "TodoFilterBar",
    "TodoPriorityBadge",
    "canDeleteTask",
    'task.type === "general" || !isClosedOpsTask(task)',
    "getTodoViewForDueAt",
    "sortCompletedTodoTasks",
    "normalizeQuickAddLookup",
    "applyTaskPatch",
    "data && !data.schemaReady",
    "sm:max-w-2xl",
    "max-h-[calc(100dvh-1rem)]",
    "overscroll-contain",
    "scroll-pb-24",
    "md:hidden",
  ]);

  assert.ok(workspaceSource.includes(`${ko.todo} ${ko.add}`));
  assert.ok(workspaceSource.includes(`? "${ko.doneOpen}" : "${ko.completed}"`));
  assert.doesNotMatch(workspaceSource, /TaskCreateLauncher/);
  assert.doesNotMatch(workspaceSource, /TEMPLATE_TASK_TYPES/);
  assert.doesNotMatch(workspaceSource, /DropdownMenu/);
});

test("operation dialogs keep accessible descriptions hidden from the visual workflow", async () => {
  const workspaceSource = await readSource("src/features/tasks/ops-task-workspace.tsx");

  assert.match(workspaceSource, /DialogDescription,/);
  assert.match(
    workspaceSource,
    /<DialogDescription className="sr-only">[\s\S]*?운영 업무를 입력하고 저장합니다\.[\s\S]*?<\/DialogDescription>/,
  );
  assert.match(
    workspaceSource,
    /<DialogDescription className="sr-only">[\s\S]*?선택한 운영 업무의 처리 상태를 확인합니다\.[\s\S]*?<\/DialogDescription>/,
  );
});

test("operation form actions do not cover mobile input fields", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");

  assert.match(source, /data-testid="ops-task-form-scroll-body"/);
  assert.match(source, /className="grid min-h-0 flex-1 gap-4 overflow-x-hidden overflow-y-auto overscroll-contain px-6 py-4"/);
  assert.match(source, /className="flex shrink-0 flex-col gap-2 border-t bg-background px-6 pt-3 pb-\[calc\(0\.75rem\+env\(safe-area-inset-bottom\)\)\] sm:flex-row sm:items-center sm:justify-end"/);
  assert.match(source, /pb-\[calc\(0\.75rem\+env\(safe-area-inset-bottom\)\)\]/);
  assert.doesNotMatch(source, /scroll-pb-40/);
  assert.doesNotMatch(source, /sticky bottom-0 z-20/);
  assert.doesNotMatch(source, /sm:sticky sm:bottom-0/);
});

test("registration completion checks render as direct inline required fields", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");

  assertIncludesAll(source, [
    "getRegistrationCompletionChecklistItems",
    "registrationCompletionChecklistItems",
    "RegistrationCompletionChecklist",
    "완료 체크",
    "requiredFields={requiredFields}",
    "data-required-missing={invalid ? \"true\" : undefined}",
    "updateRegistration(item.key",
  ]);
  assert.doesNotMatch(source, /OperationCompletionReview|RegistrationAutoSyncPreview|완료 전 핵심값|자동 연결|완료 순서/);
  assert.doesNotMatch(source, /<CheckField label="입학안내문" checked=\\{Boolean\\(registration\\.admissionNoticeSent\\)\\}/);
});

test("withdrawal and transfer completion checks render as direct inline required fields", async () => {
  const [workspaceSource, serviceSource] = await Promise.all([
    readSource("src/features/tasks/ops-task-workspace.tsx"),
    readSource("src/features/tasks/ops-task-service.ts"),
  ]);

  assertIncludesAll(workspaceSource, [
    "getWithdrawalCompletionChecklistItems",
    "getTransferCompletionChecklistItems",
    "WithdrawalCompletionChecklist",
    "TransferCompletionChecklist",
    "withdrawalCompletionChecklistItems",
    "transferCompletionChecklistItems",
    "CompletionChecklist",
    "완료 체크",
    "studentStatusUpdated",
    "학생 상태 변경",
    "item.auto",
    "requiredFields={requiredFields}",
    "updateWithdrawal(item.key",
    "updateTransfer(item.key",
  ]);
  assertIncludesAll(serviceSource, [
    "getWithdrawalCompletionChecklistItems",
    "getTransferCompletionChecklistItems",
  ]);
  assert.doesNotMatch(workspaceSource, /<CheckField label="메이크에듀 퇴원처리" checked=\\{Boolean\\(withdrawal\\.makeeduWithdrawalDone\\)\\}/);
  assert.doesNotMatch(workspaceSource, /<CheckField label="메이크에듀 전반처리" checked=\\{Boolean\\(transfer\\.makeeduTransferDone\\)\\}/);
});

test("completion blockers mark and focus the exact required field inline", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const targetSource = source.slice(
    source.indexOf("function getCompletionBlockerFocusField"),
    source.indexOf("function blurActiveElementBeforeDialog"),
  );

  assertIncludesAll(targetSource, [
    "function getCompletionBlockerFocusField",
    'return "registration.principalReviewNote"',
    'return "withdrawal.completedLessonHours"',
    'return "transfer.toClassStartSession"',
    'return "wordRetest.firstScore"',
  ]);
  assertIncludesAll(source, [
    "function buildRequiredCompletionFieldSet",
    "function formatCompletionBlockerNotice",
    "function queueCompletionBlockerFocus",
    "setFormDetailStep(getCompletionBlockerFormStep",
    "pendingCompletionFocusRef.current = fieldName",
    "필수값을 확인하세요",
    "data-required-missing={invalid ? \"true\" : undefined}",
    'completionField="withdrawal.teacherOpinion"',
    'completionField="transfer.fromUndistributedTextbooks"',
    'completionField="wordRetest.branch"',
  ]);
  assert.doesNotMatch(source, /OperationCompletionReview|OperationAutoSyncPreview|RegistrationAutoSyncPreview|queueCompletionReviewFocus|queueOperationSyncFocus|완료 전 핵심값|자동 연결|완료 순서/);
});

test("withdrawal completion persists the automatic student-status check", async () => {
  const [workspaceSource, serviceSource] = await Promise.all([
    readSource("src/features/tasks/ops-task-workspace.tsx"),
    readSource("src/features/tasks/ops-task-service.ts"),
  ]);
  const migrationPath = "supabase/migrations/20260526112000_ops_withdrawal_student_status_updated.sql";
  const hasMigration = await pathExists(migrationPath);
  const migrationSource = hasMigration ? await readSource(migrationPath) : "";

  assertIncludesAll(workspaceSource, [
    '{ label: "학생 상태 변경", checked: Boolean(withdrawal.studentStatusUpdated) }',
  ]);
  assertIncludesAll(serviceSource, [
    "studentStatusUpdated?: boolean",
    "studentStatusUpdated: bool(row.student_status_updated)",
    "student_status_updated: Boolean(detail.studentStatusUpdated)",
    "async function markWithdrawalStudentStatusUpdated",
    "student_status_updated: true",
    "await markWithdrawalStudentStatusUpdated(taskId)",
  ]);
  assert.equal(hasMigration, true);
  assertIncludesAll(migrationSource, [
    "alter table public.ops_withdrawal_details",
    "add column if not exists student_status_updated boolean not null default false",
  ]);
});

test("withdrawal form can fill settlement fields from the selected class plan", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");

  assertIncludesAll(source, [
    "buildWithdrawalClassPlanPatch",
    "buildWithdrawalSettlementDefaults",
    "buildWithdrawalTextbookDefaults",
    "function applyWithdrawalClassPlanPatch",
    "const withdrawalClassItem = classItem || selectedWithdrawalClass",
    "const withdrawalTextbooks = classItem ? getClassTextbookOptions(classItem) : withdrawalClassTextbooks",
    "const patch = (buildWithdrawalClassPlanPatch as BuildWithdrawalClassPlanPatch)({ withdrawal, classItem: withdrawalClassItem, classTextbooks: withdrawalTextbooks })",
    'if (options.fillWithdrawal) applyWithdrawalClassPlanPatch(classItem)',
    'applyWithdrawalWorkflowPreset("today_with_class_plan")',
    "selectedWithdrawalClass",
    "withdrawalClassTextbooks",
    'if (patch.withdrawalSession) updateWithdrawal("withdrawalSession", patch.withdrawalSession)',
    'if (patch.completedLessonHours) updateWithdrawal("completedLessonHours", patch.completedLessonHours)',
    'if (patch.fourWeekLessonHours) updateWithdrawal("fourWeekLessonHours", patch.fourWeekLessonHours)',
    'if (patch.undistributedTextbooks) updateWithdrawal("undistributedTextbooks", patch.undistributedTextbooks)',
  ]);
});

test("withdrawal settlement summary shows lesson-hour risk before completion", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const withdrawalSummarySource = source.slice(
    source.indexOf("function WithdrawalClassSettlementSummary"),
    source.indexOf("function getTransferScheduleRiskLabel"),
  );

  assertIncludesAll(source, [
    "function getWithdrawalSettlementRiskLabel",
    "수업시수 확인",
    "수업시수 입력 필요",
    "수업시수 충돌",
  ]);
  assertIncludesAll(withdrawalSummarySource, [
    "const settlementRiskLabel = getWithdrawalSettlementRiskLabel(withdrawal)",
    'Badge variant={settlementRiskLabel === "수업시수 확인" ? "secondary" : "outline"}',
    "{settlementRiskLabel}",
    "진행/4주 기준",
  ]);
});

test("withdrawal settlement summary shows roster status before completion", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const withdrawalSummarySource = source.slice(
    source.indexOf("function WithdrawalClassSettlementSummary"),
    source.indexOf("function getTransferScheduleRiskLabel"),
  );

  assertIncludesAll(source, [
    "function getWithdrawalRosterRiskLabel",
    "hasRosterLink(student, classItem)",
    '"명단 확인"',
    '"명단 연결 필요"',
    '"학생 선택 필요"',
    'const selectedWithdrawalStudent = form.type === "withdrawal" ? findStudent(form.studentId || "") : undefined',
    "student={selectedWithdrawalStudent}",
  ]);
  assertIncludesAll(withdrawalSummarySource, [
    "student?: OpsStudentOption",
    "const rosterRiskLabel = getWithdrawalRosterRiskLabel(student, classItem)",
    'Badge variant={rosterRiskLabel === "명단 확인" ? "secondary" : "outline"}',
    "{rosterRiskLabel}",
    "수업명단",
    "{valueOrDash(student?.label)}",
  ]);
});

test("withdrawal settlement summary shows completion handoff before final checks", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const withdrawalSummarySource = source.slice(
    source.indexOf("function WithdrawalClassSettlementSummary"),
    source.indexOf("function getTransferScheduleRiskLabel"),
  );

  assertIncludesAll(source, [
    "function getWithdrawalCompletionHandoffLabels",
    "명단 제거 예정",
    "명단 확인 필요",
    "퇴원 처리 예정",
  ]);

  assertIncludesAll(withdrawalSummarySource, [
    "const handoffLabels = getWithdrawalCompletionHandoffLabels(student, classItem)",
    "완료 반영",
    "handoffLabels.roster",
    "handoffLabels.status",
  ]);
});

test("transfer form can fill schedule sessions from selected class plans", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");

  assertIncludesAll(source, [
    "buildTransferClassPlanPatch",
    "buildTransferScheduleDefaults",
    "buildTransferTextbookDefaults",
    "function applyTransferScheduleDefaults",
    "function applyTransferTextbookDefaults",
    "function applyTransferClassPlanPatch",
    'const patch = (buildTransferClassPlanPatch as BuildTransferClassPlanPatch)({',
    "const nextTransfer = {",
    'if (options.fillTransferFrom || options.fillTransferTo) applyTransferClassPlanPatch(classItem, options)',
    "수업계획 회차",
    "교재 기준",
    "selectedTransferFromClass",
    "selectedTransferToClass",
    "transferFromClassTextbooks",
    "transferToClassTextbooks",
    'updateTransfer("fromClassEndSession", defaults.fromClassEndSession)',
    'updateTransfer("toClassStartSession", defaults.toClassStartSession)',
    'updateTransfer("fromUndistributedTextbooks", defaults.fromUndistributedTextbooks)',
    'updateTransfer("toUndistributedTextbooks", defaults.toUndistributedTextbooks)',
  ]);
});

test("transfer comparison shows schedule and session collision risk before completion", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const transferComparisonSource = source.slice(
    source.indexOf("function TransferClassComparisonSummary"),
    source.indexOf("type RegistrationSyncItem"),
  );

  assertIncludesAll(source, [
    "function getTransferScheduleRiskLabel",
    "회차 연결",
    "회차 입력 필요",
    "회차 충돌",
    "회차 공백",
    "일정 충돌",
  ]);
  assertIncludesAll(transferComparisonSource, [
    "const scheduleRiskLabel = getTransferScheduleRiskLabel(transfer)",
    "전반 일정 기준",
    'Badge variant={scheduleRiskLabel === "회차 연결" ? "secondary" : "outline"}',
  ]);
});

test("transfer comparison compares from and to class-plan readiness", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const transferComparisonSource = source.slice(
    source.indexOf("function TransferClassComparisonSummary"),
    source.indexOf("type RegistrationSyncItem"),
  );

  assertIncludesAll(source, [
    "function getTransferClassPlanRiskLabel",
    "회차 입력 필요",
    "회차 없음",
    "회차 초과",
    "진도 미배정 회차",
  ]);
  assertIncludesAll(transferComparisonSource, [
    "const fromClassPlanRiskLabel = getTransferClassPlanRiskLabel(fromClass, transfer.fromClassEndSession)",
    "const toClassPlanRiskLabel = getTransferClassPlanRiskLabel(toClass, transfer.toClassStartSession)",
    "const classPlanSummary = (classItem?: OpsClassOption)",
    "수업계획 회차",
    'fromClassPlanRiskLabel === "회차 확인" ? "secondary" : "outline"',
    'toClassPlanRiskLabel === "회차 확인" ? "secondary" : "outline"',
  ]);
});

test("transfer comparison shows roster handoff before completion", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const transferComparisonSource = source.slice(
    source.indexOf("function TransferClassComparisonSummary"),
    source.indexOf("type RegistrationSyncItem"),
  );

  assertIncludesAll(source, [
    "const selectedTransferStudent = form.type === \"transfer\" ? findStudent(form.studentId || \"\") : undefined",
    "student={selectedTransferStudent}",
    "function getTransferRosterRiskLabels",
    "hasRosterLink(student, fromClass)",
    "hasRosterLink(student, toClass)",
    "전 명단 확인",
    "전 명단 연결 필요",
    "후 명단 추가 예정",
    "후 명단 이미 있음",
  ]);

  assertIncludesAll(transferComparisonSource, [
    "const rosterRiskLabels = getTransferRosterRiskLabels(student, fromClass, toClass)",
    "전 수업 명단",
    "후 수업 명단",
  ]);
});

test("withdrawal and transfer rows expose schedule settlement risk before opening detail", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const rowSource = source.slice(
    source.indexOf("function TaskListRow"),
    source.indexOf("function GroupedTaskList"),
  );

  assertIncludesAll(source, [
    "function getOperationRowRiskSummary",
    "getOperationClassPlanRiskLabel(completionBlockers)",
    "getTransferScheduleRiskLabel(transfer)",
    "getWithdrawalSettlementRiskLabel(withdrawal)",
    "전반 회차",
    "퇴원 정산",
    "퇴원회차 입력 필요",
    "미배부 확인",
    "전/후 수업계획 확인",
    "수업계획 확인",
  ]);
  assertIncludesAll(rowSource, [
    "const operationRowRiskSummary = getOperationRowRiskSummary(task, completionBlockers)",
    "aria-label=\"전반 퇴원 처리 상태\"",
    "operationRowRiskSummary.headingLabel",
    "operationRowRiskSummary.primaryLabel",
    "operationRowRiskSummary.secondaryLabel",
    "operationRowRiskSummary.tertiaryLabel",
    "operationRowRiskSummary.quaternaryLabel",
  ]);
});

test("word retest textbook selection starts from the selected class textbooks", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");

  assertIncludesAll(source, [
    "getClassScopedTextbookOptions",
    "wordRetestTextbookOptions",
    "selectedWordRetestClass",
    "classItem.textbookIds.includes(textbook.id)",
    "options={wordRetestTextbookOptions}",
  ]);
});

test("registration textbook selection starts from the selected class textbooks", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");

  assertIncludesAll(source, [
    "registrationTextbookOptions",
    "selectedRegistrationClass",
    'getClassScopedTextbookOptions(textbooks, selectedRegistrationClass, form.textbookId || "")',
    "options={registrationTextbookOptions}",
  ]);
  assert.doesNotMatch(source, /<LinkedSelect label="교재" value=\{form\.textbookId \|\| ""\} options=\{textbooks\} completionField="registration\.textbook"/);
});

test("word retest completion blockers reuse the single class plan textbook", async () => {
  const [workspaceSource, modelSource] = await Promise.all([
    readSource("src/features/tasks/ops-task-workspace.tsx"),
    readSource("src/features/tasks/ops-task-model.js"),
  ]);

  assertIncludesAll(modelSource, [
    "export function getWordRetestEffectiveTextbookId",
    "export function getWordRetestEffectiveBranch",
    "return classSingleTextbookId(classItem)",
    "return classBranch(classItem)",
  ]);
  assertIncludesAll(workspaceSource, [
    "getWordRetestEffectiveTextbookId,",
    "getWordRetestEffectiveBranch,",
    "const wordRetestTextbookId = getWordRetestEffectiveTextbookId(input, { classes })",
    "const wordRetestBranch = getWordRetestEffectiveBranch(input, { classes })",
    "if (!String(wordRetestBranch || \"\").trim()) blockers.push(\"지점\")",
    "if (!hasLinkedRecord(wordRetestTextbookId)) blockers.push(\"교재\")",
    "if (hasLinkedRecord(wordRetestTextbookId) && !findTextbookOption(textbooks, wordRetestTextbookId, indexes)) blockers.push(\"교재\")",
  ]);
  assert.doesNotMatch(workspaceSource, /if \(!String\(wordRetest\.branch \|\| ""\)\.trim\(\)\) blockers\.push\("지점"\)/);
});

test("word retest service completion reuses the single class plan textbook", async () => {
  const serviceSource = await readSource("src/features/tasks/ops-task-service.ts");
  const syncWordRetestSource = serviceSource.slice(
    serviceSource.indexOf("async function syncWordRetestManagementLinks"),
    serviceSource.indexOf("export async function syncOpsTaskManagementLinks"),
  );

  assertIncludesAll(serviceSource, [
    "async function resolveOpsWordRetestTextbook(input: OpsTaskInput, classRow: Row | null)",
    "const textbook = await resolveOpsWordRetestTextbook(input, classRow)",
    "hasManagementReference(input.textbookId, input.textbookTitle, input.classId)",
    "hasManagementReference(wordRetest.branch, input.campus, input.classId)",
    "getSingleClassPlanTextbookId(classRow)",
  ]);
  assert.doesNotMatch(serviceSource, /if \(!hasManagementReference\(input\.textbookId\)\) missingFields\.push\("교재"\)/);
  assert.doesNotMatch(serviceSource, /const textbook = await selectOpsRowById\("textbooks", input\.textbookId \|\| ""\)/);
  assert.doesNotMatch(syncWordRetestSource, /const textbook = await resolveOpsTextbook\(input\.textbookId, input\.textbookTitle \|\| wordRetest\.textbookName\)/);
});

test("word retest score step uses direct status controls for assistant processing", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");

  assertIncludesAll(source, [
    "function WordRetestStatusControls",
    'aria-label="단어 재시험 상태"',
    "WORD_RETEST_STATUSES.map",
    "aria-pressed={value === status.value}",
    "onChange(status.value)",
    'completionField="wordRetest.firstScore"',
    'requiredFieldProps("wordRetest.firstScore")',
    "<WordRetestStatusControls",
    'if (value === "absent")',
  ]);
  assert.doesNotMatch(source, /getWordRetestCompletionReviewItems|wordRetestCompletionReviewItems|OperationCompletionReview/);
});

test("word retest request step previews assistant handoff before completion", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const basicSource = source.slice(
    source.indexOf('if (step === "word_retest_basic")'),
    source.indexOf('if (step === "word_retest_scope")'),
  );
  const summarySource = source.slice(
    source.indexOf("function WordRetestRequestHandoffSummary"),
    source.indexOf("function WordRetestQueueBar"),
  );

  assertIncludesAll(source, [
    "function getWordRetestRosterRiskLabel",
    "hasRosterLink(student, classItem)",
    "명단 확인",
    "명단 연결 필요",
    "function WordRetestRequestHandoffSummary",
    "getWordRetestExecutionSummary(input, { today })",
  ]);
  assertIncludesAll(basicSource, [
    "<WordRetestRequestHandoffSummary",
    "input={form}",
    "student={selectedWordRetestStudent}",
    "classItem={selectedWordRetestClass}",
    "teacher={findTeacher(wordRetest.teacherId || \"\")}",
    "today={operationTodayKey}",
  ]);
  assertIncludesAll(summarySource, [
    'aria-label="단어 재시험 실행 기준"',
    "실행 큐",
    "명단",
    "지점",
    "선생님",
    "scopeLabel",
    "응시일시 필요",
    "범위 입력 필요",
  ]);
});

test("word retest absent tasks expose a teacher rerequest action", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");

  assertIncludesAll(source, [
    "buildWordRetestRerequestDraft",
    "function openWordRetestRerequest",
    "isWordRetestRerequestable",
    "미응시 재요청",
    "setEditingTask(null)",
    "setFormDetailStep(getDefaultFormDetailStep(\"word_retest\"))",
    "openWordRetestRerequest(selectedTaskFresh)",
    "buildWordRetestRerequestDraft(task, { nextTestAt: dueTomorrowValue })",
  ]);
});

test("word retest teacher view keeps rerequestable absent tasks visible", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const visibleTasksSource = source.slice(
    source.indexOf("const visibleTasks = useMemo"),
    source.indexOf("const calendarItems = useMemo"),
  );

  assertIncludesAll(visibleTasksSource, [
    "const isWordRetestTeacherRerequestTask = isWordRetestWorkspace && wordRetestMode === \"teacher\" && isWordRetestRerequestable(task)",
    "if (!showClosed && !isOpenTask(task) && !isWordRetestAssistantExecutionTask && !isWordRetestTeacherRerequestTask) return false",
    "if (wordRetestMode === \"teacher\" && !isTeacherWordRetest(task, currentUserId, currentUserLabel)) return false",
  ]);
});

test("word retest teacher view owns its queue and ignores hidden assistant branch filter", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const visibleTasksSource = source.slice(
    source.indexOf("const visibleTasks = useMemo"),
    source.indexOf("const calendarItems = useMemo"),
  );

  assertIncludesAll(source, [
    "type WordRetestTeacherQueueMode",
    "const WORD_RETEST_TEACHER_QUEUE_ITEMS",
    "function WordRetestTeacherQueueBar",
    'aria-label="선생님 단어 재시험 큐"',
    'const [wordRetestTeacherQueue, setWordRetestTeacherQueue] = useState<WordRetestTeacherQueueMode>("all")',
    "function isWordRetestInTeacherQueue",
    "const wordRetestTeacherQueueCounts = useMemo",
    "<WordRetestTeacherQueueBar",
    "value={wordRetestTeacherQueue}",
    "counts={wordRetestTeacherQueueCounts}",
    "onChange={setWordRetestTeacherQueue}",
  ]);
  assertIncludesAll(visibleTasksSource, [
    'if (wordRetestMode === "assistant" && !isWordRetestInBranchQueue(task, wordRetestBranch)) return false',
    'if (wordRetestMode === "teacher" && !isTeacherWordRetest(task, currentUserId, currentUserLabel)) return false',
    'if (wordRetestMode === "teacher" && !isWordRetestInTeacherQueue(task, wordRetestTeacherQueue)) return false',
  ]);
  assert.doesNotMatch(visibleTasksSource, /if \(isWordRetestWorkspace\) \{\s*if \(!isWordRetestInBranchQueue\(task, wordRetestBranch\)\) return false/);
});

test("word retest teacher rows expose inline rerequest action", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const workspaceRenderSource = source.slice(
    source.indexOf("<CalendarList"),
    source.indexOf("<Dialog open={formOpen}"),
  );
  const rowSource = source.slice(
    source.indexOf("function TaskListRow"),
    source.indexOf("function GroupedTaskList"),
  );
  const groupedListSource = source.slice(
    source.indexOf("function GroupedTaskList"),
    source.indexOf("function loadCalendarRows"),
  );

  assertIncludesAll(source, [
    "onWordRetestRerequest={(task) => openWordRetestRerequest(task)}",
    "wordRetestTeacherMode={isWordRetestWorkspace && wordRetestMode === \"teacher\"}",
  ]);
  assertIncludesAll(workspaceRenderSource, [
    "onWordRetestRerequest={(task) => openWordRetestRerequest(task)}",
    "wordRetestTeacherMode={isWordRetestWorkspace && wordRetestMode === \"teacher\"}",
  ]);
  assertIncludesAll(rowSource, [
    "wordRetestTeacherMode",
    "onWordRetestRerequest",
    "const shouldShowWordRetestRerequest = wordRetestTeacherMode && isWordRetestRerequestable(task)",
    "{shouldShowWordRetestRerequest && (",
    'aria-label={`${task.title}: 미응시 재요청`}',
    "onWordRetestRerequest?.(task)",
  ]);
  assertIncludesAll(groupedListSource, [
    "onWordRetestRerequest",
    "wordRetestTeacherMode",
    "onWordRetestRerequest={onWordRetestRerequest}",
    "wordRetestTeacherMode={wordRetestTeacherMode}",
  ]);
});

test("word retest assistant queue keeps closed score and absent work visible", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const visibleTasksSource = source.slice(
    source.indexOf("const visibleTasks = useMemo"),
    source.indexOf("const calendarItems = useMemo"),
  );

  assertIncludesAll(visibleTasksSource, [
    "const isWordRetestAssistantExecutionTask = isWordRetestWorkspace && wordRetestMode === \"assistant\" && isWordRetestInExecutionQueue(task, wordRetestQueue, wordRetestExecutionOptions)",
    "if (!showClosed && !isOpenTask(task) && !isWordRetestAssistantExecutionTask && !isWordRetestTeacherRerequestTask) return false",
    "if (wordRetestMode === \"assistant\" && !isWordRetestInExecutionQueue(task, wordRetestQueue, wordRetestExecutionOptions)) return false",
  ]);
  assert.doesNotMatch(visibleTasksSource, /isWordRetestDoneQueueTask/);
});

test("word retest assistant queue exposes inline execution actions", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");

  assertIncludesAll(source, [
    "isWordRetestScoreValue",
    "buildWordRetestAssistantActionPatch",
    "type WordRetestBranchMode",
    "const WORD_RETEST_BRANCH_ITEMS",
    "const WORD_RETEST_QUICK_SCORE_PRESETS = [\"100\"]",
    "function WordRetestBranchBar",
    'aria-label="단어 재시험 지점"',
    "wordRetestBranch",
    "setWordRetestBranch",
    "isWordRetestInBranchQueue(task, wordRetestBranch)",
    "getWordRetestAssistantQuickActions",
    "getWordRetestExecutionSummary",
    "function changeWordRetestAssistantAction",
    "quickWordRetestScore",
    "setQuickWordRetestScore",
    "action.kind === \"quick_score\"",
    "action.score",
    "점수는 0~100 숫자로 입력하세요.",
    "!isWordRetestScoreValue(action.score)",
    "aria-label={`${task.title}: 1차 점수 빠른 입력`}",
    "aria-label={`${task.title}: ${score}점 바로 저장`}",
    "onAction({ ...action, score })",
    "aria-label={`${task.title}: 점수 저장`}",
    "onAction({ ...action, score: quickWordRetestScore })",
    "const actionPatch = buildWordRetestAssistantActionPatch(task, action)",
    "if (!actionPatch)",
    "wordRetest: actionPatch.wordRetest",
    "wordRetestAssistantMode={isWordRetestWorkspace && wordRetestMode === \"assistant\"}",
    "onWordRetestAssistantAction={(task, action) => void changeWordRetestAssistantAction(task, action)}",
    "const wordRetestAssistantActions = wordRetestAssistantMode && task.type === \"word_retest\"",
    "const shouldShowWordRetestExecutionSummary = task.type === \"word_retest\" && (wordRetestAssistantMode || showOperationSourceLink)",
    "const wordRetestExecutionSummary = shouldShowWordRetestExecutionSummary",
    "onAction={(action) => onWordRetestAssistantAction?.(task, action)}",
    'aria-label="단어 재시험 실행 상태"',
    "wordRetestExecutionSummary.stageLabel",
    "wordRetestExecutionSummary.scoreLabel",
    "wordRetestExecutionSummary.branchLabel",
    "wordRetestExecutionSummary.testAtLabel",
    "wordRetestExecutionSummary.teacherLabel",
    "wordRetestExecutionSummary.scopeLabel",
    "openEdit(task, [\"점수\"])",
    "clearScores",
    'status: "done"',
    'action.status === "done" ? "default"',
    "action.label",
  ]);
});

test("word retest assistant detail keeps execution actions available after opening a task", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const detailStateSource = source.slice(
    source.indexOf("const selectedTaskFresh"),
    source.indexOf("const focusQuickAdd"),
  );
  const detailDialogSource = source.slice(
    source.indexOf("<Dialog open={detailOpen}"),
    source.indexOf("<details className=\"rounded-lg border p-4\" open={selectedTaskFresh.comments.length > 0}>"),
  );

  assertIncludesAll(source, [
    "function WordRetestAssistantActionControls",
    "actions: WordRetestAssistantQuickAction[]",
    "onAction: (action: WordRetestAssistantQuickAction) => void",
    "WORD_RETEST_QUICK_SCORE_PRESETS.map((score)",
  ]);
  assertIncludesAll(detailStateSource, [
    "const selectedWordRetestAssistantActions = selectedTaskFresh && isWordRetestWorkspace && wordRetestMode === \"assistant\" && selectedTaskFresh.type === \"word_retest\"",
    "getWordRetestAssistantQuickActions(selectedTaskFresh, wordRetestExecutionOptions)",
  ]);
  assertIncludesAll(detailDialogSource, [
    "selectedWordRetestAssistantActions.length > 0 &&",
    "<WordRetestAssistantActionControls",
    "actions={selectedWordRetestAssistantActions}",
    "onAction={(action) => void changeWordRetestAssistantAction(selectedTaskFresh, action)}",
    "disabled={saving}",
  ]);
});

test("word retest completion guards invalid score strings before sync", async () => {
  const serviceSource = await readSource("src/features/tasks/ops-task-service.ts");
  const scoreSource = serviceSource.slice(
    serviceSource.indexOf("function nullableWordRetestScore"),
    serviceSource.indexOf("function stripMissingMigrationColumns"),
  );
  const readinessSource = serviceSource.slice(
    serviceSource.indexOf("function hasWordRetestScore"),
    serviceSource.indexOf("function isWordRetestAbsent"),
  );

  assertIncludesAll(serviceSource, [
    "isWordRetestScoreValue",
  ]);
  assertIncludesAll(scoreSource, [
    "function nullableWordRetestScore",
    "if (!isWordRetestScoreValue(trimmed)) return null",
    "first_score: nullableWordRetestScore(detail.firstScore)",
    "second_score: nullableWordRetestScore(detail.secondScore)",
    "third_score: nullableWordRetestScore(detail.thirdScore)",
  ]);
  assertIncludesAll(readinessSource, [
    "isWordRetestScoreValue(score)",
  ]);
});

test("word retest assistant opens on the all-work execution queue", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const queueItemsSource = source.slice(
    source.indexOf("const WORD_RETEST_QUEUE_ITEMS"),
    source.indexOf("const WORD_RETEST_BRANCH_ITEMS"),
  );
  const stateSource = source.slice(
    source.indexOf("const [wordRetestMode"),
    source.indexOf("const [formOpen"),
  );

  assertIncludesAll(queueItemsSource, [
    '{ key: "all", label: "전체" }',
    '{ key: "today", label: "오늘 응시" }',
    '{ key: "needs_score", label: "점수 입력" }',
    '{ key: "done", label: "완료" }',
  ]);
  assert.ok(
    queueItemsSource.indexOf('{ key: "all", label: "전체" }') <
      queueItemsSource.indexOf('{ key: "today", label: "오늘 응시" }'),
    "assistant queue should expose 전체 before narrower stage filters",
  );
  assertIncludesAll(stateSource, [
    'const [wordRetestQueue, setWordRetestQueue] = useState<WordRetestQueueMode>("all")',
  ]);
});

test("word retest detail keeps branch status teacher and request note visible", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");

  assertIncludesAll(source, [
    "function getWordRetestStatusLabel",
    "WORD_RETEST_STATUSES.find((status) => status.value === value)?.label",
    '<OptionalInfo label="지점" value={wordRetest.branch} />',
    '<OptionalInfo label="선생님" value={wordRetest.teacherName} />',
    '<OptionalInfo label="상태" value={getWordRetestStatusLabel(wordRetest.retestStatus || "")} />',
    '<OptionalInfo label="요청사항" value={wordRetest.requestNote} />',
  ]);
});

test("operation create forms expose quick presets for one-minute entry", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");

  assertIncludesAll(source, [
    "function OperationQuickPresetBar",
    "buildRegistrationWorkflowPresetPatch",
    "buildWithdrawalWorkflowPresetPatch",
    "buildTransferWorkflowPresetPatch",
    "buildWordRetestWorkflowPresetPatch",
    "function applyRegistrationWorkflowPreset",
    "function applyWithdrawalWorkflowPreset",
    "function applyTransferWorkflowPreset",
    "function applyWordRetestWorkflowPreset",
    'aria-label="빠른 입력"',
    "dueTodayValue={dueTodayValue}",
    "dueTomorrowValue={dueTomorrowValue}",
    '오늘 문의',
    '오늘 레벨테스트',
    '오늘 전화상담',
    '오늘 방문상담',
    '오늘 상담',
    '등록 신청',
    '수납 진행',
    'form.type === "registration" && (',
    '오늘 시작일',
    '오늘 퇴원/정산',
    '오늘 퇴원',
    '오늘 전반/회차',
    '오늘 종료/내일 시작',
    '오늘 본관',
    '오늘 별관',
    '내일 본관',
    '내일 별관',
    'inquiryNowValue: dateTimeInputValueFromDate(new Date())',
    'applyRegistrationWorkflowPreset("phone_inquiry_today")',
    'applyRegistrationWorkflowPreset("chat_inquiry_today")',
    'applyRegistrationWorkflowPreset("walk_in_inquiry_today")',
    'updateRegistration("pipelineStatus", patch.pipelineStatus)',
    'updateRegistration("inquiryAt", patch.inquiryAt)',
    'updateRegistration("inquiryChannel", patch.inquiryChannel)',
    'updateRegistration("levelTestAt", patch.levelTestAt)',
    'updateRegistration("phoneConsultationAt", patch.phoneConsultationAt)',
    'updateRegistration("visitConsultationAt", patch.visitConsultationAt)',
    'updateRegistration("consultationAt", patch.consultationAt)',
    'updateWithdrawal("withdrawalDate", patch.withdrawalDate)',
    'updateWithdrawal("withdrawalSession", patch.withdrawalSession)',
    'updateWithdrawal("completedLessonHours", patch.completedLessonHours)',
    'updateWithdrawal("fourWeekLessonHours", patch.fourWeekLessonHours)',
    'updateWithdrawal("undistributedTextbooks", patch.undistributedTextbooks)',
    'updateWithdrawal("withdrawalDate", dateInputValue(dueTodayValue))',
    'updateTransfer("fromClassEndDate", dateInputValue(dueTodayValue))',
    'updateTransfer("toClassStartDate", dateInputValue(dueTomorrowValue))',
    'updateTransfer("fromClassEndDate", patch.fromClassEndDate)',
    'updateTransfer("toClassStartDate", patch.toClassStartDate)',
    'updateTransfer("fromClassEndSession", patch.fromClassEndSession)',
    'updateTransfer("toClassStartSession", patch.toClassStartSession)',
    'updateTransfer("fromUndistributedTextbooks", patch.fromUndistributedTextbooks)',
    'updateTransfer("toUndistributedTextbooks", patch.toUndistributedTextbooks)',
    'updateWordRetest("testAt", patch.testAt)',
    'updateWordRetest("branch", patch.branch)',
  ]);

  assert.doesNotMatch(source, /form\.type === "registration" && editingTask/);
  assert.doesNotMatch(source, /추천/);
});

test("operation create forms focus the first student lookup for one-minute entry", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const linkedSelectSource = source.slice(
    source.indexOf("function LinkedSelect"),
    source.indexOf("function ProfileSelect"),
  );
  const withdrawalBasicSource = source.slice(
    source.indexOf('if (step === "withdrawal_basic")'),
    source.indexOf('if (step === "withdrawal_reason")'),
  );
  const transferBasicSource = source.slice(
    source.indexOf('if (step === "transfer_basic")'),
    source.indexOf('if (step === "transfer_schedule")'),
  );
  const wordRetestBasicSource = source.slice(
    source.indexOf('if (step === "word_retest_basic")'),
    source.indexOf('if (step === "word_retest_scope")'),
  );

  assertIncludesAll(linkedSelectSource, [
    "autoFocus?: boolean",
    "autoFocus={autoFocus}",
    "autoFocus={autoFocus && !shouldShowLinkedSearch}",
  ]);
  assert.match(withdrawalBasicSource, /<LinkedSelect label="학생"[\s\S]*autoFocus[\s\S]*completionField="withdrawal\.student"/);
  assert.match(transferBasicSource, /<LinkedSelect label="학생"[\s\S]*autoFocus[\s\S]*completionField="transfer\.student"/);
  assert.match(wordRetestBasicSource, /<LinkedSelect label="학생"[\s\S]*autoFocus[\s\S]*completionField="wordRetest\.student"/);
});

test("registration phone and visit consultations stay visible in task schedules", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const scheduleSource = source.slice(
    source.indexOf("function getTaskScheduleItems"),
    source.indexOf("function hasTaskSchedule"),
  );

  assertIncludesAll(scheduleSource, [
    'addTaskScheduleItem(items, "전화상담", task.registration?.phoneConsultationAt)',
    'addTaskScheduleItem(items, "방문상담", task.registration?.visitConsultationAt)',
    'addTaskScheduleItem(items, "상담", task.registration?.consultationAt)',
    'addTaskScheduleItem(items, "레벨테스트", task.registration?.levelTestAt)',
  ]);
});

test("transfer class-plan quick preset lives in the schedule step", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const basicStart = source.indexOf('if (step === "transfer_basic")');
  const scheduleStart = source.indexOf('if (step === "transfer_schedule")');
  const checksStart = source.indexOf('if (step === "transfer_checks")');

  assert.notEqual(basicStart, -1);
  assert.notEqual(scheduleStart, -1);
  assert.notEqual(checksStart, -1);

  const basicStep = source.slice(basicStart, scheduleStart);
  const scheduleStep = source.slice(scheduleStart, checksStart);

  assert.doesNotMatch(basicStep, /오늘 전반\/회차/);
  assert.match(scheduleStep, /오늘 전반\/회차/);
  assert.ok(
    scheduleStep.indexOf('label: "오늘 전반/회차"') < scheduleStep.indexOf('<LinkedSelect label="전 수업"'),
    "전반 회차 프리셋은 전/후 수업 선택 필드 위 빠른 입력에 있어야 한다",
  );
});

test("operation detail summaries show schedule and settlement fields without reopening forms", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const detailSource = source.slice(source.indexOf("function TypeDetail"));

  assertIncludesAll(detailSource, [
    '<OptionalInfo label="문의일시" value={dateLabel(registration.inquiryAt || "")} />',
    '<OptionalInfo label="전화상담" value={dateLabel(registration.phoneConsultationAt || "")} />',
    '<OptionalInfo label="방문상담" value={dateLabel(registration.visitConsultationAt || "")} />',
    '<OptionalInfo label="상담" value={dateLabel(registration.consultationAt || "")} />',
    '<OptionalInfo label="상담 담당자" value={registration.counselor} />',
    '<OptionalInfo label="레벨테스트" value={dateLabel(registration.levelTestAt || "")} />',
    '<OptionalInfo label="레벨테스트 장소" value={registration.levelTestPlace} />',
    '<OptionalInfo label="레벨테스트 자료" value={registration.levelTestMaterialLink} />',
    '<OptionalInfo label="수업 시작회차" value={registration.classStartSession} />',
    '<OptionalInfo label="요청 사항" value={registration.requestNote} />',
    '<OptionalInfo label="학년" value={withdrawal.schoolGrade} />',
    '<OptionalInfo label="선생님" value={withdrawal.teacherName} />',
    '<OptionalInfo label="진행 수업시수" value={withdrawal.completedLessonHours} />',
    '<OptionalInfo label="4주 기준 수업시수" value={withdrawal.fourWeekLessonHours} />',
    '<OptionalInfo label="미배부 교재" value={withdrawal.undistributedTextbooks} />',
    '<OptionalInfo label="선생님 의견" value={withdrawal.teacherOpinion} />',
    '<OptionalInfo label="전 수업" value={transfer.fromClassName} />',
    '<OptionalInfo label="후 수업" value={transfer.toClassName} />',
    '<OptionalInfo label="전 선생님" value={transfer.fromTeacherName} />',
    '<OptionalInfo label="후 선생님" value={transfer.toTeacherName} />',
    '<OptionalInfo label="전 수업 종료회차" value={transfer.fromClassEndSession} />',
    '<OptionalInfo label="후 수업 시작회차" value={transfer.toClassStartSession} />',
    '<OptionalInfo label="전 미배부 교재" value={transfer.fromUndistributedTextbooks} />',
    '<OptionalInfo label="후 미배부 교재" value={transfer.toUndistributedTextbooks} />',
  ]);
});

test("registration level test keeps manual principal placement without recommendations", async () => {
  const migrationPath = "supabase/migrations/20260526110000_ops_registration_principal_placement.sql";
  assert.equal(await pathExists(migrationPath), true);

  const [workspaceSource, serviceSource, migrationSource] = await Promise.all([
    readSource("src/features/tasks/ops-task-workspace.tsx"),
    readSource("src/features/tasks/ops-task-service.ts"),
    readSource(migrationPath),
  ]);
  const registrationTestSource = workspaceSource.slice(
    workspaceSource.indexOf('if (step === "registration_test")'),
    workspaceSource.indexOf('if (step === "registration_start")'),
  );
  const registrationStartSource = workspaceSource.slice(
    workspaceSource.indexOf('if (step === "registration_start")'),
    workspaceSource.indexOf('if (step === "registration_checks")'),
  );

  assertIncludesAll(registrationTestSource, [
    "levelTestResult",
    "principalReviewNote",
    'label="레벨테스트 결과"',
    'label="원장 분석"',
  ]);
  assertIncludesAll(registrationStartSource, [
    "principalPlacementChecked",
    "원장 반배정",
  ]);
  assert.match(
    workspaceSource,
    /\{ key: "registration_start", label: "원장 반배정" \}/,
  );
  assert.doesNotMatch(
    workspaceSource,
    /\{ key: "registration_start", label: "수업등록" \}/,
  );
  assertIncludesAll(workspaceSource, [
    '"원장 분석": "원장 분석 입력"',
    'if (blocker === "원장 분석") return "registration.principalReviewNote"',
  ]);
  assertIncludesAll(serviceSource, [
    "levelTestResult?: string",
    "principalReviewNote?: string",
    "principalPlacementChecked?: boolean",
    "level_test_result",
    "principal_review_note",
    "principal_placement_checked",
    'missingFields.push("원장 분석")',
    '"원장 분석"',
  ]);
  assertIncludesAll(migrationSource, [
    "level_test_result",
    "principal_review_note",
    "principal_placement_checked",
  ]);
  assert.doesNotMatch(`${registrationTestSource}\n${registrationStartSource}`, /수업 추천|시작회차 추천|recommendedClass|recommendedStartSession/);
});

test("registration start step checks selected class-plan session without recommendations", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const registrationStartSource = source.slice(
    source.indexOf('if (step === "registration_start")'),
    source.indexOf('if (step === "registration_checks")'),
  );

  assertIncludesAll(source, [
    "function getRegistrationStartSessionRiskLabel",
    "function RegistrationClassStartSummary",
    "const riskLabel = getRegistrationStartSessionRiskLabel(classItem, registration.classStartSession)",
    "등록 시작 기준",
    "수업 시작회차",
    "시작회차 없음",
    "진도 미배정 회차",
  ]);
  assertIncludesAll(registrationStartSource, [
    "<RegistrationClassStartSummary",
    "registration={registration}",
    "classItem={selectedRegistrationClass}",
    "classTextbooks={registrationClassTextbooks}",
  ]);
  assert.doesNotMatch(registrationStartSource, /수업 추천|시작회차 추천|recommendedClass|recommendedStartSession|자동 추천/);
});

test("registration start step shows roster and textbook handoff state without recommendations", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const registrationSummarySource = source.slice(
    source.indexOf("function RegistrationClassStartSummary"),
    source.indexOf("function getWithdrawalSessionRiskLabel"),
  );
  const registrationStartSource = source.slice(
    source.indexOf('if (step === "registration_start")'),
    source.indexOf('if (step === "registration_checks")'),
  );

  assertIncludesAll(source, [
    "function getRegistrationRosterRiskLabel",
    "function getRegistrationTextbookIssueRiskLabel",
    "hasRosterLink(student, classItem)",
    '"명단 추가 예정"',
    '"이미 명단 연결"',
    '"학생 생성 후 명단 추가"',
    '"교재 청구 준비"',
    '"교재 선택 필요"',
    '"수업계획 교재 필요"',
    'const selectedRegistrationStudent = form.type === "registration" ? findStudent(form.studentId || "") : undefined',
  ]);
  assertIncludesAll(registrationSummarySource, [
    "student?: OpsStudentOption",
    "studentName?: string",
    "selectedTextbookId?: string",
    "const rosterRiskLabel = getRegistrationRosterRiskLabel(student, classItem, studentName)",
    "const textbookIssueRiskLabel = getRegistrationTextbookIssueRiskLabel(classTextbooks, selectedTextbookId)",
    'Badge variant={rosterRiskLabel === "이미 명단 연결" || rosterRiskLabel === "명단 추가 예정" ? "secondary" : "outline"}',
    'Badge variant={textbookIssueRiskLabel === "교재 청구 준비" ? "secondary" : "outline"}',
    "수업명단",
    "교재 청구",
  ]);
  assertIncludesAll(registrationStartSource, [
    "student={selectedRegistrationStudent}",
    "studentName={form.studentName}",
    "selectedTextbookId={form.textbookId}",
  ]);
  assert.doesNotMatch(registrationStartSource, /수업 추천|시작회차 추천|recommendedClass|recommendedStartSession|자동 추천/);
});

test("registration start step keeps principal analysis visible before manual placement", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const registrationStartSource = source.slice(
    source.indexOf('if (step === "registration_start")'),
    source.indexOf('if (step === "registration_checks")'),
  );

  assertIncludesAll(source, [
    "function getRegistrationPrincipalAnalysisRiskLabel",
    "function RegistrationPrincipalPlacementSummary",
    "getRegistrationPrincipalQueueSummary",
    "const registrationPrincipalQueueSummary = task.type === \"registration\" ? getRegistrationPrincipalQueueSummary(task) : null",
    "aria-label=\"등록 원장 배정 상태\"",
    "registrationPrincipalQueueSummary.testAtLabel",
    "registrationPrincipalQueueSummary.materialLabel",
    "registrationPrincipalQueueSummary.resultLabel",
    "registrationPrincipalQueueSummary.analysisLabel",
    "registrationPrincipalQueueSummary.placementLabel",
    "원장 분석 기준",
    "분석 입력 필요",
    "분석 확인",
    "반배정 확인 필요",
    "반배정 확인",
    "레벨테스트 결과",
  ]);
  assertIncludesAll(registrationStartSource, [
    "<RegistrationPrincipalPlacementSummary",
    "registration={registration}",
    "studentName={form.studentName}",
  ]);
  assert.doesNotMatch(registrationStartSource, /수업 추천|시작회차 추천|recommendedClass|recommendedStartSession|자동 추천/);
});

test("completion blocker actions focus the exact field to fix", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const submitSource = source.slice(
    source.indexOf("const submitForm = async"),
    source.indexOf("const completeOperationStatus"),
  );

  assertIncludesAll(source, [
    "function getCompletionBlockerFocusField",
    "const pendingCompletionFocusRef = useRef(\"\")",
    "function queueCompletionBlockerFocus",
    "setCompletionFocusRequest((request) => request + 1)",
    "pendingCompletionFocusRef.current = fieldName",
    "queueCompletionBlockerFocus(task.type, blockers)",
    "queueCompletionBlockerFocus(form.type, [firstBlocker])",
    'data-completion-field={completionField}',
    'completionField="registration.studentName"',
    'if (blocker === "학생") return "registration.studentName"',
    'completionField="registration.classStartSession"',
    'completionField="withdrawal.withdrawalSession"',
    'completionField="withdrawal.completedLessonHours"',
    'if (blocker === "수업시수 충돌") return "withdrawal.completedLessonHours"',
    'completionField="transfer.fromClassEndSession"',
    'completionField="transfer.toClassStartSession"',
    'if (blocker === "회차 충돌" || blocker === "회차 공백") return "transfer.toClassStartSession"',
    'completionField="wordRetest.testAt"',
  ]);
  assertIncludesAll(submitSource, [
    "if (completionBlockers.length > 0) {",
    "setFormDetailStep(getCompletionBlockerFormStep(payload.type, completionBlockers) || getDefaultFormDetailStep(payload.type))",
    "queueCompletionBlockerFocus(payload.type, completionBlockers)",
    "setFormCompletionBlockers(completionBlockers)",
  ]);
  assert.doesNotMatch(source, /if \(blocker === "전 수업 종료회차" \|\| blocker === "회차 충돌" \|\| blocker === "회차 공백"\) return "transfer\.fromClassEndSession"/);
});

test("class plan completion blockers open the exact lesson-design section", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");

  assertIncludesAll(source, [
    "function getClassPlanBlockerHref",
    "\"수업계획 회차\": \"lesson-design-periods\"",
    "\"전 수업계획 회차\": \"lesson-design-periods\"",
    "\"후 수업계획 회차\": \"lesson-design-periods\"",
    "\"수업계획 진도\": \"lesson-design-board\"",
    "\"전 수업계획 진도\": \"lesson-design-board\"",
    "\"후 수업계획 진도\": \"lesson-design-board\"",
    "\"수업계획 교재\": \"lesson-design-textbooks\"",
    "\"전 수업계획 교재\": \"lesson-design-textbooks\"",
    "\"후 수업계획 교재\": \"lesson-design-textbooks\"",
    'if (task.type === "transfer" && blocker.startsWith("전 ")) return task.transfer?.fromClassId || ""',
    'if (task.type === "transfer" && blocker.startsWith("후 ")) return task.transfer?.toClassId || task.classId || ""',
    'return `/admin/curriculum/lesson-design?${params.toString()}`',
    "const classPlanHref = getClassPlanBlockerHref(task, blocker)",
    "classPlanHref ? (",
    "<a",
    "href={classPlanHref}",
    "aria-label={`${task.title}: ${blocker} ${needLabel} 수업계획에서 바로 수정`}",
  ]);
});

test("form completion blockers route class-plan gaps directly to lesson design", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");

  assertIncludesAll(source, [
    "const formCompletionBlockerTarget: CompletionBlockerTaskTarget = {",
    'id: editingTask?.id || "form-completion"',
    "type: form.type",
    "classId: form.classId",
    "registration: form.registration",
    "withdrawal: form.withdrawal",
    "transfer: form.transfer",
    "getClassPlanBlockerHref(formCompletionBlockerTarget, firstBlocker)",
    "function getClassPlanBlockerSessionOrder",
    "params.set(\"sessionOrder\", String(sessionOrder))",
    "getClassPlanSessionOrderValue(task.registration?.classStartSession)",
    "getClassPlanSessionOrderValue(task.withdrawal?.withdrawalSession)",
    "getClassPlanSessionOrderValue(task.transfer?.fromClassEndSession)",
    "getClassPlanSessionOrderValue(task.transfer?.toClassStartSession)",
    "수업계획에서 바로 수정",
    "const firstBlockerHref = getClassPlanBlockerHref(formCompletionBlockerTarget, firstBlocker)",
    "href={firstBlockerHref}",
  ]);
});

test("transfer creation starts with same-day quick schedule presets", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const transferBasicSource = source.slice(
    source.indexOf('if (step === "transfer_basic")'),
    source.indexOf('if (step === "transfer_schedule")'),
  );

  assertIncludesAll(transferBasicSource, [
    "<OperationQuickPresetBar",
    '오늘 종료/내일 시작',
    '오늘 종료',
    '내일 시작',
    'updateTransfer("fromClassEndDate", dateInputValue(dueTodayValue))',
    'updateTransfer("toClassStartDate", dateInputValue(dueTomorrowValue))',
    'className="md:col-span-2"',
    '<LinkedSelect label="학생"',
  ]);
  assert.ok(
    transferBasicSource.indexOf("<OperationQuickPresetBar") <
      transferBasicSource.indexOf('<LinkedSelect label="학생"'),
    "transfer quick presets should be available before the first field",
  );
});

test("/admin/tasks removes the legacy sample table implementation", async () => {
  for (const pathname of [
    "src/app/admin/tasks/components/add-task-modal.tsx",
    "src/app/admin/tasks/components/columns.tsx",
    "src/app/admin/tasks/components/data-table.tsx",
    "src/app/admin/tasks/components/data-table-toolbar.tsx",
    "src/app/admin/tasks/components/user-nav.tsx",
    "src/app/admin/tasks/data/tasks.json",
    "src/app/admin/tasks/data/data.tsx",
    "src/app/admin/tasks/data/schema.ts",
  ]) {
    assert.equal(await pathExists(pathname), false, pathname);
  }
});

test("todo workspace supports board calendar filters and legacy query links", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");

  assertIncludesAll(source, [
    '{ key: "calendar", label: "',
    '{ key: "board", label: "',
    "const LEGACY_TODO_VIEW_ROUTES",
    'board: { list: "board" }',
    'mine: { list: "mine" }',
    'if (nextFilter === "mine") return { list: "mine" }',
    'overdue: { list: "filters", filter: "overdue" }',
    'confirmation: { list: "filters", filter: "confirmation" }',
    "function buildTodoBoardColumns",
    'key: "overdue"',
    'key: "today"',
    'key: "mine"',
    'key: "upcoming"',
    'key: "unsorted"',
    'aria-label="',
    "scroll-px-3 snap-x snap-mandatory",
    'grid-flow-col auto-cols-[minmax(78vw,1fr)]',
    'md:grid-cols-[repeat(5,minmax(0,1fr))]',
    "snap-start",
    'columns.map((column)',
    "비어 있음",
    "function getCalendarDateState",
    "function sortCalendarDatesForWork",
    "getOpsTaskCalendarItems(actionableTodoTasks).length",
    "tasks={visibleTasks}",
    'if (todoView === "mine") return isOpsTaskActionable(task, { today: todayKey }) && isOpsTaskAssignedToUser(task, currentUserId, currentUserLabel)',
    'mine: actionableTodoTasks.filter((task) => isOpsTaskAssignedToUser(task, currentUserId, currentUserLabel)).length',
    'const deepLinkedTaskId = searchParams.get("taskId") || ""',
    'const deepLinkedTask = taskById.get(deepLinkedTaskId)',
    'syncTaskDeepLink(null)',
    "setSelectedTask(deepLinkedTask)",
    "setDetailOpen(true)",
    "syncTaskDeepLink(task.id)",
    "syncTaskDeepLink(null)",
  ]);

  assert.ok(source.includes(`label: "${ko.board}"`));
  assert.ok(source.includes(`label: "${ko.mine}"`));
  assert.ok(source.includes(`label: "${ko.unassigned}"`));
  assert.ok(source.includes('label: "확인 필요"'));
  assert.ok(source.includes(`aria-label="${ko.todo} ${ko.board}"`));
  assert.ok(source.includes("const todoTaskSource = scopedTasks"));
  assert.match(source, /const HORIZONTAL_TAB_BAR_CLASS = "flex min-w-0 flex-wrap gap-1 overflow-visible sm:flex-nowrap sm:overflow-x-auto/);
  assertIncludesAll(source, [
    'dateState === "today"',
    `? "${ko.today}" : dateState === "overdue"`,
    `? "${ko.overdue}" : "${ko.upcoming}"`,
  ]);
  assert.doesNotMatch(source, /md:overflow-x-auto/);
});

test("todo workspace only shows standalone general tasks", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");

  assertIncludesAll(source, [
    'const workspaceTaskType = isTodoWorkspace ? "general" : scopedTaskType',
    "const workspaceIncludesManagementOptions = true",
    "taskType: workspaceTaskType",
    "includeManagementOptions: workspaceIncludesManagementOptions",
    'const todoScopedTasks = useMemo(() => tasks.filter((task) => task.type === "general"), [tasks])',
    "isTodoWorkspace ? todoScopedTasks : tasks.filter((task) => task.type === scopedTaskType)",
    "const actionableTodoTasks = scopedTasks.filter((task) => isOpsTaskActionable(task, { today: todayKey }))",
    "getOpsTaskCalendarItems(actionableTodoTasks).length",
    "const todoTaskSource = scopedTasks",
  ]);

  assert.doesNotMatch(source, /taskType: scopedTaskType,\n\s+includeManagementOptions: !isTodoWorkspace/);
  assert.doesNotMatch(source, /tasks\.filter\(\(task\) => task\.type === scopedTaskType\),\n\s+\[scopedTaskType, tasks\]/);
  assert.doesNotMatch(source, /isTodoWorkspace \? tasks : tasks\.filter\(\(task\) => task\.type === scopedTaskType\)/);
  assert.doesNotMatch(source, /const openGeneralTasks = scopedTasks\.filter/);
}
);

test("todo unified queue rows link back to each source operation workspace", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const taskListSource = source.slice(
    source.indexOf("function TaskList"),
    source.indexOf("function GroupedTaskList"),
  );
  const boardSource = source.slice(
    source.indexOf("function TodoBoard"),
    source.indexOf("function TaskList({"),
  );
  const renderSource = source.slice(
    source.indexOf("<TodoBoard"),
    source.indexOf("<Dialog open={formOpen}"),
  );

  assertIncludesAll(source, [
    "function getOperationWorkspaceHref",
    'registration: "/admin/registration"',
    'transfer: "/admin/transfer"',
    'withdrawal: "/admin/withdrawal"',
    'word_retest: "/admin/word-retests"',
    'return `${path}?taskId=${encodeURIComponent(task.id)}`',
  ]);
  assertIncludesAll(taskListSource, [
    "showOperationSourceLink",
    "const operationWorkspaceHref = getOperationWorkspaceHref(task)",
    "showOperationSourceLink && operationWorkspaceHref",
    'aria-label={`${task.title} 원천 업무 화면 열기`}',
    "업무 화면",
  ]);
  assertIncludesAll(boardSource, [
    "showOperationSourceLink",
    "const operationWorkspaceHref = getOperationWorkspaceHref(task)",
    "showOperationSourceLink && operationWorkspaceHref",
    'aria-label={`${task.title} 원천 업무 화면 열기`}',
  ]);
  assertIncludesAll(renderSource, [
    "showOperationSourceLink={isTodoWorkspace}",
  ]);
});

test("todo workspace calendar and board counts stay scoped to standalone tasks", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");

  assertIncludesAll(source, [
    "isOpsTaskActionable",
    'const todoScopedTasks = useMemo(() => tasks.filter((task) => task.type === "general"), [tasks])',
    "const actionableTodoTasks = scopedTasks.filter((task) => isOpsTaskActionable(task, { today: todayKey }))",
    "today: actionableTodoTasks.filter((task) => hasOpsTaskCalendarDate(task, todayKey)).length",
    "upcoming: actionableTodoTasks.filter((task) => hasOpsTaskFutureCalendarDate(task, todayKey)).length",
    "board: actionableTodoTasks.length",
    "if (hasQuery) return todoView === \"completed\" ? isClosedOpsTask(task) && !isOpsTaskActionable(task, { today: todayKey }) : isOpsTaskActionable(task, { today: todayKey })",
    "if (todoView === \"today\") return hasOpsTaskCalendarDate(task, todayKey)",
    "if (todoView === \"board\") return isOpsTaskActionable(task, { today: todayKey })",
    "if (!isOpsTaskActionable(task, { today: todayKey })) return false",
    "for (const task of sortTodoTasks(tasks.filter((task) => isOpsTaskActionable(task, { today: todayKey })), todayKey))",
  ]);
  assert.doesNotMatch(source, /const openTodoTasks = scopedTasks\.filter/);
});

test("todo unified queue shows word retest execution state outside assistant mode", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const rowSource = source.slice(
    source.indexOf("function TaskListRow"),
    source.indexOf("function GroupedTaskList"),
  );
  const boardCardSource = source.slice(
    source.indexOf("function TodoBoardCard"),
    source.indexOf("function TaskList({"),
  );

  assertIncludesAll(rowSource, [
    "const shouldShowWordRetestExecutionSummary = task.type === \"word_retest\" && (wordRetestAssistantMode || showOperationSourceLink)",
    "const wordRetestExecutionSummary = shouldShowWordRetestExecutionSummary",
    "getWordRetestExecutionSummary(task, executionOptions)",
    'aria-label="단어 재시험 실행 상태"',
    "wordRetestExecutionSummary.stageLabel",
    "wordRetestExecutionSummary.scoreLabel",
    "wordRetestExecutionSummary.testAtLabel",
  ]);
  assertIncludesAll(boardCardSource, [
    "const wordRetestExecutionSummary = task.type === \"word_retest\"",
    "getWordRetestExecutionSummary(task, { today: todayKey })",
    'aria-label="단어 재시험 실행 상태"',
    "wordRetestExecutionSummary.stageLabel",
    "wordRetestExecutionSummary.scoreLabel",
    "wordRetestExecutionSummary.teacherLabel",
    "wordRetestExecutionSummary.scopeLabel",
  ]);
});

test("todo board cards keep operation scan summaries visible", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const boardCardSource = source.slice(
    source.indexOf("function TodoBoardCard"),
    source.indexOf("function TaskList({"),
  );

  assertIncludesAll(boardCardSource, [
    "const registrationPrincipalQueueSummary = task.type === \"registration\" ? getRegistrationPrincipalQueueSummary(task) : null",
    "const operationRowRiskSummary = getOperationRowRiskSummary(task, completionBlockers)",
    'aria-label="등록 원장 배정 상태"',
    "registrationPrincipalQueueSummary.testAtLabel",
    "registrationPrincipalQueueSummary.materialLabel",
    "registrationPrincipalQueueSummary.resultLabel",
    "registrationPrincipalQueueSummary.analysisLabel",
    "registrationPrincipalQueueSummary.placementLabel",
    'aria-label="전반 퇴원 처리 상태"',
    "operationRowRiskSummary.headingLabel",
    "operationRowRiskSummary.primaryLabel",
    "operationRowRiskSummary.secondaryLabel",
    "operationRowRiskSummary.tertiaryLabel",
    "operationRowRiskSummary.quaternaryLabel",
  ]);
});

test("todo board cards advance registration pipeline like list and calendar views", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const boardCardSource = source.slice(
    source.indexOf("function TodoBoardCard"),
    source.indexOf("function TaskList({"),
  );
  const boardSource = source.slice(
    source.indexOf("function TodoBoard({"),
    source.indexOf("function TodoBoardCard"),
  );

  assertIncludesAll(boardSource, [
    "onRegistrationPipelineAdvance",
    "onRegistrationPipelineAdvance={onRegistrationPipelineAdvance}",
  ]);
  assertIncludesAll(boardCardSource, [
    "onRegistrationPipelineAdvance: (task: OpsTask, pipelineStatus: string) => void",
    "const nextRegistrationAction = getNextRegistrationPipelineAction(task)",
    "const primaryOperationAction = nextRegistrationAction || nextAction",
    "const primaryOperationActionBlocked = nextRegistrationAction",
    "nextRegistrationAction.pipelineStatus.startsWith(\"7.\") && completionBlockers.length > 0",
    "onRegistrationPipelineAdvance(task, nextRegistrationAction.pipelineStatus)",
    "primaryOperationAction.label",
  ]);
});

test("todo filter counts follow the same actionable queue as the visible list", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const filterBarSource = source.slice(
    source.indexOf("function TodoFilterBar"),
    source.indexOf("function EmptyTaskState"),
  );

  assertIncludesAll(filterBarSource, [
    "const actionableFilterTasks = tasks.filter((task) => isOpsTaskActionable(task, { today: todayKey }))",
    "all: actionableFilterTasks.length",
    "overdue: actionableFilterTasks.filter((task) => {",
    "priority: actionableFilterTasks.filter((task) => task.priority === \"urgent\" || task.priority === \"high\").length",
    "unassigned: actionableFilterTasks.filter((task) => hasTaskOrganizationIssue(task, completionBlockersByTaskId.get(task.id) || EMPTY_COMPLETION_BLOCKERS)).length",
    "confirmation: actionableFilterTasks.filter((task) => confirmationByTaskId.get(task.id) === true).length",
  ]);
  assert.doesNotMatch(filterBarSource, /const openTasks = tasks\.filter\(\(task\) => !isClosedOpsTask\(task\)\)/);
});

test("todo inbox only includes work without any operational schedule", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");

  assertIncludesAll(source, [
    "function hasTaskSchedule(task: OpsTask)",
    "inbox: actionableTodoTasks.filter((task) => !hasTaskSchedule(task)).length",
    'if (todoView === "inbox") return isOpsTaskActionable(task, { today: todayKey }) && !hasTaskSchedule(task)',
  ]);
  assert.doesNotMatch(source, /inbox: actionableTodoTasks\.filter\(\(task\) => !toDateKey\(task\.dueAt\)\)\.length/);
  assert.doesNotMatch(source, /if \(todoView === "inbox"\) return isOpsTaskActionable\(task, \{ today: todayKey \}\) && !dueDate/);
});

test("todo unresolved filter includes operation completion blockers", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");

  assertIncludesAll(source, [
    "function hasTaskOrganizationIssue",
    "completionBlockers.length > 0",
    "operationCompletionBlockersByTaskId",
    "buildOperationCompletionBlockerMap(",
    "operationCompletionBlockersByTaskId.get(task.id) || EMPTY_COMPLETION_BLOCKERS",
    "completionBlockersByTaskId?: OperationCompletionBlockerMap",
    "completionBlockersByTaskId = EMPTY_COMPLETION_BLOCKERS_BY_TASK_ID",
    "unassigned: actionableFilterTasks.filter((task) => hasTaskOrganizationIssue(task, completionBlockersByTaskId.get(task.id) || EMPTY_COMPLETION_BLOCKERS)).length",
    "completionBlockersByTaskId={operationCompletionBlockersByTaskId}",
    'if (todoFilter === "unassigned") return hasTaskOrganizationIssue(task, operationCompletionBlockersByTaskId.get(task.id) || EMPTY_COMPLETION_BLOCKERS)',
    'if (taskFocus === "unassigned" && !hasTaskOrganizationIssue(task, operationCompletionBlockersByTaskId.get(task.id) || EMPTY_COMPLETION_BLOCKERS)) return false',
  ]);
});

test("todo unresolved row fixes open the exact organization field", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const rowSource = source.slice(
    source.indexOf("function TaskListRow"),
    source.indexOf("function GroupedTaskList"),
  );

  assertIncludesAll(source, [
    'type TaskOrganizationFixField = "task.assignee" | "task.dueAt"',
    "function openOrganizationFix",
    "pendingCompletionFocusRef.current = field",
    "setCompletionFocusRequest((request) => request + 1)",
    'completionField="task.assignee"',
    'completionField="task.dueAt"',
    "onOrganizationFix={openOrganizationFix}",
  ]);
  assertIncludesAll(rowSource, [
    "onOrganizationFix",
    'onOrganizationFix(task, "task.assignee")',
    'onOrganizationFix(task, "task.dueAt")',
    'aria-label={`${task.title}: 담당 지정`}',
    'aria-label={`${task.title}: 예정 지정`}',
  ]);
});

test("todo board cards expose organization fixes to exact fields", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const boardSource = source.slice(
    source.indexOf("function TodoBoard({"),
    source.indexOf("function TodoBoardCard"),
  );
  const boardCardSource = source.slice(
    source.indexOf("function TodoBoardCard"),
    source.indexOf("function WordRetestAssistantActionControls"),
  );

  assertIncludesAll(boardSource, [
    "onOrganizationFix",
    "onOrganizationFix={onOrganizationFix}",
  ]);
  assertIncludesAll(boardCardSource, [
    "onOrganizationFix",
    "const organizationFixes = getTaskOrganizationFixes(task, completionBlockers)",
    'const needsAssigneeFix = task.type !== "general" && organizationFixes.includes("담당 지정")',
    'const needsScheduleFix = task.type !== "general" && organizationFixes.includes("예정 지정")',
    'aria-label="미정리 수정"',
    'onClick={() => onOrganizationFix(task, "task.assignee")}',
    'onClick={() => onOrganizationFix(task, "task.dueAt")}',
    'aria-label={`${task.title}: 담당 지정`}',
    'aria-label={`${task.title}: 예정 지정`}',
  ]);
});

test("todo board cards move between columns with mouse drag", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const boardSource = source.slice(
    source.indexOf("function TodoBoard({"),
    source.indexOf("function TodoBoardCard"),
  );
  const boardCardSource = source.slice(
    source.indexOf("function TodoBoardCard"),
    source.indexOf("function WordRetestAssistantActionControls"),
  );

  assertIncludesAll(source, [
    'from "@dnd-kit/core"',
    'from "@dnd-kit/utilities"',
    "DndContext",
    "PointerSensor",
    "KeyboardSensor",
    "useDraggable",
    "useDroppable",
    "type DragEndEvent",
    "function moveTodoTaskToBoardColumn",
    "const handleTodoBoardMove",
    "onTodoBoardMove={(task, columnKey) => void handleTodoBoardMove(task, columnKey)}",
  ]);
  assertIncludesAll(boardSource, [
    "const todoBoardSensors = useSensors(",
    "function handleTodoBoardDragEnd(event: DragEndEvent)",
    "onDragEnd={handleTodoBoardDragEnd}",
    "onTodoBoardMove",
    "useDroppable({ id: column.key })",
    "data-todo-board-column={column.key}",
    "data-todo-board-over={isOver ? \"true\" : \"false\"}",
  ]);
  assertIncludesAll(boardCardSource, [
    "useDraggable({",
    "data: { taskId: task.id }",
    "transform ? CSS.Translate.toString(transform) : undefined",
    "attributes",
    "listeners",
    'aria-label={`${task.title} 드래그`}',
    "data-todo-board-card={task.id}",
  ]);
});

test("registration transfer and withdrawal workspaces expose a Notion-style process board", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const renderSource = source.slice(
    source.indexOf("<TodoBoard"),
    source.indexOf("<Dialog open={formOpen}"),
  );

  assertIncludesAll(source, [
    'type ViewKey = "process" | "all" | "status" | "assignee" | "calendar"',
    'type OperationProcessWorkspaceKey = "registration" | "transfer" | "withdrawal"',
    "const OPERATION_PROCESS_BOARD_CONFIGS",
    "stages: REGISTRATION_PIPELINE_STATUSES.map",
    "transfer: {",
    'label: "제출 완료"',
    'label: "처리 진행 중"',
    'label: "처리 완료"',
    "function isOperationProcessWorkspace",
    "function getOperationProcessStageKey",
    "function buildOperationProcessBoardColumns",
    "function OperationProcessBoard",
    "function changeOperationProcessStage",
    'aria-label="프로세스 보드"',
    "onProcessStageChange",
  ]);
  assertIncludesAll(renderSource, [
    'view === "process"',
    "<OperationProcessBoard",
    "columns={operationProcessBoardColumns}",
    "onProcessStageChange={(task, stageKey) => void changeOperationProcessStage(task, stageKey)}",
  ]);
  assert.ok(
    renderSource.indexOf('<OperationProcessBoard') < renderSource.indexOf('view === "status"'),
    "process board should be the primary operation view before status grouping",
  );
});

test("operation process board behaves like a Notion database table", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const boardSource = source.slice(
    source.indexOf("function OperationProcessBoard"),
    source.indexOf("function TodoBoard({"),
  );

  assertIncludesAll(source, [
    "OPERATION_PROCESS_DATABASE_COLUMNS",
    "type OperationProcessColumnKey",
    "type OperationProcessCellField",
    "function getOperationProcessCellValue",
    "function getOperationProcessCellEditValue",
    "function getOperationProcessCellFocusTarget",
    "function getOperationProcessInlineEditType",
    "function OperationProcessTable",
    "function OperationProcessHeaderCell",
    "function OperationProcessCell",
    "function openProcessCellEdit",
    "function commitProcessCellEdit",
  ]);

  assertIncludesAll(boardSource, [
    'aria-label="프로세스 데이터베이스"',
    "gridTemplateColumns",
    "columnOrder",
    "columnWidths",
    "reorderProcessColumn",
    "startProcessColumnDrag",
    "startProcessColumnResize",
    "data-operation-process-cell",
    "data-operation-process-column",
    "data-operation-process-resize-handle",
    "data-operation-process-inline-input",
    "onProcessCellEdit",
    "onProcessCellCommit",
    "onMouseDown",
    "elementFromPoint",
    "onPointerDown",
    "setPointerCapture",
    'aria-label={`${task.title} ${column.label} 입력`}',
    'aria-label={`${task.title} ${column.label} 직접 입력`}',
    'aria-label={`${task.title} 진행상태 변경`}',
    "onProcessStageChange(task, event.currentTarget.value)",
  ]);
  assert.doesNotMatch(boardSource, /열 왼쪽으로 이동|열 오른쪽으로 이동|열 너비 줄이기|열 너비 늘리기/);
});

test("operation process tables mirror the Notion property order", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const columnsSource = source.slice(
    source.indexOf("const OPERATION_PROCESS_DATABASE_COLUMNS"),
    source.indexOf("const WORKSPACE_TASK_TYPE"),
  );

  assertInOrder(columnsSource.slice(columnsSource.indexOf("registration: ["), columnsSource.indexOf("transfer: [")), [
    'label: "이름"',
    'label: "학교"',
    'label: "학년"',
    'label: "과목"',
    'label: "연계"',
    'label: "학부모 전화"',
    'label: "학생 전화"',
    'label: "요청 사항"',
    'label: "문의일시"',
    'label: "문의채널"',
    'label: "레벨테스트일시"',
    'label: "레벨테스트장소"',
    'label: "레벨테스트결과"',
    'label: "상담 책임자"',
    'label: "전화상담일시"',
    'label: "방문상담일시"',
    'label: "방문상담실"',
  ]);
  assertInOrder(columnsSource.slice(columnsSource.indexOf("transfer: ["), columnsSource.indexOf("withdrawal: [")), [
    'label: "ID"',
    'label: "진행상태"',
    'label: "전반사유"',
    'label: "학생명"',
    'label: "과목"',
    'label: "전 선생님명"',
    'label: "전 수업명"',
    'label: "전 수업 종료일"',
    'label: "전 수업 종료회차"',
    'label: "전 수업 미배부교재"',
    'label: "후 선생님명"',
    'label: "후 수업명"',
    'label: "후 수업 시작일"',
    'label: "후 수업 시작회차"',
    'label: "후 수업 미배부교재"',
    'label: "수업시간표 명단 변경"',
    'label: "메이크에듀 전반처리"',
    'label: "수업료, 교재비 정산처리"',
  ]);
  assertInOrder(columnsSource.slice(columnsSource.indexOf("withdrawal: [")), [
    'label: "ID"',
    'label: "진행상태"',
    'label: "과목"',
    'label: "학년"',
    'label: "선생님명"',
    'label: "수업명"',
    'label: "학생명"',
    'label: "고객 퇴원사유"',
    'label: "선생님 의견"',
    'label: "기타 전달내용"',
    'label: "미배부 교재"',
    'label: "퇴원일"',
    'label: "퇴원회차"',
    'label: "진행된 수업시수"',
    'label: "4주 기준 수업시수"',
    'label: "수업진행률"',
    'label: "수업시간표 명단 변경"',
    'label: "메이크에듀 퇴원처리"',
    'label: "수업료, 교재비 정산처리"',
  ]);
});

test("todo confirmation filter includes operation confirmation work", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const rowSource = source.slice(
    source.indexOf("function TaskListRow"),
    source.indexOf("function GroupedTaskList"),
  );

  assertIncludesAll(source, [
    'type TodoFilterKey = "all" | "overdue" | "priority" | "unassigned" | "confirmation"',
    '{ key: "confirmation", label: "확인 필요" }',
    "confirmationByTaskId?: OperationConfirmationMap",
    "confirmationByTaskId = EMPTY_CONFIRMATION_BY_TASK_ID",
    "confirmation: actionableFilterTasks.filter((task) => confirmationByTaskId.get(task.id) === true).length",
    "confirmationByTaskId={confirmationByTaskId}",
    'if (todoFilter === "confirmation") return confirmationByTaskId.get(task.id) === true',
    "confirmationByTaskId.get(task.id) === true",
  ]);
  assertIncludesAll(rowSource, [
    "const shouldShowCompletionBlockerChips = isOperationRow && completionBlockers.length > 0",
    "const shouldShowConfirmationRequestChip = isOperationRow && task.status === \"requested\"",
    "{shouldShowCompletionBlockerChips && (",
    "{shouldShowConfirmationRequestChip && (",
    'aria-label="완료 전 필요한 입력"',
    'aria-label="확인 필요 사유"',
    "요청 확인",
    'tone={primaryOperationActionBlocked ? "destructive" : "default"}',
    "showNeed",
  ]);
});

test("todo board and calendar cards expose operation confirmation work", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const boardCardSource = source.slice(
    source.indexOf("function TodoBoardCard"),
    source.indexOf("function TaskList({"),
  );
  const calendarSource = source.slice(
    source.indexOf("function CalendarList"),
    source.indexOf("function CompletionBlockerActionPanel"),
  );

  assertIncludesAll(boardCardSource, [
    "const shouldShowBoardConfirmationRequestChip = task.type !== \"general\" && task.status === \"requested\"",
    "{shouldShowBoardConfirmationRequestChip && (",
    'aria-label="확인 필요 사유"',
    'aria-label={`${task.title}: 요청 확인`}',
    "요청 확인",
  ]);
  assertIncludesAll(calendarSource, [
    "const shouldShowCalendarConfirmationRequestChip = Boolean(task && task.type !== \"general\" && task.status === \"requested\")",
    "{shouldShowCalendarConfirmationRequestChip && (",
    'aria-label="확인 필요 사유"',
    'aria-label={`${item.title}: 요청 확인`}',
    "요청 확인",
  ]);
});

test("todo board completion blockers explain the missing work before final action", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const boardCardSource = source.slice(
    source.indexOf("function TodoBoardCard"),
    source.indexOf("function TaskList({"),
  );

  assertIncludesAll(boardCardSource, [
    "{completionBlockers.length > 0 && (",
    'aria-label="완료 전 필요한 입력"',
    'tone={primaryOperationActionBlocked ? "destructive" : "default"}',
    "showNeed",
  ]);
});

test("calendar view exposes operation completion blockers before final action", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const calendarSource = source.slice(
    source.indexOf("function CalendarList"),
    source.indexOf("function CompletionBlockerActionPanel"),
  );

  assertIncludesAll(calendarSource, [
    "const shouldShowCalendarCompletionBlockers = Boolean(task && task.type !== \"general\" && completionBlockers.length > 0)",
    "{shouldShowCalendarCompletionBlockers && (",
    "task={task || { id: item.id, title: item.title }}",
    'aria-label="완료 전 필요한 입력"',
    'tone={primaryCalendarActionBlocked ? "destructive" : "default"}',
    "showNeed",
  ]);
});

test("calendar view keeps operation row scan summaries visible", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const calendarSource = source.slice(
    source.indexOf("function CalendarList"),
    source.indexOf("function CompletionBlockerActionPanel"),
  );

  assertIncludesAll(calendarSource, [
    "const calendarRegistrationPrincipalQueueSummary = task?.type === \"registration\" ? getRegistrationPrincipalQueueSummary(task) : null",
    "const calendarOperationRowRiskSummary = task ? getOperationRowRiskSummary(task, completionBlockers) : null",
    'aria-label="등록 원장 배정 상태"',
    "calendarRegistrationPrincipalQueueSummary.testAtLabel",
    "calendarRegistrationPrincipalQueueSummary.materialLabel",
    "calendarRegistrationPrincipalQueueSummary.resultLabel",
    "calendarRegistrationPrincipalQueueSummary.analysisLabel",
    "calendarRegistrationPrincipalQueueSummary.placementLabel",
    'aria-label="전반 퇴원 처리 상태"',
    "calendarOperationRowRiskSummary.headingLabel",
    "calendarOperationRowRiskSummary.primaryLabel",
    "calendarOperationRowRiskSummary.secondaryLabel",
    "calendarOperationRowRiskSummary.tertiaryLabel",
    "calendarOperationRowRiskSummary.quaternaryLabel",
  ]);
});

test("calendar view keeps word retest execution summary visible", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const calendarSource = source.slice(
    source.indexOf("function CalendarList"),
    source.indexOf("function CompletionBlockerActionPanel"),
  );

  assertIncludesAll(calendarSource, [
    "const calendarWordRetestExecutionSummary = task?.type === \"word_retest\" ? getWordRetestExecutionSummary(task, { today: todayKey }) : null",
    'aria-label="단어 재시험 실행 상태"',
    "calendarWordRetestExecutionSummary.stageLabel",
    "calendarWordRetestExecutionSummary.scoreLabel",
    "calendarWordRetestExecutionSummary.branchLabel",
    "calendarWordRetestExecutionSummary.testAtLabel",
    "calendarWordRetestExecutionSummary.teacherLabel",
    "calendarWordRetestExecutionSummary.scopeLabel",
  ]);
});

test("quick add keeps Todoist-like shortcuts without extra UI", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");

  assertIncludesAll(source, [
    "function parseTodoistQuickAdd",
    "const quickDueAt = parsed.dueAt || (todoView === \"today\" ? dueTodayValue : \"\")",
    "dueAt: quickDueAt",
    "getTodoViewForDueAt(quickDueAt, todayKey)",
    "let explicitTime = \"\"",
    "const setDueAt = (nextDueAt: string) => {",
    "dueAt = explicitTime ? withTime(nextDueAt, explicitTime) : nextDueAt",
    "nextweek",
    "p1",
    "p4",
    "const koreanMeridiemTime = normalized.match",
    "const koreanHourTime = normalized.match",
    "function quickDateTimeForWeekdayInCalendarWeek",
    "function quickDateTimeForNextCalendarWeekday",
    "pendingWeekdayModifier = \"next\"",
    "pendingWeekdayModifier = \"this\"",
    "const forceThisWeekday = pendingWeekdayModifier === \"this\"",
    "quickDateTimeForNextCalendarWeekday(weekday)",
    "const match = token.match(/^(마감|마감일|예정|예정일|기한|일정|due)[:：](.*)$/i)",
    'token.trim().toLowerCase().replace(/까지$/, "")',
    "const relative = normalized.match",
    "const monthDay = normalized.match",
    "let pendingAssigneeLookup = false",
    "let pendingDueLookup = false",
    "if (pendingDueLookup) {",
    "const applyDateToken = (dateToken: string) =>",
    'normalizedDateToken.endsWith("까지")',
    'applyDateToken(normalizedDateToken.replace(/까지$/, ""))',
    "const assigneeDirective = getQuickAddAssigneeDirective(token)",
    '["담당", "담당자", "assignee", "assign"].includes(normalized)',
    "const dueDirective = getQuickAddDueDirective(token)",
    "applyDateToken(dueDirective.value)",
    "pendingDueLookup = true",
    '["마감", "마감일", "예정", "예정일", "기한", "일정", "due"].includes(normalized)',
    "parsed.assigneeId",
    "parsed.priority",
    "parsed.memo",
  ]);
});

test("simple todo details stay completion focused", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const secondaryStatusSource = source.slice(
    source.indexOf("function getSecondaryTaskStatusOptions"),
    source.indexOf("function shouldShowDetailStatusBadge"),
  );
  const detailDialogSource = source.slice(
    source.indexOf("<Dialog open={detailOpen}"),
    source.indexOf("<Dialog open={Boolean(deleteTarget)}"),
  );

  assertIncludesAll(source, [
    'if (task.type === "general") return []',
    "function shouldShowDetailStatusBadge",
    'task.type !== "general" || isClosedOpsTask(task)',
    "shouldShowDetailStatusBadge(selectedTaskFresh)",
    'deleteTarget?.title ? `${deleteTarget.title} 삭제할까요?` : "삭제할까요?"',
    "deleteTargetRemovesCompletedOperation",
    '`${deleteTarget?.title || "완료된 운영 업무"} 이력 삭제할까요?`',
    "이력 삭제",
    "삭제 완료",
    'selectedTaskFresh.comments.length > 0 ? `댓글 ${selectedTaskFresh.comments.length}` : "댓글 추가"',
    'selectedTaskFresh.attachments.length > 0 ? `첨부 ${selectedTaskFresh.attachments.length}` : "첨부 추가"',
  ]);

  assert.doesNotMatch(secondaryStatusSource, /task\.type === "general"\) \{[\s\S]*OPS_TASK_STATUSES/);
  assert.doesNotMatch(source, /삭제하시겠습니까/);
  assert.doesNotMatch(source, /상세 정보/);
  assert.doesNotMatch(source, /댓글 없음/);
  assert.doesNotMatch(source, /첨부 없음/);
  assert.doesNotMatch(source, /완료 조건/);
  assert.doesNotMatch(detailDialogSource, /<DialogDescription(?! className="sr-only")/);
});

test("assignee search and quick add match profile login ids", async () => {
  const [workspaceSource, serviceSource] = await Promise.all([
    readSource("src/features/tasks/ops-task-workspace.tsx"),
    readSource("src/features/tasks/ops-task-service.ts"),
  ]);

  assert.match(serviceSource, /export type OpsProfileOption = \{[\s\S]*loginId: string[\s\S]*\}/);
  assert.match(serviceSource, /profiles: profileRows[\s\S]*loginId: text\(row\.login_id\),[\s\S]*role: text\(row\.role\)/);
  assert.match(workspaceSource, /searchText: \[profile\.email, profile\.loginId, profile\.role\]\.filter\(Boolean\)\.join\(" "\)/);
  assert.match(workspaceSource, /normalizeQuickAddLookup\(profile\.email\)\.includes\(assigneeQuery\) \|\|[\s\S]*normalizeQuickAddLookup\(profile\.loginId\)\.includes\(assigneeQuery\)/);
});

test("linked selectors support one-result keyboard selection", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");

  assertIncludesAll(source, [
    "function optionExactSearchParts",
    "const matchedOptions = useMemo",
    "const quickSelectOption = useMemo",
    'event.key !== "Enter"',
    "handleLinkedChange(quickSelectOption.id)",
    'onKeyDown={handleLinkedQueryKeyDown}',
    '"검색 결과 없음"',
    "matchedOptions.length === 1 ? matchedOptions[0] : undefined",
  ]);
});

test("linked selectors reuse no-result search text for direct operation entry", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const linkedSelectSource = source.slice(
    source.indexOf("function LinkedSelect"),
    source.indexOf("function ProfileSelect"),
  );
  const manualFieldSource = source.slice(
    source.indexOf("function openManualField"),
    source.indexOf("function applyRegistrationWorkflowPreset"),
  );

  assertIncludesAll(linkedSelectSource, [
    "onManualSelect?: (query?: string) => void",
    "function handleManualSelect(manualQuery = linkedQuery.trim())",
    "onManualSelect?.(manualQuery)",
    "const canQuickManualSelect",
    "if (canQuickManualSelect)",
    "handleManualSelect(linkedQuery.trim())",
    '`${manualLabel || "직접 입력"}: ${linkedQuery.trim()}`',
  ]);
  const handleManualSelectSource = linkedSelectSource.slice(
    linkedSelectSource.indexOf("function handleManualSelect"),
    linkedSelectSource.indexOf("function handleLinkedChange"),
  );
  assert.ok(
    handleManualSelectSource.indexOf('onChange("")') <
      handleManualSelectSource.indexOf("onManualSelect?.(manualQuery)"),
    "manual linked id clearing should happen before writing the manual value",
  );
  assertIncludesAll(manualFieldSource, [
    "function openManualField(field: string, manualValue = \"\")",
    "const nextManualValue = manualValue.trim()",
    'if (field === "withdrawalStudent") updateForm("studentName", nextManualValue)',
    'if (field === "transferStudent") updateForm("studentName", nextManualValue)',
    'if (field === "wordRetestStudent") {',
    'updateWordRetest("studentName", nextManualValue)',
    'updateForm("studentName", nextManualValue)',
    'if (field === "wordRetestClass") {',
    'updateWordRetest("className", nextManualValue)',
    'updateForm("className", nextManualValue)',
  ]);
  assertIncludesAll(source, [
    'onManualSelect={(query) => openManualField("registrationClass", query)}',
    'onManualSelect={(query) => openManualField("registrationTextbook", query)}',
    'onManualSelect={(query) => openManualField("withdrawalStudent", query)}',
    'onManualSelect={(query) => openManualField("withdrawalClass", query)}',
    'onManualSelect={(query) => openManualField("transferStudent", query)}',
    'onManualSelect={(query) => openManualField("transferFromClass", query)}',
    'onManualSelect={(query) => openManualField("transferToClass", query)}',
    'onManualSelect={(query) => openManualField("wordRetestStudent", query)}',
    'onManualSelect={(query) => openManualField("wordRetestClass", query)}',
    'onManualSelect={(query) => openManualField("wordRetestTeacher", query)}',
    'onManualSelect={(query) => openManualField("wordRetestTextbook", query)}',
  ]);
});

test("dedicated operations are split into separate admin routes", async () => {
  const routes = [
    ["src/app/admin/registration/page.tsx", "registration"],
    ["src/app/admin/transfer/page.tsx", "transfer"],
    ["src/app/admin/withdrawal/page.tsx", "withdrawal"],
    ["src/app/admin/word-retests/page.tsx", "word_retest"],
  ];

  for (const [pathname, workspace] of routes) {
    const source = await readSource(pathname);
    assert.match(source, new RegExp(`<OpsTaskWorkspace workspace="${workspace}" />`));
    assert.doesNotMatch(source, /redirect\(/);
  }
});

test("navigation keeps todo as one sidebar entry and separates operation menus", async () => {
  const [source, workspaceSource] = await Promise.all([
    readSource("src/lib/navigation.ts"),
    readSource("src/features/tasks/ops-task-workspace.tsx"),
  ]);
  const fullOverviewStart = source.indexOf("const fullOverviewItems");
  const todoStart = source.indexOf(`title: "${ko.todo}",\n      url: "/admin/tasks"`, fullOverviewStart);
  const todoBlock = source.slice(todoStart, source.indexOf(`{ title: "${ko.registration}"`, todoStart));

  assertIncludesAll(source, [
    `title: "${ko.todo}"`,
    'url: "/admin/tasks"',
    `{ title: "${ko.registration}", url: "/admin/registration", icon: UserPlus }`,
    `{ title: "${ko.transfer}", url: "/admin/transfer", icon: Repeat2 }`,
    `{ title: "${ko.withdrawal}", url: "/admin/withdrawal", icon: UserMinus }`,
    `{ title: "${ko.wordRetest}", url: "/admin/word-retests", icon: SpellCheck }`,
    `{ title: "${ko.approvals}", url: "/admin/approvals", icon: FileCheck2 }`,
    'match: "/admin/tasks"',
  ]);
  assertIncludesAll(workspaceSource, [
    `{ key: "today", label: "${ko.today}" }`,
    `{ key: "mine", label: "${ko.mine}" }`,
    `{ key: "board", label: "${ko.board}" }`,
    `{ key: "calendar", label: "${ko.calendar}" }`,
    `{ key: "filters", label: "${ko.filters}" }`,
  ]);

  assert.doesNotMatch(todoBlock, /items:\s*\[/);
  assert.doesNotMatch(todoBlock, /\/admin\/tasks\?list=/);
  assert.doesNotMatch(todoBlock, /url: "\/admin\/registration"/);
  assert.doesNotMatch(todoBlock, /url: "\/admin\/transfer"/);
  assert.doesNotMatch(todoBlock, /url: "\/admin\/withdrawal"/);
  assert.doesNotMatch(todoBlock, /url: "\/admin\/word-retests"/);
  assert.doesNotMatch(source, new RegExp(`title: "${ko.taskbox}"`));
});

test("registration keeps the Notion pipeline as first-class state", async () => {
  const [workspaceSource, modelSource, serviceSource, migrationSource] = await Promise.all([
    readSource("src/features/tasks/ops-task-workspace.tsx"),
    readSource("src/features/tasks/ops-task-model.js"),
    readSource("src/features/tasks/ops-task-service.ts"),
    readSource("supabase/migrations/20260522103000_ops_registration_pipeline_status.sql"),
  ]);
  const combined = `${workspaceSource}\n${modelSource}\n${serviceSource}\n${migrationSource}`;

  for (const status of [
    "0. \ub4f1\ub85d \ubb38\uc758",
    "1. \ub808\ubca8\ud14c\uc2a4\ud2b8 \uc2e0\uccad",
    "2. \uc0c1\ub2f4 \uc2e0\uccad",
    "3. \uc0c1\ub2f4 \uc644\ub8cc",
    "4-1. \ud604\uc7ac\ubc18 \ub300\uae30",
    "4-2. \uc2e0\uaddc\ubc18 \ub300\uae30",
    "4-3. \ub2e4\uc74c \uac1c\uac15 \uc54c\ub9bc",
    "5. \ub4f1\ub85d \uc2e0\uccad",
    "6. \uc218\ub0a9 \uc9c4\ud589 \uc911",
    "7. \ub4f1\ub85d \uc644\ub8cc",
    "8. \ubbf8\ub4f1\ub85d",
    "9. \ubb38\uc758\ub9cc",
  ]) {
    assert.ok(combined.includes(status), status);
  }

  assertIncludesAll(combined, [
    "RegistrationPipelineFilter",
    "pipelineStatus",
    "pipeline_status",
    "REGISTRATION_PIPELINE_STATUSES",
    "ops_registration_details_pipeline_status_idx",
    "findRegistrationPipelineStatus",
    "syncRegistrationPipelineStatusForTaskStatus",
  ]);
});

test("operation forms render type-specific fields without duplicate visible step navigation", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const formDialogSource = source.slice(
    source.indexOf("<Dialog open={formOpen}"),
    source.indexOf("<Dialog open={detailOpen}"),
  );

  assertIncludesAll(source, [
    '"registration_contact"',
    '"registration_test"',
    '"registration_start"',
    '"registration_checks"',
    '"withdrawal_basic"',
    '"withdrawal_reason"',
    '"withdrawal_checks"',
    '"transfer_basic"',
    '"transfer_schedule"',
    '"transfer_checks"',
    '"word_retest_basic"',
    '"word_retest_scope"',
    '"word_retest_scores"',
    "<LinkedSelect",
    `label="${ko.student}"`,
    `label="${ko.class}"`,
    `label="${ko.teacher}"`,
    "fillRegistration: true",
    "fillWithdrawal: true",
    "fillTransferFrom: true",
    "fillTransferTo: true",
    "fillWordRetest: true",
    "getStudentRosterClassIds",
    "selectedWordRetestStudent",
    "selectedWordRetestClassId",
    "selectedWordRetestTeacherId",
    "selectedRegistrationClass",
    "getClassTextbookOptions",
    "getWordRetestClassOptions(classes, selectedWordRetestStudent, selectedWordRetestClassId)",
    "getWordRetestTeacherOptions(teachers, selectedWordRetestTeacherId)",
    "const wordRetestNow = useMemo(() => new Date(), [])",
    "const wordRetestExecutionOptions = useMemo(",
    "sortWordRetestExecutionQueue(nextTasks, wordRetestExecutionOptions)",
    "getWordRetestExecutionStage(task, wordRetestExecutionOptions)",
    "isWordRetestInExecutionQueue(task, wordRetestQueue, wordRetestExecutionOptions)",
    "type WordRetestQueueMode",
    "const WORD_RETEST_QUEUE_ITEMS",
    "const WORD_RETEST_QUEUE_BAR_CLASS",
    "flex-wrap",
    "function WordRetestQueueBar",
    'aria-label="단어 재시험 실행 큐"',
    "오늘 응시",
    "진행 중",
    "점수 입력",
    "미응시",
    "완료",
    "setWordRetestQueue",
    "classItem.id === selectedClassId",
    "teacher.id === selectedTeacherId",
    "openManualField",
    "shouldShowManualField",
    'const defaultAssigneeId = currentUserId || ""',
    "const { user, canManageAll, isAdmin, isStaff, isTeacher } = useAuth()",
    'setWordRetestMode(isTeacher && !isStaff ? "teacher" : "assistant")',
    "{getTaskTypeLabel(form.type)}",
  ]);

  assertIncludesAll(formDialogSource, [
    'step="all"',
  ]);
  assert.doesNotMatch(formDialogSource, /formStepProgressLabel|입력 단계|aria-pressed=\{activeFormDetailStep === tab\.key\}|previousFormDetailStep|nextFormDetailStep|이전 단계|다음 단계|step=\{activeFormDetailStep\}/);
  assert.doesNotMatch(formDialogSource, /<DialogDescription(?! className="sr-only")/);
  assert.match(source, />\s*\uc120\uc0dd\ub2d8\s*<\/button>/);
  assert.match(source, />\s*\uc870\uad50\s*<\/button>/);
});

test("operation edit modal keeps chrome flush and marks missing required fields inline", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const formDialogSource = source.slice(
    source.indexOf("<Dialog open={formOpen}"),
    source.indexOf("<Dialog open={detailOpen}"),
  );
  const fieldComponentsSource = source.slice(
    source.indexOf("function SelectField("),
    source.indexOf("type LinkedSelectOption"),
  );
  const linkedSelectSource = source.slice(
    source.indexOf("function LinkedSelect("),
    source.indexOf("function ProfileSelect("),
  );
  const textFieldSource = source.slice(
    source.indexOf("function TextField("),
    source.indexOf("function CheckField("),
  );
  const checkFieldSource = source.slice(
    source.indexOf("function CheckField("),
    source.indexOf("function ClassPlanInlineSummary"),
  );
  const registrationChecksSource = source.slice(
    source.indexOf('if (step === "registration_checks")'),
    source.indexOf("if (form.type === \"withdrawal\")"),
  );

  assertIncludesAll(formDialogSource, [
    "flex-col overflow-hidden p-0",
    'data-testid="ops-task-form-scroll-body"',
    "grid min-h-0 flex-1 gap-4 overflow-x-hidden overflow-y-auto",
    "flex shrink-0 flex-col gap-2 border-t bg-background px-6",
    "formRequiredFields",
  ]);
  assert.doesNotMatch(formDialogSource, /sticky top-0|-mx-6|-mt-6|sticky bottom-0|-mb-6|backdrop-blur/);

  assertIncludesAll(source, [
    "function buildRequiredCompletionFieldSet",
    "aria-required={required || undefined}",
    "aria-invalid={invalid || undefined}",
    'aria-hidden="true"',
    "text-destructive",
    "data-required-missing={invalid ? \"true\" : undefined}",
    "requiredFields={formRequiredFields}",
    "requiredFieldProps",
    "필수값을 확인하세요",
    "완료 체크",
  ]);
  assertIncludesAll(fieldComponentsSource, ["required", "invalid"]);
  assertIncludesAll(linkedSelectSource, ["required", "invalid", "requiredLabel"]);
  assertIncludesAll(textFieldSource, ["required", "invalid", "requiredLabel"]);
  assertIncludesAll(checkFieldSource, ["required", "invalid", "requiredLabel"]);

  assertIncludesAll(registrationChecksSource, [
    "RegistrationCompletionChecklist",
    "requiredFields={requiredFields}",
  ]);
  assert.doesNotMatch(registrationChecksSource, /OperationCompletionReview|RegistrationAutoSyncPreview|완료 전 핵심값|자동 연결|완료 순서/);
});

test("registration create inquiry step stays compact before manual placement", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const formDialogSource = source.slice(
    source.indexOf("<Dialog open={formOpen}"),
    source.indexOf("<Dialog open={detailOpen}"),
  );
  const registrationContactSource = source.slice(
    source.indexOf('if (step === "registration_contact")'),
    source.indexOf('if (step === "registration_test")'),
  );
  const registrationStartSource = source.slice(
    source.indexOf('if (step === "registration_start")'),
    source.indexOf('if (step === "registration_checks")'),
  );

  assertIncludesAll(formDialogSource, [
    'form.type === "registration" && (!isTemplateForm || editingTask) && (',
    'REGISTRATION_PIPELINE_STATUSES.map((status) => (',
  ]);
  assertIncludesAll(registrationContactSource, [
    'label="문의 채널"',
    'label="문의일시"',
    'label="학생명"',
    'label="학부모 전화"',
    "<RegistrationDuplicateCandidatePanel",
  ]);
  assert.doesNotMatch(registrationContactSource, /label="기존 학생 연결"|<LinkedSelect/);
  assertIncludesAll(registrationStartSource, [
    "<LinkedSelect",
    'label="기존 학생 연결"',
    'completionField="registration.student"',
    "fillRegistration: true",
    '<LinkedSelect label="수업"',
    '<LinkedSelect label="교재"',
  ]);
});

test("withdrawal create first step keeps settlement essentials compact", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const withdrawalBasicSource = source.slice(
    source.indexOf('if (step === "withdrawal_basic")'),
    source.indexOf('if (step === "withdrawal_reason")'),
  );

  assertIncludesAll(withdrawalBasicSource, [
    'label: "오늘 퇴원/정산"',
    'label: "오늘 퇴원"',
    'label: "내일 퇴원"',
    '<LinkedSelect label="학생"',
    '<LinkedSelect label="수업"',
    'label="퇴원일"',
    'label="퇴원회차"',
    'label="진행 수업시수"',
    'label="4주 기준 수업시수"',
    'label="미배부 교재"',
    "{(form.studentId || form.classId || withdrawal.schoolGrade) &&",
    'label="학년"',
    "{(form.classId || withdrawal.teacherName) &&",
    'label="선생님"',
  ]);
  assert.doesNotMatch(withdrawalBasicSource, /수업계획 기준|교재 기준/);
});

test("word retest create first step uses combined date and branch presets", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const wordRetestBasicSource = source.slice(
    source.indexOf('if (step === "word_retest_basic")'),
    source.indexOf('if (step === "word_retest_scope")'),
  );

  assertIncludesAll(wordRetestBasicSource, [
    'label: "오늘 본관"',
    'label: "오늘 별관"',
    'label: "내일 본관"',
    'label: "내일 별관"',
    '<LinkedSelect label="학생"',
    '<LinkedSelect label="수업"',
    '<LinkedSelect label="선생님"',
    'label="응시일시"',
    'label="지점"',
  ]);
  assert.doesNotMatch(wordRetestBasicSource, /label: "오늘 응시"|label: "내일 응시"|label: "본관"|label: "별관"/);
});

test("registration linked student selection refreshes profile fields from the selected student", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const selectStudentSource = source.slice(
    source.indexOf("const selectStudent = ("),
    source.indexOf("const registrationClassTextbooks"),
  );

  assertIncludesAll(selectStudentSource, [
    'updateRegistration("schoolGrade", student.grade || registration.schoolGrade || "")',
    'updateRegistration("schoolName", student.school || registration.schoolName || "")',
    'updateRegistration("studentPhone", student.contact || registration.studentPhone || "")',
    'updateRegistration("parentPhone", student.parentContact || registration.parentPhone || "")',
  ]);
  assert.doesNotMatch(selectStudentSource, /updateRegistration\("schoolGrade", registration\.schoolGrade \|\| student\.grade\)/);
  assert.doesNotMatch(selectStudentSource, /updateRegistration\("schoolName", registration\.schoolName \|\| student\.school\)/);
  assert.doesNotMatch(selectStudentSource, /updateRegistration\("studentPhone", registration\.studentPhone \|\| student\.contact\)/);
  assert.doesNotMatch(selectStudentSource, /updateRegistration\("parentPhone", registration\.parentPhone \|\| student\.parentContact\)/);
});

test("registration class selection refreshes a stale textbook from the selected class", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const selectClassSource = source.slice(
    source.indexOf("const selectClass = ("),
    source.indexOf("const selectTeacher ="),
  );

  assertIncludesAll(selectClassSource, [
    "const classTextbookIds = classItem.textbookIds || []",
    "const shouldSyncPrimaryTextbook = options.fillRegistration || options.fillWordRetest",
    "const shouldRefreshPrimaryTextbook = shouldUpdatePrimaryClass && shouldSyncPrimaryTextbook && textbookId && (!form.textbookId || !classTextbookIds.includes(form.textbookId))",
    "if (shouldRefreshPrimaryTextbook) selectTextbook(textbookId)",
  ]);
  assert.doesNotMatch(selectClassSource, /if \(shouldUpdatePrimaryClass && textbookId && !form\.textbookId\) selectTextbook\(textbookId\)/);
});

test("word retest student selection refreshes a stale class when the student has one retest class", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const selectStudentSource = source.slice(
    source.indexOf("const selectStudent = ("),
    source.indexOf("const registrationClassTextbooks"),
  );

  assertIncludesAll(selectStudentSource, [
    "const shouldRefreshWordRetestClass = options.fillWordRetestClass && wordRetestClassId && form.classId !== wordRetestClassId",
    "if (shouldRefreshWordRetestClass) selectClass(wordRetestClassId, { fillWordRetest: true })",
  ]);
  assert.doesNotMatch(selectStudentSource, /if \(options\.fillWordRetestClass && wordRetestClassId && !form\.classId\) selectClass\(wordRetestClassId, \{ fillWordRetest: true \}\)/);
});

test("withdrawal and transfer student selection refresh stale class links from the selected student", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const selectStudentSource = source.slice(
    source.indexOf("const selectStudent = ("),
    source.indexOf("const registrationClassTextbooks"),
  );

  assertIncludesAll(selectStudentSource, [
    "const shouldRefreshWithdrawalClass = options.fillWithdrawalClass && classId && form.classId !== classId",
    "if (shouldRefreshWithdrawalClass) selectClass(classId, { fillWithdrawal: true })",
    "const shouldRefreshTransferFromClass = options.fillTransferFromClass && classId && transfer.fromClassId !== classId",
    "if (shouldRefreshTransferFromClass) selectClass(classId, { fillTransferFrom: true })",
  ]);
  assert.doesNotMatch(selectStudentSource, /if \(options\.fillWithdrawalClass && classId && !form\.classId\) selectClass\(classId, \{ fillWithdrawal: true \}\)/);
  assert.doesNotMatch(selectStudentSource, /if \(options\.fillTransferFromClass && classId && !transfer\.fromClassId\) selectClass\(classId, \{ fillTransferFrom: true \}\)/);
});

test("clearing operation students clears class links that were derived from the student", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const selectStudentStart = source.indexOf("const selectStudent = (");
  const emptyStudentSource = source.slice(
    source.indexOf("if (!studentId) {", selectStudentStart),
    source.indexOf("if (!student) return", selectStudentStart),
  );

  assertIncludesAll(emptyStudentSource, [
    'if (options.fillWithdrawalClass) selectClass("", { fillWithdrawal: true })',
    'if (options.fillTransferFromClass) selectClass("", { fillTransferFrom: true })',
    'if (options.fillWordRetestClass) selectClass("", { fillWordRetest: true })',
  ]);
  assert.doesNotMatch(emptyStudentSource, /fillRegistration[^}]+selectClass\("", \{ fillRegistration: true \}\)/s);
});

test("withdrawal and transfer class selection refresh stale teacher names from the selected class", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const selectClassSource = source.slice(
    source.indexOf("const selectClass = ("),
    source.indexOf("const selectTeacher ="),
  );
  const transferPatchSource = source.slice(
    source.indexOf("function applyTransferClassPlanPatch"),
    source.indexOf("const selectClass = ("),
  );

  assertIncludesAll(selectClassSource, [
    'updateTransfer("fromTeacherName", getClassDerivedTeacherName(classItem, transfer.fromTeacherName, selectedTransferFromClass))',
    'updateTransfer("toTeacherName", getClassDerivedTeacherName(classItem, transfer.toTeacherName, selectedTransferToClass))',
    'updateWithdrawal("teacherName", getClassDerivedTeacherName(classItem, withdrawal.teacherName, selectedWithdrawalClass))',
  ]);
  assertIncludesAll(transferPatchSource, [
    "fromTeacherName: getClassDerivedTeacherName(classItem, transfer.fromTeacherName, selectedTransferFromClass)",
    "toTeacherName: getClassDerivedTeacherName(classItem, transfer.toTeacherName, selectedTransferToClass)",
  ]);
  assert.doesNotMatch(selectClassSource, /updateTransfer\("fromTeacherName", transfer\.fromTeacherName \|\| classItem\.teacher\)/);
  assert.doesNotMatch(selectClassSource, /updateTransfer\("toTeacherName", transfer\.toTeacherName \|\| classItem\.teacher\)/);
  assert.doesNotMatch(selectClassSource, /updateWithdrawal\("teacherName", withdrawal\.teacherName \|\| classItem\.teacher\)/);
  assert.doesNotMatch(transferPatchSource, /fromTeacherName: transfer\.fromTeacherName \|\| classItem\.teacher/);
  assert.doesNotMatch(transferPatchSource, /toTeacherName: transfer\.toTeacherName \|\| classItem\.teacher/);
});

test("withdrawal and transfer class selection clears previous class-derived teacher names when the new class has none", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const teacherHelperSource = source.slice(
    source.indexOf("function keepManualTeacherName"),
    source.indexOf("function applyWithdrawalClassPlanPatch"),
  );

  assertIncludesAll(teacherHelperSource, [
    "function keepManualTeacherName(currentTeacherName: string | undefined, previousClass?: OpsClassOption)",
    "if (previousClass?.teacher && current === previousClass.teacher) return \"\"",
    "function getClassDerivedTeacherName(classItem: OpsClassOption, currentTeacherName: string | undefined, previousClass?: OpsClassOption)",
    "return classItem.teacher || keepManualTeacherName(currentTeacherName, previousClass)",
  ]);
});

test("clearing withdrawal and transfer classes clears class-derived teacher names", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const selectClassStart = source.indexOf("const selectClass = (");
  const selectClassSource = source.slice(
    selectClassStart,
    source.indexOf("if (!classItem) return", selectClassStart),
  );

  assertIncludesAll(selectClassSource, [
    'updateTransfer("fromTeacherName", "")',
    'updateTransfer("toTeacherName", "")',
    'if (options.fillWithdrawal) updateWithdrawal("teacherName", "")',
  ]);
});

test("clearing registration and word retest classes clears class-derived textbook and branch values", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const selectClassStart = source.indexOf("const selectClass = (");
  const emptyClassSource = source.slice(
    source.indexOf("if (!classId) {", selectClassStart),
    source.indexOf("if (!classItem) return", selectClassStart),
  );

  assertIncludesAll(emptyClassSource, [
    'if (options.fillRegistration) selectTextbook("")',
    'if (options.fillWordRetest) {',
    'updateWordRetest("className", "")',
    'updateWordRetest("branch", "")',
    'selectTextbook("", { fillWordRetest: true })',
  ]);
  assert.doesNotMatch(emptyClassSource, /if \(options\.fillWordRetest\) updateWordRetest\("className", ""\)\s+if \(options\.fillTransferFrom\)/);
});

test("word retest teacher changes clear only the previous teacher-derived assignee", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const selectTeacherSource = source.slice(
    source.indexOf("const selectTeacher = ("),
    source.indexOf("const selectTextbook ="),
  );

  assertIncludesAll(selectTeacherSource, [
    'const previousTeacher = findTeacher(wordRetest.teacherId || "")',
    "const previousTeacherProfileId = previousTeacher?.profileId || \"\"",
    'form.assigneeId === previousTeacherProfileId',
    'updateForm("assigneeId", "")',
    "if (teacher.profileId) updateForm(\"assigneeId\", teacher.profileId)",
    "else if (previousTeacherProfileId && form.assigneeId === previousTeacherProfileId)",
  ]);
  assert.doesNotMatch(selectTeacherSource, /if \(!teacherId\) \{\s+updateWordRetest\("teacherName", ""\)\s+return/);
});

test("word retest teacher requests start from the signed-in teacher catalog", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const helperSource = source.slice(
    source.indexOf("function getCurrentUserTeacherOption"),
    source.indexOf("function buildOpsTaskOptionIndexes"),
  );
  const createSource = source.slice(
    source.indexOf("function openCreate"),
    source.indexOf("function queueCompletionBlockerFocus"),
  );

  assertIncludesAll(helperSource, [
    "function getCurrentUserTeacherOption",
    "teacher.profileId === safeUserId",
    "const currentEmail = normalizeLookupValue(currentUserEmail)",
    "normalizeLookupValue(teacher.accountEmail) === currentEmail",
  ]);
  assertIncludesAll(source, [
    "const currentUserTeacher = useMemo(",
    "getCurrentUserTeacherOption(teachers, currentUserId, user?.email || \"\")",
  ]);
  assertIncludesAll(createSource, [
    "const wordRetestTeacherDefaults = type === \"word_retest\" && currentUserTeacher",
    "assigneeId: currentUserTeacher.profileId || defaultAssigneeId",
    "wordRetest: {",
    "teacherId: currentUserTeacher.id",
    "teacherName: currentUserTeacher.label",
    "...wordRetestTeacherDefaults",
  ]);
});

test("management sync connects registration transfer withdrawal and word retest data", async () => {
  const [workspaceSource, serviceSource, accessMigrationSource, deleteGuardMigrationSource, detailDeleteGuardMigrationSource] = await Promise.all([
    readSource("src/features/tasks/ops-task-workspace.tsx"),
    readSource("src/features/tasks/ops-task-service.ts"),
    readSource("supabase/migrations/20260524150000_ops_word_retest_teacher_access.sql"),
    readSource("supabase/migrations/20260524153000_ops_task_history_delete_guard.sql"),
    readSource("supabase/migrations/20260524154000_ops_task_detail_history_delete_guard.sql"),
  ]);

  assertIncludesAll(workspaceSource, [
    "getOperationCompletionBlockers",
    "getOpsTaskScheduleCompletionBlockers",
    "getRegistrationEffectiveTextbookId",
    "getRegistrationDuplicateCompletionBlockers",
    "getRegistrationDuplicateStudentCandidates",
    "registrationDuplicateCandidates",
    "자동 반영",
    "확인 필요",
    "기존 학생 연결",
    "기존 학생 후보",
    "getRegistrationDuplicateCompletionBlockers(input, students).forEach((blocker) => blockers.push(blocker))",
    '"기존 학생 후보": "기존 학생 연결"',
    "onSelect={(studentId) => selectStudent(studentId, { fillRegistration: true })}",
    "hasLinkedRecord(input.studentId)",
    "!hasLinkedRecord(input.classId)",
    "const registrationTextbookId = getRegistrationEffectiveTextbookId(input, { classes })",
    "!hasLinkedRecord(registrationTextbookId)",
    "const wordRetestTextbookId = getWordRetestEffectiveTextbookId(input, { classes })",
    "!hasLinkedRecord(wordRetestTextbookId)",
    "fromClass && toClass && fromClass.id === toClass.id",
    "findStudentOptionByReference",
    "findClassOptionByReference",
    "findTextbookOption(textbooks, wordRetestTextbookId, indexes)",
    "findTeacherOption(teachers, wordRetest.teacherId, indexes)",
    "wordRetest.teacherName",
    "blockers.push",
    "wordRetest.teacherId",
    "wordRetest.branch",
    "wordRetest.testAt",
    "wordRetest.unit",
    "hasWordRetestScore",
    "function shouldRequireWordRetestScore",
    "!isWordRetestAbsent(wordRetest) && !hasWordRetestScore(wordRetest)",
    'if (value === "absent")',
    "점수 없음",
    "function CompletionBlockerActionPanel",
    "function CompletionBlockerInlineChips",
    "function ClassPlanInlineSummary",
    "selectedWithdrawalClass",
    "withdrawalClassTextbooks",
    "function getWithdrawalSessionRiskLabel",
    "function WithdrawalClassSettlementSummary",
    "<WithdrawalClassSettlementSummary",
    "퇴원 정산 기준",
    "퇴원회차 초과",
    "진행/4주 기준",
    "수업 교재",
    "미배부 교재",
    "selectedTransferFromClass",
    "selectedTransferToClass",
    "수업계획",
    "수업교재",
    "selectTextbook(textbook.id)",
    "교재 연결 없음",
    "function TransferClassComparisonSummary",
    "<TransferClassComparisonSummary",
    "전반 비교",
    "전 수업 교재",
    "후 수업 교재",
    "전 미배부 교재",
    "후 미배부 교재",
    "종료/시작",
    "const shouldUpdatePrimaryClass = !options.fillTransferFrom || options.fillTransferTo",
    'if (shouldUpdatePrimaryClass) updateForm("classId", classId)',
    "shouldRefreshPrimaryTextbook",
    "회차 미생성",
    "교재 미연결",
    "진도 미배정",
    "const classPlanRiskLabel",
    "Number(classItem.textbookIds?.length || 0) <= 0",
    "Number(classItem.sessionCount || 0) <= 0",
    "미배정",
    "getCompletionBlockerActionLabel([blocker])",
    "{formCompletionBlockers.length > 0 && (",
    "showNeed",
    "isOwnGeneralTask",
    "[task.requestedBy, task.assigneeId, task.secondaryAssigneeId].includes(currentUserId)",
    "완료 전",
    "aria-label=\"완료 전 필요한 입력\"",
    "INPUT_COMPLETION_BLOCKERS",
    "CHOICE_COMPLETION_BLOCKERS",
    '"퇴원회차": "퇴원회차 지정"',
    '"진행 수업시수": "진행 수업시수 입력"',
    '"4주 기준 수업시수": "4주 기준 수업시수 입력"',
    '"수업시수 충돌": "수업시수 수정"',
    '"전 수업 종료회차": "전 수업 종료회차 지정"',
    '"후 수업 시작회차": "후 수업 시작회차 지정"',
    '"수업시작회차": "수업시작회차 입력"',
    '"일정 충돌": "일정 충돌 수정"',
    '"회차 충돌": "회차 충돌 수정"',
    '"회차 공백": "회차 공백 수정"',
    '"수업시수 충돌": "수업시수 수정"',
    "getOpsTaskScheduleCompletionBlockers(input, { classes }).forEach((blocker) => blockers.push(blocker))",
    '"수업계획 회차": "수업계획 확인"',
    '"수업계획 진도": "수업계획 진도 확인"',
    '"수업계획 교재": "수업계획 교재 확인"',
    '"수업계획 회차"',
    '"수업계획 진도"',
    '"수업계획 교재"',
    "입력 필요",
    "선택 필요",
    "수정 필요",
  ]);
  assert.doesNotMatch(workspaceSource, /currentFormCompletionBlockers/);
  assert.doesNotMatch(workspaceSource, /getCompletionReadinessInput/);
  assert.doesNotMatch(workspaceSource, /isCompletionReadinessStep/);
  assert.doesNotMatch(workspaceSource, /ManagementSyncPreview/);
  assert.doesNotMatch(workspaceSource, /CompletionReadinessPreview/);
  assert.doesNotMatch(workspaceSource, /RegistrationAutoSyncPreview|OperationAutoSyncPreview|getOperationSyncItemKindLabel|registrationSyncItems|withdrawalSyncItems|transferSyncItems|자동 연결/);
  assert.doesNotMatch(workspaceSource, />\s*완료 전\s*<\/span>/);

  assertIncludesAll(serviceSource, [
    "assertManagementSyncReady",
    "assertManagementSyncRecordsReady",
    "assertRegistrationDuplicateResolved",
    "등록 완료 전에 기존 학생 후보를 연결하세요.",
    "hasManagementReference(input.classId)",
    "hasManagementReference(input.textbookId, input.textbookTitle, input.classId)",
    "hasManagementReference(wordRetest.teacherId)",
    "hasManagementReference(transfer.fromClassId)",
    "hasManagementReference(transfer.toClassId || input.classId)",
    'return current === "absent" ? "absent" : "done"',
    "function shouldRequireWordRetestScore",
    "function inferClassBranch",
    "inferClassBranch(classRow)",
    "!isWordRetestAbsent(wordRetest) && !hasWordRetestScore(wordRetest)",
    "isSameManagementReference(transfer.fromClassId, transfer.toClassId || input.classId)",
    "ensureOpsStudent",
    "assignOpsStudentToClass",
    "assignOpsTextbookToClass",
    "buildRegistrationTextbookSaleDraft",
    "resolveOpsRegistrationTextbook",
    "getSingleClassPlanTextbookId",
    "textbook = await resolveOpsRegistrationTextbook(input, classRow)",
    "ensureRegistrationTextbookIssueDraft",
    "await ensureRegistrationTextbookIssueDraft(taskId, input, student, classRow, textbook)",
    ".from(\"textbook_sales\")",
    ".from(\"textbook_sale_lines\")",
    "교재 청구/출고",
    "removeOpsStudentFromClass",
    "syncRegistrationManagementLinks",
    "syncWithdrawalManagementLinks",
    "syncTransferManagementLinks",
    "syncWordRetestManagementLinks",
    "function getClassPlanMetrics",
    "function getClassPlanTextbookIds",
    "schedule_plan",
    "textbookId || textbook_id || id",
    "...getClassPlanTextbookIds(row)",
    "sessionCount",
    "plannedSessionCount",
    "unplannedSessionCount",
    "function assertDifferentOpsClass",
    "assertDifferentOpsClass(fromClass, toClass",
    "전반 완료 전에 전 수업과 후 수업을 다르게 선택하세요.",
    "resolveOpsRegistrationStudent",
    "matchesOpsRegistrationStudent",
    "identityFields.length === 0",
    "supportingFields",
    "return null",
    "const existingStudent = completed ? await resolveOpsRegistrationStudent(input) : null",
    "const firstDelete = await supabase.from(\"ops_tasks\").delete().eq(\"id\", taskId)",
    "export async function deleteOpsTask",
    "MANAGEMENT_INPUT_FIELDS",
    "assertOpsTaskSchedulePlanReady(input, [toOpsClassPlanReference",
    "getOpsTaskScheduleCompletionBlockers(input, {",
    "function toOpsClassPlanReference",
    "textbookIds: getClassPlanTextbookIds(row)",
    "수업계획 회차",
    "수업계획 진도",
    "수업계획 교재",
    "MANAGEMENT_CHOICE_FIELDS",
    "managementMissingFieldLabel",
    '"일정 충돌"',
    '"수업시작회차"',
    '"회차 공백"',
    'const MANAGEMENT_FIX_FIELDS = new Set(["일정 충돌", "회차 충돌", "회차 공백", "수업시수 충돌"])',
    "입력 필요",
    "선택 필요",
    "연결 필요",
    '"registration_completed"',
    '"withdrawal_completed"',
    '"transfer_from_class"',
    '"transfer_to_class"',
    ".from(\"ops_word_retests\")",
  ]);
  const classPlanReferenceBlock = serviceSource.slice(
    serviceSource.indexOf("function toOpsClassPlanReference"),
    serviceSource.indexOf("function getClassPlanTextbookIds"),
  );
  assert.match(classPlanReferenceBlock, /plannedSessionCount: planMetrics\.plannedSessionCount/);

  assertIncludesAll(accessMigrationSource, [
    "create schema if not exists dashboard_private",
    "create or replace function dashboard_private.is_ops_word_retest_teacher",
    "set search_path = ''",
    "teacher.profile_id = auth.uid()",
    "revoke all on function dashboard_private.is_ops_word_retest_teacher(uuid) from public",
    "or dashboard_private.is_ops_word_retest_teacher(id)",
    "drop policy if exists ops_tasks_select",
    "drop policy if exists ops_tasks_update",
  ]);

  assertIncludesAll(deleteGuardMigrationSource, [
    "drop policy if exists ops_tasks_delete",
    "public.current_dashboard_role() = 'admin'",
    "type = 'general'",
    "requested_by = auth.uid()",
    "assignee_id = auth.uid()",
    "secondary_assignee_id = auth.uid()",
    "requested_by = auth.uid()\n      and status not in ('done', 'canceled')",
    "public.current_dashboard_role() = 'staff'",
    "type = 'general'",
    "status not in ('done', 'canceled')",
  ]);

  const deleteOpsTaskSource = serviceSource.slice(
    serviceSource.indexOf("export async function deleteOpsTask"),
    serviceSource.indexOf("export async function addOpsTaskComment"),
  );
  assertIncludesAll(deleteOpsTaskSource, [
    "await assertOpsTaskExists(taskId)",
  ]);
  assertIncludesAll(serviceSource, [
    "async function assertOpsTaskExists(taskId: string)",
    ".from(\"ops_tasks\").select(\"id\").eq(\"id\", taskId).limit(1)",
    "function isMissingOpsTaskReferenceError(error: unknown)",
    "code === \"23503\"",
    "message.includes(\"foreign key\") && message.includes(\"ops_tasks\")",
    "function throwIfMissingOpsTaskReference(error: unknown): never",
    "function didMutateOpsTask(data: unknown)",
    "throw new Error(\"업무 데이터를 다시 불러오세요.\")",
  ]);
  assertIncludesAll(deleteOpsTaskSource, [
    ".from(\"ops_tasks\").delete().eq(\"id\", taskId).select(\"id\")",
    "if (!didMutateOpsTask(data)) throw new Error(\"업무 데이터를 다시 불러오세요.\")",
  ]);
  assert.doesNotMatch(deleteOpsTaskSource, /deleteOpsTaskChildRows/);

  assertIncludesAll(detailDeleteGuardMigrationSource, [
    "drop policy if exists ops_registration_details_write",
    "create policy ops_withdrawal_details_delete",
    "create policy ops_transfer_details_delete",
    "create policy ops_word_retests_delete",
    "public.current_dashboard_role() = 'admin'",
    "public.current_dashboard_role() = 'staff'",
    "ops_tasks.status not in ('done', 'canceled')",
  ]);
});

test("registration duplicate candidates stay visible through final review", async () => {
  const workspaceSource = await readSource("src/features/tasks/ops-task-workspace.tsx");

  assertIncludesAll(workspaceSource, [
    "function RegistrationDuplicateCandidatePanel",
    "formatRegistrationDuplicateCandidateDetail",
    "candidate.reasons",
    "등록 완료 전에 후보를 확인하고 기존 학생이면 연결하세요.",
    "selectedStudentId={form.studentId || \"\"}",
  ]);

  const checksStepIndex = workspaceSource.indexOf('if (step === "registration_checks")');
  assert.ok(checksStepIndex > 0);
  const panelIndex = workspaceSource.indexOf("<RegistrationDuplicateCandidatePanel", checksStepIndex);
  const checklistIndex = workspaceSource.indexOf("<RegistrationCompletionChecklist", checksStepIndex);
  assert.ok(panelIndex > checksStepIndex);
  assert.ok(checklistIndex > panelIndex);
});

test("registration class-plan textbook blockers route to the start step without duplicate generic textbook work", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const registrationBlockerStart = source.indexOf('if (input.type === "registration" && isRegistrationPipelineComplete(input))');
  const registrationBlockerEnd = source.indexOf('if (input.type === "withdrawal" && input.status === "done")', registrationBlockerStart);
  const stepFunctionStart = source.indexOf("function getCompletionBlockerFormStep");
  const registrationStepStart = source.indexOf('if (type === "registration")', stepFunctionStart);
  const registrationStepEnd = source.indexOf('if (type === "withdrawal")', registrationStepStart);

  assert.notEqual(registrationBlockerStart, -1);
  assert.notEqual(registrationBlockerEnd, -1);
  assert.notEqual(stepFunctionStart, -1);
  assert.notEqual(registrationStepStart, -1);
  assert.notEqual(registrationStepEnd, -1);

  const registrationBlockerSource = source.slice(registrationBlockerStart, registrationBlockerEnd);
  const registrationStepSource = source.slice(registrationStepStart, registrationStepEnd);

  assertIncludesAll(registrationBlockerSource, [
    "const registrationClass = findClassOption(classes, input.classId, indexes)",
    "const registrationClassPlanNeedsTextbook = Boolean(registrationClass && registrationClass.textbookIds.length <= 0)",
    "if (!hasLinkedRecord(registrationTextbookId) && !registrationClassPlanNeedsTextbook) blockers.push(\"교재\")",
  ]);
  assertIncludesAll(registrationStepSource, [
    "\"수업계획 교재\"",
  ]);
});

test("operation class options preserve exact class-plan session readiness", async () => {
  const [workspaceSource, serviceSource] = await Promise.all([
    readSource("src/features/tasks/ops-task-workspace.tsx"),
    readSource("src/features/tasks/ops-task-service.ts"),
  ]);

  assertIncludesAll(serviceSource, [
    "type OpsClassPlanSessionOption = {",
    "function getClassPlanSessionSummaries",
    "sessionOrder:",
    "planned:",
    "planSessions:",
    "planMetrics.planSessions",
  ]);

  assertIncludesAll(workspaceSource, [
    "function getClassPlanSelectedSession",
    "const selectedSession = getClassPlanSelectedSession(classItem, selectedSessionNumber)",
    'if (!selectedSession) return "퇴원회차 없음"',
    'if (selectedSession.planned === false) return "진도 미배정 회차"',
  ]);
});

test("completed operational tasks cannot be reopened by status alone", async () => {
  const [serviceSource, migrationSource] = await Promise.all([
    readSource("src/features/tasks/ops-task-service.ts"),
    readSource("supabase/migrations/20260524160000_ops_task_completed_operation_status_guard.sql"),
  ]);

  assertIncludesAll(serviceSource, [
    "function assertCompletedOperationStatusTransition(task: OpsTask, status: OpsTaskStatus)",
    "task.type !== \"general\"",
    "task.status === \"done\"",
    "status !== \"done\"",
    "완료된 운영 업무는 관리 데이터가 반영되어 상태만 되돌릴 수 없습니다.",
    "const currentTask = await loadOpsTaskById(task.id)",
    "if (!currentTask) throw new Error(\"업무 데이터를 다시 불러오세요.\")",
    "assertCompletedOperationStatusTransition(currentTask, status)",
    "if (error || !didMutateOpsTask(data))",
    "throw new Error(\"업무 데이터를 다시 불러오세요.\")",
    "await writeEvent(currentTask.id, \"status_changed\", \"status\", currentTask.status, status)",
  ]);

  assertIncludesAll(migrationSource, [
    "create or replace function public.prevent_completed_operation_reopen()",
    "old.type <> 'general'",
    "old.status = 'done'",
    "new.status <> 'done'",
    "raise exception '완료된 운영 업무는 관리 데이터가 반영되어 상태만 되돌릴 수 없습니다.'",
    "create trigger prevent_completed_operation_reopen",
  ]);
});

test("status-only completion still enforces manual operation checks", async () => {
  const serviceSource = await readSource("src/features/tasks/ops-task-service.ts");
  const updateStatusSource = serviceSource.slice(
    serviceSource.indexOf("export async function updateOpsTaskStatus"),
    serviceSource.indexOf("export async function deleteOpsTask"),
  );
  const doneBranchSource = updateStatusSource.slice(
    updateStatusSource.indexOf('if (status === "done")'),
    updateStatusSource.indexOf("const { data, error } = await supabase"),
  );

  assertIncludesAll(doneBranchSource, [
    "const nextInput = inputFromTask(currentTask, status)",
    "assertManagementSyncReady(nextInput)",
    "await assertManagementSyncRecordsReady(nextInput)",
    "await syncOpsTaskManagementLinks(currentTask.id, nextInput)",
  ]);
  assert.ok(
    doneBranchSource.indexOf("assertManagementSyncReady(nextInput)") <
      doneBranchSource.indexOf("await assertManagementSyncRecordsReady(nextInput)"),
    "manual checklist fields should fail before roster/student sync runs",
  );
});

test("completed operational task details are locked after management sync", async () => {
  const [serviceSource, migrationSource] = await Promise.all([
    readSource("src/features/tasks/ops-task-service.ts"),
    readSource("supabase/migrations/20260524162000_ops_completed_operation_detail_update_guard.sql"),
  ]);
  const workspaceSource = await readSource("src/features/tasks/ops-task-workspace.tsx");

  assertIncludesAll(serviceSource, [
    "function assertCompletedOperationEditable(task: OpsTask)",
    "task.type !== \"general\"",
    "task.status === \"done\"",
    "완료된 운영 업무는 관리 데이터와 이력이 연결되어 수정할 수 없습니다.",
    "if (!existingTask) throw new Error(\"업무 데이터를 다시 불러오세요.\")",
    "assertCompletedOperationEditable(existingTask)",
    "if (error || !didMutateOpsTask(data))",
  ]);
  const commentSource = serviceSource.slice(
    serviceSource.indexOf("export async function addOpsTaskComment"),
    serviceSource.indexOf("export async function addOpsTaskAttachment"),
  );
  const attachmentSource = serviceSource.slice(
    serviceSource.indexOf("export async function addOpsTaskAttachment"),
    serviceSource.indexOf("export { getOpsTaskCalendarItems"),
  );
  for (const source of [commentSource, attachmentSource]) {
    assertIncludesAll(source, [
      "await assertOpsTaskExists(taskId)",
      "if (error) throwIfMissingOpsTaskReference(error)",
    ]);
  }
  assert.ok(
    serviceSource.indexOf("assertCompletedOperationEditable(existingTask)") <
      serviceSource.indexOf("assertManagementSyncReady(input)", serviceSource.indexOf("export async function updateOpsTask")),
    "completed operation edits should be rejected before expensive management-sync validation",
  );

  assertIncludesAll(migrationSource, [
    "drop policy if exists ops_registration_details_insert on public.ops_registration_details;",
    "drop policy if exists ops_registration_details_update on public.ops_registration_details;",
    "drop policy if exists ops_withdrawal_details_insert on public.ops_withdrawal_details;",
    "drop policy if exists ops_withdrawal_details_update on public.ops_withdrawal_details;",
    "drop policy if exists ops_transfer_details_insert on public.ops_transfer_details;",
    "drop policy if exists ops_transfer_details_update on public.ops_transfer_details;",
    "drop policy if exists ops_word_retests_insert on public.ops_word_retests;",
    "drop policy if exists ops_word_retests_update on public.ops_word_retests;",
    "create policy ops_registration_details_insert",
    "public.current_dashboard_role() = 'admin'",
    "ops_tasks.status not in ('done', 'canceled')",
  ]);

  assertIncludesAll(workspaceSource, [
    "function canEditTaskDetails(task: Pick<OpsTask, \"type\" | \"status\">)",
    "task.type === \"general\" || task.status !== \"done\"",
    "const selectedTaskCanEdit = selectedTaskFresh ? canEditTaskDetails(selectedTaskFresh) : false",
    "canEditTaskDetails(task) &&",
    "selectedTaskCanEdit &&",
  ]);
});

test("approval workspace supports monthly report templates and approval history", async () => {
  const [pageSource, workspaceSource, serviceSource, migrationSource, templateMigrationSource, navigationSource] = await Promise.all([
    readSource("src/app/admin/approvals/page.tsx"),
    readSource("src/features/approvals/approval-workspace.tsx"),
    readSource("src/features/approvals/approval-service.ts"),
    readSource("supabase/migrations/20260523190000_approval_requests.sql"),
    readSource("supabase/migrations/20260524113000_approval_templates.sql"),
    readSource("src/lib/navigation.ts"),
  ]);

  assert.match(pageSource, /<ApprovalWorkspace \/>/);
  assertIncludesAll(workspaceSource, [
    "\uc601\uc5b4 \uc6d4\uac04 \ubcf4\uace0\uc11c",
    "\uc218\ud559 \uc6d4\uac04 \ubcf4\uace0\uc11c",
    "\uc790\uc720 \uc11c\uc2dd",
    "ENGLISH_MONTHLY_CHECKS",
    "MATH_COMMON_CHECKS",
    "function checklistGroups",
    "function buildTemplateInput",
    "function buildSavedTemplateTitle",
    "canSubmitApproval",
    "approvalManagerOptions",
    "nonRequesterApprovers",
    "nonRequesterApprovers.length > 0 ? nonRequesterApprovers : approvalManagerOptions",
    "progress.percent",
    "placeholder=\"예: 고1 영어A / 전체\"",
    "placeholder=\"월간 보고 내용을 자유롭게 정리\"",
    "결재자 미정",
    "기본 서식",
    "saveApprovalTemplate",
    "APPROVAL_VIEWS",
    "createMonthlyReportApproval",
    "updateMonthlyReportApproval",
    "updateApprovalStatus",
    "addApprovalComment",
    "function ApprovalActivity({ comments, events }",
    "approvalEventLabel(event)",
    "placeholder=\"\ub313\uae00\"",
    "from \"@/components/ui/empty\"",
    "<Empty className=\"min-h-48 border-0 p-8\">",
  ]);

  assertIncludesAll(serviceSource, [
    'export type ApprovalStatus = "draft" | "submitted" | "reviewing" | "approved" | "returned" | "canceled"',
    'export type ApprovalSubject = "english" | "math" | "general"',
    "export type ApprovalChecklistItem = {",
    "group?: string",
    "export type ApprovalTemplate = {",
    "function parseChecklistItems",
    "subject: (text(row.subject) || \"general\") as ApprovalSubject",
    "templateKey: text(row.template_key) || \"free\"",
    "checklistItems: parseChecklistItems(row.checklist_items)",
    "attachmentLinks: text(row.attachment_links)",
    ".from(\"approval_templates\")",
    "export async function saveApprovalTemplate",
    ".from(\"approval_comments\")",
    ".from(\"approval_events\")",
    "export async function addApprovalComment",
    ".from(\"approval_requests\")",
  ]);

  assertIncludesAll(migrationSource, [
    "create table if not exists public.approval_requests",
    "request_type in ('monthly_report', 'general')",
    "subject text not null default 'general'",
    "template_key text not null default 'free'",
    "checklist_items jsonb not null default '[]'::jsonb",
    "approval_requests_subject_idx",
    "write_approval_status_event",
  ]);

  assertIncludesAll(templateMigrationSource, [
    "create table if not exists public.approval_templates",
    "checklist_items jsonb not null default '[]'::jsonb",
    "approval_templates_select_shared_or_own",
  ]);
  assert.ok(navigationSource.includes(`title: "${ko.approvals}"`));
});

test("dashboard and browser workflow scripts target the new operation surfaces", async () => {
  const [dashboardSummary, workspaceSource, serviceSource, scriptSource, sampleScriptSource] = await Promise.all([
    readSource("src/features/tasks/ops-task-dashboard-summary.tsx"),
    readSource("src/features/tasks/ops-task-workspace.tsx"),
    readSource("src/features/tasks/ops-task-service.ts"),
    readSource("scripts/verify-ops-task-browser-workflow.mjs"),
    readSource("scripts/verify-ops-task-sample-workflow.mjs"),
  ]);

  assertIncludesAll(dashboardSummary, [
    "loadOpsTodoDashboardSummaryData",
    "getOpsTaskBasicCompletionBlockers",
    "isOpsTaskActionable",
    "isOpsTaskBasicConfirmationCandidate",
    "type OpsClassOption",
    "type OpsStudentOption",
    "type OpsTextbookOption",
    "type OpsTeacherOption",
    "const actionableQueueTasks = data.tasks.filter((task) => isOpsTaskActionable(task, { today: todayKey }))",
    "function hasDashboardTaskOrganizationIssue(",
    "function getDashboardTaskOrganizationIssueLabels(",
    "function getDashboardTaskConfirmationIssueLabels(",
    "function formatDashboardMetricDetail(",
    "textbooks: OpsTextbookOption[]",
    "teachers: OpsTeacherOption[]",
    "getOpsTaskBasicCompletionBlockers(task, { classes, students, textbooks, teachers }).length > 0",
    "담당자 미정",
    "일정 미정",
    "요청 확인",
    "unassignedDetail: formatDashboardMetricDetail(organizationIssueLabels)",
    "confirmationDetail: formatDashboardMetricDetail(confirmationIssueLabels)",
    'detail={summary.unassignedDetail}',
    'detail={summary.confirmationDetail}',
    "text-xs text-muted-foreground",
    "isOpsTaskBasicConfirmationCandidate(task, { classes: data.classes, students: data.students, textbooks: data.textbooks, teachers: data.teachers })",
    "md:grid-cols-5",
    'href="/admin/tasks?list=mine"',
    'href="/admin/tasks?list=filters&filter=confirmation"',
    `label="${ko.today}"`,
    `label="${ko.overdue}"`,
    `label="${ko.mine}"`,
    `label="${ko.unassigned}"`,
    'label="확인 필요"',
  ]);
  assert.doesNotMatch(dashboardSummary, /data\.tasks\.filter\(\(task\) => !isClosedOpsTask\(task\)\)/);
  assert.doesNotMatch(dashboardSummary, /filter=mine/);
  assert.doesNotMatch(dashboardSummary, /openOperationTasks/);
  assert.doesNotMatch(dashboardSummary, /openGeneralTasks/);

  assertIncludesAll(serviceSource, [
    "type OpsTaskWorkspaceLoadOptions",
    "export type OpsTaskAutomationRule",
    "export type OpsTaskNotificationChannel",
    "getOpsTaskWorkspaceCacheKey",
    "const opsTaskWorkspaceDataCache = new Map",
    "if (options.taskType) taskQuery = taskQuery.eq(\"type\", options.taskType)",
    'readTable("ops_task_automation_rules"',
    'readTable("ops_task_notification_channels"',
    "mappedAutomationRules",
    "buildAutomationRuleStatus",
    "notificationChannels: notificationChannelRows",
    "export async function createOpsTaskAutomationRule",
    "export async function updateOpsTaskAutomationRule",
    "export async function createOpsTaskNotificationChannel",
    "export async function updateOpsTaskNotificationChannel",
    "shouldReadRegistration ? readTaskScopedTable",
    "export async function loadOpsTodoDashboardSummaryData",
    "classes: OpsClassOption[]",
    "textbooks: OpsTextbookOption[]",
    "teachers: OpsTeacherOption[]",
    "loadOpsTaskWorkspaceData({ includeManagementOptions: true })",
    "classes: workspaceData.classes",
    "textbooks: workspaceData.textbooks",
    "teachers: workspaceData.teachers",
    "automationRuleId: text(row.automation_rule_id)",
    "automationSourceKey: text(row.automation_source_key)",
    "automation_generated_at: automationGeneratedAt",
  ]);
  assert.doesNotMatch(serviceSource, /loadOpsTaskWorkspaceData\(\{ includeManagementOptions: false \}\)/);
  assert.doesNotMatch(serviceSource, /\\.eq\\("type", "general"\\)/);

  assertIncludesAll(workspaceSource, [
    "createOpsTaskAutomationRule",
    "updateOpsTaskAutomationRule",
    "createOpsTaskNotificationChannel",
    "updateOpsTaskNotificationChannel",
    "getOpsAutomationSourceLabel",
    "function AutomationRulePanel(",
    "function NotificationChannelPanel(",
    "data.automationRules",
    "data.notificationChannels",
    "반복 업무 템플릿",
    "Google Chat 채널",
    "getCachedOpsTaskWorkspaceData(workspaceLoadOptions)",
    'const workspaceTaskType = isTodoWorkspace ? "general" : scopedTaskType',
    "const workspaceIncludesManagementOptions = true",
    "const loadOptions = { taskType: workspaceTaskType, includeManagementOptions: workspaceIncludesManagementOptions }",
    "loadOpsTaskWorkspaceData({ ...loadOptions, force })",
    'todoView === "recurring"',
    'todoView === "automations"',
  ]);

  const authenticatedRoutesSource = scriptSource.slice(
    scriptSource.indexOf("const AUTHENTICATED_CORE_SMOKE_ROUTES"),
    scriptSource.indexOf("const ROUTES"),
  );

  assertIncludesAll(scriptSource, [
    "/admin/tasks?list=today",
    "/admin/tasks?list=board",
    "/admin/tasks?list=calendar",
    "/admin/dashboard",
    "/admin/registration",
    "/admin/transfer",
    "/admin/withdrawal",
    "/admin/word-retests",
    "/admin/approvals",
    "AUTHENTICATED_CORE_SMOKE_ROUTES",
    "/admin/students",
    "/admin/classes",
    "/admin/textbooks",
    "/admin/curriculum",
    "/admin/class-schedule",
    "/admin/curriculum/lesson-design",
    "/admin/timetable",
    "/admin/academic-calendar",
    "/admin/academic-calendar/annual-board",
    "/admin/settings/schools",
    "/admin/settings/teachers",
    "/admin/settings/classrooms",
    "/admin/settings/class-groups",
    "/admin/settings/textbook-suppliers",
    "management-students",
    "dashboard",
    "management-classes",
    "management-textbooks",
    "curriculum-planning",
    "class-schedule",
    "lesson-design",
    "timetable",
    "academic-calendar",
    "academic-annual-board",
    "settings-schools",
    "settings-teachers",
    "settings-classrooms",
    "settings-class-groups",
    "settings-textbook-suppliers",
    "verifyQuickAddInteraction",
    "verifySingleQuickAddInteraction",
    "오늘 오후 11시까지",
    'getByText("오늘 23:00"',
    "Todo quick-add preview did not parse the Korean due suffix.",
    "waitForBodyToExclude",
    "countRemainingUiSamples",
    "remainingUiSamples",
    "UI sample cleanup left",
    "OPS_BROWSER_QUICK_ADD_SAMPLE_COUNT",
    "OPS_BROWSER_OPERATION_SAMPLE_COUNT",
    "OPS_BROWSER_OPERATION_COMPLETE_SAMPLE",
    "DEFAULT_QUICK_ADD_SAMPLE_COUNT",
    "DEFAULT_OPERATION_SAMPLE_COUNT",
    "UI_COMPLETION_PREFIX",
    "samplesCreated",
    "completedOperationSamples",
    "operationCompletionSync",
    "for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1)",
    "const editedTitle = `${sampleTitle} 수정`",
    'getByRole("button", { name: "수정" })',
    'getByRole("button", { name: "완료" })',
    'getByRole("button", { name: "다시 열기" })',
    "verifySingleCreateDialogInteraction",
    "createOperationCompletionFixtures",
    "verifyOperationCompletionInteraction",
    "verifyOperationCompletionSet",
    "verifyOperationCompletionSync",
    "cleanupOperationCompletionFixtures",
    "fillOperationMinimumFields",
    "selectManualIfPresent",
    "제목 직접 지정",
    "다음: 등록 완료",
    "registration_student_linked",
    "withdrawal_status_applied",
    "transfer_assigned_to_new_class",
    "word_retest_links_resolved",
    "verifyCreateDialogInteraction",
    "verifyApprovalDraftInteraction",
    "Approval composer should start collapsed.",
    "Approval title did not refresh when report month changed.",
    "Approval body kept a stale monthly section after report month changed.",
    "Approval attachment template kept stale month labels.",
    'await monthInput.fill("2026-05")',
    'await monthInput.fill("2026-07")',
    'page.getByRole("combobox", { name: "결재자" })',
    '!optionText.includes("미정")',
    ".env.ops-browser.local",
    "OPS_BROWSER_LOGIN_ID/OPS_BROWSER_PASSWORD",
    "OPS_BROWSER_SUPABASE_STORAGE",
    "OPS_BROWSER_TEMP_USER",
    "OPS_BROWSER_PREFLIGHT",
    "buildOpsBrowserAuthPreflight",
    "canRunAuthenticatedWorkflow",
    "storage-state-file",
    "temp-user-storage",
    "ui-login",
    "missing",
    "SUPABASE_SERVICE_ROLE_KEY",
    "OPS_BROWSER_PUBLIC_SMOKE",
    "PUBLIC_SMOKE_ROUTES",
    "CORE_ADMIN_PUBLIC_SMOKE_ROUTES",
    "LEGACY_AUTH_PUBLIC_SMOKE_ROUTES",
    "LEGACY_ADMIN_PUBLIC_SMOKE_ROUTES",
    "ADMIN_ALIAS_PUBLIC_SMOKE_ROUTES",
    "runPublicSmoke",
    'authMode: "public-smoke"',
    "landing-alias-redirect",
    "next=%2Fadmin%2Fdashboard",
    "admin-root-redirect",
    "admin-calendar-alias-redirect",
    "admin-manual-alias-redirect",
    "admin-schools-alias-redirect",
    "admin-teachers-alias-redirect",
    "admin-classrooms-alias-redirect",
    "admin-terms-alias-redirect",
    "admin-settings-root-redirect",
    "admin-settings-account-redirect",
    "admin-settings-appearance-redirect",
    "admin-settings-connections-redirect",
    "admin-settings-notifications-redirect",
    "admin-settings-terms-redirect",
    "admin-settings-user-redirect",
    "protected-tasks-redirect",
    "protected-dashboard-redirect",
    "protected-approvals-redirect",
    "protected-registration-redirect",
    "protected-transfer-redirect",
    "protected-withdrawal-redirect",
    "protected-students-redirect",
    "protected-classes-redirect",
    "protected-textbooks-redirect",
    "protected-curriculum-redirect",
    "protected-timetable-redirect",
    "protected-academic-calendar-redirect",
    "protected-settings-schools-redirect",
    "legacy-admin-chat-redirect",
    "legacy-sign-in-2",
    "legacy-sign-up-2",
    "legacy-forgot-password-2",
    "expectedSearchIncludes",
    "next=%2Fadmin%2Ftasks%3FtaskId%3Dmissing-task-for-smoke",
    "next=%2Fadmin%2Fapprovals",
    "next=%2Fadmin%2Fcalendar",
    "next=%2Fadmin%2Fmanual",
    "next=%2Fadmin%2Fsettings%2Fschools",
    "next=%2Fadmin%2Fsettings%2Fnotifications",
    "createStorageStateFromSupabase",
    "createTemporaryBrowserUserStorage",
    "auth.admin.createUser",
    "auth.admin.deleteUser",
    "getSupabaseStorageKey",
    "input did not retain the filled value",
    "sign-in-login-id",
    "const localPartCandidate = normalizeLoginLocalPart(localPart)",
    "return unique([loginId, normalized, localPartCandidate])",
    "waitUntil: \"networkidle\"",
    'authMode = "supabase-storage"',
    'authMode = "temp-user-storage"',
    'authMode = "ui-login"',
    "catch {",
    "fixed step progress label",
    'getByRole("button", { name: "완료" })',
    'getByRole("button", { name: "해당 없음" })',
    'hiddenStatus of ["요청", "진행", "보류", "취소"]',
    'Todo detail leaked workflow status',
    'teacherButton.innerText()).includes("선생님")',
    'assistantButton.innerText()).includes("조교")',
    `expectedTexts: ["${ko.todo}", "${ko.today}", "${ko.add}"]`,
    `expectedTexts: ["${ko.registration}", "${ko.registration} ${ko.add}"]`,
    `expectedTexts: ["${ko.approvals}",`,
  ]);
  assertIncludesAll(authenticatedRoutesSource, [
    'path: "/admin/curriculum/lesson-design"',
  ]);
  assert.doesNotMatch(authenticatedRoutesSource, /path: "\/admin\/class-schedule\/lesson-design"/);

  assertIncludesAll(sampleScriptSource, [
    "word_retest_target as",
    "retest_status = case when word_retest_target.row_no = 1 then 'absent' else 'done' end",
    "first_score = case when word_retest_target.row_no = 1 then null else 100 end",
    "absent_word_retest_count",
    "absentWordRetest !== 1",
    'update({ retest_status: "absent", first_score: null, second_score: null, third_score: null })',
  ]);
});

test("browser verification dependencies are installed with the workspace", async () => {
  const [packageSource, browserScriptSource, guardScriptSource] = await Promise.all([
    readSource("package.json"),
    readSource("scripts/verify-ops-task-browser-workflow.mjs"),
    readSource("scripts/verify-admin-guard-smoke.mjs"),
  ]);
  const packageJson = JSON.parse(packageSource);
  const devDependencies = packageJson.devDependencies || {};

  assert.match(browserScriptSource, /await import\("playwright"\)/);
  assert.match(guardScriptSource, /await import\("playwright"\)/);
  assert.ok(devDependencies.playwright, "playwright must be a devDependency for browser verification scripts");
});

test("authenticated ops browser checks wait for visible route text instead of network idle", async () => {
  const scriptSource = await readSource("scripts/verify-ops-task-browser-workflow.mjs");
  const inspectRouteSource = scriptSource.slice(
    scriptSource.indexOf("async function inspectRoute"),
    scriptSource.indexOf("async function inspectPublicSmokeRoute"),
  );

  assert.match(inspectRouteSource, /waitUntil: "domcontentloaded"/);
  assert.match(inspectRouteSource, /const bodyText = await waitForRouteText\(page, route\)/);
  assert.doesNotMatch(inspectRouteSource, /waitUntil: "networkidle"/);
});

test("todo quick-add browser verifier creates a task visible in the today list", async () => {
  const scriptSource = await readSource("scripts/verify-ops-task-browser-workflow.mjs");
  const quickAddSource = scriptSource.slice(
    scriptSource.indexOf("async function verifySingleQuickAddInteraction"),
    scriptSource.indexOf("async function verifyQuickAddInteraction"),
  );

  assert.match(quickAddSource, /오늘 오후 11시까지/);
  assert.match(quickAddSource, /오늘 23:00/);
  assert.match(scriptSource, /async function clickStableText/);
  assert.match(scriptSource, /await page\.reload\(\{ waitUntil: "domcontentloaded" \}\)/);
  assert.match(quickAddSource, /await clickStableText\(page, sampleTitle, "created todo row"\)/);
  assert.match(quickAddSource, /await clickStableText\(page, editedTitle, "edited todo row"\)/);
  assert.doesNotMatch(quickAddSource, /내일 오전 10시까지/);
});

test("ops task service runs trigger automations after completion without mirroring state boards", async () => {
  const serviceSource = await readSource("src/features/tasks/ops-task-service.ts");

  assertIncludesAll(serviceSource, [
    "buildOpsTriggeredTaskDraft",
    "buildGoogleChatTaskNotificationPayload",
    "function triggerKeysForTaskAutomation",
    "\"registration.completed\"",
    "\"transfer.completed\"",
    "\"withdrawal.completed\"",
    "\"word_retest.completed\"",
    "\"ops.updated\"",
    "\"ops.assignee_assigned\"",
    "\"ops.date_confirmed\"",
    "async function createTriggeredOpsTaskFollowUps",
    "ops_task_automation_runs",
    "ops_task_notification_deliveries",
    "await createTriggeredOpsTaskFollowUps(existingTask, input)",
    "await createTriggeredOpsTaskFollowUps(currentTask, nextInput)",
  ]);
  assert.doesNotMatch(serviceSource, /pipeline_status_held/);
  assert.doesNotMatch(serviceSource, /status_held/);
});

test("automation settings surface run and Google Chat delivery state", async () => {
  const [serviceSource, workspaceSource] = await Promise.all([
    readSource("src/features/tasks/ops-task-service.ts"),
    readSource("src/features/tasks/ops-task-workspace.tsx"),
  ]);

  assertIncludesAll(serviceSource, [
    "export type OpsTaskAutomationRuleStatus",
    "buildAutomationRuleStatus",
    "ops_task_automation_runs",
    "ops_task_notification_deliveries",
    "pendingDeliveryCount",
    "failedDeliveryCount",
    "nextRunAtForAutomationRule",
  ]);
  assertIncludesAll(workspaceSource, [
    "formatAutomationDateLabel",
    "getAutomationRunStatusLabel",
    "getAutomationDeliveryStatusLabel",
    "getGoogleChatWebhookEnvKey",
    "GOOGLE_CHAT_WEBHOOK_",
    "최근 생성",
    "최근 {getAutomationRunStatusLabel",
    "대기 {rule.status.pendingDeliveryCount}",
    "실패 {rule.status.failedDeliveryCount}",
  ]);
});

test("automation rule forms preview generated work before saving", async () => {
  const workspaceSource = await readSource("src/features/tasks/ops-task-workspace.tsx");

  assertIncludesAll(workspaceSource, [
    "function AutomationRulePreview(",
    "function buildRecurringAutomationPreview(",
    "function buildTriggerAutomationPreview(",
    "예상 생성 결과",
    "생성 시점",
    "종료일",
    "우선순위",
    "체크리스트",
    "관련 메뉴",
    "createLeadDays",
    "endDate",
    "checklist",
    "relatedRoute",
    "자동화 규칙 저장 전에 실제 만들어질 업무를 확인",
  ]);
});

test("recurring automation settings expose monthly last weekday schedules", async () => {
  const workspaceSource = await readSource("src/features/tasks/ops-task-workspace.tsx");

  assertIncludesAll(workspaceSource, [
    '{ value: "last_weekday", label: "매월 마지막 요일" }',
    'recurringFrequency === "last_weekday"',
    'weekday: recurringFrequency === "last_weekday" ? Number.parseInt(recurringWeekday, 10) || 5 : null',
    '`매월 마지막 ${AUTOMATION_WEEKDAY_OPTIONS.find((option) => option.value === input.weekday)?.label || "금"}`',
  ]);
});

test("recurring automation settings expose after-completion generation", async () => {
  const [workspaceSource, runnerSource] = await Promise.all([
    readSource("src/features/tasks/ops-task-workspace.tsx"),
    readSource("src/server/ops-task-automation-runner.js"),
  ]);

  assertIncludesAll(workspaceSource, [
    "AUTOMATION_GENERATION_MODE_OPTIONS",
    "{ value: \"after_completion\", label: \"완료 후 다음 회차 생성\" }",
    "const [recurringGenerationMode, setRecurringGenerationMode]",
    '<SelectField label="생성 방식" value={recurringGenerationMode} onChange={setRecurringGenerationMode}>',
    "generationMode: recurringGenerationMode",
  ]);

  assertIncludesAll(runnerSource, [
    "isAfterCompletionRecurringRule",
    "listRecurringAutomationTasksByRule",
    "waiting_for_previous_completion",
    "taskScheduledFor(latestTask)",
  ]);
});

test("automation rule rows expose detailed run history instead of summary only", async () => {
  const [serviceSource, workspaceSource] = await Promise.all([
    readSource("src/features/tasks/ops-task-service.ts"),
    readSource("src/features/tasks/ops-task-workspace.tsx"),
  ]);

  assertIncludesAll(serviceSource, [
    "export type OpsTaskAutomationRunHistoryItem",
    "recentRuns: OpsTaskAutomationRunHistoryItem[]",
    "recentDeliveries: OpsTaskAutomationDeliveryHistoryItem[]",
    "buildAutomationRunHistory",
    "buildAutomationDeliveryHistory",
    "sourceKey: text(run.source_key)",
    "scheduledFor: text(run.scheduled_for)",
    "nextRetryAt: text(delivery.next_retry_at)",
  ]);
  assertIncludesAll(workspaceSource, [
    "function AutomationRuleHistory(",
    "실행 이력",
    "전송 이력",
    "sourceKey",
    "nextRetryAt",
    "rule.status.recentRuns",
    "rule.status.recentDeliveries",
  ]);
});

test("Google Chat channel settings can send an authenticated test message", async () => {
  const [workspaceSource, envExampleSource, channelPresetMigrationSource] = await Promise.all([
    readSource("src/features/tasks/ops-task-workspace.tsx"),
    readSource(".env.example"),
    readSource("supabase/migrations/20260528143000_ops_task_notification_channel_presets.sql"),
  ]);

  assertIncludesAll(workspaceSource, [
    "GOOGLE_CHAT_CHANNEL_PRESETS",
    "{ name: \"조교팀\", teamKey: \"assistants\" }",
    "{ name: \"영어팀\", teamKey: \"english\" }",
    "{ name: \"수학팀\", teamKey: \"math\" }",
    "{ name: \"관리팀\", teamKey: \"admin\" }",
    "{ name: \"전체 공지\", teamKey: \"all\" }",
    "applyChannelPreset",
    "팀방",
    "const handleTestNotificationChannel",
    "supabase.auth.getSession()",
    "fetch(\"/api/ops-task-notification-channels/test\"",
    "Authorization: `Bearer ${session.access_token}`",
    "onTest={handleTestNotificationChannel}",
    "테스트",
    "Google Chat 테스트 알림을 보냈습니다.",
  ]);

  assertIncludesAll(envExampleSource, [
    "GOOGLE_CHAT_WEBHOOK_ASSISTANTS=",
    "GOOGLE_CHAT_WEBHOOK_ENGLISH=",
    "GOOGLE_CHAT_WEBHOOK_MATH=",
    "GOOGLE_CHAT_WEBHOOK_ADMIN=",
    "GOOGLE_CHAT_WEBHOOK_PRINCIPAL=",
    "GOOGLE_CHAT_WEBHOOK_ALL=",
  ]);

  assertIncludesAll(channelPresetMigrationSource, [
    "'[팁스] 조교팀', 'assistants'",
    "'[팁스] 영어팀', 'english'",
    "'[팁스] 수학팀', 'math'",
    "'[팁스] 관리팀', 'admin'",
    "'[팁스] 전체 공지', 'all'",
    "on conflict (team_key) do update",
  ]);
});

test("Google Chat channel settings make env keys copyable for team-room setup", async () => {
  const workspaceSource = await readSource("src/features/tasks/ops-task-workspace.tsx");

  assertIncludesAll(workspaceSource, [
    "async function copyGoogleChatEnvKey",
    "navigator.clipboard.writeText",
    "copiedEnvKey",
    "setCopiedEnvKey",
    "환경변수 복사",
    "복사됨",
    "copyGoogleChatEnvKey(webhookEnvKey)",
    "copyGoogleChatEnvKey(getGoogleChatWebhookEnvKey(channel.teamKey))",
  ]);
});

test("automation generated checklists are stored and operated as task checklist items", async () => {
  const [serviceSource, workspaceSource, migrationSource, runnerSource] = await Promise.all([
    readSource("src/features/tasks/ops-task-service.ts"),
    readSource("src/features/tasks/ops-task-workspace.tsx"),
    readSource("supabase/migrations/20260528133000_ops_task_checklist_items.sql"),
    readSource("src/server/ops-task-automation-runner.js"),
  ]);

  assertIncludesAll(serviceSource, [
    "export type OpsTaskChecklistItem",
    "checklistItems: parseOpsTaskChecklistItems(row.checklist_items)",
    "checklist_items: normalizeOpsTaskChecklistItems(input.checklistItems)",
    "stripMissingMigrationColumns(row, [\"checklist_items\"])",
  ]);

  assertIncludesAll(workspaceSource, [
    "function TaskChecklistPanel(",
    "onChecklistItemChange",
    "체크리스트",
    "updateForm(\"checklistItems\"",
    "selectedTaskFresh.checklistItems",
  ]);

  assertIncludesAll(runnerSource, [
    "checklistItems: buildAutomationChecklistItems(action.checklist || action.checklistItems || action.checklist_items)",
    "checklist_items: normalizeTaskChecklistItems(input.checklistItems)",
  ]);

  assertIncludesAll(migrationSource, [
    "alter table public.ops_tasks",
    "add column if not exists checklist_items jsonb not null default '[]'::jsonb",
    "jsonb_typeof(checklist_items) = 'array'",
  ]);
});

test("trigger automation rules expose structured filters and duplicate due handling", async () => {
  const [workspaceSource, serviceSource, runnerSource, migrationSource] = await Promise.all([
    readSource("src/features/tasks/ops-task-workspace.tsx"),
    readSource("src/features/tasks/ops-task-service.ts"),
    readSource("src/server/ops-task-automation-runner.js"),
    readSource("supabase/migrations/20260528120000_ops_task_automation_core.sql"),
  ]);

  assertIncludesAll(workspaceSource, [
    "추가 조건",
    "캠퍼스 조건",
    "과목 조건",
    "학년 조건",
    "담당팀 조건",
    "상태 조건",
    "중복 처리",
    "기존 마감일 갱신",
    "duplicatePolicy: triggerDuplicatePolicy",
    "filters: buildAutomationConditionFilters",
  ]);

  assertIncludesAll(serviceSource, [
    'status: "created" | "updated" | "skipped" | "failed"',
    "async function updateExistingAutomationTaskDue",
    "draft.updateTask",
    "duplicate_update_due",
  ]);

  assertIncludesAll(runnerSource, [
    "updated: 0",
    "draft.updateTask",
    "await store.updateTask",
    "duplicate_update_due",
  ]);

  assertIncludesAll(migrationSource, [
    "status in ('created', 'updated', 'skipped', 'failed')",
  ]);
});

test("trigger automation settings include curriculum plan follow-up rules", async () => {
  const workspaceSource = await readSource("src/features/tasks/ops-task-workspace.tsx");

  assertIncludesAll(workspaceSource, [
    'triggerKey: "curriculum.plan_saved"',
    'target: "curriculum"',
    'label: "수업계획 확정"',
    'defaultTitle: "{className} 다음 수업 자료 준비"',
    'dueBasis: "event.classItem.nextSessionDate"',
    'setTriggerRelatedRoute("/admin/curriculum")',
    'triggerKey: "academic_calendar.date_confirmed"',
    'target: "academic_calendar"',
    'label: "학사일정 날짜 확정"',
    'defaultTitle: "{eventTitle} 자료 준비"',
    'dueBasis: "event.academicEvent.start"',
    'setTriggerRelatedRoute("/admin/academic-calendar")',
    'triggerKey: "ops.updated"',
    'label: "업무 변경됨"',
    'triggerKey: "ops.assignee_assigned"',
    'label: "담당자 배정됨"',
    'triggerKey: "ops.date_confirmed"',
    'label: "날짜 확정됨"',
  ]);
});

test("trigger automation defaults use event-root due basis paths", async () => {
  const workspaceSource = await readSource("src/features/tasks/ops-task-workspace.tsx");

  assertIncludesAll(workspaceSource, [
    "TRIGGER_DUE_BASIS_OPTIONS",
    "{ value: \"event.occurredAt\", label: \"이벤트 발생일\" }",
    "{ value: \"task.registration.classStartDate\", label: \"첫 수업 시작일\" }",
    "{ value: \"task.transfer.toClassStartDate\", label: \"새 수업 시작일\" }",
    "{ value: \"task.withdrawal.withdrawalDate\", label: \"퇴원일\" }",
    "{ value: \"task.wordRetest.testAt\", label: \"재시험일\" }",
    "{ value: \"event.classItem.nextSessionDate\", label: \"다음 수업일\" }",
    "{ value: \"event.academicEvent.start\", label: \"학사일정 시작일\" }",
    "{ value: \"event.academicEvent.end\", label: \"학사일정 종료일\" }",
    '<SelectField label="기준일" value={triggerDueBasis} onChange={setTriggerDueBasis}>',
    "getTriggerDueBasisLabel(input.dueBasis)",
    'dueBasis: "task.registration.classStartDate"',
    'dueBasis: "task.transfer.toClassStartDate"',
    'dueBasis: "task.withdrawal.withdrawalDate"',
    'dueBasis: "task.wordRetest.testAt"',
    'dueBasis: "event.classItem.nextSessionDate"',
    'dueBasis: "event.academicEvent.start"',
  ]);
  assert.doesNotMatch(workspaceSource, /dueBasis: "registration\.classStartDate"/);
  assert.doesNotMatch(workspaceSource, /dueBasis: "transfer\.toClassStartDate"/);
  assert.doesNotMatch(workspaceSource, /dueBasis: "withdrawal\.withdrawalDate"/);
  assert.doesNotMatch(workspaceSource, /dueBasis: "wordRetest\.testAt"/);
});

test("academic calendar saves publish automation trigger events", async () => {
  const [calendarSource, annualBoardSource, helperSource, routeSource] = await Promise.all([
    readSource("src/features/operations/academic-calendar-workspace.tsx"),
    readSource("src/features/operations/academic-annual-board-workspace.tsx"),
    readSource("src/features/operations/academic-calendar-automation.ts"),
    readSource("src/app/api/ops-task-automations/trigger/route.ts"),
  ]);

  assertIncludesAll(calendarSource, [
    "postAcademicCalendarAutomationEvent",
    "savedPayload: academicMutation.payload",
  ]);
  assertIncludesAll(annualBoardSource, [
    "postAcademicCalendarAutomationEvent",
    "savedPayload: academicMutation.payload",
  ]);
  assertIncludesAll(helperSource, [
    'sourceType: "academic_calendar"',
    'trigger: "academic_calendar.changed"',
    'trigger: "academic_calendar.date_confirmed"',
    "/api/ops-task-automations/trigger",
  ]);
  assertIncludesAll(routeSource, [
    "const academicEvent = objectBodyValue(body.academicEvent)",
    "academicEvent",
  ]);
});

test("trigger automation settings can save a fixed assignee profile", async () => {
  const workspaceSource = await readSource("src/features/tasks/ops-task-workspace.tsx");

  assertIncludesAll(workspaceSource, [
    '{ value: "fixed", label: "고정 담당자" }',
    "const [triggerAssigneeId, setTriggerAssigneeId]",
    "triggerAssigneeStrategy === \"fixed\"",
    '<SelectField label="고정 담당자" value={triggerAssigneeId} onChange={setTriggerAssigneeId}>',
    "profileId: triggerAssigneeStrategy === \"fixed\" ? triggerAssigneeId : \"\"",
    "getAutomationAssigneePreviewLabel(input.assigneeStrategy, input.assigneeId, profiles)",
  ]);
});
