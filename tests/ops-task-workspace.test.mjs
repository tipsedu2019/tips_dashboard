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
  wordRetest: "\uc601\uc5b4 \ub2e8\uc5b4 \uc7ac\uc2dc\ud5d8",
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
    '"-mx-6 -mb-6 flex flex-col gap-2 border-t bg-background px-6 py-4 sm:flex-row sm:items-center sm:justify-end"',
    "profiles={assigneeProfileOptions}",
    "onChange={handleAssigneeChange}",
    "onClick={() => handleAssigneeChange(currentUserId)}",
  ]);

  assert.doesNotMatch(workspaceSource, /profiles=\{requestedProfileOptions\}/);
  assert.doesNotMatch(workspaceSource, /onChange=\{handleRequestedByChange\}/);
  const generalTodoFormSource = workspaceSource.slice(
    workspaceSource.indexOf("{!isTemplateForm && ("),
    workspaceSource.indexOf("{isWordRetestForm && ("),
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
    "import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from",
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
    "const linkedSelectControl = shouldShowLinkedSearch && isLinkedSearchOpen",
    "<PopoverAnchor asChild>{linkedSelectControl}</PopoverAnchor>",
    "className=\"z-[120] w-[var(--radix-popper-anchor-width)] min-w-72 max-w-[calc(100vw-1rem)] overflow-hidden p-0\"",
    "function handleLinkedListWheel(event: WheelEvent<HTMLDivElement>)",
    "onWheel={handleLinkedListWheel}",
    "onOpenAutoFocus={(event) => event.preventDefault()}",
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
    workspaceSource.indexOf("{isWordRetestForm && ("),
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

test("popover content can stay inside modal scroll containers", async () => {
  const popoverSource = await readSource("src/components/ui/popover.tsx");

  assertIncludesAll(popoverSource, [
    "type PopoverContentProps = React.ComponentProps<typeof PopoverPrimitive.Content> & {",
    "disablePortal?: boolean",
    "portalContainer?: React.ComponentProps<typeof PopoverPrimitive.Portal>[\"container\"]",
    "if (disablePortal) return content",
    "<PopoverPrimitive.Portal container={portalContainer}>",
  ]);
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

test("todo list places columns in the requested operations order", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const taskListSource = source.slice(
    source.indexOf("function TaskList({"),
    source.indexOf("function GroupedTaskList({"),
  );

  assertIncludesAll(taskListSource, [
    'md:grid-cols-[88px_140px_minmax(220px,1fr)_150px_150px_96px_120px]',
    "function TodoSortableHeaderButton({",
    'onSortChange("status")',
    'onSortChange("priority")',
    'onSortChange("due")',
    "aria-sort={ariaSort}",
    "TODO_TABLE_SORT_COLUMNS",
    "if (isTodoRow) {",
    "<TodoPriorityBadge priority={task.priority} showNormal />",
    "<TodoDateSummary task={task} />",
    "<TaskStatusBadge status={task.status} />",
  ]);

  const headerSource = taskListSource.slice(
    taskListSource.indexOf("const header = ("),
    taskListSource.indexOf("const rows ="),
  );
  assert.ok(headerSource.indexOf('onSortChange("priority")') < headerSource.indexOf('onSortChange("due")'));
  assert.ok(headerSource.indexOf('onSortChange("due")') < headerSource.indexOf("<span>제목</span>"));
  assert.ok(headerSource.indexOf("<span>제목</span>") < headerSource.indexOf("<span>요청자/요청팀</span>"));
  assert.ok(headerSource.indexOf("<span>요청자/요청팀</span>") < headerSource.indexOf("<span>담당자/담당팀</span>"));
  assert.ok(headerSource.indexOf("<span>담당자/담당팀</span>") < headerSource.indexOf('onSortChange("status")'));
  assert.ok(headerSource.indexOf('onSortChange("status")') < headerSource.indexOf("<span className=\"text-right\">다음 액션</span>"));

  const todoRowSource = taskListSource.slice(
    taskListSource.indexOf("if (isTodoRow) {"),
    taskListSource.indexOf("\n  return (", taskListSource.indexOf("if (isTodoRow) {")),
  );
  assert.ok(todoRowSource.indexOf("<TodoPriorityBadge priority={task.priority} showNormal />") < todoRowSource.indexOf("<TodoDateSummary task={task} />"));
  assert.ok(todoRowSource.indexOf("<TodoDateSummary task={task} />") < todoRowSource.indexOf('aria-label={`${task.title} 상세 보기`}'));
  assert.ok(todoRowSource.indexOf("{todoRequesterLabel}") < todoRowSource.indexOf("{todoAssigneeLabel}"));
  assert.ok(todoRowSource.indexOf("{todoAssigneeLabel}") < todoRowSource.indexOf("<TaskStatusBadge status={task.status} />"));
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
    'const formCloseLabel = confirmingFormClose ? "저장하지 않고 닫기" : "닫기"',
    'confirmingFormClose ? "저장하지 않고 닫기" : "닫기"',
    "closeButtonLabel={formCloseLabel}",
    "onCloseButtonClick={confirmingFormClose ? discardFormAndClose : closeForm}",
    "showCloseButtonText",
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
  const fullOverviewBlock = source.slice(source.indexOf("const fullOverviewItems"), source.indexOf("const overview: NavGroup"));

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
  assert.ok(fullOverviewBlock.indexOf(`title: "${ko.todo}"`) < fullOverviewBlock.indexOf(`title: "${ko.wordRetest}"`));
  assert.ok(fullOverviewBlock.indexOf(`title: "${ko.wordRetest}"`) < fullOverviewBlock.indexOf(`title: "${ko.registration}"`));
  assert.doesNotMatch(source, new RegExp(`title: "${ko.taskbox}"`));
});

test("registration keeps the operational pipeline as first-class state", async () => {
  assert.equal(
    await pathExists("supabase/migrations/20260710052921_registration_application_workflow.sql"),
    true,
    "registration operational flow migration should exist",
  );
  const [workspaceSource, modelSource, serviceSource, migrationSource, operationalFlowMigrationSource] = await Promise.all([
    readSource("src/features/tasks/ops-task-workspace.tsx"),
    readSource("src/features/tasks/ops-task-model.js"),
    readSource("src/features/tasks/ops-task-service.ts"),
    readSource("supabase/migrations/20260522103000_ops_registration_pipeline_status.sql"),
    readSource("supabase/migrations/20260710052921_registration_application_workflow.sql"),
  ]);
  const combined = `${workspaceSource}\n${modelSource}\n${serviceSource}\n${migrationSource}\n${operationalFlowMigrationSource}`;

  for (const status of [
    "0. \ub4f1\ub85d \ubb38\uc758",
    "1. \ub808\ubca8\ud14c\uc2a4\ud2b8 \uc608\uc57d",
    "1-1. \ub808\ubca8\ud14c\uc2a4\ud2b8 \uc644\ub8cc",
    "2. \uc0c1\ub2f4 \uc608\uc57d",
    "3. \uc0c1\ub2f4 \uc644\ub8cc",
    "4-1. \ud604\uc7ac\ubc18 \ub300\uae30",
    "4-2. \uc2e0\uaddc\ubc18 \ub300\uae30",
    "4-3. \ub2e4\uc74c \uac1c\uac15 \uc54c\ub9bc",
    "5. \uc785\ud559 \ub4f1\ub85d \uacb0\uc815",
    "5-1. \uc785\ud559\uc2e0\uccad\uc11c \ubc1c\uc1a1 \uc644\ub8cc",
    "6. \uc218\ub0a9 \ud655\uc778",
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
    "registration_pipeline_status_check",
  ]);
});

test("registration workspace replaces Notion registration management with process tabs table filters and notifications", async () => {
  const [workspaceSource, serviceSource, migrationSource] = await Promise.all([
    readSource("src/features/tasks/ops-task-workspace.tsx"),
    readSource("src/features/tasks/ops-task-service.ts"),
    readSource("supabase/migrations/20260710052914_registration_operational_fields.sql"),
  ]);
  const combined = `${workspaceSource}\n${serviceSource}\n${migrationSource}`;
  const registrationTableSource = workspaceSource.slice(
    workspaceSource.indexOf("const REGISTRATION_TABLE_COLUMNS"),
    workspaceSource.indexOf("function WithdrawalDataTable"),
  );
  const detailDialogSource = workspaceSource.slice(
    workspaceSource.indexOf("<Dialog open={detailOpen}"),
    workspaceSource.indexOf("<Dialog open={Boolean(deleteTarget)}"),
  );

  assertIncludesAll(combined, [
    'type RegistrationViewKey = "inquiry" | "consulting" | "waiting" | "enrollment" | "closed"',
    "REGISTRATION_VIEW_TABS",
    "REGISTRATION_VIEW_STATUS_PREFIXES",
    "REGISTRATION_TABLE_COLUMNS",
    "REGISTRATION_NOTIFICATION_TEMPLATE_VARIABLES",
    "DEFAULT_REGISTRATION_NOTIFICATION_TEMPLATES",
    "RegistrationDataTable",
    "RegistrationFilterSelect",
    "RegistrationPeriodFilterBar",
    "RegistrationResizableHeaderCell",
    "RegistrationWorkflowStatusBadge",
    "RegistrationOperationsChecklistChips",
    "RegistrationNotificationSettingsDialog",
    "RegistrationDetailPanel",
    "getRegistrationViewTasks",
    "getRegistrationTableValue",
    "matchesRegistrationPeriodFilter",
    "notifyRegistrationWorkflow",
    "getRegistrationNotificationTriggerForPipelineStatus",
    "textbookPreparation",
    "visitConsultationPlace",
    "timetableRosterUpdated",
    "textbook_preparation",
    "visit_consultation_place",
    "timetable_roster_updated",
  ]);

  assertIncludesAll(workspaceSource, [
    '{ key: "inquiry", label: "문의" }',
    '{ key: "consulting", label: "상담/레벨테스트" }',
    '{ key: "waiting", label: "대기" }',
    '{ key: "enrollment", label: "등록" }',
    '{ key: "closed", label: "완료" }',
    'aria-label={isTodoWorkspace ? "할 일 목록" : isWordRetestWorkspace ? "단어 재시험 역할" : isRegistrationWorkspace ? "등록 흐름" : isWithdrawalWorkspace ? "퇴원 흐름" : isTransferWorkspace ? "전반 흐름" : `${workspaceLabel} 보기`}',
    "const workspaceSurfaceClassName = isWithdrawalWorkspace || isTransferWorkspace || isRegistrationWorkspace",
    "setRegistrationNotificationOpen(true)",
    'isRegistrationWorkspace ? "등록 알림 설정"',
    "registrationCounts",
    "registrationView",
  ]);

  assertIncludesAll(registrationTableSource, [
    '"pipelineStatus"',
    '"subject"',
    '"schoolGrade"',
    '"schoolName"',
    '"student"',
    '"parentPhone"',
    '"inquiryChannel"',
    '"inquiryAt"',
    '"counselor"',
    '"levelTestAt"',
    '"phoneConsultationAt"',
    '"visitConsultationAt"',
    '"className"',
    '"classStartDate"',
    '"classStartSession"',
    '"requestNote"',
    '"operationsChecklist"',
    '"action"',
    'aria-label="등록 전체 필터"',
    'aria-label="등록 데이터테이블 열 필터"',
    'data-testid="registration-mobile-task-list"',
    'aria-label="등록 신청 데이터테이블"',
    'labelPrefix="등록"',
    "selectedCounselorFilter",
    "selectedGradeFilter",
  ]);

  assertIncludesAll(workspaceSource, [
    'label="진행상태"',
    'label="과목"',
    'label="학년"',
    'label="방문상담실"',
    'label="교재 준비"',
    'label="수업시작회차"',
    'label="수업시간표 명단"',
    "전부 학원에서 준비",
    "개인적으로 준비",
    "일부만 학원에서 준비(메모 확인 필수)",
  ]);

  assertIncludesAll(detailDialogSource, [
    "RegistrationDetailPanel",
    'selectedTaskFresh?.type === "registration" || selectedTaskFresh?.type === "withdrawal" || selectedTaskFresh?.type === "transfer" ? "sm:max-w-3xl"',
  ]);
});

test("registration follows the real decision waitlist admission form and manual payment workflow", async () => {
  assert.equal(
    await pathExists("src/app/api/solapi/registration/route.ts"),
    true,
    "registration SOLAPI route should exist",
  );
  assert.equal(
    await pathExists("supabase/migrations/20260710053001_registration_message_least_privilege.sql"),
    true,
    "registration SOLAPI history should have an explicit least-privilege migration",
  );
  assert.equal(
    await pathExists("supabase/migrations/20260710053144_registration_message_policy_performance.sql"),
    true,
    "registration SOLAPI history should keep its RLS policy index-friendly",
  );

  const [workspaceSource, registrationWorkflowSource, serviceSource, routeSource, migrationSource, leastPrivilegeMigrationSource, policyPerformanceMigrationSource] = await Promise.all([
    readSource("src/features/tasks/ops-task-workspace.tsx"),
    readSource("src/features/tasks/registration-workflow.js"),
    readSource("src/features/tasks/ops-task-service.ts"),
    readSource("src/app/api/solapi/registration/route.ts"),
    readSource("supabase/migrations/20260710052921_registration_application_workflow.sql"),
    readSource("supabase/migrations/20260710053001_registration_message_least_privilege.sql"),
    readSource("supabase/migrations/20260710053144_registration_message_policy_performance.sql"),
  ]);
  const combined = `${workspaceSource}\n${serviceSource}\n${routeSource}\n${migrationSource}\n${leastPrivilegeMigrationSource}\n${policyPerformanceMigrationSource}`;
  const detailDialogSource = workspaceSource.slice(
    workspaceSource.indexOf("<Dialog open={detailOpen}"),
    workspaceSource.indexOf("<Dialog open={Boolean(deleteTarget)}"),
  );

  assertIncludesAll(`${workspaceSource}\n${registrationWorkflowSource}`, [
    "REGISTRATION_DECISION_ACTIONS",
    "RegistrationDecisionActions",
    "getRegistrationPipelineActionBlockers",
    "toDateKey(registration.consultationAt)",
    'studentName.endsWith("학생")',
    "RegistrationCustomerMessageDialog",
    "openRegistrationCustomerMessage",
    "sendRegistrationAdmissionMessage",
    "copyMakeEduAdmissionMessage",
    "입학 등록",
    "현재반 대기",
    "신규반 대기",
    "다음 개강 알림",
    "미등록",
    "입학신청서 발송",
    "메이크에듀용 내용 복사",
    "레벨테스트 예약일시",
    "상담 예약일시",
    "상담 완료일시",
    "수납 완료 확인",
  ]);
  assertIncludesAll(serviceSource, [
    "assignOpsStudentToWaitlist",
    "syncRegistrationWaitlist",
    "removeRegistrationWaitlistOnDelete",
    "registration_waitlist",
    "waitlist_registered",
    "previousTask",
  ]);
  assertIncludesAll(routeSource, [
    'from "node:crypto"',
    "createHmac",
    "randomBytes",
    "SOLAPI_API_KEY",
    "SOLAPI_API_SECRET",
    "SOLAPI_KAKAO_PF_ID",
    "SOLAPI_REGISTRATION_ADMISSION_TEMPLATE_ID",
    "https://api.solapi.com/messages/v4/send-many/detail",
    'type: "ATA"',
    "disableSms: true",
    '"#{학생명}"',
    "template_key: ADMISSION_TEMPLATE_KEY",
    'event_type: "customer_message_sent"',
    'status: "pending"',
    "claimMessageRecord",
  ]);
  assertIncludesAll(migrationSource, [
    "create table if not exists public.ops_registration_messages",
    "recipient_last4",
    "provider_message_id",
    "provider_group_id",
    "request_key",
    "updated_at",
    "'pending', 'accepted', 'failed'",
    "ops_registration_messages_task_created_idx",
  ]);
  assertIncludesAll(leastPrivilegeMigrationSource, [
    "revoke all privileges",
    "from anon",
    "revoke insert, update, delete, truncate, references, trigger",
    "from authenticated",
    "grant select",
  ]);
  assertIncludesAll(policyPerformanceMigrationSource, [
    "ops_registration_messages_sent_by_idx",
    "(select public.current_dashboard_role())",
    "(select auth.uid())",
  ]);
  assertIncludesAll(combined, [
    "입학신청서 작성 안내",
    "https://bit.ly/3rurm5t",
  ]);
  assert.match(
    detailDialogSource,
    /selectedTaskFresh\.type !== "registration" && selectedTaskFresh\.type !== "word_retest" && !isProcessDetail/,
    "registration detail should not render the generic comment and attachment rail",
  );
});

test("registration form is one progressive application with future steps locked and operations history collapsed", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const formDialogSource = source.slice(
    source.indexOf("<Dialog open={formOpen}"),
    source.indexOf("<Dialog open={detailOpen}"),
  );
  const registrationFormSource = source.slice(
    source.indexOf('if (form.type === "registration") {', source.indexOf("function TypeSpecificFields")),
    source.indexOf('if (form.type === "withdrawal")', source.indexOf("function TypeSpecificFields")),
  );

  assertIncludesAll(source, [
    "REGISTRATION_FORM_SECTIONS",
    "getRegistrationFormStage",
    "RegistrationFormSection",
    'data-registration-current={active ? "true" : "false"}',
    "<fieldset disabled={!enabled}",
    "지금 입력",
    "이전 단계 완료 후",
    "registrationOperationsOpen",
    'aria-label="담당자 및 일시 이력"',
    "CollapsibleContent",
    "focusRegistrationFormSection",
    'scrollIntoView({ block: "start", behavior: "smooth" })',
  ]);
  assert.doesNotMatch(registrationFormSource, /if \(step === "registration_/);
  assert.match(
    source,
    /const shouldShowFormDetailTabs = isTemplateForm && !isWordRetestForm && form\.type !== "withdrawal" && form\.type !== "transfer" && form\.type !== "registration" && formDetailTabs\.length > 1/,
  );
  assert.doesNotMatch(
    formDialogSource,
    /\{form\.type === "registration" && \([\s\S]*?<SelectField\s+label="진행상태"/,
    "registration status should be workflow-controlled rather than a top-level jump selector",
  );
});

test("operation class options query the canonical fee schema before legacy tuition fallbacks", async () => {
  const serviceSource = await readSource("src/features/tasks/ops-task-service.ts");
  const candidatesSource = serviceSource.slice(
    serviceSource.indexOf("const OPS_CLASS_COLUMN_CANDIDATES"),
    serviceSource.indexOf("const OPS_REGISTRATION_OPTIONAL_DETAIL_COLUMNS"),
  );
  const firstCandidate = candidatesSource.match(/\n\s*"([^"]+)",/)?.[1] || "";

  assert.match(firstCandidate, /schedule_plan,fee,/);
  assert.match(firstCandidate, /textbook_ids/);
  assert.doesNotMatch(firstCandidate, /tuition/);
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
    'label="담당선생님"',
    'label="장소"',
    'label="메모"',
    "fillRegistration: true",
    "fillWithdrawal: true",
    "fillTransferFrom: true",
    "fillTransferTo: true",
    "fillWordRetest: true",
    "getStudentRosterClassIds",
    "selectedWordRetestStudent",
    "selectedWordRetestClassId",
    "selectedWordRetestClass",
    "selectedWordRetestTeacherId",
    "selectedWordRetestTeacher",
    "getWordRetestStudentOptions(students, selectedWordRetestClass, form.studentId || \"\")",
    "getWordRetestClassOptions(classes, selectedWordRetestStudent, selectedWordRetestClassId, selectedWordRetestTeacher)",
    "getWordRetestTeacherOptions(teachers, selectedWordRetestTeacherId)",
    "classItem.id === selectedClassId",
    "teacher.id === selectedTeacherId",
    "findCurrentUserTeacherOption",
    "openManualField",
    "shouldShowManualField",
    "WordRetestMainExamDateField",
    "LinkedSelectedValue",
    "renderOption",
    "renderSelected",
    "listHeader",
    "getWordRetestTextbookOptions",
    "getWordRetestTextbookGradeFilters",
    "normalizeWordRetestTextbookSubjectLabel",
    "isWordRetestTextbookOption",
    "findClassWordRetestTextbook",
    "shouldPreferWordRetestTextbook",
    "inferWordRetestTextbookSubject",
    "inferWordRetestTextbookGrade",
    "inferWordRetestTextbookGradePill",
    "wordRetestTextbookGradeFilter",
    'const defaultAssigneeId = currentUserId || ""',
    "const { user, session, canManageAll, isAdmin, isStaff, isTeacher } = useAuth()",
    'setWordRetestMode(isTeacher && !isStaff ? "teacher" : "assistant")',
    "shouldShowFormDetailTabs",
    "{formStepProgressLabel}",
    "{getTaskTypeLabel(form.type)}",
  ]);

  assert.doesNotMatch(formDialogSource, /<DialogDescription(?! className="sr-only")/);
  assert.ok(source.includes('{ key: "teacher", label: "담당선생님" }'));
  assert.ok(source.includes('{ key: "assistant", label: "조교선생님" }'));

  const wordRetestScopeSource = source.slice(
    source.indexOf('if (step === "word_retest_scope")'),
    source.indexOf('if (step === "word_retest_scores")'),
  );
  assert.ok(
    wordRetestScopeSource.indexOf('label="출제 개수"') < wordRetestScopeSource.indexOf('label="커트라인(맞은 개수)"'),
    "word retest scope fields should place total question count before cutoff count",
  );
});

test("withdrawal workspace follows request processing and completed queues", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const withdrawalDataTableSource = source.slice(
    source.indexOf("function WithdrawalResizableHeaderCell"),
    source.indexOf("function DashboardMetric"),
  );
  const withdrawalPeriodFilterSource = source.slice(
    source.indexOf("function WithdrawalPeriodFilterBar"),
    source.indexOf("function WithdrawalResizableHeaderCell"),
  );
  const detailDialogSource = source.slice(
    source.indexOf("<Dialog open={detailOpen}"),
    source.indexOf("<Dialog open={Boolean(deleteTarget)}"),
  );
  const withdrawalWorkspaceToolbarSource = source.slice(
    source.indexOf('aria-label={isTodoWorkspace ? "할 일 목록"'),
    source.indexOf("{isTodoWorkspace && ("),
  );
  const formDialogSource = source.slice(
    source.indexOf("<Dialog open={formOpen}"),
    source.indexOf("<Dialog open={detailOpen}"),
  );
  const withdrawalFormSource = source.slice(
    source.indexOf('if (form.type === "withdrawal")'),
    source.indexOf('if (form.type === "transfer")'),
  );
  const withdrawalDetailSource = source.slice(
    source.indexOf("function WithdrawalDetailPanel"),
    source.indexOf("function CommentPanelContent"),
  );
  const withdrawalDetailTopSource = withdrawalDetailSource.slice(
    withdrawalDetailSource.indexOf('aria-label="퇴원 상세 신청서"'),
    withdrawalDetailSource.indexOf('<details className="group rounded-md border">'),
  );
  const withdrawalDetailProcessingSource = withdrawalDetailSource.slice(
    withdrawalDetailSource.indexOf('<details className="group rounded-md border">'),
    withdrawalDetailSource.indexOf("</details>"),
  );
  const withdrawalCheckBlockerSource = source.slice(
    source.indexOf("function getMissingWithdrawalCheckLabels"),
    source.indexOf("function getMissingTransferCheckLabels"),
  );
  const nextStatusActionSource = source.slice(
    source.indexOf("function getNextTaskStatusAction"),
    source.indexOf("function canEditTaskDetails"),
  );
  const withdrawalNotificationVariableSource = source.slice(
    source.indexOf("const WITHDRAWAL_NOTIFICATION_TEMPLATE_VARIABLES"),
    source.indexOf("const WITHDRAWAL_NOTIFICATION_TEMPLATE_PREVIEW_CONTEXT"),
  );
  const withdrawalNotificationDispatchSource = source.slice(
    source.indexOf("async function sendWithdrawalGoogleChatNotification"),
    source.indexOf("function WithdrawalNotificationSettingsDialog"),
  );
  const withdrawalNotificationDialogSource = source.slice(
    source.indexOf("function WithdrawalNotificationSettingsDialog"),
    source.indexOf("function renderWithdrawalNotificationTemplate"),
  );

  assertIncludesAll(source, [
    'type WithdrawalViewKey = "applicant" | "operations" | "closed"',
    'type WithdrawalPeriodFilter = "all" | "today" | "week" | "month" | "custom"',
    "type WithdrawalTableColumnKey",
    "WITHDRAWAL_VIEW_TABS",
    "WITHDRAWAL_NOTIFICATION_CHANNELS",
    "WITHDRAWAL_GOOGLE_CHAT_CHANNEL_MAP",
    "WITHDRAWAL_NOTIFICATION_TRIGGERS",
    "WITHDRAWAL_NOTIFICATION_TEMPLATE_VARIABLES",
    "WithdrawalNotificationSettingsDialog",
    "WithdrawalGoogleChatWebhookInfo",
    "WITHDRAWAL_PERIOD_FILTERS",
    "WITHDRAWAL_TABLE_COLUMNS",
    "WITHDRAWAL_TABLE_COLUMN_WIDTHS",
    "WITHDRAWAL_TABLE_COLUMN_MIN_WIDTHS",
    '{ key: "applicant", label: "신청" }',
    '{ key: "operations", label: "처리 중" }',
    '{ key: "closed", label: "완료" }',
    "isWithdrawalWorkspace",
    "withdrawalView",
    "syncWithdrawalView",
    "getWithdrawalViewTasks",
    "withdrawalCounts",
    "WithdrawalDataTable",
    "WithdrawalPeriodFilterBar",
    "WithdrawalFilterSelect",
    "WithdrawalResizableHeaderCell",
    "getWithdrawalTableGridTemplate",
    "matchesWithdrawalSelectionFilters",
    "matchesWithdrawalPeriodFilter",
    "getWithdrawalTableValue",
  ]);
  assert.doesNotMatch(source, /\{ key: "approver", label: "결재자" \}/);
  assert.doesNotMatch(source, /view === "approver"/);
  assert.match(
    source,
    /if \(view === "operations"\) \{[\s\S]*"review_requested"/,
    "legacy withdrawal review_requested rows should remain in the processing queue",
  );
  assert.match(
    source,
    /if \(task\.type === "withdrawal" && task\.status === "in_progress"\) return \{ status: "done", label: "완료" \}/,
    "withdrawal tasks should move from processing directly to completed without an approval queue",
  );
  assert.match(
    nextStatusActionSource,
    /if \(task\.type === "withdrawal" && task\.status === "done"\) return null/,
    "completed withdrawal rows should be preserved without a reopen action",
  );
  assert.match(
    nextStatusActionSource,
    /if \(task\.type === "withdrawal" && task\.status === "requested"\) return \{ status: "in_progress", label: "처리 시작" \}/,
    "new withdrawal applications should move directly to processing",
  );
  assert.match(
    nextStatusActionSource,
    /if \(task\.type === "withdrawal" && task\.status === "confirmed"\) return \{ status: "in_progress", label: "처리 시작" \}/,
    "legacy confirmed withdrawal rows should use the same processing action language",
  );
  assertIncludesAll(withdrawalWorkspaceToolbarSource, [
    'aria-label={isRegistrationWorkspace ? "등록 알림 설정" : isTransferWorkspace ? "전반 알림 설정" : "퇴원 알림 설정"}',
    "setWithdrawalNotificationOpen(true)",
    "<Bell className=\"size-4\"",
  ]);
  assert.match(
    withdrawalWorkspaceToolbarSource,
    /!isWordRetestWorkspace && !isRegistrationWorkspace && !isWithdrawalWorkspace && !isTransferWorkspace && \(/,
    "withdrawal toolbar should exclude the generic refresh action",
  );
  assertIncludesAll(source, [
    'tableAriaLabel = "퇴원 알림 설정 표"',
    'aria-label={tableAriaLabel}',
    "알림 위치",
    "구글챗 · 관리팀",
    "웹훅 URL 보기",
    "웹훅 URL 수정",
    "handleOpenWithdrawalWebhookInfo",
    "handleSaveWithdrawalWebhookInfo",
    "selectedWebhookInfo",
    "webhookUrlInput",
    "/api/google-chat?channel=",
    'method: "PATCH"',
    "신청 접수",
    "처리 완료",
    "openWithdrawalNotificationTemplateEditor",
    "selectedNotificationTrigger",
    "withdrawalNotificationTemplates",
    "DialogTitle>알림 내용 수정",
    'aria-label={`${trigger.label} 알림 내용 수정`}',
    'className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden sm:max-w-2xl"',
    'className="grid min-h-0 gap-4 overflow-y-auto pr-1"',
    '<DialogFooter className="shrink-0">',
  ]);
  assert.match(withdrawalNotificationDialogSource, /mobileListTestId = "withdrawal-notification-mobile-list"/);
  assert.match(withdrawalNotificationDialogSource, /data-testid=\{mobileListTestId\}/);
  assert.match(withdrawalNotificationDialogSource, /className="grid gap-2 md:hidden"/);
  assert.match(withdrawalNotificationDialogSource, /className="hidden overflow-x-auto rounded-md border md:block"/);
  assert.match(withdrawalNotificationDialogSource, /aria-label=\{`\$\{trigger\.label\} 모바일 \$\{workflowLabel\} 알림 설정`\}/);
  assert.ok(
    withdrawalNotificationDialogSource.indexOf("{selectedWebhookInfo || webhookInfoError ? (") <
      withdrawalNotificationDialogSource.indexOf("data-testid={mobileListTestId}"),
    "withdrawal webhook detail should appear before the long mobile settings list",
  );
  assert.match(withdrawalNotificationDialogSource, /webhookInfoPanelRef/);
  assert.match(withdrawalNotificationDialogSource, /scrollIntoView\(\{ block: "start" \}\)/);
  assert.doesNotMatch(source, /완료 알림/);
  assertIncludesAll(source, [
    'columnKey: "status"',
    'columnKey: "subject"',
    'columnKey: "teacher"',
    'columnKey: "className"',
    'columnKey: "student"',
    'columnKey: "withdrawalDate"',
    'columnKey: "withdrawalSession"',
    'columnKey: "completedLessonHours"',
    'columnKey: "fourWeekLessonHours"',
    'columnKey: "progress"',
    'columnKey: "customerReason"',
    'columnKey: "teacherOpinion"',
    'columnKey: "undistributedTextbooks"',
    'columnKey: "operationsChecklist"',
    'columnKey: "action"',
  ]);
  assert.ok(
    source.indexOf('columnKey: "student"') < source.indexOf('columnKey: "customerReason"') &&
      source.indexOf('columnKey: "customerReason"') < source.indexOf('columnKey: "teacherOpinion"') &&
      source.indexOf('columnKey: "teacherOpinion"') < source.indexOf('columnKey: "undistributedTextbooks"') &&
      source.indexOf('columnKey: "undistributedTextbooks"') < source.indexOf('columnKey: "withdrawalDate"'),
    "withdrawal table should place reason opinion and undistributed textbooks immediately after student",
  );
  assertIncludesAll(withdrawalDataTableSource, [
    'aria-label="퇴원 전체 필터"',
    'aria-label="퇴원 누가 필터"',
    'aria-label={`${filterColumn.label} 열 필터`}',
    "filterInputOpen",
    "isFilterInputExpanded",
    "setFilterInputOpen((current) => !current)",
    'aria-label="퇴원 신청 데이터테이블"',
    'data-testid="withdrawal-mobile-task-list"',
    'aria-label="퇴원 모바일 목록"',
    "getWithdrawalTaskDetailAriaLabel(task)",
    'aria-label={`${label} 열 너비 조절`}',
    'cursor-col-resize',
    'role="columnheader"',
    'setWithdrawalTableSort',
    'setFilterColumnKey(columnKey)',
    '[grid-template-columns:var(--withdrawal-grid-template)]',
    "<WithdrawalPeriodFilterBar",
    "WithdrawalOperationsChecklistChips",
    "onChecklistChange",
  ]);
  assert.ok(source.includes("aria-pressed={item.checked}"));
  assert.match(withdrawalDataTableSource, /className="grid gap-2 p-3 md:hidden"/);
  assert.match(withdrawalDataTableSource, /className="hidden w-full overflow-x-auto md:block"/);
  assert.doesNotMatch(
    withdrawalDataTableSource,
    /detailAriaLabel = "퇴원 상세 열기"/,
    "withdrawal desktop detail buttons should use row-specific labels instead of a repeated generic name",
  );
  assert.match(withdrawalDataTableSource, /getWithdrawalMobileNextActionLabel/);
  assert.match(source, /labelPrefix = "퇴원"/);
  assert.match(source, /aria-label=\{`\$\{labelPrefix\} 기간 필터`\}/);
  assertIncludesAll(withdrawalPeriodFilterSource, [
    "<DatePickerControl",
    'placeholder="시작일"',
    'placeholder="종료일"',
    'ariaLabel={`${labelPrefix} 기간 시작일`}',
    'ariaLabel={`${labelPrefix} 기간 종료일`}',
  ]);
  assert.doesNotMatch(withdrawalPeriodFilterSource, /type="date"/);
  assert.doesNotMatch(withdrawalDataTableSource, /label="수업 필터"/);
  assert.doesNotMatch(withdrawalDataTableSource, /allLabel="수업 전체"/);
  assert.doesNotMatch(withdrawalDataTableSource, /label="학생 필터"/);
  assert.doesNotMatch(withdrawalDataTableSource, /allLabel="학생 전체"/);
  assert.doesNotMatch(withdrawalDataTableSource, /columnKey: "requester"/);
  assert.doesNotMatch(withdrawalDataTableSource, /columnKey: "requestedAt"/);

  assertIncludesAll(withdrawalFormSource, [
    "selectWithdrawalSubject",
    "selectWithdrawalTeacher",
    "withdrawalSubjectOptions",
    "withdrawalTeacherOptions",
    "withdrawalClassOptions",
    "withdrawalStudentOptions",
    "WithdrawalScheduleCalendarField",
    "TextareaField",
    "UndistributedTextbookListField",
    'label="과목"',
    'label="선생님"',
    'label="수업"',
    'label="학생"',
    'label="고객 퇴원사유"',
    'label="선생님 의견"',
    'label="미배부 교재"',
    'CheckField label="메이크에듀 퇴원처리"',
    'CheckField label="수업료 처리"',
    'CheckField label="교재비 처리"',
    "help={WITHDRAWAL_UNDISTRIBUTED_TEXTBOOK_HELP}",
  ]);
  assertIncludesAll(withdrawalFormSource, [
    "canSelectWithdrawalTeacher",
    "canSelectWithdrawalClass",
    "canSelectWithdrawalStudent",
    'disabled={!canSelectWithdrawalTeacher}',
    'disabledPlaceholder="과목 먼저"',
    'disabled={!canSelectWithdrawalClass}',
    'disabledPlaceholder="선생님 먼저"',
    'disabled={!canSelectWithdrawalStudent}',
    'disabledPlaceholder="수업 먼저"',
    "renderSelected={(option) => <LinkedSelectedValue label={option.label} />}",
  ]);

  assert.ok(
    withdrawalFormSource.indexOf('label="과목"') < withdrawalFormSource.indexOf('label="선생님"') &&
      withdrawalFormSource.indexOf('label="선생님"') < withdrawalFormSource.indexOf('label="수업"') &&
      withdrawalFormSource.indexOf('label="수업"') < withdrawalFormSource.indexOf('label="학생"'),
    "withdrawal form should narrow selections in subject teacher class student order",
  );
  assert.match(
    source,
    /if \(subject !== form\.subject\) \{[\s\S]*?updateWithdrawal\("teacherName", ""\)[\s\S]*?updateForm\("classId", ""\)[\s\S]*?updateForm\("studentId", ""\)/,
    "changing the withdrawal subject should clear downstream teacher, class and student selections",
  );
  assert.match(
    source,
    /if \(teacherId !== selectedWithdrawalTeacherId\) \{[\s\S]*?updateForm\("classId", ""\)[\s\S]*?updateForm\("studentId", ""\)/,
    "changing the withdrawal teacher should clear downstream class and student selections",
  );
  assert.doesNotMatch(
    withdrawalFormSource,
    /renderSelected=\{\(option\) => <LinkedSelectedValue label=\{option\.label\} pills=/,
    "withdrawal selected values should not show secondary metadata pills in the closed controls",
  );
  assert.doesNotMatch(
    withdrawalFormSource,
    /renderOption=\{\(option\) => <LinkedSelectedValue label=\{option\.label\} pills=\{\[option\.meta\]\}/,
    "withdrawal teacher candidates should not show team metadata pills",
  );
  assert.doesNotMatch(
    withdrawalFormSource,
    /classItem\?\.subject, classItem\?\.teacher, classItem\?\.room/,
    "withdrawal class candidates should not show subject teacher or room metadata pills",
  );
  assert.match(
    withdrawalFormSource,
    /return <LinkedSelectedValue label=\{option\.label\} pills=\{\[student\?\.grade, student\?\.school\]\} \/>/,
    "withdrawal student candidates should keep grade and school but hide status metadata",
  );
  assert.ok(
    withdrawalFormSource.indexOf("고객 퇴원사유") < withdrawalFormSource.indexOf("WithdrawalScheduleCalendarField"),
    "withdrawal form should collect applicant reason before the withdrawal schedule calendar in one request",
  );
  assert.doesNotMatch(withdrawalFormSource, /if \(step === "withdrawal_reason"\)/);
  assert.doesNotMatch(withdrawalFormSource, /if \(step === "withdrawal_checks"\)/);
  assert.doesNotMatch(withdrawalFormSource, /퇴원 신청 내용/);
  assert.doesNotMatch(withdrawalFormSource, /<TextField label="학년"/);
  assert.doesNotMatch(withdrawalFormSource, /<WithdrawalFlowSummary/);
  assert.doesNotMatch(withdrawalFormSource, /<TextField label="퇴원회차"/);
  assert.doesNotMatch(withdrawalFormSource, /<TextFieldWithHelp label="퇴원일"/);
  assert.doesNotMatch(withdrawalFormSource, /<TaskListboxField label=\{<FieldHelpLabel label="퇴원회차"/);
  assert.doesNotMatch(withdrawalFormSource, /<TextField label="진행 수업시수"/);
  assert.doesNotMatch(withdrawalFormSource, /<TextField label="4주 기준 수업시수"/);
  assert.doesNotMatch(withdrawalFormSource, /AutoSyncStatusField label="시간표 명단 변경"/);
  assertIncludesAll(source, [
    "getWithdrawalClassScheduleItems",
    "getFallbackWithdrawalClassScheduleItems",
    "getWithdrawalScheduleWeekdayIndexes",
    "parseWithdrawalScheduleHoursByWeekday",
    "getWithdrawalSessionHours",
    "getWithdrawalWeeklyLessonHours",
    "getWithdrawalScheduleMetrics",
    "getWithdrawalScheduleStateLabel",
    "isWithdrawalScheduleSelectable",
    "FieldHelpLabel",
    "helpOpen",
    "setHelpOpen",
    "WITHDRAWAL_DATE_HELP",
    "수업진행률",
    "정상",
    "휴강",
    "보강",
    "관리팀으로부터 수령한 교재 중 위 학생에게 아직 배부되지 않은 교재가 있다면 입력하고",
    "당월 출석부를 보고 학생이 마지막으로 수업 받은 날짜를 선택해 주세요",
    "수업 일정에서 마지막으로 출석한 날짜를 선택하면 퇴원회차와 수업진행률이 자동 계산됩니다.",
    "진행 수업시수",
    "4주 기준 수업시수",
    "배부되지 않은 교재에 대한 교재비 청구취소나 환불 처리는 교재 반납 이후에 진행됩니다.",
    "UndistributedTextbookListField",
    'aria-label={`${label} 항목 추가`}',
    "교재 추가",
    "Math.max(1, rawItems.length) + extraRowCount",
    "getWithdrawalCalendarSessionLabel",
  ]);
  assert.doesNotMatch(
    withdrawalFormSource,
    /<TextFieldWithHelp label="미배부 교재"/,
    "undistributed textbooks should support multiple entries instead of a single text input",
  );
  assert.match(
    source,
    /const shouldShowFormDetailTabs = isTemplateForm && !isWordRetestForm && form\.type !== "withdrawal" && form\.type !== "transfer" && form\.type !== "registration" && formDetailTabs\.length > 1/,
  );
  assert.match(
    source,
    /className=\{form\.type === "withdrawal" \|\| form\.type === "transfer" \|\| form\.type === "registration" \? "grid gap-3" : "grid gap-3 rounded-lg border p-3"\}/,
  );
  assert.match(
    formDialogSource,
    /\{isTemplateForm && !isWordRetestForm && formDetailTabs\.length > 0 && \(/,
  );
  assert.match(
    formDialogSource,
    /\{shouldShowFormDetailTabs && \([\s\S]*?aria-label=\{`\$\{getTaskTypeLabel\(form\.type\)\} 입력 단계/,
  );
  assert.match(
    source,
    /function getFormCompletionIntentSubmitLabel\(intent: FormCompletionIntent \| null, taskType: OpsTaskInput\["type"\], isEditing: boolean\)/,
  );
  assert.match(
    source,
    /if \(!intent && taskType === "withdrawal" && !isEditing\) return "퇴원 신청"/,
  );
  assert.match(
    source,
    /function canSubmitOpsTaskForm\(input: OpsTaskInput, isEditing: boolean\)/,
    "withdrawal submit gating should be centralized with the form state",
  );
  assert.match(
    source,
    /function canSubmitOpsTaskForm\(input: OpsTaskInput, isEditing: boolean\) \{[\s\S]*?if \(input\.type !== "withdrawal" \|\| isEditing\) return true[\s\S]*?return Boolean\([\s\S]*?input\.subject &&[\s\S]*?withdrawal\.teacherName &&[\s\S]*?input\.classId &&[\s\S]*?input\.studentId/,
    "new withdrawal applications should require subject, teacher, class, and student before submit is enabled",
  );
  assert.match(
    source,
    /const canSubmitCurrentForm = canSubmitOpsTaskForm\(form, Boolean\(editingTask\)\)/,
  );
  assert.match(
    formDialogSource,
    /<Button type="submit" disabled=\{saving \|\| !canSubmitCurrentForm\} className="w-full sm:w-auto">/,
  );
  assert.match(
    formDialogSource,
    /getFormCompletionIntentSubmitLabel\(formCompletionIntent, form\.type, Boolean\(editingTask\)\)/,
  );
  assert.match(source, /<Textarea[\s\S]*className="min-h-20 min-w-0 resize-y"/);
  assert.match(source, /<Popover open=\{helpOpen\} onOpenChange=\{setHelpOpen\}>/);
  assert.match(source, /weeklyLessonHours \* 4/);
  assert.match(source, /completedMinutes[\s\S]*\/ 60/);
  assert.match(
    source,
    /if \(isWithdrawalWorkspace \|\| isTransferWorkspace\) return getWithdrawalViewTasks\(nextTasks, withdrawalView\)/,
  );
  assert.match(
    source,
    /isWithdrawalWorkspace \? \(\s*<WithdrawalDataTable[\s\S]*?tasks=\{visibleTasks\}/,
  );
  assert.match(
    source,
    /aria-label=\{isTodoWorkspace \? "할 일 목록" : isWordRetestWorkspace \? "단어 재시험 역할" : isRegistrationWorkspace \? "등록 흐름" : isWithdrawalWorkspace \? "퇴원 흐름" : isTransferWorkspace \? "전반 흐름" : `\$\{workspaceLabel\} 보기`\}/,
  );
  assertIncludesAll(source, [
    "const workspaceSurfaceClassName = isWithdrawalWorkspace || isTransferWorkspace",
    '? "flex flex-col gap-2"',
    ': "flex flex-col gap-2 rounded-lg border bg-card p-3 shadow-xs"',
    "className={workspaceSurfaceClassName}",
  ]);
  assertIncludesAll(withdrawalDetailSource, [
    "신청 · 처리",
    "퇴원 상세 신청서",
    "고객 퇴원사유",
    "선생님 의견",
    "미배부 교재",
    "퇴원일",
    "퇴원회차",
    "진행 수업시수",
    "4주 기준 수업시수",
    "수업진행률",
    "처리 확인",
    "신청자",
    "신청일시",
  ]);
  assertIncludesAll(withdrawalDetailTopSource, [
    "고객 퇴원사유",
    "선생님 의견",
    "미배부 교재",
    "퇴원일",
    "퇴원회차",
    "진행 수업시수",
    "4주 기준 수업시수",
    "수업진행률",
    "처리 확인",
  ]);
  assertIncludesAll(withdrawalDetailProcessingSource, [
    "신청 · 처리",
    "신청자",
    "신청일시",
    "담당자",
    "완료일시",
  ]);
  assert.doesNotMatch(withdrawalDetailProcessingSource, /label="담당"/);
  assert.doesNotMatch(withdrawalDetailProcessingSource, /처리일시/);
  assert.doesNotMatch(withdrawalDetailProcessingSource, /퇴원일|퇴원회차|진행 수업시수|4주 기준 수업시수|수업진행률/);
  assertIncludesAll(source, [
    "isWithdrawalDetail",
    "isTransferDetail",
    "isProcessDetail",
    "isCompletedProcessDetail",
    "canManageWithdrawalStatusAction",
  ]);
  assertIncludesAll(detailDialogSource, [
    "WithdrawalDetailPanel",
    "TransferDetailPanel",
    "!isProcessDetail",
    "selectedTaskFresh.type !== \"word_retest\" && !isProcessDetail",
  ]);
  assertIncludesAll(source, [
    "const canManageWithdrawalWorkflow = canManageAll || isStaff",
    "function getWithdrawalWorkflowStatusLabel",
    "function WithdrawalWorkflowStatusBadge",
  ]);
  assert.match(
    source,
    /case "status":\s*return getWithdrawalWorkflowStatusLabel\(task\.status\)/,
    "withdrawal table filtering and sorting should use the simplified withdrawal workflow labels",
  );
  assert.match(
    source,
    /<WithdrawalWorkflowStatusBadge status=\{task\.status\} \/>/,
    "withdrawal table should not expose the generic confirmed status badge",
  );
  assert.match(
    detailDialogSource,
    /!isProcessDetail && \(\s*<CompletionBlockerActionPanel/,
    "withdrawal detail should not show the completion blocker chip group",
  );
  assert.match(
    detailDialogSource,
    /!isProcessDetail && getSecondaryTaskStatusOptions\(selectedTaskFresh\)/,
    "withdrawal detail should not show hold or cancel secondary actions",
  );
  assert.match(
    detailDialogSource,
    /canManageWithdrawalStatusAction && \(\(!isProcessDetail \|\| !detailPrimaryActionBlocked\) && detailPrimaryAction\)/,
    "withdrawal progress and completion actions should be available only to the management team",
  );
  assert.match(
    source,
    /canManageWorkflow=\{canManageWithdrawalWorkflow\}/,
    "withdrawal table status actions should be gated by the management workflow permission",
  );
  assert.match(
    source,
    /const canRunStatusAction = canManageWorkflow && Boolean\(nextAction\)/,
    "withdrawal rows should hide progress and completion buttons for non-management users",
  );
  assertIncludesAll(withdrawalCheckBlockerSource, [
    "withdrawal?.makeeduWithdrawalDone",
    "withdrawal?.feeProcessed",
    "withdrawal?.textbookFeeProcessed",
    "메이크에듀 퇴원처리",
    "수업료 처리",
    "교재비 처리",
  ]);
  assert.doesNotMatch(withdrawalDetailSource, /TaskTypeBadge|TaskStatusBadge|getTaskPriorityLabel|완료 상태/);
  assert.doesNotMatch(withdrawalDetailSource, /WithdrawalFlowSummary/);
  assert.doesNotMatch(withdrawalDetailSource, /AutoSyncResultSummary/);
  assert.doesNotMatch(withdrawalDetailSource, /결재/);
  assert.match(
    withdrawalNotificationVariableSource,
    /WITHDRAWAL_TABLE_COLUMNS[\s\S]*\.map\(\(column\) => column\.label\)[\s\S]*\.filter\(\(label\) => label !== "액션"\)/,
    "notification templates should expose every data table column except the non-data action column",
  );
  assertIncludesAll(withdrawalNotificationVariableSource, [
    '"담당선생님"',
    '"관리팀"',
    '"프로세스"',
  ]);
  assertIncludesAll(source.slice(source.indexOf("const WITHDRAWAL_NOTIFICATION_TEMPLATE_PREVIEW_CONTEXT"), source.indexOf("const DEFAULT_WITHDRAWAL_NOTIFICATION_TEMPLATES")), [
    "상태",
    "과목",
    "선생님",
    "수업",
    "학생",
    "퇴원일",
    "퇴원회차",
    "진행 수업시수",
    "4주 기준 수업시수",
    "수업진행률",
    "고객 퇴원사유",
    "선생님 의견",
    "미배부 교재",
    "신청자",
    "신청일시",
  ]);
  assertIncludesAll(withdrawalNotificationDispatchSource, [
    "sendWithdrawalGoogleChatNotification",
    "fetch(\"/api/google-chat\"",
    "method: \"POST\"",
    "notifyWithdrawalWorkflow",
    "withdrawalNotificationSettings",
    "withdrawalNotificationTemplates",
  ]);
  assert.match(
    source,
    /if \(payload\.type === "withdrawal" && !wasEditing\) \{[\s\S]*notifyWithdrawalWorkflow\("submitted"/,
    "new withdrawal applications should dispatch the submitted notification",
  );
  assert.match(
    source,
    /if \(task\.type === "withdrawal"\) \{[\s\S]*notifyWithdrawalWorkflow\(getWithdrawalNotificationTriggerForStatus\(status\)/,
    "withdrawal status changes should dispatch process notifications",
  );
});

test("withdrawal schedule calendar defaults to current month and counts the billing-cycle hours", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const scheduleFieldSource = source.slice(
    source.indexOf("function WithdrawalScheduleCalendarField"),
    source.indexOf("function WordRetestMainExamDateField"),
  );
  const metricsSource = source.slice(
    source.indexOf("function getWithdrawalScheduleMetrics"),
    source.indexOf("function getCalendarMonthKey"),
  );

  assert.match(
    scheduleFieldSource,
    /const \[calendarMonth, setCalendarMonth\] = useState\(\(\) => getCalendarMonthDate\(selectedDateKey\)\)/,
    "withdrawal calendar should show the current month by default when no withdrawal date is selected",
  );
  assert.match(
    scheduleFieldSource,
    /if \(!classItem\) \{[\s\S]*ScheduleSelectionDependencyState fieldId=\{fieldId\}[\s\S]*ReadonlyInfoField label="퇴원회차"/,
    "withdrawal should show a compact dependency state instead of a full empty calendar before class selection",
  );
  assert.doesNotMatch(
    scheduleFieldSource,
    /firstScheduleDate/,
    "the default withdrawal calendar month should not jump to the first schedule date",
  );
  assertIncludesAll(metricsSource, [
    "getWithdrawalBillingCycleItems",
    "completedCycleItems",
    ".reduce((sum, item) => sum + item.lessonHours * 60, 0)",
  ]);
  assert.doesNotMatch(
    metricsSource,
    /item\.dateKey\.slice\(0, 7\) === selectedMonthKey/,
    "progress hours should not drop the first billing-cycle session just because it falls in the previous calendar month",
  );
  assert.match(
    source,
    /function getWithdrawalBillingCycleItems[\s\S]*sessionNumber === 1/,
    "billing-cycle accumulation should start from the current cycle's 1회차",
  );
  assert.match(
    scheduleFieldSource,
    /getWithdrawalCalendarDisplaySessionLabel\(scheduleItem, \{ includeMonth: true \}\)/,
    "withdrawal calendar cells should show the month with the saved schedule label only for selectable schedules",
  );
  assertIncludesAll(source, [
    "function getWithdrawalCalendarMonthLabel",
    "function getWithdrawalScheduleSessionLabel",
    "function getWithdrawalScheduleDisplayMonthLabel",
    "function getWithdrawalScheduleBillingMonthKey",
    "function getWithdrawalCalendarDisplaySessionLabel",
    "function getWithdrawalCalendarCellTitle",
    "function getWithdrawalCalendarCellToneClass",
    "if (!item || !isWithdrawalScheduleSelectable(item)) return \"\"",
    "const billingLabel = getWithdrawalSessionBillingLabel(session)",
    "billingLabel,",
    "billingColor: getWithdrawalSessionBillingColor(session)",
    "return options.includeMonth ? getWithdrawalScheduleSessionLabel(item) : item.label",
    "return [dateKey, sessionLabel, item.stateLabel].filter(Boolean).join(\" \")",
    "border border-sky-200 bg-sky-50",
    "border border-emerald-200 bg-emerald-50",
    "border border-amber-200 bg-amber-50",
    "border border-rose-200 bg-rose-50",
    "toneClass",
    "{sessionLabel && <span",
  ]);
  assert.doesNotMatch(
    source,
    /getWithdrawalScheduleMonth(SessionNumber|Items)/,
    "calendar display must use the saved class schedule label instead of recalculating a monthly session number",
  );
  assert.match(
    scheduleFieldSource,
    /place-items-center[\s\S]*text-center/,
    "withdrawal calendar session and state labels should be centered",
  );
  assert.doesNotMatch(
    scheduleFieldSource,
    /classItem\?\.label \|\| "수업 선택 필요"/,
    "withdrawal calendar should not repeat the selected class name beside the date label",
  );
});

test("transfer workspace inherits withdrawal layout while preserving transfer fields", async () => {
  const [source, serviceSource] = await Promise.all([
    readSource("src/features/tasks/ops-task-workspace.tsx"),
    readSource("src/features/tasks/ops-task-service.ts"),
  ]);
  const transferFormSource = source.slice(
    source.indexOf('if (form.type === "transfer")'),
    source.indexOf('if (form.type === "word_retest")'),
  );
  const formDialogSource = source.slice(
    source.indexOf("<Dialog open={formOpen}"),
    source.indexOf("<Dialog open={detailOpen}"),
  );
  const transferDataTableSource = source.slice(
    source.indexOf("function TransferDataTable"),
    source.indexOf("function DashboardMetric"),
  );
  const transferScheduleFieldSource = source.slice(
    source.indexOf("function TransferScheduleCalendarField"),
    source.indexOf("function WordRetestMainExamDateField"),
  );
  const workspaceToolbarSource = source.slice(
    source.indexOf('aria-label={isTodoWorkspace ? "할 일 목록"'),
    source.indexOf("{isTodoWorkspace && ("),
  );
  const detailDialogSource = source.slice(
    source.indexOf("<Dialog open={detailOpen}"),
    source.indexOf("<Dialog open={Boolean(deleteTarget)}"),
  );
  const transferDetailSource = source.slice(
    source.indexOf("function TransferDetailPanel"),
    source.indexOf("function CommentPanelContent"),
  );
  const nextStatusActionSource = source.slice(
    source.indexOf("function getNextTaskStatusAction"),
    source.indexOf("function canEditTaskDetails"),
  );

  assertIncludesAll(source, [
    "type TransferTableColumnKey",
    "TRANSFER_TABLE_COLUMNS",
    "TRANSFER_TABLE_COLUMN_WIDTHS",
    "TRANSFER_TABLE_COLUMN_MIN_WIDTHS",
    "TRANSFER_NOTIFICATION_TEMPLATE_VARIABLES",
    "DEFAULT_TRANSFER_NOTIFICATION_TEMPLATES",
    "isTransferWorkspace",
    "transferCounts",
    "TransferDataTable",
    "TransferScheduleCalendarField",
    "TransferOperationsChecklistChips",
    "getTransferTableValue",
    "getTransferClassScheduleMetrics",
    "getTransferTuitionAdjustment",
    "TransferWorkflowChart",
    "TransferTuitionAdjustmentPanel",
    "notifyTransferWorkflow",
    "TransferNotificationSettingsDialog",
    "TransferDetailPanel",
  ]);
  assertIncludesAll(serviceSource, [
    "fee?: number",
    "const normalized = String(value || \"\").replace(/[^0-9.-]+/g, \"\")",
    "OPS_CLASS_COLUMN_CANDIDATES",
    '"id,name,subject,grade,teacher,room,schedule,schedule_plan,fee,student_ids,waitlist_ids,textbook_ids,status"',
    '"id,name,subject,grade,teacher,room,schedule,schedule_plan,tuition,student_ids,waitlist_ids,textbook_ids,status"',
    '"id,name,subject,grade,teacher,room,schedule,schedule_plan,tuition,student_ids,waitlist_ids,status"',
    '"id,name,subject,grade,teacher,room,schedule,schedule_plan,fee,student_ids,waitlist_ids,status"',
    "async function readOpsClassRows()",
    "for (const columns of OPS_CLASS_COLUMN_CANDIDATES)",
    "if (!isMissingColumnError(result.error))",
    "fee: numberValue(row.fee || row.tuition)",
  ]);
  assert.match(
    formDialogSource,
    /form\.type === "transfer" \? "sm:max-w-5xl xl:max-w-6xl"/,
    "transfer request modal should be wider than the generic template form",
  );
  assert.match(
    source,
    /if \(isWithdrawalWorkspace \|\| isTransferWorkspace\) return getWithdrawalViewTasks\(nextTasks, withdrawalView\)/,
    "transfer should use the same request processing completed queue split as withdrawal",
  );
  assert.match(
    source,
    /isWithdrawalWorkspace \|\| isTransferWorkspace\s*\?\s*\([\s\S]*?<WithdrawalDataTable|isTransferWorkspace\s*\?\s*\([\s\S]*?<TransferDataTable/,
    "transfer should render a dedicated data table instead of the generic operation task list",
  );
  assert.match(
    nextStatusActionSource,
    /if \(task\.type === "transfer" && task\.status === "done"\) return null/,
    "completed transfer rows should be preserved without a reopen action",
  );
  assert.match(
    nextStatusActionSource,
    /if \(task\.type === "transfer" && task\.status === "requested"\) return \{ status: "in_progress", label: "처리 시작" \}/,
    "new transfer applications should move directly to processing like withdrawal",
  );
  assert.match(
    nextStatusActionSource,
    /if \(task\.type === "transfer" && task\.status === "in_progress"\) return \{ status: "done", label: "완료" \}/,
    "transfer processing rows should complete without an approval queue",
  );
  assertIncludesAll(workspaceToolbarSource, [
    'aria-label={isRegistrationWorkspace ? "등록 알림 설정" : isTransferWorkspace ? "전반 알림 설정" : "퇴원 알림 설정"}',
    "setTransferNotificationOpen(true)",
    "setWithdrawalNotificationOpen(true)",
  ]);
  assertIncludesAll(detailDialogSource, [
    "TransferDetailPanel",
    'selectedTaskFresh?.type === "withdrawal" || selectedTaskFresh?.type === "transfer" ? "sm:max-w-3xl"',
    'selectedTaskFresh.type === "withdrawal" || selectedTaskFresh.type === "transfer" ? "grid gap-4"',
    "selectedTaskFresh.type !== \"word_retest\" && !isProcessDetail",
  ]);
  assertIncludesAll(transferDetailSource, [
    "전반 상세 신청서",
    "전 선생님",
    "후 선생님",
    "전 수업",
    "후 수업",
    "전 미배부 교재",
    "후 미배부 교재",
    "전 수업 종료일",
    "전 수업 종료회차",
    "후 수업 시작일",
    "후 수업 시작회차",
    "처리 확인",
    "신청 · 처리",
    "신청자",
    "신청일시",
    "담당자",
    "완료일시",
  ]);
  assert.doesNotMatch(transferDetailSource, /시간표 명단 변경/);
  assert.doesNotMatch(transferDetailSource, /AutoSyncResultSummary/);

  assertIncludesAll(transferDataTableSource, [
    'aria-label="전반 전체 필터"',
    'aria-label="전반 누가 필터"',
    'aria-label="전반 신청 데이터테이블"',
    'data-testid="transfer-mobile-task-list"',
    'aria-label="전반 모바일 목록"',
    "getTransferTaskDetailAriaLabel(task)",
    '[grid-template-columns:var(--transfer-grid-template)]',
    "<WithdrawalPeriodFilterBar",
    "TransferOperationsChecklistChips",
    "onChecklistChange",
    "setTransferTableSort",
  ]);
  assert.doesNotMatch(
    transferDataTableSource,
    /detailAriaLabel="전반 상세 열기"/,
    "transfer desktop detail buttons should use row-specific labels instead of a repeated generic name",
  );
  assertIncludesAll(source, [
    'columnKey: "transferReason"',
    'columnKey: "fromClassEndDate"',
    'columnKey: "toClassStartDate"',
    'columnKey: "fromUndistributedTextbooks"',
    'columnKey: "toUndistributedTextbooks"',
  ]);
  assert.doesNotMatch(transferDataTableSource, /TaskList/);

  assertIncludesAll(transferFormSource, [
    "transferSubjectOptions",
    "transferFromTeacherOptions",
    "transferFromClassOptions",
    "transferStudentOptions",
    "transferToTeacherOptions",
    "transferToClassOptions",
    "selectedTransferFromClass",
    "selectedTransferToClass",
    "selectTransferSubject",
    "selectTransferFromTeacher",
    "selectTransferToTeacher",
    "<TransferWorkflowChart />",
    "TransferScheduleCalendarField",
    "TextareaField",
    "UndistributedTextbookListField",
    'label="과목"',
    'label="전 선생님"',
    'label="전 수업"',
    'label="학생"',
    'label="후 선생님"',
    'label="후 수업"',
    'label="전반사유"',
    'label="전 미배부 교재"',
    'label="후 미배부 교재"',
    "help={TRANSFER_FROM_UNDISTRIBUTED_TEXTBOOK_HELP}",
    "help={TRANSFER_TO_UNDISTRIBUTED_TEXTBOOK_HELP}",
    'CheckField label="메이크에듀 전반처리"',
    'CheckField label="수업료 처리"',
    'CheckField label="교재비 처리"',
  ]);
  assert.ok(
    transferFormSource.indexOf("<TransferWorkflowChart />") < transferFormSource.indexOf('aria-label="전반 공통 정보"') &&
    transferFormSource.indexOf('aria-label="전반 공통 정보"') < transferFormSource.indexOf('aria-label="전 수업 정보"') &&
      transferFormSource.indexOf('aria-label="전반 공통 정보"') < transferFormSource.indexOf('aria-label="후 수업 정보"'),
    "transfer form should show the collapsible workflow chart before shared fields and mirrored before/after columns",
  );
  const transferCommonSource = transferFormSource.slice(
    transferFormSource.indexOf('aria-label="전반 공통 정보"'),
    transferFormSource.indexOf('aria-label="전 수업 정보"'),
  );
  const transferFromSource = transferFormSource.slice(
    transferFormSource.indexOf('aria-label="전 수업 정보"'),
    transferFormSource.indexOf('aria-label="후 수업 정보"'),
  );
  const transferToSource = transferFormSource.slice(
    transferFormSource.indexOf('aria-label="후 수업 정보"'),
    transferFormSource.indexOf('<div className="grid gap-2 md:grid-cols-3">'),
  );
  assertIncludesAll(transferCommonSource, [
    'label="과목"',
    'label="학생"',
    'label="전반사유"',
  ]);
  assertIncludesAll(transferFromSource, [
    'label="전 선생님"',
    'label="전 수업"',
    'label="전 미배부 교재"',
    'label="전 수업 종료일"',
  ]);
  assertIncludesAll(transferToSource, [
    'label="후 선생님"',
    'label="후 수업"',
    'label="후 미배부 교재"',
    'label="후 수업 시작일"',
  ]);
  assert.doesNotMatch(
    transferFromSource,
    /label="후 (선생님|수업|미배부 교재|수업 시작일)"/,
    "before-transfer column should not mix after-transfer fields",
  );
  assert.doesNotMatch(
    transferToSource,
    /label="전 (선생님|수업|미배부 교재|수업 종료일)"/,
    "after-transfer column should not mix before-transfer fields",
  );
  assert.doesNotMatch(
    transferFormSource,
    /openManualField\("transfer(?:Student|FromTeacher|FromClass|ToTeacher|ToClass)"\)/,
    "transfer student, teacher, and class selectors should not offer direct input",
  );
  assert.doesNotMatch(
    transferFormSource,
    /shouldShowManualField\("transfer(?:Student|FromTeacher|FromClass|ToTeacher|ToClass)"/,
    "transfer student, teacher, and class fields should stay selector-only",
  );
  assertIncludesAll(transferFormSource, [
    "canSelectTransferFromTeacher",
    "canSelectTransferFromClass",
    "canSelectTransferStudent",
    "canSelectTransferToTeacher",
    "canSelectTransferToClass",
    "attention={!form.subject}",
    "attention={canSelectTransferFromTeacher && !selectedTransferFromTeacherId}",
    "attention={canSelectTransferFromClass && !transfer.fromClassId}",
    "attention={canSelectTransferStudent && !form.studentId}",
    "attention={canSelectTransferToTeacher && !selectedTransferToTeacherId}",
    "attention={canSelectTransferToClass && !(transfer.toClassId || form.classId)}",
    'disabled={!canSelectTransferFromTeacher}',
    'disabledPlaceholder="과목 먼저"',
    'disabled={!canSelectTransferFromClass}',
    'disabledPlaceholder="전 선생님 먼저"',
    'disabled={!canSelectTransferStudent}',
    'disabledPlaceholder="전 수업 먼저"',
    'disabled={!canSelectTransferToTeacher}',
    'disabled={!canSelectTransferToClass}',
    'disabledPlaceholder="후 선생님 먼저"',
  ]);
  assert.match(
    source,
    /function selectTransferSubject\(subject: string\) \{[\s\S]*?updateTransfer\("fromTeacherName", ""\)[\s\S]*?updateTransfer\("fromClassId", ""\)[\s\S]*?updateForm\("studentId", ""\)[\s\S]*?updateTransfer\("toTeacherName", ""\)[\s\S]*?updateTransfer\("toClassId", ""\)/,
    "changing transfer subject should clear both from and to downstream selections",
  );
  assert.match(
    source,
    /function selectTransferFromTeacher\(teacherId: string\) \{[\s\S]*?updateTransfer\("fromClassId", ""\)[\s\S]*?updateForm\("studentId", ""\)/,
    "changing transfer from teacher should clear from class and student selections",
  );
  assert.match(
    source,
    /function selectTransferToTeacher\(teacherId: string\) \{[\s\S]*?updateTransfer\("toClassId", ""\)/,
    "changing transfer to teacher should clear to class selections",
  );
  assert.doesNotMatch(transferFormSource, /if \(step === "transfer_schedule"\)/);
  assert.doesNotMatch(transferFormSource, /if \(step === "transfer_checks"\)/);
  assert.doesNotMatch(transferFormSource, /type="date"/);
  assert.doesNotMatch(transferFormSource, /AutoSyncStatusField label="시간표 명단 변경"/);

  assertIncludesAll(transferScheduleFieldSource, [
    "getTransferClassScheduleMetrics",
    "isWithdrawalScheduleSelectable",
    "수업을 선택하면 등록된 수업일정이 표시됩니다.",
    "disabled={!selectable}",
    "getWithdrawalCalendarDisplaySessionLabel(scheduleItem, { includeMonth: true })",
    "getWithdrawalCalendarCellTitle(cell.dateKey, scheduleItem)",
    "getWithdrawalCalendarCellToneClass(cell.dateKey, selected, selectable, scheduleItem)",
    "calendarCellTitle",
    "title={calendarCellTitle}",
    "whitespace-normal",
    "onScheduleSelect(getTransferClassScheduleMetrics(scheduleItems, item.dateKey, classItem))",
    'ReadonlyInfoField label={`${label} 회차`}',
  ]);
  assert.doesNotMatch(
    transferScheduleFieldSource,
    /ReadonlyInfoField label=\{`\$\{label\}회차`\}/,
    "transfer dependency state should not render labels like 전 수업 종료일회차",
  );
  assertIncludesAll(transferFormSource, [
    'label="전 수업 종료일"',
    'label="후 수업 시작일"',
    "<TransferTuitionAdjustmentPanel",
    "adjustment={transferTuitionAdjustment}",
  ]);
  assertIncludesAll(source, [
    "function getTransferTuitionAdjustment",
    "getSchedulePlanSessions(classItem)",
    "function getTransferMonthlyCycleContext",
    "function getTransferBillingCycleItems",
    "const sessionNumber = selectedItem.sessionNumber",
    "const sameMonthItems = getTransferBillingCycleItems(items, selectedItem)",
    "const cycleSessionCount = Math.max(sameMonthItems.length, fallbackCycleSessionCount, sessionNumber)",
    "monthKey: getWithdrawalScheduleBillingMonthKey(selectedItem)",
    "monthLabel: getWithdrawalScheduleDisplayMonthLabel(selectedItem)",
    "fromCycle.monthKey !== toCycle.monthKey",
    "월별 확인",
    "연속 회차로 계산하지 않습니다.",
    "fromServedValue",
    "toRemainingValue",
    "difference = servedValue - paidValue",
    'settlementType: "refund_or_carry"',
    'settlementType: "additional_payment"',
    "수업료 정산",
    "전반 업무 흐름",
    'data-testid="transfer-workflow-chart"',
    'data-state={open ? "open" : "closed"}',
    "const [open, setOpen] = useState(false)",
    "aria-expanded={open}",
    "담당선생님 요청",
    "고객 요청",
    "전/후 선생님 타당성 논의",
    "타당하면 입학상담 책임자와 논의",
    "입학상담 책임자 승인",
    "관리팀 전반 처리",
    "현재 실력: 객관적인 시험 점수",
    "학습태도 및 성장가능성",
    "승급 수업: 난이도 적합성",
    "동급 수업: 수업계획표 상의 진도",
    "수업계획표 상의 진도",
    "관리팀으로부터 수령한 교재 중 위 학생에게 아직 배부되지 않은 교재가 있다면 입력하고, 전반신청서를 제출하는 즉시 해당 교재를 관리팀에게 반납해 주세요.",
    "청구 예정 교재 중(전반 후 수업의 현재 진행 교재) 위 학생에게 배부하지 않을 교재가 있다면 입력해 주세요.",
    "강부희, 김민경, 정보영",
    "양소윤",
    "강정은",
    "전 진행률",
    "후 잔여진행률",
    "환불/이월",
    "추가 납부",
    "attention?: boolean",
    "border-primary/60 bg-primary/5",
    "border-amber-300 bg-amber-50",
  ]);
  assert.doesNotMatch(source, /전 항목은 전 선생님이 직접 입력하거나 후 선생님에게 대신 입력요청/);
  assert.doesNotMatch(source, /영어 원장\(강부희, 김민경, 정보영\)/);
  assert.doesNotMatch(source, /고등부: 소윤T/);
  assert.doesNotMatch(source, /초중등부: 정은T/);
  assert.match(
    source,
    /function canSubmitOpsTaskForm\(input: OpsTaskInput, isEditing: boolean\) \{[\s\S]*?if \(input\.type === "transfer" && !isEditing\) \{[\s\S]*?input\.subject &&[\s\S]*?transfer\.fromTeacherName &&[\s\S]*?transfer\.fromClassId &&[\s\S]*?input\.studentId &&[\s\S]*?transfer\.toTeacherName &&[\s\S]*?transfer\.toClassId/,
    "new transfer requests should require subject, teachers, classes, and student before submit is enabled",
  );
  assert.match(
    source,
    /if \(!intent && taskType === "transfer" && !isEditing\) return "전반 신청"/,
  );
});

test("word retest workspace uses role queues branch filters and dedicated row actions", async () => {
  const [workspaceSource, modelSource, serviceSource, scoreMetadataMigrationSource] = await Promise.all([
    readSource("src/features/tasks/ops-task-workspace.tsx"),
    readSource("src/features/tasks/ops-task-model.js"),
    readSource("src/features/tasks/ops-task-service.ts"),
    readSource("supabase/migrations/20260702173249_ops_word_retest_score_metadata.sql"),
  ]);

  assertIncludesAll(modelSource, [
    "function getWordRetestWorkspaceRole",
    "function isWordRetestInAssistantQueue",
    "function isWordRetestInTeacherQueue",
    "WORD_RETEST_ASSISTANT_ACTION_STATUSES",
    "WORD_RETEST_TEACHER_ACTION_STATUSES",
  ]);

  assertIncludesAll(workspaceSource, [
    'type WordRetestMode = "assistant" | "teacher"',
    'type WordRetestBranchFilter = "all" | "본관" | "별관"',
    "WORD_RETEST_ROLE_TABS",
    '{ key: "assistant", label: "조교선생님" }',
    '{ key: "teacher", label: "담당선생님" }',
    "WORD_RETEST_BRANCH_FILTERS",
    '{ key: "all", label: "전체" }',
    '{ key: "본관", label: "본관" }',
    '{ key: "별관", label: "별관" }',
    "syncWordRetestMode",
    "setWordRetestBranchFilter",
    "isWordRetestInAssistantQueue",
    "isWordRetestInTeacherQueue",
    "WordRetestTaskList",
    "WordRetestTaskRow",
    "WordRetestRoleActionButton",
    "getWordRetestPrimaryActions",
    '"word_retest_complete"',
    '"word_retest_retry"',
    'retryReason?: "failed"',
    "submitWordRetestCompletion",
    'retestStatus: "done"',
    'wordRetestStatus: "not_started"',
    "openFailedWordRetestRetryForm",
    "isFailedWordRetestRetry",
    "operationCompletionBlockers",
    "재시험 추가 및 불합격 확인",
    "재시험을 추가하고 불합격을 확인했습니다.",
    "불합격 결과를 담당선생님에게 보냈습니다.",
    "합격 결과를 담당선생님에게 보냈습니다.",
    "진행상태를 변경했습니다.",
    "진행상태를 바꾸지 못했습니다.",
    "단어 재시험 진행상태를 바꾸지 못했습니다.",
    "진행상태 변경을 되돌렸습니다.",
    "진행상태를 되돌리지 못했습니다.",
    "진행상태 변경",
    "parseWordRetestScoreValue",
    "getWordRetestScoreResult",
    "getWordRetestStatusLabel(value?: string, taskStatus?: OpsTaskStatus",
    'if (scoreResult === "passed") return "완료: 합격"',
    'if (scoreResult === "failed") return "미완료: 불합격"',
    "getWordRetestScoreSummary",
    "getWordRetestBranch",
    "getWordRetestTeacherLabel",
    "getWordRetestRequestDefaults",
    "assigneeTeam: \"조교팀\"",
    'if (input.type === "word_retest")',
    'assigneeId: ""',
    'isTemplateForm && !isWordRetestForm',
    "WordRetestMainExamDateField",
    "getWordRetestClassScheduleItems",
    "classScheduleItems",
    "data-word-retest-class-date",
    "<SelectedValuePill",
    "PopoverContent",
    "TOUCH_SCROLL_AREA_STYLE",
    'WebkitOverflowScrolling: "touch"',
    'touchAction: "pan-y"',
    "function stopTouchScrollPropagation(event: TouchEvent<HTMLElement>)",
    "disablePortal",
    "onTouchMove={stopTouchScrollPropagation}",
    "placeholder={`${label} 검색`}",
    "className=\"h-9 min-w-0 pr-9\"",
    "className=\"max-h-72 overflow-y-auto overscroll-contain p-1\"",
    "right-2 top-1/2 inline-flex size-6",
    'value ? "pr-10" : ""',
    "z-[120]",
    'side="bottom"',
    "collisionPadding={12}",
    "sortWordRetestTasksByTestAt",
    "WordRetestFilterBar",
    "WordRetestInlineScoreEditor",
    "WordRetestStatusBadge",
    "WordRetestScoreResultCell",
    "getWordRetestScorePercent",
    "WordRetestProgressStepper",
    "WORD_RETEST_DIAGRAM_MAIN_NODES",
    "WORD_RETEST_DIAGRAM_ABSENT_NODES",
    "WORD_RETEST_DIAGRAM_RESULT_BRANCHES",
    "WordRetestCompactFlowNode",
    "WordRetestCompactNode",
    "WordRetestFlowArrow",
    "WordRetestFlowColumnSpacer",
    "WordRetestFlowLane",
    "WordRetestFlowChart",
    "aria-expanded={open}",
    "업무 흐름 보기",
    "접기",
    'isWordRetestWorkspace ? "flex min-w-0 items-center justify-between gap-2"',
    'isWordRetestWorkspace ? "flex-1 flex-nowrap overflow-x-auto"',
    "showClosedToggle && !isWordRetestWorkspace",
    "{(showSearch || (isWordRetestWorkspace && showClosedToggle)) && (",
    'className="relative min-w-0 flex-1"',
    'className="h-9 shrink-0 whitespace-nowrap px-3"',
    "!isWordRetestWorkspace && (",
    "getWorkspaceCreateActionLabel(workspace, workspaceLabel)",
    "min-w-[620px]",
    "h-10 w-[108px]",
    "현재 진행상태",
    "재시험 추가",
    "공통",
    "담당선생님",
    "조교선생님",
    "시험 진행",
    "결과 판정",
    "본시험일 + 7일",
    "커트라인 미만",
    "커트라인 이상",
    "불합격",
    "결과: 불합격",
    "불합격 확인",
    "미응시 보고",
    "미응시 확인",
    "합격",
    "결과: 합격",
    "합격 확인",
    "returnToStart: true",
    "불합격 보고",
    "합격 보고",
    "WordRetestPeriodFilterBar",
    "WORD_RETEST_PERIOD_FILTERS",
    '{ key: "today", label: "오늘" }',
    '{ key: "week", label: "이번주" }',
    '{ key: "month", label: "이번달" }',
    '{ key: "custom", label: "직접입력" }',
    'ariaLabel="단어 재시험 기간 시작일"',
    'ariaLabel="단어 재시험 기간 종료일"',
    "matchesWordRetestPeriodFilter",
    "shouldAutoMarkWordRetestAbsent",
    "autoMarkPastWordRetestsAbsent",
    "const nextTasks = wordRetestFilterSourceTasks.filter((task) =>",
    "}, [data, isWordRetestWorkspace, loading, wordRetestFilterSourceTasks])",
    "WORD_RETEST_TABLE_COLUMN_WIDTHS",
    "WORD_RETEST_TABLE_COLUMN_MIN_WIDTHS",
    "select: 40",
    "action: 108",
    "WordRetestResizableHeaderCell",
    "selectedTaskIds={wordRetestSelectedTaskIds}",
    "onSelectTask={toggleWordRetestSelection}",
    "onSelectAll={toggleAllVisibleWordRetests}",
    "onBulkDelete={requestRemoveWordRetests}",
    "보이는 단어 재시험 전체 선택",
    "선택 삭제",
    "memo(function WordRetestTaskRow",
    "const selectableTasks = useMemo(() => tasks.filter(canSelectTask)",
    "const selectedTasks = useMemo(() => tasks.filter((task) => selectedTaskIds.has(task.id) && canSelectTask(task))",
    "const toggleWordRetestSelection = useCallback((task: OpsTask, selected: boolean)",
    "function useStableEvent",
    "const handleWordRetestStatusChange = useStableEvent((task: OpsTask, status: OpsTaskStatus)",
    "bulkDeleteTargets",
    "단어 재시험 {bulkDeleteTargets.length}건 삭제할까요?",
    "wordRetestTeacherFilterTouchedRef",
    "currentUserTeacherOption",
    "shouldDefaultWordRetestTeacherFilter",
    "setWordRetestTeacherFilter(option.value)",
    'label="상태" columnKey="status"',
    'label="담당선생님" columnKey="teacher"',
    'label="수업" columnKey="class"',
    'label="출제 개수" columnKey="total"',
    'label="커트라인" columnKey="cutoff"',
    'label="맞은 개수" columnKey="score"',
    'label="결과" columnKey="result"',
    "cursor-col-resize",
    "onPointerDown",
    "md:[grid-template-columns:var(--word-retest-grid-template)]",
    "title={textbookLabel}",
    "group-hover:block",
    "function shouldIgnoreWordRetestRowOpen",
    "onClick={(event) => {",
    "onScoreSave={handleWordRetestScoreSave}",
    "scoreDraft={scoreDrafts[task.id]}",
    "const resolvedScoreDraft = scoreDraft || getWordRetestScoreDraft(task)",
    "onSelectTask={onSelectTask}",
    "status: task.status",
    'retestStatus: wordRetest.retestStatus || "not_started"',
    'retestStatus: "absent"',
    'if (deepLinkedTask.type === "word_retest")',
    "openEdit(deepLinkedTask)",
    "onOpen={openEdit}",
    "단어 재시험 수정",
    'if (task.type === "word_retest") return []',
    "!isTodoWorkspace && !isRegistrationWorkspace && !isWithdrawalWorkspace && !isTransferWorkspace && !isWordRetestWorkspace && visibleOperationMetrics.length > 0",
    "!isTodoWorkspace && !isRegistrationWorkspace && !isWithdrawalWorkspace && !isTransferWorkspace && !isWordRetestWorkspace && taskFocus !== \"none\"",
    'selectedTaskFresh?.type === "word_retest" ? "sm:max-w-3xl"',
    'selectedTaskFresh.type === "general" || selectedTaskFresh.type === "word_retest" ? "grid gap-4"',
    'selectedTaskFresh.type !== "word_retest" && !isProcessDetail && (',
    'label="담당선생님" allLabel="담당선생님 전체"',
    'label="수업" allLabel="수업 전체"',
    "const teacherLabel = getWordRetestTeacherLabel(task)",
    "const classLabel = getWordRetestClassLabel(task)",
    "WORD_RETEST_BRANCH_OPTIONS",
    "TaskListboxField label=\"장소\"",
    "md:grid-cols-2",
    "renderSelected={(option) => <LinkedSelectedValue label={option.label} />}",
    "renderOption={(option) => <LinkedSelectedValue label={option.label} />}",
    "renderOption={(option) =>",
    "LinkedMultiSelect",
    "wordRetestStudentIds",
    "setWordRetestStudentIds",
    "selectedWordRetestStudentIds",
    "selectWordRetestStudents",
    "getWordRetestStudentPayload",
    "createPayloads",
    "savedTasks.length > 1",
    "values={selectedWordRetestStudentIds}",
    'selectedOptions.map((option) => option.label).join(", ")',
    "listHeader={renderWordRetestTextbookFilters()}",
    "학년구분 전체",
    "pills={[classItem?.teacher, classItem?.room]}",
    "pills={[student?.grade, student?.school]}",
    "inferWordRetestTextbookSubject(textbook) === \"어휘\"",
    "inferWordRetestTextbookSubject(textbook)",
    "inferWordRetestTextbookGradePill(textbook)",
    "teacherId: teacher?.id || \"\"",
    "teacherName: teacher?.label || \"\"",
    "label=\"담당선생님\"",
    "label=\"장소\"",
    "label=\"메모\"",
    "WordRetestMainExamDateField",
    "label=\"본시험일\"",
    "label=\"시험범위\"",
    'blockers.push("커트라인")',
    'blockers.push("출제 개수")',
    'blockers.push("교재")',
    'blockers.push("시험범위")',
    "label=\"진행상태\"",
    "출제 개수",
    "커트라인(맞은 개수)",
    "커트라인",
    "1차 맞은 개수",
    "2차 맞은 개수",
    "3차 맞은 개수",
    "getWordRetestAttemptScoreFeedback",
    "${percent}점",
    "min-w-[8.5rem]",
    "items-center justify-start gap-1",
    "totalQuestionCount",
    "scoreOutOf100",
    "cutoffQuestionCount",
    "교재/시험범위",
    "시험범위 입력",
    "시험 시작",
    "합격 보고",
    "불합격 보고",
    "미응시",
    "합격 확인",
    "재시험 추가",
    "불합격 확인",
    'editingTask && formCompletionIntent?.kind !== "word_retest_retry" && (',
    'formCompletionIntent?.kind !== "word_retest_retry"',
    'const isFailedWordRetestRetryForm = formCompletionIntent?.kind === "word_retest_retry"',
    'if (step === "word_retest_scores" && isFailedWordRetestRetryForm) return null',
  ]);
  assert.match(
    workspaceSource,
    /const absentNodes:[\s\S]*WORD_RETEST_DIAGRAM_ABSENT_NODES\[0\][\s\S]*WORD_RETEST_DIAGRAM_ABSENT_NODES\[1\][\s\S]*WORD_RETEST_DIAGRAM_ABSENT_NODES\[2\][\s\S]*label: "재시험 추가"[\s\S]*detail: "담당선생님"/,
  );
  assert.match(
    workspaceSource,
    /<WordRetestFlowLane label="미응시" nodes=\{absentNodes\} activeKeys=\{activeKeys\} tone="destructive" \/>/,
  );
  assert.doesNotMatch(
    workspaceSource,
    /<WordRetestFlowLane label="미응시"[\s\S]*leadingSlots=\{1\}/,
  );
  assert.match(
    workspaceSource,
    /<WordRetestFlowLane label=\{failedBranch.label\} nodes=\{failedNodes\} activeKeys=\{activeKeys\} tone="warning" \/>/,
  );
  assert.match(
    workspaceSource,
    /<WordRetestFlowLane label=\{passedBranch.label\} nodes=\{passedNodes\} activeKeys=\{activeKeys\} tone="primary" \/>/,
  );
  assert.doesNotMatch(workspaceSource, /min-w-\[720px\]/);
  assert.doesNotMatch(workspaceSource, /min-w-\[700px\]/);
  assert.doesNotMatch(workspaceSource, /label=\{failedBranch.label\}[\s\S]*leadingSlots=\{3\}/);
  assert.doesNotMatch(workspaceSource, /label=\{passedBranch.label\}[\s\S]*leadingSlots=\{3\}/);
  assert.doesNotMatch(
    workspaceSource,
    /const absentNodes:[\s\S]*label: "시작 전"[\s\S]*detail: "복귀"[\s\S]*\]/,
  );
  assert.doesNotMatch(workspaceSource, /세부과목 전체/);
  assert.doesNotMatch(workspaceSource, /shouldRequestReview/);
  assert.doesNotMatch(workspaceSource, /kind: "edit", label: "점수 입력"/);
  assert.doesNotMatch(workspaceSource, /kind: "status", status: "review_requested", label: "검토 요청"/);
  assert.doesNotMatch(workspaceSource, /label: "통과"/);
  assert.doesNotMatch(workspaceSource, /label: "재시험"/);
  assert.doesNotMatch(workspaceSource, /label: "미완료 재요청"/);
  assert.doesNotMatch(workspaceSource, /label: "응시일시 변경"/);
  assert.doesNotMatch(workspaceSource, /응시일정 변경/);
  assert.doesNotMatch(workspaceSource, /미응시 재요청/);
  assert.doesNotMatch(workspaceSource, /DateTimeField label="응시일시"/);
  assert.doesNotMatch(workspaceSource, /Clock className/);
  assert.doesNotMatch(workspaceSource, /WORD_RETEST_TIME_OPTIONS/);
  assert.doesNotMatch(workspaceSource, /100점 환산/);
  assert.doesNotMatch(workspaceSource, /1차 · 2차 · 3차/);
  assert.doesNotMatch(workspaceSource, /시작 전 복귀/);
  assert.doesNotMatch(workspaceSource, /응시일시 경과시 자동으로 상태 변경/);
  assert.doesNotMatch(workspaceSource, /담당 요청/);
  assert.doesNotMatch(workspaceSource, /onMarkAbsent/);
  assert.doesNotMatch(workspaceSource, /canRetryAbsent/);
  assert.doesNotMatch(workspaceSource, /WordRetestResizableHeaderCell label="점수"/);
  assert.doesNotMatch(workspaceSource, /미완료 보고를 저장하고 새 재시험을 추가했습니다/);
  assert.doesNotMatch(workspaceSource, /재시험 추가 및 미완료 확인/);
  assert.doesNotMatch(workspaceSource, /재시험을 추가하고 미완료를 확인했습니다/);
  assert.doesNotMatch(workspaceSource, /완료 결과를 담당선생님에게 보냈습니다/);
  assert.doesNotMatch(workspaceSource, /setNotice\("상태를 변경했습니다\."\)/);
  assert.doesNotMatch(workspaceSource, /"상태를 바꾸지 못했습니다\."/);
  assert.doesNotMatch(workspaceSource, /"단어 재시험 상태를 바꾸지 못했습니다\."/);
  assert.doesNotMatch(workspaceSource, /setNotice\("상태 변경을 되돌렸습니다\."\)/);
  assert.doesNotMatch(workspaceSource, /"상태를 되돌리지 못했습니다\."/);
  assert.doesNotMatch(workspaceSource, /\$\{statusUndo\.title\} 상태 변경 되돌리기/);
  assert.doesNotMatch(workspaceSource, /aria-label="단어 재시험 진행상태"/);
  assert.doesNotMatch(workspaceSource, /미응시 자동/);

  const wordRetestHeaderSource = workspaceSource.slice(
    workspaceSource.indexOf('<WordRetestResizableHeaderCell label="상태"'),
    workspaceSource.indexOf('<WordRetestResizableHeaderCell label="다음 액션"'),
  );
  assert.ok(
    wordRetestHeaderSource.indexOf('label="출제 개수" columnKey="total"') <
      wordRetestHeaderSource.indexOf('label="커트라인" columnKey="cutoff"'),
    "desktop table should keep total questions before cutline",
  );
  assert.ok(
    wordRetestHeaderSource.indexOf('label="커트라인" columnKey="cutoff"') <
      wordRetestHeaderSource.indexOf('label="맞은 개수" columnKey="score"'),
    "desktop table should place correct-count after cutline",
  );
  assert.ok(
    wordRetestHeaderSource.indexOf('label="맞은 개수" columnKey="score"') <
      wordRetestHeaderSource.indexOf('label="결과" columnKey="result"'),
    "desktop table should place correct-count directly before result",
  );

  const wordRetestActionSource = workspaceSource.slice(
    workspaceSource.indexOf("function getWordRetestPrimaryActions"),
    workspaceSource.indexOf("function shouldShowDetailStatusBadge"),
  );
  assert.match(wordRetestActionSource, /scoreResult === "failed" \? "불합격 보고" : "합격 보고"/);
  assert.ok(wordRetestActionSource.includes('label: "불합격 확인"'));
  assert.ok(wordRetestActionSource.includes('label: "합격 확인"'));
  assert.doesNotMatch(wordRetestActionSource, /미완료 보고|미완료 확인|완료 보고|완료 확인/);

  const wordRetestRowSource = workspaceSource.slice(
    workspaceSource.indexOf("memo(function WordRetestTaskRow"),
    workspaceSource.indexOf("function WordRetestRoleActionButton"),
  );
  const desktopScoreOrder = ["출제 개수", "커트라인", "맞은 개수", "결과"];
  const desktopScoreOrderIndexes = desktopScoreOrder.map((label) => wordRetestRowSource.indexOf(`>${label}</span>`));
  assert.ok(desktopScoreOrderIndexes.every((index) => index > -1), "score result labels should be present in row source");
  for (let index = 1; index < desktopScoreOrderIndexes.length; index += 1) {
    assert.ok(
      desktopScoreOrderIndexes[index - 1] < desktopScoreOrderIndexes[index],
      `${desktopScoreOrder[index - 1]} should appear before ${desktopScoreOrder[index]} in desktop row order`,
    );
  }

  const mobileRowOrder = [
    ["진행상태", "order-1"],
    ["담당선생님", "order-2"],
    ["수업", "order-3"],
    ["학생", "order-4"],
    ["본시험일", "order-5"],
    ["장소", "order-6"],
    ["교재", "order-7"],
    ["시험범위", "order-8"],
    ["출제 개수", "order-9"],
    ["커트라인", "order-10"],
    ["맞은 개수", "order-11"],
    ["결과", "order-12"],
    ["다음 액션", "order-last"],
  ];
  for (const [label, orderClass] of mobileRowOrder) {
    const labelIndex = wordRetestRowSource.indexOf(`>${label}</span>`);
    assert.ok(labelIndex > -1, `${label} mobile label should be present`);
    const cellSource = wordRetestRowSource.slice(Math.max(0, labelIndex - 220), labelIndex);
    assert.ok(cellSource.includes(orderClass), `${label} should use ${orderClass} on mobile`);
    assert.ok(
      cellSource.includes("md:order-none") || cellSource.includes("md:hidden") || orderClass === "order-last",
      `${label} should keep desktop order`,
    );
  }

  const wordRetestMainExamDateFieldSource = workspaceSource.slice(
    workspaceSource.indexOf("function WordRetestMainExamDateField"),
    workspaceSource.indexOf("function ReadonlyInfoField"),
  );
  assert.match(wordRetestMainExamDateFieldSource, /function handleMainExamDateSelect/);
  assert.match(wordRetestMainExamDateFieldSource, /classScheduleItemsByDate/);
  assert.match(wordRetestMainExamDateFieldSource, /const shouldRestrictToClassSchedule = classScheduleItems\.length > 0/);
  assert.match(wordRetestMainExamDateFieldSource, /data-word-retest-class-date/);
  assert.match(wordRetestMainExamDateFieldSource, /disabled=\{!selectable\}/);
  assert.match(wordRetestMainExamDateFieldSource, /수업일정 없음/);
  assert.match(wordRetestMainExamDateFieldSource, /수업일정/);
  assert.match(wordRetestMainExamDateFieldSource, /setCalendarDateOpen\(false\)/);
  assert.doesNotMatch(wordRetestMainExamDateFieldSource, /Clock|timeListRef|handleTimeListWheel|WORD_RETEST_TIME_OPTIONS|직접 시간 입력/);

  const progressStepperSource = workspaceSource.slice(
    workspaceSource.indexOf("function WordRetestProgressStepper"),
    workspaceSource.indexOf("function WordRetestInlineScoreEditor"),
  );
  assert.ok(progressStepperSource.includes("aria-expanded={open}"));
  assert.ok(
    progressStepperSource.indexOf("업무 흐름 보기") < progressStepperSource.indexOf("<WordRetestFlowChart"),
    "word retest workflow chart should stay behind the collapsible progress control",
  );

  const wordRetestToolbarSource = workspaceSource.slice(
    workspaceSource.indexOf("{isWordRetestWorkspace && ("),
    workspaceSource.indexOf("{isTodoWorkspace && ("),
  );
  assert.doesNotMatch(wordRetestToolbarSource, /OPERATION_VIEW_TABS/);
  assert.doesNotMatch(wordRetestToolbarSource, />\s*전체\s*<\/button>[\s\S]*>\s*상태별\s*<\/button>/);
  assert.doesNotMatch(wordRetestToolbarSource, /visibleOperationMetrics/);
  assert.doesNotMatch(wordRetestToolbarSource, /TASK_FOCUS_LABELS\[taskFocus\]/);

  assertIncludesAll(serviceSource, [
    "totalQuestionCount?: string",
    "scoreOutOf100?: string",
    "cutoffQuestionCount?: string",
    "totalQuestionCount: numberText(row.total_question_count)",
    "scoreOutOf100: numberText(row.score_out_of_100)",
    "cutoffQuestionCount: numberText(row.cutoff_question_count)",
    "total_question_count: nullableNumber(detail.totalQuestionCount)",
    "score_out_of_100: nullableNumber(detail.scoreOutOf100)",
    "cutoff_question_count: nullableNumber(detail.cutoffQuestionCount)",
    "OPS_WORD_RETEST_OPTIONAL_DETAIL_COLUMNS",
    "wordRetest?.firstScore, wordRetest?.secondScore, wordRetest?.thirdScore",
    'if (status === "review_requested") return current === "absent" ? "absent" : current === "done" ? "done" : "in_progress"',
    'if (status === "requested" || status === "confirmed") return "not_started"',
  ]);

  assertIncludesAll(scoreMetadataMigrationSource, [
    "alter table public.ops_word_retests",
    "total_question_count numeric(8,2)",
    "score_out_of_100 numeric(8,2)",
    "cutoff_question_count numeric(8,2)",
  ]);
});

test("word retest workspace keeps page title full and add actions compact", async () => {
  const workspaceSource = await readSource("src/features/tasks/ops-task-workspace.tsx");

  assert.match(workspaceSource, /word_retest: "영어 단어 재시험"/);
  assert.match(workspaceSource, /function getWorkspaceCreateActionLabel\(workspace: WorkspaceKey, workspaceLabel: string\)/);
  assert.match(workspaceSource, /if \(workspace === "word_retest"\) return "추가"/);
  assert.match(workspaceSource, /const emptyActionLabel = getWorkspaceCreateActionLabel\(workspace, workspaceLabel\)/);
  assert.match(workspaceSource, /\{getWorkspaceCreateActionLabel\(workspace, workspaceLabel\)\}/);
  assert.doesNotMatch(workspaceSource, /<span className="hidden sm:inline">\{workspaceLabel\} 추가<\/span>/);
  assert.doesNotMatch(workspaceSource, /word_retest: "단어 재시험"/);
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
    "blockers.push(\"시험범위\")",
    "hasWordRetestScore",
    "function shouldRequireWordRetestScore",
    "!isWordRetestAbsent(wordRetest) && !hasWordRetestScore(wordRetest)",
    "점수 없음",
    "function CompletionBlockerActionPanel",
    "function CompletionBlockerInlineChips",
    "getCompletionBlockerActionLabel([blocker])",
    "formCompletionBlockers.length > 0 && (",
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
    "const existingStudent = shouldEnsureStudent ? await resolveOpsRegistrationStudent(input) : null",
    "const firstDelete = await supabase.from(\"ops_tasks\").delete().eq(\"id\", taskId)",
    "export async function deleteOpsTask",
    "MANAGEMENT_INPUT_FIELDS",
    "missingFields.push(\"시험범위\")",
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
    "if (error || !didMutateOpsTask(data)) {",
    "if (rollbackWaitlist) await rollbackWaitlist()",
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
  assertIncludesAll(workspaceSource, [
    "const isEditingLockedCompletedTask = Boolean(editingTask && isClosedOpsTask(editingTask) && !formCompletionIntent)",
    "const canSubmitCurrentForm = canSubmitOpsTaskForm(form, Boolean(editingTask))",
    "{!isEditingLockedCompletedTask && formCompletionBlockers.length > 0 && formCompletionIntent?.kind !== \"word_retest_retry\" && (",
    "{!isEditingLockedCompletedTask && (",
    "<Button type=\"submit\" disabled={saving || !canSubmitCurrentForm} className=\"w-full sm:w-auto\">",
  ]);
  assert.equal(
    workspaceSource.match(/\{!isEditingLockedCompletedTask && formCompletionBlockers\.length > 0 && \(/g)?.length,
    2,
    "locked completed edits should hide completion blocker notices",
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
    "OPS_BROWSER_OPERATION_COMPLETE_FILTER",
    "OPS_BROWSER_REGISTRATION_WORKFLOW_SAMPLE",
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
    "verifyRegistrationSinglePageDialog",
    "verifyFlatOperationDialog",
    "await verifyFlatOperationDialog(dialog, route)",
    "options.enabledOnly",
    'expectedTexts: ["전반", "전반 신청"]',
    "const createButtonName = route.expectedTexts[1]",
    "createOperationCompletionFixtures",
    'routePath: "/admin/registration?flow=enrollment"',
    "verifyOperationCompletionInteraction",
    "verifyOperationCompletionSet",
    "verifyOperationCompletionSync",
    "cleanupOperationCompletionFixtures",
    "createRegistrationWorkflowFixture",
    "verifyRegistrationWorkflowSet",
    "waitForRegistrationWorkflowState",
    "const hasWaitlistHistory = state.history.some",
    "waitForRegistrationMessageReadiness",
    "assertLocatorFitsViewport",
    "waitlistRemovedOnEnrollmentDecision",
    "fillOperationMinimumFields",
    "isFillableFormControl",
    "const editedOperationRowLabel = sampleName",
    "openOperationSampleDetail",
    "await openOperationSampleDetail(page, fixture.title)",
    "await openOperationSampleDetail(page, task.title)",
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
    "still shows the old step progress label",
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
