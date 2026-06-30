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
  requestedTeam: "\uc694\uccad\ud300",
  reviewRequested: "\uac80\ud1a0 \uc694\uccad",
  registration: "\ub4f1\ub85d",
  scheduleAll: "\uc804\uccb4 \uc77c\uc815",
  sent: "\ubcf4\ub0b8\ud568",
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

test("/admin/tasks is a focused team task inbox workspace", async () => {
  const [pageSource, workspaceSource] = await Promise.all([
    readSource("src/app/admin/tasks/page.tsx"),
    readSource("src/features/tasks/ops-task-workspace.tsx"),
  ]);

  assert.match(pageSource, /<OpsTaskWorkspace workspace="todo" \/>/);
  assert.doesNotMatch(pageSource, /redirect\(/);

  assertIncludesAll(workspaceSource, [
    'type TodoViewKey = "inbox" | "sent" | "completed"',
    'type TodoSortKey = "status" | "priority" | "due"',
    "TODO_VIEW_TABS",
    ko.inbox,
    ko.sent,
    ko.completed,
    "TODO_TABLE_SORT_COLUMNS",
    "TODO_TEAM_FILTER_UNASSIGNED",
    "isOpsTaskInUserInbox",
    "isOpsTaskInUserSent",
    "sortOpsTasksByPriority",
    "sortOpsTasksByWorkDate",
    "sortOpsTasksByWorkflowStatus",
    "parseTodoistQuickAdd",
    "quickDateTimeForNextWeekday",
    "normalizeQuickAddTimeToken",
    "getQuickAddAssigneeDirective",
    "getQuickAddDueDirective",
    "resolveQuickAddAssigneeId",
    "withTime",
    "data-testid=\"todo-quick-add-input\"",
    'cleanToken.startsWith("@")',
    'cleanToken.startsWith("#")',
    "TodoTeamFilterBar",
    "TodoPriorityBadge",
    "ReadonlyInfoField",
    "canDeleteTask",
    'task.type === "general" || !isClosedOpsTask(task)',
    "sortCompletedTodoTasks",
    "normalizeQuickAddLookup",
    "applyTaskPatch",
	    "data && !data.schemaReady",
	    "sm:max-w-2xl",
	    "sm:min-h-[min(760px,92vh)]",
	    "max-h-[calc(100dvh-1rem)]",
	    "overscroll-contain",
	    "scroll-pb-24",
	    "xl:hidden",
	    'label="우선순위"',
	    'label="요청일시"',
	    'label="요청자"',
	    'label="시작일"',
	    'label="마감일"',
	  ]);

  assert.ok(workspaceSource.includes(`${ko.todo} ${ko.add}`));
  assert.ok(workspaceSource.includes(`label: "${ko.reviewRequested}"`));
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

test("todo workspace supports team tabs sorting filters and legacy query links", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");

  assertIncludesAll(source, [
    '{ key: "sent", label: "',
    '{ key: "completed", label: "',
    'type TodoSortKey = "status" | "priority" | "due"',
    "TODO_TABLE_SORT_COLUMNS",
    '{ key: "status", label: "상태" }',
    '{ key: "priority", label: "우선순위" }',
    '{ key: "due", label: "시작/마감" }',
    "const LEGACY_TODO_VIEW_ROUTES",
    'today: { list: "inbox", sort: "due" }',
    'upcoming: { list: "inbox", sort: "due" }',
    'board: { list: "inbox", sort: "status" }',
    'calendar: { list: "inbox", sort: "due" }',
    'mine: { list: "inbox" }',
    'overdue: { list: "inbox", due: "overdue" }',
    'confirmation: { list: "inbox", status: "review_requested" }',
    "function buildTodoFilterOptions",
    "function matchesTodoTeamFilters",
    "function getTodoActionLabel",
    "function TodoTeamFilterBar",
    'requestedByFilter',
    'requestedTeamFilter',
    'assigneeFilter',
    'assigneeTeamFilter',
    "tasks={visibleTasks}",
    "sortKey={todoSort}",
    "onSortChange={syncTodoSort}",
    'if (todoView === "inbox") return isOpsTaskInUserInbox(task, currentUserContext)',
    'if (todoView === "sent") return isOpsTaskInUserSent(task, currentUserContext)',
    'const deepLinkedTaskId = searchParams.get("taskId") || ""',
    'const deepLinkedTask = taskById.get(deepLinkedTaskId)',
    'syncTaskDeepLink(null)',
    "setSelectedTask(deepLinkedTask)",
    "setDetailOpen(true)",
	    "syncTaskDeepLink(task.id)",
	    "syncTaskDeepLink(null)",
	    "data-testid=\"todo-mobile-task-list\"",
	    "data-testid=\"todo-table-task-list\"",
	    "function TodoTaskCard",
	    "xl:grid",
	    "xl:grid-cols-4",
	  ]);

  assert.ok(source.includes(`label: "${ko.sent}"`));
  assert.ok(source.includes(`label="${ko.requestedTeam}"`));
  assert.ok(source.includes(`aria-label="${ko.todo} 필터"`));
  assert.ok(source.includes("const todoTaskSource = scopedTasks"));
  assert.match(source, /const HORIZONTAL_TAB_BAR_CLASS = "flex min-w-0 flex-wrap gap-1 overflow-visible sm:flex-nowrap sm:overflow-x-auto/);
  assert.doesNotMatch(source, /TODO_SORT_TABS/);
  assert.doesNotMatch(source, /TODO_DUE_FILTER_OPTIONS/);
  assert.doesNotMatch(source, /aria-label="할 일 정렬"/);
  assert.doesNotMatch(source, /priorityFilter/);
  assert.doesNotMatch(source, /dueFilter/);
  assert.doesNotMatch(source, /statusFilter/);
  assert.doesNotMatch(source, /label: "기한 전체"/);
	  assert.doesNotMatch(source, /todoView === "board"/);
	  assert.doesNotMatch(source, /function TodoBoard/);
	  assert.doesNotMatch(source, /confirmationByTaskId=\\{confirmationByTaskId\\}/);
	  assert.doesNotMatch(source, /md:overflow-x-auto/);
	  assert.doesNotMatch(source, /lg:grid-cols-6/);
	});

test("todo form keeps requester metadata readonly and assignee selectors team-aware", async () => {
  const [workspaceSource, serviceSource] = await Promise.all([
    readSource("src/features/tasks/ops-task-workspace.tsx"),
    readSource("src/features/tasks/ops-task-service.ts"),
  ]);

  assertIncludesAll(serviceSource, [
    "includeTeacherOptions",
    'readTableWithFallback("teacher_catalogs", "id,name,subjects,is_visible,sort_order,profile_id,account_email"',
    "requestedBy?: string",
    "requested_by: nullable(input.requestedBy)",
  ]);

  assertIncludesAll(workspaceSource, [
    "const TODO_TEAM_OPTIONS = [\"영어팀\", \"수학팀\", \"관리팀\", \"조교팀\"]",
    "function normalizeTaskTeamValue",
    "function buildTaskProfileTeamLookup",
    "function getProfilesForTeam",
    "const assigneeProfileOptions = useMemo",
    "function handleAssigneeChange",
    "function handleAssigneeTeamChange",
    "const formRequestedByLabel =",
    "const formRequestedTeamLabel =",
    "ReadonlyInfoField label=\"요청자\"",
    "ReadonlyInfoField label=\"요청팀\"",
    "ReadonlyInfoField label=\"요청일시\"",
    "className=\"grid gap-3 pt-1 md:grid-cols-[160px_minmax(0,1fr)]\"",
    "className=\"grid gap-3 md:grid-cols-2\"",
    'isTemplateForm ? "sm:sticky sm:bottom-0" : ""',
    "profiles={assigneeProfileOptions}",
    "onChange={handleAssigneeChange}",
    "onClick={() => handleAssigneeChange(currentUserId)}",
  ]);

  assert.doesNotMatch(workspaceSource, /profiles=\{requestedProfileOptions\}/);
  assert.doesNotMatch(workspaceSource, /onChange=\{handleRequestedByChange\}/);
  const generalTodoFormSource = workspaceSource.slice(
    workspaceSource.indexOf("{!isTemplateForm && ("),
    workspaceSource.indexOf("{isTemplateForm && formDetailTabs.length > 0"),
  );
  assert.ok(generalTodoFormSource.indexOf('<span>메모</span>') < generalTodoFormSource.indexOf('ReadonlyInfoField label="요청자"'));
});

test("todo form uses compact polished controls for dates priority and team selection", async () => {
  const workspaceSource = await readSource("src/features/tasks/ops-task-workspace.tsx");

  assertIncludesAll(workspaceSource, [
    'const TODO_FORM_PRIORITY_ORDER: OpsTaskPriority[] = ["urgent", "high", "normal", "low"]',
    "const TODO_FORM_PRIORITY_OPTIONS = TODO_FORM_PRIORITY_ORDER",
    "function TaskListboxField({",
    "type TaskListboxOption = {",
    "function PrioritySelectField({",
    "function DateField({",
    "import { Popover, PopoverContent, PopoverTrigger } from",
    "calendarDateOpen",
    "function getCalendarMonthDate",
    "function buildCalendarDateCells",
    "<Popover open={calendarDateOpen} onOpenChange={setCalendarDateOpen}>",
    "<PopoverTrigger asChild>",
    "<PopoverContent",
    "collisionPadding={12}",
    'className="w-[min(21rem,calc(100vw-1.5rem))] overflow-hidden p-0"',
    "role=\"grid\"",
    "role=\"gridcell\"",
    "직접 날짜 입력",
    "aria-label={clearLabel}",
    '<X className="size-4" />',
    "function TeamSelectField({",
    'aria-haspopup="listbox"',
    'role="listbox"',
    "setListboxOpen(false)",
    "const [isLinkedSearchOpen, setIsLinkedSearchOpen] = useState(false)",
    "setIsLinkedSearchOpen(false)",
    'DialogHeader className="-mx-6 -mt-6 border-b px-6 py-4"',
    "<PrioritySelectField",
    "<TeamSelectField",
    "<DateField",
  ]);

  const priorityOrder = workspaceSource.slice(
    workspaceSource.indexOf("const TODO_FORM_PRIORITY_ORDER"),
    workspaceSource.indexOf("const TODO_FORM_PRIORITY_OPTIONS"),
  );
  assert.ok(priorityOrder.indexOf('"urgent"') < priorityOrder.indexOf('"low"'));

  const linkedSelectSource = workspaceSource.slice(
    workspaceSource.indexOf("function LinkedSelect"),
    workspaceSource.indexOf("function ProfileSelect"),
  );
  assert.doesNotMatch(linkedSelectSource, /<Input[\s\S]*<select/);

  const generalTodoFormSource = workspaceSource.slice(
    workspaceSource.indexOf("{!isTemplateForm && ("),
    workspaceSource.indexOf("{isTemplateForm && formDetailTabs.length > 0"),
  );
  assert.ok(generalTodoFormSource.indexOf("<PrioritySelectField") < generalTodoFormSource.indexOf('<TextField\n                    label="제목"'));
  assert.ok(generalTodoFormSource.includes('md:grid-cols-[160px_minmax(0,1fr)]'));
  assert.doesNotMatch(generalTodoFormSource, /<SelectField label="우선순위"/);
  assert.doesNotMatch(generalTodoFormSource, /type="date"/);
  assert.doesNotMatch(generalTodoFormSource, /<select/);

  assert.doesNotMatch(workspaceSource, />\s*시작일 지우기\s*</);
  assert.doesNotMatch(workspaceSource, />\s*마감일 지우기\s*</);
  assert.doesNotMatch(workspaceSource, /DialogHeader className="sticky/);
  const dateFieldSource = workspaceSource.slice(
    workspaceSource.indexOf("function DateField({"),
    workspaceSource.indexOf("function ReadonlyInfoField"),
  );
  assert.doesNotMatch(dateFieldSource, /handleDateOutsidePointerDown/);
  assert.doesNotMatch(dateFieldSource, /document\.addEventListener\("pointerdown"/);
  assert.doesNotMatch(dateFieldSource, /relative z-30 mt-1 overflow-hidden/);
  assert.doesNotMatch(dateFieldSource, /absolute left-0 right-0 top-full/);
});

test("quick add keeps Todoist-like shortcuts and opens the structured form", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");

  assertIncludesAll(source, [
    "function parseTodoistQuickAdd",
    "const quickDueAt = parsed.dueAt || \"\"",
    "dueAt: quickDueAt",
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
    "const assigneeDirective = getQuickAddAssigneeDirective(cleanToken)",
    '["담당", "담당자", "assignee", "assign"].includes(normalized)',
    "const dueDirective = getQuickAddDueDirective(cleanToken)",
    "applyDateToken(dueDirective.value)",
    "pendingDueLookup = true",
    '["마감", "마감일", "예정", "예정일", "기한", "일정", "due"].includes(normalized)',
    "TODO_QUICK_ADD_PRIORITY_ALIASES",
    "normalizeQuickAddToken",
    'priorityAlias = TODO_QUICK_ADD_PRIORITY_ALIASES[normalized]',
    "parsed.assigneeId",
    "parsed.priority",
    "parsed.memo",
    'placeholder="예: 긴급. 담당 홍길동. 내일까지 할 일 하기"',
    'aria-label="자연어로 할 일 빠른 추가"',
    'aria-label="입력창으로 할 일 요청"',
    "                추가\n              </Button>",
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
    'if (task.status === "review_requested") return [{ value: "in_progress", label: "수정 요청" }]',
    "function shouldShowDetailStatusBadge",
    'task.type !== "general" || task.status === "review_requested" || isClosedOpsTask(task)',
    "shouldShowDetailStatusBadge(selectedTaskFresh)",
    "function GeneralTaskDetailPanel({",
    "function DetailInfoTile({",
    'selectedTaskFresh.type === "general" ? (',
    "<GeneralTaskDetailPanel",
    "TodoPriorityBadge priority={task.priority}",
    "TaskStatusBadge status={task.status}",
    "label=\"우선순위\"",
    "label=\"제목\"",
    "label=\"담당팀\"",
    "label=\"담당자\"",
    "label=\"시작일\"",
    "label=\"마감일\"",
    "label=\"요청팀\"",
    "label=\"요청자\"",
    "label=\"요청일시\"",
    "label=\"메모\"",
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

test("todo list places priority before title in table rows", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const taskListSource = source.slice(
    source.indexOf("function TaskList({"),
    source.indexOf("function GroupedTaskList({"),
  );

  assertIncludesAll(taskListSource, [
    'md:grid-cols-[96px_88px_minmax(220px,1fr)_150px_150px_140px_120px]',
    "function TodoSortableHeaderButton({",
    'onSortChange("status")',
    'onSortChange("priority")',
    'onSortChange("due")',
    "aria-sort={ariaSort}",
    "TODO_TABLE_SORT_COLUMNS",
    "{isTodoRow && (",
    "<TodoPriorityBadge priority={task.priority} showNormal />",
  ]);

  assert.ok(taskListSource.indexOf('column.label === "우선순위"') < taskListSource.indexOf('<span>{isTodoList ? "제목" : "업무"}</span>'));
  assert.ok(taskListSource.indexOf("<TodoPriorityBadge priority={task.priority} showNormal />") < taskListSource.indexOf('aria-label={`${task.title} 상세 보기`}'));
});

test("todo filters use custom listboxes and only keep people and team filters", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const filterSource = source.slice(
    source.indexOf("function TodoTeamFilterBar({"),
    source.indexOf("function EmptyTaskState({"),
  );

  assertIncludesAll(filterSource, [
    "function TodoFilterListbox({",
    '<TodoFilterListbox label="요청자"',
    '<TodoFilterListbox label="요청팀"',
    '<TodoFilterListbox label="담당자"',
    '<TodoFilterListbox label="담당팀"',
    'aria-haspopup="listbox"',
    'role="listbox"',
    "<Check className=\"size-4 shrink-0\" />",
  ]);

  assert.doesNotMatch(filterSource, /<CompactSelect/);
  assert.doesNotMatch(filterSource, /<select/);
  assert.doesNotMatch(filterSource, /label="우선순위"/);
  assert.doesNotMatch(filterSource, /label="기한"/);
  assert.doesNotMatch(filterSource, /label="상태"/);
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

test("team workflow migration adds review request and explicit team fields", async () => {
  const [migrationSource, serviceSource] = await Promise.all([
    readSource("supabase/migrations/20260630143000_ops_task_team_workflow.sql"),
    readSource("src/features/tasks/ops-task-service.ts"),
  ]);

  assertIncludesAll(migrationSource, [
    "requested_team text",
    "assignee_team text",
    "start_at timestamptz",
    "review_requested",
    "ops_tasks_requested_team_idx",
    "ops_tasks_assignee_team_idx",
    "ops_tasks_start_at_idx",
  ]);
  assertIncludesAll(serviceSource, [
    "requestedTeam: string",
    "assigneeTeam: string",
    "startAt: string",
    "requested_team",
    "assignee_team",
    "start_at",
    'const OPS_TASK_OPTIONAL_TEAM_WORKFLOW_COLUMNS = ["requested_team", "assignee_team", "start_at"]',
    "writeOpsTaskWithOptionalTeamWorkflowColumns",
    "stripMissingMigrationColumns(row, OPS_TASK_OPTIONAL_TEAM_WORKFLOW_COLUMNS)",
    '"review_requested"',
  ]);
});

test("todo form close confirmation stays quiet and uses explicit discard copy", async () => {
  const workspaceSource = await readSource("src/features/tasks/ops-task-workspace.tsx");

  assertIncludesAll(workspaceSource, [
    'confirmingFormClose ? "저장하지 않고 닫기" : "닫기"',
    "discardFormAndClose",
  ]);

  assert.doesNotMatch(workspaceSource, />\s*버리고 닫기\s*</);
  assert.doesNotMatch(workspaceSource, />\s*입력 중\s*</);
  assert.doesNotMatch(workspaceSource, />\s*계속 작성\s*</);
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
    `{ title: "${ko.inbox}", url: "/admin/tasks?list=inbox" }`,
    `{ title: "${ko.sent}", url: "/admin/tasks?list=sent" }`,
    `{ title: "${ko.completed}", url: "/admin/tasks?list=completed" }`,
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
    "getWordRetestClassOptions(classes, selectedWordRetestStudent, selectedWordRetestClassId)",
    "getWordRetestTeacherOptions(teachers, selectedWordRetestTeacherId)",
    "classItem.id === selectedClassId",
    "teacher.id === selectedTeacherId",
    "openManualField",
    "shouldShowManualField",
    'const defaultAssigneeId = currentUserId || ""',
    "const { user, canManageAll, isAdmin, isStaff, isTeacher } = useAuth()",
    'setWordRetestMode(isTeacher && !isStaff ? "teacher" : "assistant")',
    "{formStepProgressLabel}",
    "{getTaskTypeLabel(form.type)}",
  ]);

  assert.doesNotMatch(formDialogSource, /<DialogDescription(?! className="sr-only")/);
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
    "!hasLinkedRecord(input.classId)",
    "!hasLinkedRecord(input.textbookId)",
    "fromClass && toClass && fromClass.id === toClass.id",
    "findStudentOptionByReference",
    "findClassOptionByReference",
    "findTextbookOption(textbooks, input.textbookId, indexes)",
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
    "getCompletionBlockerActionLabel([blocker])",
    "{formCompletionBlockers.length > 0 && (",
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
  assert.doesNotMatch(workspaceSource, /currentFormCompletionBlockers/);
  assert.doesNotMatch(workspaceSource, /getCompletionReadinessInput/);
  assert.doesNotMatch(workspaceSource, /isCompletionReadinessStep/);
  assert.doesNotMatch(workspaceSource, /ManagementSyncPreview/);
  assert.doesNotMatch(workspaceSource, /CompletionReadinessPreview/);
  assert.doesNotMatch(workspaceSource, />\s*완료 전\s*<\/span>/);

  assertIncludesAll(serviceSource, [
    "assertManagementSyncReady",
    "assertManagementSyncRecordsReady",
    "hasManagementReference(input.classId)",
    "hasManagementReference(input.textbookId)",
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
    "removeOpsStudentFromClass",
    "syncRegistrationManagementLinks",
    "syncWithdrawalManagementLinks",
    "syncTransferManagementLinks",
    "syncWordRetestManagementLinks",
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
    "md:grid-cols-3",
    `label="${ko.inbox}"`,
    `label="${ko.sent}"`,
    `label="${ko.completed}"`,
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
    '.select("id,title,type,status,priority,requested_by,requested_team,assignee_id,assignee_team,secondary_assignee_id,student_id,class_id,textbook_id,student_name,class_name,textbook_title,campus,subject,start_at,due_at,completed_at,memo,created_at,updated_at")',
    '.eq("type", "general")',
    'readTable("profiles", "id,name,email,role,login_id", true)',
  ]);

	  assertIncludesAll(workspaceSource, [
	    "getCachedOpsTaskWorkspaceData(workspaceLoadOptions)",
	    "const loadOptions = { taskType: scopedTaskType, includeManagementOptions: !isTodoWorkspace, includeTeacherOptions: true }",
	    "loadOpsTaskWorkspaceData({ ...loadOptions, force })",
	  ]);

  assertIncludesAll(scriptSource, [
    "/admin/tasks?list=inbox",
    "/admin/tasks?list=sent",
    "/admin/tasks?list=completed",
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
    "/admin/class-schedule/lesson-design",
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
    `expectedTexts: ["${ko.todo}", "${ko.inbox}", "${ko.add}"]`,
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
