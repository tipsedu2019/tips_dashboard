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

test("/admin/tasks is a focused Todoist-style todo workspace", async () => {
  const [pageSource, workspaceSource] = await Promise.all([
    readSource("src/app/admin/tasks/page.tsx"),
    readSource("src/features/tasks/ops-task-workspace.tsx"),
  ]);

  assert.match(pageSource, /<OpsTaskWorkspace workspace="todo" \/>/);
  assert.doesNotMatch(pageSource, /redirect\(/);

  assertIncludesAll(workspaceSource, [
    'type TodoViewKey = "inbox" | "today" | "upcoming" | "mine" | "board" | "calendar" | "filters" | "completed"',
    "TODO_VIEW_TABS",
    ko.inbox,
    ko.today,
    ko.upcoming,
    ko.mine,
    ko.board,
    ko.calendar,
    ko.filters,
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
    'confirmation: { list: "filters", filter: "all" }',
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
    "getOpsTaskCalendarItems(openGeneralTasks).length",
    "tasks={visibleTasks}",
    'if (todoView === "mine") return isOpenTask(task) && isOpsTaskAssignedToUser(task, currentUserId, currentUserLabel)',
    'mine: openGeneralTasks.filter((task) => isOpsTaskAssignedToUser(task, currentUserId, currentUserLabel)).length',
  ]);

  assert.ok(source.includes(`label: "${ko.board}"`));
  assert.ok(source.includes(`label: "${ko.mine}"`));
  assert.ok(source.includes(`label: "${ko.unassigned}"`));
  assert.ok(source.includes(`aria-label="${ko.todo} ${ko.board}"`));
  assert.ok(source.includes("const todoTaskSource = scopedTasks"));
  assert.doesNotMatch(source, /todoFilter === "confirmation"/);
  assert.doesNotMatch(source, /confirmationByTaskId=\\{confirmationByTaskId\\}/);
  assertIncludesAll(source, [
    'dateState === "today"',
    `? "${ko.today}" : dateState === "overdue"`,
    `? "${ko.overdue}" : "${ko.upcoming}"`,
  ]);
  assert.doesNotMatch(source, /md:overflow-x-auto/);
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
    'token.trim().toLowerCase().replace(/까지$/, "")',
    "const relative = normalized.match",
    "const monthDay = normalized.match",
    "let pendingAssigneeLookup = false",
    "const applyDateToken = (dateToken: string) =>",
    'normalizedDateToken.endsWith("까지")',
    'applyDateToken(normalizedDateToken.replace(/까지$/, ""))',
    "const assigneeDirective = getQuickAddAssigneeDirective(token)",
    '["담당", "담당자", "assignee", "assign"].includes(normalized)',
    "const dueDirective = getQuickAddDueDirective(token)",
    "applyDateToken(dueDirective.value)",
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

  assertIncludesAll(source, [
    'if (task.type === "general") return []',
    "function shouldShowDetailStatusBadge",
    'task.type !== "general" || isClosedOpsTask(task)',
    "shouldShowDetailStatusBadge(selectedTaskFresh)",
    "삭제하시겠습니까?",
    "deleteTargetRemovesCompletedOperation",
    "완료 이력 삭제",
    "이력 삭제",
    "삭제 완료",
  ]);

  assert.doesNotMatch(secondaryStatusSource, /task\.type === "general"\) \{[\s\S]*OPS_TASK_STATUSES/);
  assert.doesNotMatch(source, /삭제할까요/);
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

test("navigation keeps todo queues and separates operation menus", async () => {
  const source = await readSource("src/lib/navigation.ts");
  const todoBlock = source.slice(source.indexOf(`title: "${ko.todo}"`), source.indexOf(`title: "${ko.registration}"`));

  assertIncludesAll(source, [
    `title: "${ko.todo}"`,
    'url: "/admin/tasks"',
    'items: [',
    `{ title: "${ko.today}", url: "/admin/tasks?list=today" }`,
    `{ title: "${ko.overdue}", url: "/admin/tasks?list=filters&filter=overdue" }`,
    `{ title: "${ko.mine}", url: "/admin/tasks?list=mine" }`,
    `{ title: "${ko.scheduleAll}", url: "/admin/tasks?list=calendar" }`,
    `{ title: "${ko.board}", url: "/admin/tasks?list=board" }`,
    `{ title: "${ko.unassigned}", url: "/admin/tasks?list=filters&filter=unassigned" }`,
    `{ title: "${ko.registration}", url: "/admin/registration", icon: UserPlus }`,
    `{ title: "${ko.transfer}", url: "/admin/transfer", icon: Repeat2 }`,
    `{ title: "${ko.withdrawal}", url: "/admin/withdrawal", icon: UserMinus }`,
    `{ title: "${ko.wordRetest}", url: "/admin/word-retests", icon: SpellCheck }`,
    `{ title: "${ko.approvals}", url: "/admin/approvals", icon: FileCheck2 }`,
    'match: "/admin/tasks"',
  ]);

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

test("operation forms use staged fields and linked management selectors", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");

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
    "openManualField",
    "shouldShowManualField",
    'const defaultAssigneeId = currentUserId || ""',
    "const { user, canManageAll, isAdmin, isStaff, isTeacher } = useAuth()",
    'setWordRetestMode(isTeacher && !isStaff ? "teacher" : "assistant")',
    "{formStepProgressLabel}",
    "{getTaskTypeLabel(form.type)}",
  ]);

  assert.match(source, />\s*\uc120\uc0dd\ub2d8\s*<\/button>/);
  assert.match(source, />\s*\uc870\uad50\s*<\/button>/);
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
    "hasLinkedRecord(input.studentId)",
    "hasLinkedRecord(input.classId || input.className)",
    "hasLinkedRecord(input.textbookId || input.textbookTitle)",
    "findStudentOptionByReference",
    "findClassOptionByReference",
    "findTextbookOptionByReference",
    "findTeacherOptionByReference",
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
    "function CompletionReadinessPreview",
    "getCompletionBlockerActionLabel([blocker])",
    "showNeed",
    "isOwnGeneralTask",
    "[task.requestedBy, task.assigneeId, task.secondaryAssigneeId].includes(currentUserId)",
    "완료 전",
    "aria-label=\"완료 전 필요한 입력\"",
    "INPUT_COMPLETION_BLOCKERS",
    "CHOICE_COMPLETION_BLOCKERS",
    "입력 필요",
    "선택 필요",
  ]);

  assertIncludesAll(serviceSource, [
    "assertManagementSyncReady",
    "assertManagementSyncRecordsReady",
    "hasManagementReference(input.classId, input.className)",
    "hasManagementReference(wordRetest.teacherId, wordRetest.teacherName)",
    'return current === "absent" ? "absent" : "done"',
    "function shouldRequireWordRetestScore",
    "function inferClassBranch",
    "inferClassBranch(classRow)",
    "!isWordRetestAbsent(wordRetest) && !hasWordRetestScore(wordRetest)",
    "isSameManagementReference(transfer.fromClassId || transfer.fromClassName",
    "ensureOpsStudent",
    "assignOpsStudentToClass",
    "assignOpsTextbookToClass",
    "removeOpsStudentFromClass",
    "syncRegistrationManagementLinks",
    "syncWithdrawalManagementLinks",
    "syncTransferManagementLinks",
    "syncWordRetestManagementLinks",
    "const firstDelete = await supabase.from(\"ops_tasks\").delete().eq(\"id\", taskId)",
    "export async function deleteOpsTask",
    "MANAGEMENT_INPUT_FIELDS",
    "MANAGEMENT_CHOICE_FIELDS",
    "managementMissingFieldLabel",
    "입력 필요",
    "선택 필요",
    "연결 필요",
    '"registration_completed"',
    '"withdrawal_completed"',
    '"transfer_from_class"',
    '"transfer_to_class"',
    ".from(\"ops_word_retests\")",
  ]);

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
    "const openGeneralTasks = openTasks.filter((task) => task.type === \"general\")",
    "md:grid-cols-4",
    `label="${ko.today}"`,
    `label="${ko.overdue}"`,
    `label="${ko.mine}"`,
    `label="${ko.unassigned}"`,
  ]);
  assert.doesNotMatch(dashboardSummary, /filter=confirmation/);
  assert.doesNotMatch(dashboardSummary, /openOperationTasks/);
  assert.doesNotMatch(dashboardSummary, /loadOpsTaskWorkspaceData/);

  assertIncludesAll(serviceSource, [
    "type OpsTaskWorkspaceLoadOptions",
    "getOpsTaskWorkspaceCacheKey",
    "const opsTaskWorkspaceDataCache = new Map",
    "if (options.taskType) taskQuery = taskQuery.eq(\"type\", options.taskType)",
    "shouldReadRegistration ? readTaskScopedTable",
    "export async function loadOpsTodoDashboardSummaryData",
    '.select("id,title,type,status,priority,requested_by,assignee_id,secondary_assignee_id,student_id,class_id,textbook_id,student_name,class_name,textbook_title,campus,subject,due_at,completed_at,memo,created_at,updated_at")',
    '.eq("type", "general")',
    '.not("status", "in", "(\\"done\\",\\"canceled\\")")',
    'readTable("profiles", "id,name,email,role,login_id", true)',
  ]);

  assertIncludesAll(workspaceSource, [
    "getCachedOpsTaskWorkspaceData(workspaceLoadOptions)",
    "const loadOptions = { taskType: scopedTaskType, includeManagementOptions: !isTodoWorkspace }",
    "loadOpsTaskWorkspaceData({ ...loadOptions, force })",
  ]);

  assertIncludesAll(scriptSource, [
    "/admin/tasks?list=today",
    "/admin/tasks?list=board",
    "/admin/tasks?list=calendar",
    "/admin/registration",
    "/admin/transfer",
    "/admin/withdrawal",
    "/admin/word-retests",
    "/admin/approvals",
    "verifyQuickAddInteraction",
    "verifySingleQuickAddInteraction",
    "내일 오전 10시까지",
    'getByText("내일 10:00"',
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

  assertIncludesAll(sampleScriptSource, [
    "word_retest_target as",
    "retest_status = case when word_retest_target.row_no = 1 then 'absent' else 'done' end",
    "first_score = case when word_retest_target.row_no = 1 then null else 100 end",
    "absent_word_retest_count",
    "absentWordRetest !== 1",
    'update({ retest_status: "absent", first_score: null, second_score: null, third_score: null })',
  ]);
});
