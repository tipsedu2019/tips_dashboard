import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import * as registrationNotificationModel from "../src/features/tasks/registration-consultation-notification.js";

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

test("student management withdrawal handoff opens a prefilled withdrawal request and consumes the deep link", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");

  assert.match(source, /function buildWithdrawalCreatePrefill/);
  assert.match(source, /const requestedWithdrawalStudentId = isWithdrawalWorkspace && searchParams\.get\("create"\) === "withdrawal"/);
  assert.match(source, /openCreateRef\.current\?\.\("withdrawal", buildWithdrawalCreatePrefill/);
  assert.match(source, /params\.delete\("create"\)/);
  assert.match(source, /params\.delete\("studentId"\)/);
  assert.match(source, /router\.replace\(nextQuery \? `\$\{pathname\}\?\$\{nextQuery\}` : pathname, \{ scroll: false \}\)/);
  assert.match(source, /const preserveUnscopedWithdrawalStudent = Boolean\(form\.studentId && !form\.classId\)/);
  assert.match(source, /const nextWithdrawalClassContainsStudent = Boolean/);
  assert.match(source, /getStudentRosterClassIds\(withdrawalStudent, classes\)\.includes\(classItem\.id\)/);
});

function assertIncludesAll(source, values) {
  for (const value of values) {
    assert.ok(source.includes(value), value);
  }
}

function assertInOrder(source, values) {
  let cursor = -1;
  for (const value of values) {
    const next = source.indexOf(value, cursor + 1);
    assert.notEqual(next, -1, `missing ordered source contract: ${value}`);
    assert.ok(next > cursor, `${value} must appear after the previous item`);
    cursor = next;
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
    "const currentSearchParams = new URLSearchParams(window.location.search)",
    'const deepLinkedTaskId = currentSearchParams.get("taskId") || ""',
    'const deepLinkedTask = taskById.get(deepLinkedTaskId)',
    'syncTaskDeepLink(null)',
    "setSelectedTask(deepLinkedTask)",
    "setDetailOpen(true)",
	    "syncTaskDeepLink(task.id, nextTrackId)",
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

test("detail deletion clears the task deep link before opening the shared confirmation dialog", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const start = source.indexOf("const requestRemoveTask =");
  const end = source.indexOf("const requestRemoveWordRetests =", start);
  const requestRemoveTaskSource = source.slice(start, end);
  const deepLinkedTaskIdIndex = source.indexOf('const deepLinkedTaskId = currentSearchParams.get("taskId")');
  const deepLinkEffectStart = source.lastIndexOf("useEffect(() => {", deepLinkedTaskIdIndex);
  const deepLinkEffectEnd = source.indexOf("function handleDetailOpenChange", deepLinkEffectStart);
  const deepLinkEffectSource = source.slice(deepLinkEffectStart, deepLinkEffectEnd);

  assertInOrder(requestRemoveTaskSource, [
    "setDetailOpen(false)",
    "syncTaskDeepLink(null)",
    "setDeleteTarget(task)",
  ]);
  assertInOrder(deepLinkEffectSource, [
    "useEffect(() => {",
    "if (deleteTarget) return",
    "const currentSearchParams = new URLSearchParams(window.location.search)",
    'const deepLinkedTaskId = currentSearchParams.get("taskId")',
  ]);
  assert.match(deepLinkEffectSource, /\[[^\]]*deleteTarget[^\]]*\]\)/s);
});

test("all five task surfaces use one server-gated notification control panel with exact workflow keys", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");

  assert.match(
    source,
    /import \{ NotificationControlPanel, useNotificationControlPlaneAvailability \} from "@\/features\/notifications\/notification-control-panel"/,
  );
  assert.match(source, /const WORKSPACE_NOTIFICATION_WORKFLOW_KEY = \{[\s\S]*todo: "tasks",[\s\S]*word_retest: "word_retests",[\s\S]*registration: "registration",[\s\S]*transfer: "transfer",[\s\S]*withdrawal: "withdrawal",[\s\S]*satisfies Record<WorkspaceKey, NotificationWorkflowKey>/);
  assert.match(source, /const notificationControlPlaneAvailability = useNotificationControlPlaneAvailability\(\)/);
  assert.match(source, /const canonicalNotificationEnabled = notificationControlPlaneAvailability\.status === "enabled"/);
  assert.match(source, /const legacyNotificationEnabled = notificationControlPlaneAvailability\.status === "disabled"/);
  assert.match(source, /const showNotificationSettingsLauncher = \(canManageAll \|\| isStaff\)/);
  assert.match(source, /const showLegacyNotificationSettingsLauncher = legacyNotificationEnabled \|\| \(canonicalNotificationEnabled && showNotificationSettingsLauncher\)/);
  assert.doesNotMatch(source, /disabled=\{notificationControlPlaneAvailability\.status === "loading"\}/);
  assert.match(source, /canonicalNotificationEnabled \? \([\s\S]*<NotificationControlPanel[\s\S]*workflowKey=\{notificationWorkflowKey\}[\s\S]*presentation="dialog"[\s\S]*open=\{workspaceDataBelongsToCurrentViewer && canonicalNotificationOpen\}/);
  assert.match(source, /legacyNotificationEnabled && isWithdrawalWorkspace/);
  assert.match(source, /legacyNotificationEnabled && isTransferWorkspace/);
  assert.match(source, /legacyNotificationEnabled && isRegistrationWorkspace/);
  assert.doesNotMatch(source, /!canonicalNotificationEnabled && is(?:Withdrawal|Transfer|Registration)Workspace/);
  assert.doesNotMatch(source, /get_notification_runtime_flags_v1|NEXT_PUBLIC_NOTIFICATION_CONTROL_PLANE/);
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
    'DialogHeader className="-mx-6 -mt-6 border-b px-6 pb-5 pt-4"',
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
    source.indexOf("<Dialog open={workspaceDataBelongsToCurrentViewer && detailOpen}"),
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

test("common registration host owns one shell close while other forms keep dialog and footer controls", async () => {
  const workspaceSource = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const dialogSource = await readSource("src/components/ui/dialog.tsx");
  const formDialogSource = workspaceSource.slice(
    workspaceSource.indexOf("<Dialog open={workspaceDataBelongsToCurrentViewer && formOpen}"),
    workspaceSource.indexOf("<Dialog open={workspaceDataBelongsToCurrentViewer && detailOpen}"),
  );
  const registrationHostSource = workspaceSource.slice(
    workspaceSource.indexOf("data-registration-application-host"),
    workspaceSource.indexOf("<Dialog open={workspaceDataBelongsToCurrentViewer && bulkDeleteTargets.length"),
  );

  assertIncludesAll(workspaceSource, [
    'const formCloseLabel = "닫기"',
    "discardFormAndClose",
    'open={workspaceDataBelongsToCurrentViewer && confirmingFormClose}',
    '입력한 내용을 버릴까요?',
    '계속 작성',
    '저장하지 않고 닫기',
    "cancelFormCloseConfirmation",
    "formCloseReturnFocusRef.current?.focus()",
  ]);
  assertIncludesAll(formDialogSource, [
    "closeButtonLabel={formCloseLabel}",
    "onCloseButtonClick={closeForm}",
    "showCloseButton={!registrationCreateApplicationRendered}",
    "registrationCloseAction={(",
    "aria-label={formCloseLabel}",
  ]);
  assert.match(
    formDialogSource,
    /\{!registrationCreateApplicationRendered && \(\s*<Button type="button" variant="outline" onClick=\{closeForm\}/,
  );
  assert.match(registrationHostSource, /showCloseButton=\{false\}/);
  assert.match(registrationHostSource, /closeAction=\{\([\s\S]*?requestRegistrationApplicationClose/);
  assert.match(registrationHostSource, /registrationApplicationHost\.kind === "detail"[\s\S]*?closeAction=\{registrationDetailCloseAction\}/);

  assert.doesNotMatch(formDialogSource, /\bshowCloseButtonText\b/);
  assert.doesNotMatch(workspaceSource, /function blurActiveElementBeforeDialog/);
  assert.doesNotMatch(workspaceSource, /blurActiveElementBeforeDialog\(\)/);
  assert.match(dialogSource, /showCloseButtonText[\s\S]*: "size-8 rounded-md/);
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

test("custom listboxes and registration tabs implement their declared keyboard patterns", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const listboxSource = source.slice(
    source.indexOf("function TaskListboxField"),
    source.indexOf("function PrioritySelectField"),
  );

  assertIncludesAll(listboxSource, [
    "handleListboxTriggerKeyDown",
    "handleListboxOptionKeyDown",
    'event.key === "ArrowDown"',
    'event.key === "ArrowUp"',
    'event.key === "Home"',
    'event.key === "End"',
    'event.key === "Escape"',
    "window.requestAnimationFrame(() => triggerRef.current?.focus())",
    "focus-visible:ring-2 focus-visible:ring-ring/40",
    "tabIndex={selected || (!selectedOption && index === 0) ? 0 : -1}",
  ]);
  assertIncludesAll(source, [
    "handleRegistrationViewTabKeyDown",
    'data-registration-view-tab={tab.key}',
    "tabIndex={registrationView === tab.key ? 0 : -1}",
    "onKeyDown={(event) => handleRegistrationViewTabKeyDown(event, tab.key)}",
  ]);
});

test("required task listboxes expose opt-in accessibility semantics without changing optional defaults", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const taskListboxSource = source.slice(
    source.indexOf("function TaskListboxField"),
    source.indexOf("function PrioritySelectField"),
  );
  const gradeFieldStart = source.indexOf('<RegistrationFocusTarget focusKey="schoolGrade">');
  const gradeFieldSource = source.slice(
    gradeFieldStart,
    source.indexOf('<RegistrationFieldLabel label="학교"', gradeFieldStart),
  );

  assertIncludesAll(taskListboxSource, [
    "required = false",
    "required?: boolean",
    "const requiredDescriptionId = useId()",
    'role="combobox"',
    "aria-required={required || undefined}",
    "aria-describedby={required ? requiredDescriptionId : undefined}",
    '<span id={requiredDescriptionId} className="sr-only">필수 입력</span>',
  ]);
  assert.match(gradeFieldSource, /<TaskListboxField[\s\S]*?\n\s+required\n/);
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
  const assistantOverviewBlock = source.slice(
    source.indexOf("const assistantOverviewItems"),
    source.indexOf("const fullOverviewItems"),
  );
  const dashboardIndex = fullOverviewBlock.indexOf('title: "대시보드"');
  const todoIndex = fullOverviewBlock.indexOf(`title: "${ko.todo}"`);

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
  assert.notEqual(dashboardIndex, -1);
  assert.ok(dashboardIndex < todoIndex);
  assert.match(
    fullOverviewBlock,
    /const fullOverviewItems: NavItem\[\] = \[\s*\{ title: "대시보드", url: "\/admin\/dashboard"/,
  );
  assert.doesNotMatch(assistantOverviewBlock, /title: "대시보드"/);
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
    "RegistrationCaseList",
    "getRegistrationCaseTabCounts",
    "pipelineStatus",
    "pipeline_status",
    "REGISTRATION_PIPELINE_STATUSES",
    "ops_registration_details_pipeline_status_idx",
    "findRegistrationPipelineStatus",
    "syncRegistrationPipelineStatusForTaskStatus",
    "registration_pipeline_status_check",
  ]);
});

test("registration workspace replaces Notion registration management with one application row per view", async () => {
  const [workspaceSource, serviceSource, migrationSource, caseListSource, trackModelSource, initialPlanSource] = await Promise.all([
    readSource("src/features/tasks/ops-task-workspace.tsx"),
    readSource("src/features/tasks/ops-task-service.ts"),
    readSource("supabase/migrations/20260710052914_registration_operational_fields.sql"),
    readSource("src/features/tasks/registration-case-list.tsx"),
    readSource("src/features/tasks/registration-track-model.js"),
    readSource("src/features/tasks/registration-initial-plan-control.tsx"),
  ]);
  const combined = `${workspaceSource}\n${serviceSource}\n${migrationSource}\n${caseListSource}\n${trackModelSource}`;
  const registrationTableSource = caseListSource;
  const detailDialogSource = workspaceSource.slice(
    workspaceSource.indexOf("<Dialog open={workspaceDataBelongsToCurrentViewer && detailOpen}"),
    workspaceSource.indexOf("<Dialog open={Boolean(deleteTarget)}"),
  );

  assertIncludesAll(combined, [
    'type RegistrationViewKey = "inquiry" | "level_test" | "consulting" | "waiting" | "enrollment" | "closed"',
    "REGISTRATION_VIEW_TABS",
    "STATUS_TO_VIEW",
    "getRegistrationTrackViewKey",
    "RegistrationCaseList",
    "buildRegistrationCaseListItems",
    "filterRegistrationCaseListItems",
    "RegistrationWorkflowStatusBadge",
    "RegistrationOperationsChecklistChips",
    "RegistrationNotificationSettingsDialog",
    "RegistrationDetailPanel",
    "getRegistrationCaseTabCounts",
    "collectRegistrationLegacySourceIds",
    "dispatchLegacyOpsTaskSources",
    "textbookPreparation",
    "visitConsultationPlace",
    "timetableRosterUpdated",
    "textbook_preparation",
    "visit_consultation_place",
    "timetable_roster_updated",
  ]);

  assertIncludesAll(workspaceSource, [
    '{ key: "inquiry", label: "문의" }',
    '{ key: "level_test", label: "레벨테스트" }',
    '{ key: "consulting", label: "상담" }',
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
    'data-testid="registration-case-mobile-list"',
    'data-testid="registration-case-desktop-list"',
    'aria-label="등록 신청 데이터테이블"',
    "RegistrationCaseActions",
    "item.tracks.map",
    "item.matchingTracks.map",
    "getRegistrationCaseTrackTimeLabel(track)",
    "REGISTRATION_CASE_INITIAL_RENDER_LIMIT = 40",
    "key={item.taskId}",
  ]);

  assertIncludesAll(workspaceSource, [
    'label="진행상태"',
    'label="과목"',
    'label="학년"',
    "RegistrationApplicationCreate",
    "RegistrationApplication",
    "admissionActions",
  ]);
  assertIncludesAll(initialPlanSource, [
    "과목별 다음 업무",
    "상담 책임자",
    "방문상담일시",
    "방문상담실",
  ]);

  assertIncludesAll(detailDialogSource, [
    "RegistrationDetailPanel",
    'selectedTaskFresh?.type === "registration" || selectedTaskFresh?.type === "withdrawal" || selectedTaskFresh?.type === "transfer" ? "sm:max-w-3xl"',
  ]);
});

test("fixture registration create keeps production conditions and follows management-role permissions", async () => {
  const workspaceSource = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const createGate = workspaceSource.slice(
    workspaceSource.indexOf("const showToolbarCreate"),
    workspaceSource.indexOf("const hasLoadBlocker"),
  );

  assert.match(workspaceSource, /const canManageRegistrationWorkflow = registrationFixtureEnabled[\s\S]*?\["admin", "staff"\]\.includes/);
  assert.match(createGate, /\(!registrationFixtureEnabled \|\| canManageRegistrationWorkflow\)/);
  assert.match(createGate, /!isTodoWorkspace && \(isRegistrationWorkspace \|\| isWithdrawalWorkspace \|\| isTransferWorkspace \|\| !showEmptyCreate\)/);
});

test("fixture registration stays loading until its runtime adapter is installed", async () => {
  const workspaceSource = await readSource("src/features/tasks/ops-task-workspace.tsx");

  assertIncludesAll(workspaceSource, [
    "const registrationFixturePrepared = Boolean(",
    "const [registrationFixtureRuntimeReady, setRegistrationFixtureRuntimeReady] = useState(false)",
    "const registrationFixtureTransitioning = registrationFixtureRequested !== registrationFixtureRuntimeReady",
    "const loading = workspaceLoading || registrationFixtureTransitioning",
    "if (!registrationFixturePrepared || !registrationFixtureModule || !registrationFixtureStateRef.current)",
    "setRegistrationFixtureRuntimeReady(true)",
    "setRegistrationFixtureRuntimeReady(false)",
  ]);
});

test("fixture registration withholds every provider token even before its runtime is ready", async () => {
  const workspaceSource = await readSource("src/features/tasks/ops-task-workspace.tsx");

  assertIncludesAll(workspaceSource, [
    'const registrationNotificationSessionToken = registrationFixtureRequested ? "" : notificationSessionToken',
    "sendRegistrationVisitNotificationTarget(target, registrationNotificationSessionToken)",
    "sessionToken={registrationNotificationSessionToken}",
    "notificationToken={registrationNotificationSessionToken}",
    "!registrationFixtureRequested && showLegacyNotificationSettingsLauncher",
  ]);
});

test("leaving a registration fixture clears provider retry targets before production resumes", async () => {
  const workspaceSource = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const fixtureRetryCleanup = workspaceSource.slice(
    workspaceSource.indexOf("const registrationVisitNotificationRetryGenerationRef"),
    workspaceSource.indexOf("const withdrawalCreateHandledRef"),
  );

  assertIncludesAll(fixtureRetryCleanup, [
    "if (registrationFixtureRequested) return",
    "registrationVisitNotificationRetryGenerationRef.current += 1",
    "registrationVisitNotificationRetryInFlightRef.current = false",
    "setPendingRegistrationVisitNotificationTargets([])",
    "setRetryingRegistrationVisitNotifications(false)",
    "[registrationFixtureRequested]",
  ]);
});

test("registration exposes six ordered work tabs with case rows retaining subject-specific states", async () => {
  const [workspaceSource, caseListSource, trackModelSource] = await Promise.all([
    readSource("src/features/tasks/ops-task-workspace.tsx"),
    readSource("src/features/tasks/registration-case-list.tsx"),
    readSource("src/features/tasks/registration-track-model.js"),
  ]);
  const tabsSource = workspaceSource.slice(
    workspaceSource.indexOf("const REGISTRATION_VIEW_TABS"),
    workspaceSource.indexOf("const REGISTRATION_GRADE_OPTIONS"),
  );

  const orderedTabs = [
    '{ key: "inquiry", label: "문의" }',
    '{ key: "level_test", label: "레벨테스트" }',
    '{ key: "consulting", label: "상담" }',
    '{ key: "waiting", label: "대기" }',
    '{ key: "enrollment", label: "등록" }',
    '{ key: "closed", label: "완료" }',
  ];
  for (let index = 1; index < orderedTabs.length; index += 1) {
    assert.ok(
      tabsSource.indexOf(orderedTabs[index - 1]) < tabsSource.indexOf(orderedTabs[index]),
      `${orderedTabs[index - 1]} should appear before ${orderedTabs[index]}`,
    );
  }
  assertIncludesAll(trackModelSource, [
    'level_test_scheduled: "level_test"',
    'level_test_in_progress: "level_test"',
    'consultation_waiting: "consulting"',
    'visit_consultation_scheduled: "consulting"',
  ]);

  assertIncludesAll(caseListSource, [
    'level_test_scheduled: "레벨테스트 예약"',
    'level_test_in_progress: "레벨테스트 진행"',
    'consultation_waiting: "전화상담 대기"',
    'visit_consultation_scheduled: "방문상담 예약"',
    'onAction(item.taskId, track.trackId, "complete_consultation")',
  ]);
});

test("registration toolbar keeps the workflow self-explanatory with search and refresh instead of a duplicate manual", async () => {
  const workspaceSource = await readSource("src/features/tasks/ops-task-workspace.tsx");
  assert.doesNotMatch(workspaceSource, /RegistrationProcessManualDialog/);
  assert.doesNotMatch(workspaceSource, /registrationProcessManualOpen/i);
  assert.doesNotMatch(workspaceSource, /등록 프로세스 & 매뉴얼/);
  assert.doesNotMatch(workspaceSource, /BookOpenCheck/);
  assert.doesNotMatch(workspaceSource, /RegistrationWorkflowChart|registration-workflow-chart|등록 업무 6단계/);
  assert.doesNotMatch(workspaceSource, /aria-label="학년 필터"|allLabel="학년 전체"|selectedGradeFilter|appliedGradeFilter/);
  assert.match(workspaceSource, /const hasQuery = !isWithdrawalWorkspace && !isTransferWorkspace && query\.trim\(\)\.length > 0/);
  assert.match(workspaceSource, /const showSearch = isRegistrationWorkspace\s*\? registrationMode === "list"\s*:/);
  assert.match(workspaceSource, /filterRegistrationCaseListItems\(registrationCaseItems, registrationView, deferredQuery\)/);
  assert.match(workspaceSource, /isRegistrationWorkspace[\s\S]*?aria-label="새로고침"/);
  assert.match(workspaceSource, /setRegistrationCalendarRefreshToken\(\(current\) => current \+ 1\)/);
  assert.match(workspaceSource, /isRegistrationWorkspace \? "w-full !flex-nowrap !overflow-x-auto lg:flex-1"/);
});

test("closing a registration form clears validation feedback before returning to the list", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const closeFormSource = source.slice(
    source.indexOf("  function closeForm()"),
    source.indexOf("  function cancelFormCloseConfirmation", source.indexOf("  function closeForm()")),
  );

  assert.match(closeFormSource, /function closeForm\(\)[\s\S]*?setMessage\(""\)/);
  assert.match(closeFormSource, /function discardFormAndClose\(\)[\s\S]*?setMessage\(""\)/);
  assert.match(closeFormSource, /setFormCompletionBlockers\(\[\]\)/);
});

test("canonical registration detail shows a retry state instead of a permanent loading message after failure", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  assert.match(source, /const \[registrationDetailLoadError, setRegistrationDetailLoadError\] = useState\(""\)/);
  assert.match(
    source,
    /const isCanonicalRegistrationTrackDetail = Boolean\([\s\S]*?selectedRegistrationAppointmentId/,
    "calendar appointment loads must stay on the canonical detail surface before a track is resolved",
  );
  assert.match(source, /setRegistrationDetailLoadError\(""\)[\s\S]*?loadRegistrationCaseForWorkspace/);
  assert.match(source, /setRegistrationDetailLoadError\("선택한 과목 상세를 불러오지 못했습니다\."\)/);
  assert.match(source, /setRegistrationDetailLoadError\("등록 예약 상세를 불러오지 못했습니다\."\)/);
  assert.match(source, /registrationDetailLoadError \? \([\s\S]*?등록 상세 다시 시도/);
  assert.match(source, /등록 상세 다시 시도[\s\S]*?openRegistrationTrack/);
  assert.match(source, /등록 상세 다시 시도[\s\S]*?openRegistrationAppointment/);
});

test("registration list and calendar navigation clear stale detail notices", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const modeSource = source.slice(
    source.indexOf("  const syncRegistrationMode"),
    source.indexOf("  function handleRegistrationViewTabKeyDown"),
  );
  const editSource = source.slice(
    source.indexOf("  const editRegistrationTrack"),
    source.indexOf("  const openRegistrationAppointment"),
  );
  const appointmentSource = source.slice(
    source.indexOf("  const openRegistrationAppointment"),
    source.indexOf("  const openRegistrationCalendarItem"),
  );

  assert.match(modeSource, /setNotice\(""\)/);
  assert.match(appointmentSource, /setNotice\(""\)/);
  assert.doesNotMatch(editSource, /과목별 상세를 확인하세요/);
  assert.doesNotMatch(source, /상담 결과 입력을 계속 진행하세요/);
});

test("registration keeps the result URL only in canonical completion and detail surfaces", async () => {
  const [workspaceSource, appointmentEditorSource] = await Promise.all([
    readSource("src/features/tasks/ops-task-workspace.tsx"),
    readSource("src/features/tasks/registration-appointment-editor.tsx"),
  ]);
  const registrationFormSource = workspaceSource.slice(
    workspaceSource.indexOf('if (form.type === "registration") {', workspaceSource.indexOf("function TypeSpecificFields")),
    workspaceSource.indexOf('if (form.type === "withdrawal")', workspaceSource.indexOf("function TypeSpecificFields")),
  );
  const registrationDetailSource = workspaceSource.slice(
    workspaceSource.indexOf("function RegistrationDetailPanel"),
    workspaceSource.indexOf("function WithdrawalDetailPanel"),
  );

  assert.doesNotMatch(registrationFormSource, /시험지·결과지 URL|levelTestMaterialLink/);
  assert.match(appointmentEditorSource, /시험지·결과지 URL/);
  assert.match(registrationDetailSource, /RegistrationExternalLinkInfo label="시험지·결과지 URL"/);
});

test("등록 예약 달력은 목록 흐름과 분리되고 정확한 예약 딥링크를 한 번만 연다", async () => {
  const [workspaceSource, editorSource, calendarSource] = await Promise.all([
    readSource("src/features/tasks/ops-task-workspace.tsx"),
    readSource("src/features/tasks/registration-track-editor.tsx"),
    readSource("src/features/tasks/registration-appointment-calendar.tsx"),
  ]);

  assertIncludesAll(workspaceSource, [
    'type RegistrationWorkspaceMode = "list" | "calendar"',
    "RegistrationAppointmentCalendar",
    "registrationMode",
    "syncRegistrationMode",
    'currentSearchParams.get("appointmentId")',
    "openRegistrationAppointment",
    "selectedRegistrationAppointmentId",
    "openRegistrationCalendarItem",
    "item.href",
    "initialAppointmentId={selectedRegistrationAppointmentId}",
    "onAppointmentOpenChange={handleRegistrationAppointmentOpenChange}",
    'routeParams.set("view", "calendar")',
    'role="group" aria-label="등록 화면 보기"',
  ]);
  assert.match(
    workspaceSource,
    /registrationMode === "calendar"[\s\S]*?<RegistrationAppointmentCalendar/,
  );
  assert.match(
    workspaceSource,
    /const participantTrackIds = getRegistrationAppointmentParticipantTrackIds\(detail, appointmentId\)/,
  );
  assert.match(
    workspaceSource,
    /syncTaskDeepLink\(taskId, trackId, selectedRegistrationAppointmentId\)/,
    "과목을 바꿔도 달력 예약 ID가 유지돼야 합니다.",
  );
  assert.match(
    workspaceSource,
    /catch(?: \(error\))? \{[\s\S]*?selectionKey[\s\S]*?setRegistrationDetailLoadError\("등록 예약 상세를 불러오지 못했습니다\."\)/,
    "예약 상세 실패는 내부 오류 문자열을 사용자에게 그대로 노출하면 안 됩니다.",
  );

  assertIncludesAll(editorSource, [
    "initialAppointmentId?: string | null",
    "onAppointmentOpenChange?: (appointmentId: string | null) => void",
    "initialAppointmentAppliedRef",
    "initialAppointmentId",
    "onAppointmentOpenChange?.(null)",
  ]);
  assert.match(editorSource, /if \(initialAppointmentAppliedRef\.current === initialKey\) return/);

  assertIncludesAll(calendarSource, [
    'type CalendarView = "month" | "week"',
    'aria-label="등록 예약 달력 보기"',
    'data-testid="registration-appointment-month"',
    'data-testid="registration-appointment-week"',
    'data-testid="registration-appointment-mobile-agenda"',
    'role="group"',
    'aria-label="등록 예약 달력 보기"',
    "getSeoulRegistrationDateKey(item.scheduledAt)",
    "Asia/Seoul",
    "loadRegistrationAppointmentCalendar",
    'scheduled: "예약"',
    'completed: "완료"',
    'canceled: "취소"',
  ]);
  assert.match(calendarSource, /STATUS_LABELS\[item\.status\]/);
  assert.doesNotMatch(calendarSource, /!compact \? <Badge[\s\S]*?STATUS_LABELS\[item\.status\]/);
  assert.doesNotMatch(calendarSource, /\bdraggable\b|onDrop|onDrag|resize|range-create|onDelete/);
});

test("registration tabs render compact application rows without the retired parent table filters", async () => {
  const [workspaceSource, tableSource] = await Promise.all([
    readSource("src/features/tasks/ops-task-workspace.tsx"),
    readSource("src/features/tasks/registration-case-list.tsx"),
  ]);

  assertIncludesAll(workspaceSource, [
    "key={registrationView}",
    "items={visibleRegistrationCaseItems}",
    "viewerRole={registrationViewerRole}",
  ]);
  assertIncludesAll(tableSource, [
    'aria-label="등록 신청 목록"',
    'aria-label="등록 신청 모바일 목록"',
    'aria-label="등록 신청 데이터테이블"',
    "const visibleItems = items.slice(0, visibleCount)",
    "RegistrationCaseListRow",
  ]);
  assert.doesNotMatch(workspaceSource, /RegistrationDataTable|RegistrationPipelineFilter/);
  assert.doesNotMatch(tableSource, /selectedGradeFilter|selectedCounselorFilter|RegistrationResizableHeaderCell/);
});

test("registration hold and terminal states expose only valid explicit actions", async () => {
  const workspaceSource = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const actionSource = workspaceSource.slice(
    workspaceSource.indexOf("function getNextTaskStatusAction"),
    workspaceSource.indexOf("function getWordRetestPrimaryActions"),
  );

  assertIncludesAll(workspaceSource, [
    'task.status === "on_hold" ? `보류 · ${pipelineLabel}` : pipelineLabel',
    'task.status === "on_hold") return null',
    'return [{ value: "in_progress", label: "다시 진행" }]',
    "isCanonicalRegistrationTrackDetail",
    "!isCanonicalRegistrationTrackDetail",
    'getRegistrationPipelinePrefix(selectedTaskFresh.registration?.pipelineStatus) === "9."',
    '"문의로 다시 열기"',
    '"상담 결과로 다시 열기"',
    "function getRegistrationDecisionActionsForTask",
    "getRegistrationBranchActions(task.registration?.pipelineStatus)",
    '? "다음 방향"',
    '? "상담 결과"',
    ': "등록 전환"',
    '"1.": "진행 후 결과 입력"',
    '"2.": "진행 후 상담 결과 입력"',
  ]);
  assert.match(actionSource, /if \(task\.type === "registration"\) return null/);
  assert.match(actionSource, /if \(task\.status === "on_hold"\) return \[\{ value: "in_progress", label: "다시 진행" \}\]/);
});

test("registration load failure can retry and a committed create survives detail refresh failure", async () => {
  const workspaceSource = await readSource("src/features/tasks/ops-task-workspace.tsx");

  assertIncludesAll(workspaceSource, [
    'data?.error || "할 일 DB 마이그레이션을 적용하세요."',
    'onClick={() => void reload(true)}',
    '다시 시도',
    "const canOpenCreate = isTodoWorkspace || (!loading && !hasLoadBlocker)",
    "let savedWithRefreshWarning = false",
    "loadSavedTaskOrFallback",
    "savedWithRefreshWarning = true",
  ]);
});

test("registration list renders core data without starting option reads until a form opens", async () => {
  const workspaceSource = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const reloadSource = workspaceSource.slice(
    workspaceSource.indexOf("const reload = useCallback"),
    workspaceSource.indexOf("useEffect(() => {\n    void reload()"),
  );

  assertIncludesAll(workspaceSource, [
    "const workspaceLoadGenerationRef = useRef(0)",
    "function mergeOpsTaskWorkspaceOptionData",
    "const enrichedTasks = current.tasks.map",
    "requestedByLabel: profileLabels.get(task.requestedBy) || task.requestedByLabel",
    "authorLabel: profileLabels.get(comment.authorId) || comment.authorLabel",
    "uploadedByLabel: profileLabels.get(attachment.uploadedBy) || attachment.uploadedByLabel",
    "actorLabel: profileLabels.get(event.actorId) || event.actorLabel",
    "tasks: enrichedTasks",
    "includeManagementOptions: false",
    "includeTeacherOptions: false",
    "includeProfileOptions: false",
    "const loadGeneration = ++workspaceLoadGenerationRef.current",
    "mergeOpsTaskWorkspaceOptionData(nextData, enrichmentData)",
    "setLoading(false)",
    "const ensureRegistrationOptions = useCallback",
    "loadOpsTaskWorkspaceOptionData({",
    "viewerId: currentUserId",
    "mergeOpsTaskWorkspaceOptionData(current, enrichmentData)",
    "workspaceLoadGenerationRef.current !== loadGeneration",
    "if (type === \"registration\") void ensureRegistrationOptions()",
    "if (task.type === \"registration\") void ensureRegistrationOptions()",
  ]);
  assert.doesNotMatch(reloadSource, /loadOpsTaskWorkspaceOptionData/);
});

test("registration alone uses the application list while neighboring operation tables stay wired", async () => {
  const workspaceSource = await readSource("src/features/tasks/ops-task-workspace.tsx");

  assert.match(workspaceSource, /isRegistrationWorkspace \? \([\s\S]*?<RegistrationCaseList/);
  assert.match(workspaceSource, /isWithdrawalWorkspace \? \([\s\S]*?<WithdrawalDataTable/);
  assert.match(workspaceSource, /isTransferWorkspace \? \([\s\S]*?<TransferDataTable/);
  assert.match(workspaceSource, /onOpen=\{\(taskId, trackId\) => void openRegistrationTrack\(taskId, trackId\)\}/);
  assert.match(workspaceSource, /onEdit=\{\(taskId, trackId\) => void editRegistrationTrack\(taskId, trackId\)\}/);
  assert.match(workspaceSource, /onAction=\{\(taskId, trackId, action\) => void handleRegistrationTrackAction\(taskId, trackId, action\)\}/);
});

test("local task mutations invalidate stale background workspace reloads before committing state", async () => {
  const workspaceSource = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const invalidationSource = workspaceSource.slice(
    workspaceSource.indexOf("const invalidatePendingWorkspaceReloads"),
    workspaceSource.indexOf("const applyTaskPatch"),
  );
  assert.match(invalidationSource, /workspaceLoadGenerationRef\.current \+= 1/);
  assert.match(invalidationSource, /setLoading\(false\)/);
  assert.match(invalidationSource, /registrationOptionsLoadGenerationRef\.current \+= 1/);
  assert.match(invalidationSource, /setRegistrationOptionsLoading\(false\)/);

  for (const [start, end] of [
    ["const applyTaskPatch", "const prependTask"],
    ["const prependTask", "const replaceTaskInState"],
    ["const replaceTaskInState", "const handleRegistrationCustomerMessageSent"],
    ["const updateTaskInState", "const appendTaskComment"],
    ["const removeTaskFromState", "const buildLocalTaskFromInput"],
  ]) {
    const helperSource = workspaceSource.slice(
      workspaceSource.indexOf(start),
      workspaceSource.indexOf(end),
    );
    assert.ok(
      helperSource.indexOf("invalidatePendingWorkspaceReloads()") < helperSource.indexOf("setData("),
      `${start} must invalidate an older reload before committing local mutation state`,
    );
  }
});

test("registration option enrichment survives a slower core revalidation", async () => {
  const workspaceSource = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const reloadSource = workspaceSource.slice(
    workspaceSource.indexOf("const reload = useCallback"),
    workspaceSource.indexOf("useEffect(() => {\n    void reload()"),
  );
  const optionSource = workspaceSource.slice(
    workspaceSource.indexOf("const ensureRegistrationOptions = useCallback"),
    workspaceSource.indexOf("useEffect(() => {", workspaceSource.indexOf("const ensureRegistrationOptions = useCallback")),
  );

  assert.match(workspaceSource, /const registrationOptionsDataRef = useRef<OpsTaskWorkspaceOptionData \| null>\(null\)/);
  assert.match(workspaceSource, /const registrationOptionsLoadGenerationRef = useRef\(0\)/);
  assert.match(reloadSource, /const enrichmentData = registrationOptionsDataRef\.current/);
  assert.match(reloadSource, /mergeOpsTaskWorkspaceOptionData\(nextData, enrichmentData\)/);
  assert.doesNotMatch(
    reloadSource.slice(reloadSource.indexOf("const nextData = await")),
    /registrationOptionsLoadedRef\.current = false/,
  );
  assert.match(optionSource, /\+\+registrationOptionsLoadGenerationRef\.current/);
  assert.match(optionSource, /registrationOptionsDataRef\.current = enrichmentData/);
  assert.doesNotMatch(optionSource, /workspaceLoadGenerationRef\.current !== loadGeneration/);
});

test("automatic word-retest mutations cannot commit across viewer or reload ownership changes", async () => {
  const workspaceSource = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const autoMutationSource = workspaceSource.slice(
    workspaceSource.indexOf("async function autoMarkPastWordRetestsAbsent"),
    workspaceSource.indexOf("void autoMarkPastWordRetestsAbsent()"),
  );

  assert.match(autoMutationSource, /const mutationViewerId = currentUserId/);
  assert.match(autoMutationSource, /const mutationLoadGeneration = workspaceLoadGenerationRef\.current/);
  assert.match(autoMutationSource, /!workspaceMountedRef\.current/);
  assert.match(autoMutationSource, /latestWorkspaceViewerIdRef\.current !== mutationViewerId/);
  assert.match(autoMutationSource, /workspaceLoadGenerationRef\.current !== mutationLoadGeneration/);
  assert.match(autoMutationSource, /void reload\(true, false\)/);
  assert.match(autoMutationSource, /invalidatePendingWorkspaceReloads\(\)/);
  assert.doesNotMatch(autoMutationSource, /workspaceLoadGenerationRef\.current \+= 1/);
});

test("viewer transitions hide and reset the previous viewer's workspace state before passive reload", async () => {
  const workspaceSource = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const reloadSource = workspaceSource.slice(
    workspaceSource.indexOf("const reload = useCallback"),
    workspaceSource.indexOf("useEffect(() => {\n    workspaceMountedRef.current = true"),
  );

  assert.match(workspaceSource, /<OpsTaskWorkspaceSession key=\{user\?\.id \|\| "anonymous"\} workspace=\{workspace\} \/>/);
  assert.match(workspaceSource, /const latestWorkspaceViewerIdRef = useRef\(currentUserId\)\s*latestWorkspaceViewerIdRef\.current = currentUserId/);
  assert.match(workspaceSource, /const workspaceDataBelongsToCurrentViewer = workspaceDataViewerIdRef\.current === currentUserId/);
  assert.match(workspaceSource, /const tasks = workspaceDataBelongsToCurrentViewer \? data\?\.tasks \|\| EMPTY_TASKS : EMPTY_TASKS/);
  assert.match(workspaceSource, /const selectedTaskFresh = workspaceDataBelongsToCurrentViewer && selectedTask/);
  assert.match(reloadSource, /workspaceDataViewerIdRef\.current = ""/);
  assert.match(reloadSource, /setSelectedTask\(null\)/);
  assert.match(reloadSource, /setEditingTask\(null\)/);
  assert.match(reloadSource, /setFormOpen\(false\)/);
  assert.match(reloadSource, /setDetailOpen\(false\)/);
  assert.match(reloadSource, /setRegistrationCustomerMessageTask\(null\)/);
  assert.match(reloadSource, /setDeleteTarget\(null\)/);
  assert.match(reloadSource, /setBulkDeleteTargets\(\[\]\)/);
  assert.match(reloadSource, /workspaceDataViewerIdRef\.current = currentUserId[\s\S]*setData/);
  assert.match(workspaceSource, /open=\{workspaceDataBelongsToCurrentViewer && formOpen\}/);
  assert.match(workspaceSource, /open=\{workspaceDataBelongsToCurrentViewer && detailOpen\}/);
});

test("registration detail prioritizes reached sections instead of listing empty future work", async () => {
  const workspaceSource = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const detailSource = workspaceSource.slice(
    workspaceSource.indexOf("function RegistrationDetailPanel"),
    workspaceSource.indexOf("function WithdrawalDetailPanel"),
  );

  assertIncludesAll(detailSource, [
    "getRegistrationMobileSections(pipelineStatus, getRegistrationMobileSectionData(task, registration))",
    "const showLevelTestDetail =",
    "const showConsultationDetail =",
    "const showPlacementDetail =",
    "const showAdmissionDetail =",
    'aria-label="문의 정보"',
    'aria-label="레벨테스트 정보"',
    'aria-label="상담 정보"',
    'aria-label="등록·대기 정보"',
    'aria-label="입학 처리 정보"',
  ]);
});

test("registration mobile cards derive terminal sections from task links as well as detail fields", async () => {
  const workspaceSource = await readSource("src/features/tasks/ops-task-workspace.tsx");

  assertIncludesAll(workspaceSource, [
    "function getRegistrationMobileSectionData",
    "classId: task.classId",
    "className: task.className",
    "textbookId: task.textbookId",
    "textbookTitle: task.textbookTitle",
    "registration.pipelineStatus",
    "getRegistrationMobileSectionData(task, registration)",
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

  const [workspaceSource, registrationWorkflowSource, serviceSource, routeSource, routeCoreSource, legacyRouteSource, migrationSource, leastPrivilegeMigrationSource, policyPerformanceMigrationSource] = await Promise.all([
    readSource("src/features/tasks/ops-task-workspace.tsx"),
    readSource("src/features/tasks/registration-workflow.js"),
    readSource("src/features/tasks/ops-task-service.ts"),
    readSource("src/app/api/solapi/registration/route.ts"),
    readSource("src/app/api/solapi/registration/core.js"),
    readSource("src/app/api/solapi/registration/legacy.ts"),
    readSource("supabase/migrations/20260710052921_registration_application_workflow.sql"),
    readSource("supabase/migrations/20260710053001_registration_message_least_privilege.sql"),
    readSource("supabase/migrations/20260710053144_registration_message_policy_performance.sql"),
  ]);
  const combined = `${workspaceSource}\n${serviceSource}\n${routeSource}\n${migrationSource}\n${leastPrivilegeMigrationSource}\n${policyPerformanceMigrationSource}`;
  const detailDialogSource = workspaceSource.slice(
    workspaceSource.indexOf("<Dialog open={workspaceDataBelongsToCurrentViewer && detailOpen}"),
    workspaceSource.indexOf("<Dialog open={Boolean(deleteTarget)}"),
  );

  assertIncludesAll(`${workspaceSource}\n${registrationWorkflowSource}`, [
    "REGISTRATION_BRANCH_ACTIONS",
    "RegistrationDecisionActions",
    "getRegistrationBranchActions",
    "getRegistrationPipelineActionBlockers",
    'studentName.endsWith("학생")',
    "RegistrationCustomerMessageDialog",
    "openRegistrationCustomerMessage",
    "sendRegistrationAdmissionMessage",
    "copyMakeEduAdmissionMessage",
    'label: "등록"',
    "현재 학기 수강반 대기",
    "현재 학기 개강반 대기",
    "다음 학기 개강반 대기",
    "미등록 완료",
    "문의 완료",
    "레벨테스트 재응시",
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
  assertIncludesAll(`${routeSource}\n${routeCoreSource}\n${legacyRouteSource}`, [
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

test("registration create uses the canonical initial plan, exact runtime matrix, and frozen retry envelope", async () => {
  const [source, createSource, initialPlanSource, intakeWorkflowSource, registrationWorkflowSource, sampleWorkflowSource, browserWorkflowSource] = await Promise.all([
    readSource("src/features/tasks/ops-task-workspace.tsx"),
    readSource("src/features/tasks/registration-application-create.tsx"),
    readSource("src/features/tasks/registration-initial-plan-control.tsx"),
    readSource("src/features/tasks/registration-intake-workflow.ts"),
    readSource("src/features/tasks/registration-workflow.js"),
    readSource("scripts/verify-ops-task-sample-workflow.mjs"),
    readSource("scripts/verify-ops-task-browser-workflow.mjs"),
  ]);
  const formDialogSource = source.slice(
    source.indexOf("<Dialog open={workspaceDataBelongsToCurrentViewer && formOpen}"),
    source.indexOf("<Dialog open={workspaceDataBelongsToCurrentViewer && detailOpen}"),
  );
  const registrationFormSource = source.slice(
    source.indexOf('if (form.type === "registration") {', source.indexOf("function TypeSpecificFields")),
    source.indexOf('if (form.type === "withdrawal")', source.indexOf("function TypeSpecificFields")),
  );
  const registrationCreateDefaultsSource = registrationWorkflowSource.slice(
    registrationWorkflowSource.indexOf("export function getRegistrationCreateDefaults"),
    registrationWorkflowSource.indexOf("export function getRegistrationPrefillPipelineStatus"),
  );
  const readyCreateSource = source.slice(
    source.indexOf('if (createAttempt.writer === "atomic")'),
    source.indexOf("const inquiryOnlyPayload", source.indexOf('if (createAttempt.writer === "atomic")')),
  );
  const submitFormSource = source.slice(
    source.indexOf("const submitForm = async"),
    source.indexOf("const handleFormKeyDown", source.indexOf("const submitForm = async")),
  );

  assertIncludesAll(source, [
    'import { RegistrationApplicationCreate } from "./registration-application-create"',
    "probeRegistrationIntakeWorkflowRuntime",
    "probeRegistrationSubjectTrackRuntime",
    "probeRegistrationInitialPersistence",
    "createRegistrationCaseWithInitialWorkflow",
    "createRegistrationCase",
    "createRegistrationCreateAttempt",
    "assertRegistrationCreateAttemptPersistenceMode",
    "markRegistrationLegacyCreateStarted",
    "dispatchRegistrationVisitNotificationTargets",
    "registrationCreateAttemptRef",
    'registrationPersistence.mode === "ready_atomic"',
    'createAttempt.writer === "atomic"',
    'createAttempt.writer === "canonical"',
    'createAttempt.writer === "legacy"',
    'registrationPersistence.mode === "blocked_maintenance"',
    'registrationPersistence.mode === "blocked_mismatch"',
    'registrationPersistence.mode === "blocked_indeterminate"',
  ]);
  assert.doesNotMatch(formDialogSource, /담당자 및 일시 이력/);

  assertIncludesAll(registrationFormSource, [
    "<RegistrationApplicationCreate",
    "form={form}",
    "draft={registrationInitialWorkflowDraft}",
    "onFormPatch={updateFormPatch}",
    "onDraftChange={onRegistrationInitialWorkflowChange}",
  ]);
  assert.doesNotMatch(registrationFormSource, /phoneConsultationAt|levelTestAt|visitConsultationAt|visitConsultationPlace|levelTestMaterialLink/);
  assertIncludesAll(createSource, ["RegistrationApplicationPlacementSection", "RegistrationApplicationAdmissionSection"]);
  assert.doesNotMatch(source, /inquiryChannel|\{문의채널\}|문의채널|문의 채널/);
  assert.doesNotMatch(sampleWorkflowSource, /inquiry_channel/);
  assert.doesNotMatch(browserWorkflowSource, /inquiry_channel/);
  assertIncludesAll(browserWorkflowSource, [
    "async function selectListboxOptionIfPresent",
    'await selectListboxOptionIfPresent(page, dialog, "학년", "고1")',
    "전화상담 예약일시",
    "시험지·결과지 URL",
    "상담 책임자",
    "방문상담 예약일시",
    "방문상담실",
    "canonical reload",
    'width: 1349, height: 987',
    "visitFieldOrder",
  ]);
  assert.doesNotMatch(browserWorkflowSource, /fillIfPresent\(dialog, "학년"/);
  assert.doesNotMatch(source, /ensureRegistrationInquiryAt/);
  assert.match(registrationCreateDefaultsSource, /campus: "본관"/);
  assert.match(readyCreateSource, /createRegistrationCaseWithInitialWorkflow\(\{/);
  assert.match(readyCreateSource, /normalizedInitialWorkflow\.subjectPlans/);
  assert.match(readyCreateSource, /normalizedInitialWorkflow\.levelTestAppointment/);
  assert.match(readyCreateSource, /normalizedInitialWorkflow\.visitAppointment/);
  assert.match(readyCreateSource, /normalizedInitialWorkflow\.directorOverrides/);
  assert.doesNotMatch(readyCreateSource, /createRegistrationCase\(\{/);
  assert.doesNotMatch(readyCreateSource, /persistCreatedRegistrationDirectorDefaults/);
  assert.doesNotMatch(submitFormSource, /directorOverrides:\s*\{\s*\.\.\.registrationResolvedDirectorIds/);
  assert.doesNotMatch(source, /persistCreatedRegistrationDirectorDefaults/);
  assert.match(
    submitFormSource,
    /getRegistrationPersistenceErrorMessage\(error,\s*getOpsTaskActionErrorMessage\(error, "저장하지 못했습니다\."\)\)/,
  );
  const registrationDateTimeControls = initialPlanSource.match(/<DateTimePickerControl[\s\S]*?\/>/g) || [];
  assert.equal(registrationDateTimeControls.length, 2);
  for (const controlSource of registrationDateTimeControls) {
    assert.match(controlSource, /disablePortal/);
    assert.match(controlSource, /timeOptions=\{REGISTRATION_TIME_OPTIONS\}/);
  }
  assertIncludesAll(initialPlanSource, [
    "과목별 다음 업무",
    "문의 유지",
    "바로 전화상담",
    "레벨테스트",
    "방문상담",
    "상담 책임자",
    "dateAriaLabel=\"레벨테스트 예약일 날짜\"",
    "timeAriaLabel=\"레벨테스트 예약일 시각\"",
    "dateAriaLabel=\"방문상담일 날짜\"",
    "timeAriaLabel=\"방문상담일 시각\"",
    "레벨테스트 장소",
    "방문상담실",
    "참여 과목",
  ]);
  assert.doesNotMatch(initialPlanSource, /전화상담 예약일시|phoneConsultationAt|시험지·결과지 URL|levelTestMaterialLink/);
  assertInOrder(initialPlanSource, ["상담 책임자", "전화상담 대기 기준일시", "방문상담일시", "방문상담실", "상담 결과"]);
  assertInOrder(initialPlanSource, ["레벨테스트 예약일시", "레벨테스트 장소", "참여 과목"]);
  assert.match(source, /getRegistrationCreateDefaults\(new Date\(\)\.toISOString\(\)\)/);

  const inquiryStart = createSource.indexOf("commonInfoContent");
  const inquiryEnd = createSource.indexOf("subjectSyncContent", inquiryStart);
  const inquirySource = createSource.slice(inquiryStart, inquiryEnd);
  assert.match(inquirySource, /className="grid gap-3 md:grid-cols-2"/);
  const orderedInquiryFields = [
    'data-registration-focus="subject"',
    'data-registration-focus="studentName"',
    'data-registration-focus="schoolGrade"',
    '<span>학년</span>',
    '<span>학교</span>',
    'data-registration-focus="parentPhone"',
    '<span>학생 전화</span>',
  ];
  for (let index = 1; index < orderedInquiryFields.length; index += 1) {
    assert.ok(
      inquirySource.indexOf(orderedInquiryFields[index - 1]) < inquirySource.indexOf(orderedInquiryFields[index]),
      `${orderedInquiryFields[index - 1]} should appear before ${orderedInquiryFields[index]}`,
    );
  }
  assertIncludesAll(inquirySource, [
    "<span>학생명</span>",
    '<legend className="text-sm font-medium">과목</legend>',
    "<span>학년</span>",
    "<span>학부모 전화</span>",
  ]);
  assert.doesNotMatch(inquirySource, /문의일시|focusKey="inquiryAt"|DateTimePickerControl/);
  assert.doesNotMatch(createSource, /label="캠퍼스"|updateForm\("campus"/);
  assert.doesNotMatch(inquirySource, /autoFocus=/);
  assertIncludesAll(source, [
    "aria-describedby={required ? requiredDescriptionId : undefined}",
    "하나 이상 선택해야 하는 필수 항목입니다.",
  ]);
  assert.doesNotMatch(inquirySource, /기존 학생 연결/);
  assert.match(
    formDialogSource,
    /disabled=\{saving \|\| \(!canSubmitCurrentForm && form\.type !== "registration"\)\}/,
  );
  assert.match(
    source,
    /getRegistrationPrefillPipelineStatus\(inputWithCompletionIntent\)/,
  );
  assert.match(source, /const submissionForm = form[\s\S]*?getRegistrationCreateBlockers\(submissionForm\)/);
  assert.match(source, /prepareRegistrationPipelineTransition/);
  assert.match(source, /setMessage\(getRegistrationCreateErrorMessage\(submissionForm\)\)/);

  assert.match(intakeWorkflowSource, /type RegistrationCreateAttempt = \{[\s\S]*?fingerprint: string[\s\S]*?requestKey: string[\s\S]*?inquiryAt: string[\s\S]*?normalizedInitialWorkflow:/);
  assert.match(source, /registrationCreateAttemptRef\.current = createRegistrationCreateAttempt/);
  assert.match(source, /persistenceMode: registrationPersistence\.mode/);
  assert.match(source, /assertRegistrationCreateAttemptPersistenceMode\([\s\S]*?registrationCreateAttemptRef\.current[\s\S]*?registrationPersistence\.mode/);
  assert.match(source, /if \(createAttempt\.writer === "atomic"\)/);
  assert.match(source, /if \(createAttempt\.writer === "canonical"\)/);
  assert.match(source, /if \(createAttempt\.writer === "legacy"\)/);
  assert.match(source, /inquiryAt: createAttempt\.inquiryAt/);
  assert.match(source, /sanitizeRegistrationInquiryOnlyInput\(registrationReceiptPayload\)/);
  const inquirySanitizerSource = source.slice(
    source.indexOf("function sanitizeRegistrationInquiryOnlyInput"),
    source.indexOf("function getWordRetestStudentPayload"),
  );
  assertIncludesAll(inquirySanitizerSource, [
    'status: "requested"',
    'completedAt: ""',
    'secondaryAssigneeId: ""',
    'classId: ""',
    'textbookId: ""',
    "pipelineStatus: REGISTRATION_PIPELINE_STATUSES[0]",
  ]);
  assert.match(source, /registrationCreateAttemptRef\.current = null[\s\S]*?dispatchRegistrationVisitNotificationTargets/);
  assert.match(source, /registrationCreateAttemptRef\.current = markRegistrationLegacyCreateStarted\(createAttempt\)[\s\S]*?createOpsTask\(inquiryOnlyPayload\)/);
  assert.match(source, /function discardFormAndClose\(\)[\s\S]*?registrationCreateAttemptRef\.current = null/);
  assert.match(source, /function openCreate\([\s\S]*?registrationCreateAttemptRef\.current = null/);

  const editBranch = submitFormSource.slice(
    submitFormSource.indexOf("if (editingTask)"),
    submitFormSource.indexOf("} else {", submitFormSource.indexOf("if (editingTask)")),
  );
  assert.match(editBranch, /updateRegistrationCaseCommon/);
  assert.match(editBranch, /positivelyIdentifiedLegacyRegistrationEdit/);
  assert.match(editBranch, /registrationTracks!\.every\(\(track\) => track\.legacy\)/);
  assert.doesNotMatch(editBranch, /registrationTracks\?\.some\(\(track\) => !track\.legacy\)/);
  assert.match(editBranch, /loadOpsRegistrationCaseDetail\(editingTask\.id, currentUserId, \{ force: true \}\)/);
  assert.match(editBranch, /registrationTracks: updatedDetail\.tracks/);
  assert.match(editBranch, /registrationTracks: editingTask\.registrationTracks/);
  assert.doesNotMatch(editBranch, /updateOpsTask\(editingTask\.id, payload\)/);
  assert.match(submitFormSource, /sanitizeRegistrationInquiryOnlyInput/);
});

test("canonical registration application mounts one honest read-only timeline in section six", async () => {
  assert.equal(
    await pathExists("src/features/tasks/registration-history-timeline.tsx"),
    true,
    "the canonical registration timeline component should exist",
  );

  const [workspaceSource, editorSource, timelineSource] = await Promise.all([
    readSource("src/features/tasks/ops-task-workspace.tsx"),
    readSource("src/features/tasks/registration-track-editor.tsx"),
    readSource("src/features/tasks/registration-history-timeline.tsx"),
  ]);
  const canonicalDetailStart = workspaceSource.indexOf("registrationCaseDetail && isCanonicalRegistrationTrackDetail");
  const canonicalDetailSource = workspaceSource.slice(
    canonicalDetailStart,
    workspaceSource.indexOf(') : selectedTaskFresh.type === "withdrawal"', canonicalDetailStart),
  );

  assert.match(editorSource, /import \{ RegistrationHistoryTimeline \} from "\.\/registration-history-timeline"/);
  assert.match(editorSource, /<RegistrationHistoryTimeline[\s\S]*?detail=\{detail\}[\s\S]*?profiles=/);
  assert.match(editorSource, /history=\{<RegistrationHistoryTimeline/);
  assert.doesNotMatch(editorSource, /현재 업무/);
  assert.doesNotMatch(editorSource, /담당자 및 일시 이력/);
  assert.match(timelineSource, /buildRegistrationSubjectHistory\(detail\)/);
  assert.match(timelineSource, /과목 전체/);
  assert.match(timelineSource, /단계 전체/);
  assert.match(timelineSource, /알 수 없음/);
  assert.match(timelineSource, /마이그레이션/);
  assert.match(timelineSource, /시간 확인 불가/);
  assert.match(timelineSource, /actorKind/);
  assert.match(timelineSource, /oldScheduledAt/);
  assert.match(timelineSource, /oldPlace/);
  assert.match(timelineSource, /예약 시각:/);
  assert.match(timelineSource, /장소:/);
  assert.match(timelineSource, /registration_director_defaults: "상담 책임자 자동 배정"/);
  assert.doesNotMatch(timelineSource, /`시스템 · \$\{item\.systemSource\}`/);
  assert.doesNotMatch(
    timelineSource,
    /if \(item\.actorId\) return profileById\.get\(item\.actorId\)/,
    "v1 rows with a null actor kind must stay unknown even when an immutable actor id remains",
  );
  assert.doesNotMatch(timelineSource, /<Input|<Textarea|onEdit|onDelete|onAssignee|onDueDate|onDueAt/);
  assert.doesNotMatch(timelineSource, /수정|삭제|담당자 변경|예정일 변경|마감일 변경/);
  assert.match(canonicalDetailSource, /<RegistrationApplication/);
  assert.doesNotMatch(canonicalDetailSource, /selectedTaskFresh\.events\.map/);
  assert.match(
    workspaceSource,
    /selectedTaskFresh\.type !== "registration" && selectedTaskFresh\.type !== "word_retest" && !isProcessDetail && \([\s\S]*?selectedTaskFresh\.events\.map/,
    "the generic event renderer stays inside an outer branch that excludes registration",
  );
});

test("committed initial visit notifications expose an in-session notification-only retry", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const retryStart = source.indexOf("async function retryPendingRegistrationVisitNotifications")
  const retryEnd = source.indexOf("\n  }", retryStart) + 4
  const retrySource = source.slice(retryStart, retryEnd)

  assert.ok(retryStart >= 0, "notification-only retry handler should exist")
  assertIncludesAll(source, [
    "pendingRegistrationVisitNotificationTargets",
    "setPendingRegistrationVisitNotificationTargets",
    "dispatchRegistrationVisitNotificationTargets",
    "방문상담 알림 재시도",
  ])
  assert.match(
    source,
    /\{\(notice \|\| pendingRegistrationVisitNotificationTargets\.length > 0\) && !detailOpen && registrationApplicationHost\.kind === "closed" && \(/,
    "the list-level retry alert must remain visible even after another action clears notice",
  )
  assert.match(
    source,
    /\{\(notice \|\| pendingRegistrationVisitNotificationTargets\.length > 0\) && \([\s\S]*?notice \|\| `방문상담 알림 \$\{pendingRegistrationVisitNotificationTargets\.length\}건/,
    "the detail-level retry alert must render a fallback message without notice",
  )
  assert.doesNotMatch(
    source,
    /\{notice && !detailOpen && \([\s\S]*?pendingRegistrationVisitNotificationTargets\.length > 0/,
  )
  assert.match(retrySource, /dispatchRegistrationVisitNotificationTargets/)
  assert.match(
    retrySource,
    /setPendingRegistrationVisitNotificationTargets\(\(current\) => \([\s\S]*?reconcileRegistrationVisitNotificationRetryTargets\([\s\S]*?current[\s\S]*?retryTargets[\s\S]*?result\.failedTargets/,
    "retry completion must reconcile against current targets so concurrent failures survive",
  )
  assertIncludesAll(retrySource, [
    "registrationVisitNotificationRetryGenerationRef.current",
    "latestWorkspaceViewerIdRef.current !== retryViewerId",
    "workspaceMountedRef.current",
  ])
  assert.doesNotMatch(retrySource, /createRegistrationCaseWithInitialWorkflow|createRegistrationCase\(|createOpsTask\(/)

  const viewerResetSource = source.slice(
    source.indexOf("if (viewerChanged)"),
    source.indexOf("const loadOptions", source.indexOf("if (viewerChanged)")),
  )
  assertIncludesAll(viewerResetSource, [
    "workspaceViewerGenerationRef.current += 1",
    "registrationVisitNotificationRetryGenerationRef.current += 1",
    "registrationVisitNotificationRetryInFlightRef.current = false",
    "setPendingRegistrationVisitNotificationTargets([])",
    "setRetryingRegistrationVisitNotifications(false)",
  ])

  const atomicStart = source.indexOf('if (createAttempt.writer === "atomic")')
  const atomicEnd = source.indexOf("const inquiryOnlyPayload", atomicStart)
  const atomicSource = source.slice(atomicStart, atomicEnd)
  assertInOrder(atomicSource, [
    "createRegistrationCaseWithInitialWorkflow",
    "registrationCreateAttemptRef.current === createAttempt",
    "registrationCreateAttemptRef.current = null",
    "dispatchRegistrationVisitNotificationTargets",
    "registrationSubmissionStillOwnsWorkspace",
    "setPendingRegistrationVisitNotificationTargets",
  ])
  assert.match(
    source,
    /const registrationSubmissionStillOwnsWorkspace = \(\) => isRegistrationSubmissionOwnershipCurrent\(\{[\s\S]*?mounted: workspaceMountedRef\.current[\s\S]*?currentViewerId: latestWorkspaceViewerIdRef\.current[\s\S]*?currentViewerGeneration: workspaceViewerGenerationRef\.current/,
    "post-commit ownership must be evaluated from live refs rather than cached before an await",
  )
  assert.doesNotMatch(atomicSource, /const notificationStateBelongsToSubmissionViewer/)
  assert.match(source, /const submissionViewerId = currentUserId[\s\S]*?const submissionViewerGeneration = workspaceViewerGenerationRef\.current/)
})

test("post-commit registration work rejects a viewer generation change during notification delay", async () => {
  const isCurrent = registrationNotificationModel.isRegistrationSubmissionOwnershipCurrent;
  assert.equal(typeof isCurrent, "function", "production must expose the ownership predicate consumed by the workspace");

  const snapshot = { viewerId: "viewer-a", generation: 7 };
  const live = { mounted: true, viewerId: "viewer-a", generation: 7 };
  assert.equal(isCurrent({
    mounted: live.mounted,
    submissionViewerId: snapshot.viewerId,
    submissionViewerGeneration: snapshot.generation,
    currentViewerId: live.viewerId,
    currentViewerGeneration: live.generation,
  }), true, "the unchanged submission still owns its workspace generation");
  let releaseNotification;
  const notificationDelay = new Promise((resolve) => {
    releaseNotification = resolve;
  });
  const ownsAfterNotification = (async () => {
    await notificationDelay;
    return isCurrent({
      mounted: live.mounted,
      submissionViewerId: snapshot.viewerId,
      submissionViewerGeneration: snapshot.generation,
      currentViewerId: live.viewerId,
      currentViewerGeneration: live.generation,
    });
  })();

  live.generation += 1;
  releaseNotification();
  assert.equal(await ownsAfterNotification, false, "a delayed completion cannot own a newer viewer generation");
  assert.equal(isCurrent({
    mounted: true,
    submissionViewerId: snapshot.viewerId,
    submissionViewerGeneration: snapshot.generation,
    currentViewerId: "viewer-b",
    currentViewerGeneration: snapshot.generation,
  }), false, "matching generations cannot cross viewer identities");

  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const submitStart = source.indexOf("const submitForm = async");
  const submitEnd = source.indexOf("\n  const handleFormKeyDown", submitStart);
  const submit = source.slice(submitStart, submitEnd);
  const atomicStart = submit.indexOf('if (createAttempt.writer === "atomic")');
  const atomicEnd = submit.indexOf("const inquiryOnlyPayload", atomicStart);
  const atomic = submit.slice(atomicStart, atomicEnd);
  const canonicalStart = submit.indexOf('if (createAttempt.writer === "canonical")');
  const canonicalEnd = submit.indexOf('if (createAttempt.writer === "legacy")', canonicalStart);
  const canonical = submit.slice(canonicalStart, canonicalEnd);

  assert.match(submit, /const submissionRegistrationNotificationSessionToken = registrationNotificationSessionToken/);
  assert.match(submit, /await probeRegistrationInitialPersistence\([\s\S]*?if \(!registrationSubmissionStillOwnsWorkspace\(\)\) return[\s\S]*?setRegistrationPersistence/);
  const dispatchAt = atomic.indexOf("await dispatchRegistrationVisitNotificationTargets");
  const postDispatchGuardAt = atomic.indexOf("if (!registrationSubmissionStillOwnsWorkspace()) return", dispatchAt);
  const retryStateAt = atomic.indexOf("setPendingRegistrationVisitNotificationTargets", dispatchAt);
  const atomicRehydrateAt = atomic.indexOf("await rehydrateCommittedRegistrationCase(committed)");
  assert.ok(dispatchAt >= 0 && postDispatchGuardAt > dispatchAt, "atomic notification completion must re-check live ownership");
  assert.equal(atomic.indexOf("if (!registrationSubmissionStillOwnsWorkspace()) return"), postDispatchGuardAt, "atomic delivery must not be skipped when ownership changes after commit");
  assert.ok(retryStateAt > postDispatchGuardAt, "stale notifications must not write retry state");
  assert.ok(atomicRehydrateAt > postDispatchGuardAt, "stale notifications must not rehydrate an old case");
  assert.match(atomic, /\} catch \{\s*if \(!registrationSubmissionStillOwnsWorkspace\(\)\) return[\s\S]*?setPendingRegistrationVisitNotificationTargets/);
  assert.match(atomic, /sendRegistrationVisitNotificationTarget\(target, submissionRegistrationNotificationSessionToken\)/);
  assert.match(atomic, /await rehydrateCommittedRegistrationCase\(committed\)\s*if \(!registrationSubmissionStillOwnsWorkspace\(\)\) return/);
  assert.match(canonical, /await createRegistrationCase\([\s\S]*?if \(!registrationSubmissionStillOwnsWorkspace\(\)\) return[\s\S]*?await rehydrateCommittedRegistrationCase\(committed\)\s*if \(!registrationSubmissionStillOwnsWorkspace\(\)\) return/);
  assert.match(submit, /\} catch \(error\) \{\s*if \(!registrationSubmissionStillOwnsWorkspace\(\)\) return\s*setMessage/);
  assert.match(submit, /\} finally \{\s*if \(registrationSubmissionStillOwnsWorkspace\(\)\) setSaving\(false\)\s*\}/);
});

test("registration browser-back closure clears canonical state and restores the link when dirty close is canceled", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const deepLinkStart = source.indexOf("useEffect(() => {\n    if (deleteTarget) return");
  const deepLinkEnd = source.indexOf("\n  function handleDetailOpenChange", deepLinkStart);
  const deepLink = source.slice(deepLinkStart, deepLinkEnd);
  const closeStart = source.indexOf("const closeRegistrationApplicationHost = useCallback");
  const closeEnd = source.indexOf("\n  const requestRegistrationApplicationClose", closeStart);
  const close = source.slice(closeStart, closeEnd);
  const cancelStart = source.indexOf("function cancelFormCloseConfirmation");
  const cancelEnd = source.indexOf("\n  function handleFormOpenChange", cancelStart);
  const cancel = source.slice(cancelStart, cancelEnd);

  assert.doesNotMatch(deepLink, /if \(!deepLinkedTaskId \|\| !data/);
  assert.match(deepLink, /if \(!deepLinkedTaskId\) \{[\s\S]*?\["loading_detail", "detail", "refresh_failed"\]\.includes\(registrationApplicationHost\.kind\)/);
  assert.match(deepLink, /registrationCloseDeepLinkRestoreRef\.current = \{[\s\S]*?taskId: registrationApplicationHost\.taskId[\s\S]*?focusTrackId: registrationApplicationHost\.focusTrackId[\s\S]*?appointmentId: registrationApplicationHost\.appointmentId/);
  assert.match(deepLink, /requestRegistrationApplicationClose\(\)/);
  assertIncludesAll(close, [
    "setSelectedTask(null)",
    "setSelectedRegistrationTrackId(null)",
    "setSelectedRegistrationAppointmentId(null)",
    "setRegistrationCaseDetail(null)",
    'registrationTrackSelectionRef.current = ""',
    "registrationCommittedReceiptRef.current = null",
  ]);
  assert.match(cancel, /registrationCloseDeepLinkRestoreRef\.current[\s\S]*?syncTaskDeepLink\(restoreDeepLink\.taskId, restoreDeepLink\.focusTrackId, restoreDeepLink\.appointmentId\)/);
});

test("committed loading can close while create submission remains protected", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const requestStart = source.indexOf("const requestRegistrationApplicationClose = useCallback");
  const requestEnd = source.indexOf("\n  useEffect(() => {\n    if (deleteTarget) return", requestStart);
  const requestClose = source.slice(requestStart, requestEnd);

  assert.match(requestClose, /if \(saving && registrationApplicationHost\.kind === "create"\) return/);
  assert.doesNotMatch(requestClose, /if \(saving\) return/);
  assert.match(requestClose, /closeRegistrationApplicationHost\(\)/);
});

test("registration host create and detail modes have accessible Radix titles without duplicate visible headings", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const hostStart = source.indexOf("data-registration-application-host");
  const hostEnd = source.indexOf("<Dialog open={workspaceDataBelongsToCurrentViewer && bulkDeleteTargets.length", hostStart);
  const host = source.slice(hostStart, hostEnd);

  assert.match(host, /registrationApplicationHost\.kind === "create"[\s\S]*?<DialogTitle className="sr-only">등록 신청서<\/DialogTitle>[\s\S]*?<RegistrationApplicationCreate/);
  assert.match(host, /registrationApplicationHost\.kind === "detail"[\s\S]*?<DialogTitle className="sr-only">등록 신청서<\/DialogTitle>[\s\S]*?<RegistrationApplication/);
  assert.equal((host.match(/<DialogTitle className="sr-only">등록 신청서<\/DialogTitle>/g) || []).length, 2);
});

test("appointment refresh retry reuses canonical appointment validation and clears stale links", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const resolverStart = source.indexOf("function resolveRegistrationAppointmentFocus");
  const resolverEnd = source.indexOf("\nconst WITHDRAWAL_NOTIFICATION_CHANNELS", resolverStart);
  const resolver = source.slice(resolverStart, resolverEnd);
  const openStart = source.indexOf("const openRegistrationAppointment = useCallback");
  const openEnd = source.indexOf("\n  const openRegistrationCalendarItem", openStart);
  const openAppointment = source.slice(openStart, openEnd);
  const retryStart = source.indexOf("async function retryCommittedRegistrationCaseRefresh");
  const retryEnd = source.indexOf("\n  const postRegistrationAdmissionAction", retryStart);
  const retry = source.slice(retryStart, retryEnd);

  assert.match(resolver, /detail\.appointments\.find/);
  assert.match(resolver, /getRegistrationAppointmentParticipantTrackIds/);
  assert.match(resolver, /preferredTrackId && participantTrackIds\.includes\(preferredTrackId\)/);
  assert.match(openAppointment, /resolveRegistrationAppointmentFocus\(detail, appointmentId, preferredTrackId\)/);
  assert.match(retry, /resolveRegistrationAppointmentFocus\(detail, appointmentId, focusTrackId\)/);
  assert.match(retry, /if \(appointmentId && !appointmentFocus\) \{[\s\S]*?closeRegistrationApplicationHost\(\)[\s\S]*?예약 정보가 변경되었습니다\. 등록 달력을 다시 확인하세요\.[\s\S]*?return/);
  assert.doesNotMatch(retry, /appointmentTrackIds\[0\] \|\| detail\.tracks\[0\]/);
});

test("canonical registration host owns notification and error live regions without list duplicates", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");

  assert.match(source, /\{\(notice \|\| pendingRegistrationVisitNotificationTargets\.length > 0\) && !detailOpen && registrationApplicationHost\.kind === "closed" && \(/);
  assert.match(source, /\{message && !formOpen && !detailOpen && registrationApplicationHost\.kind === "closed" && <div role="alert"/);
  assert.match(source, /registrationApplicationHost\.kind === "detail"[\s\S]*?pendingRegistrationVisitNotificationTargets\.length > 0[\s\S]*?retryPendingRegistrationVisitNotifications/);
});

test("registration application rows retain every subject during class sync", async () => {
  const [workspaceSource, serviceSource, caseListSource] = await Promise.all([
    readSource("src/features/tasks/ops-task-workspace.tsx"),
    readSource("src/features/tasks/ops-task-service.ts"),
    readSource("src/features/tasks/registration-case-list.tsx"),
  ]);

  assertIncludesAll(workspaceSource, [
    "buildRegistrationCaseListItems(scopedTasks)",
    "filterRegistrationCaseListItems(registrationCaseItems, registrationView, deferredQuery)",
    'form.type !== "registration" || !form.subject',
  ]);
  assertIncludesAll(caseListSource, [
    "item.tracks.map",
    "item.matchingTracks.map",
    "item.representativeTrack.trackId",
    "track.trackId",
    "track.subject",
  ]);
  assertIncludesAll(serviceSource, [
    "assertRegistrationInquiryBaseReady",
    "assertRegistrationInquiryBaseReady(input)",
  ]);
  assert.match(
    serviceSource,
    /subject: text\(input\.subject\) \|\| text\(classRow\?\.subject\) \|\| null/,
  );
});

test("registration required inquiry fields remain invariant after the workflow advances", async () => {
  const [workspaceSource, serviceSource] = await Promise.all([
    readSource("src/features/tasks/ops-task-workspace.tsx"),
    readSource("src/features/tasks/ops-task-service.ts"),
  ]);

  assert.match(
    workspaceSource,
    /const registrationCreateBlockers = submissionForm\.type === "registration"\s*\? getRegistrationCreateBlockers\(submissionForm\)\s*:\s*\[\]/,
  );
  assert.match(
    serviceSource,
    /function assertRegistrationInquiryBaseReady\(input: OpsTaskInput\)/,
  );
  assert.match(serviceSource, /assertRegistrationInquiryBaseReady\(input\)/);
  assert.doesNotMatch(
    serviceSource,
    /assertRegistrationInquiryBaseReady\(input, existingTask\.registration\?\.pipelineStatus/,
  );
});

test("registration resolves and edits directors per subject in the canonical initial plan", async () => {
  const [workspaceSource, createSource, initialPlanSource] = await Promise.all([
    readSource("src/features/tasks/ops-task-workspace.tsx"),
    readSource("src/features/tasks/registration-application-create.tsx"),
    readSource("src/features/tasks/registration-initial-plan-control.tsx"),
  ]);

  assertIncludesAll(workspaceSource, [
    'from "./registration-application-create"',
    "registrationResolvedDirectorIds",
    "subjects: [subject]",
    "<RegistrationApplicationCreate",
  ]);
  assertIncludesAll(createSource, [
    "resolvedDirectorIds,",
    "directorOptionsBySubject,",
  ]);
  assertIncludesAll(initialPlanSource, [
    "orderedSubjects.map((subject)",
    "draft.directorOverrides[subject] || resolvedDirectorId",
    "directorOptionsBySubject[subject]",
    "[subject]: event.target.value",
    "`${subject} 상담 책임자`",
  ]);
  assert.doesNotMatch(workspaceSource, /function handleRegistrationCounselorChange/);
});

test("registration form actions remain in normal flow and wrap safely on narrow screens", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  assert.match(source, /const formActionBarClassName = "-mx-6 -mb-6[^"\n]*"/);
  assert.match(source, /className=\{formActionBarClassName\}/);
  assert.doesNotMatch(source, /form\.type === "registration" \? "sticky bottom-0/);
  assert.match(source, /form\.type === "registration" \? "scroll-pb-24 sm:max-w-4xl" : "scroll-pb-24"/);
  assert.match(source, /form\.type === "registration" \? "h-auto min-h-9 whitespace-normal" : ""/);
  assert.match(source, /form\.type === "registration" \? "break-words text-center leading-tight" : "truncate"/);
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

test("operation forms keep staged linked selectors outside canonical registration intake", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const formDialogSource = source.slice(
    source.indexOf("<Dialog open={workspaceDataBelongsToCurrentViewer && formOpen}"),
    source.indexOf("<Dialog open={workspaceDataBelongsToCurrentViewer && detailOpen}"),
  );

  assertIncludesAll(source, [
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
    wordRetestScopeSource.indexOf('label="출제 개수"') < wordRetestScopeSource.indexOf('label="커트라인(합격 개수)"'),
    "word retest scope fields should place total question count before cutoff count",
  );
});

test("withdrawal workspace follows request processing and completed queues", async () => {
  const [source, googleChatRouteSource] = await Promise.all([
    readSource("src/features/tasks/ops-task-workspace.tsx"),
    readSource("src/app/api/google-chat/route.ts"),
  ]);
  const withdrawalDataTableSource = source.slice(
    source.indexOf("function WithdrawalResizableHeaderCell"),
    source.indexOf("function DashboardMetric"),
  );
  const withdrawalPeriodFilterSource = source.slice(
    source.indexOf("function WithdrawalPeriodFilterBar"),
    source.indexOf("function WithdrawalResizableHeaderCell"),
  );
  const detailDialogSource = source.slice(
    source.indexOf("<Dialog open={workspaceDataBelongsToCurrentViewer && detailOpen}"),
    source.indexOf("<Dialog open={Boolean(deleteTarget)}"),
  );
  const withdrawalWorkspaceToolbarSource = source.slice(
    source.indexOf('aria-label={isTodoWorkspace ? "할 일 목록"'),
    source.indexOf("{isTodoWorkspace && ("),
  );
  const formDialogSource = source.slice(
    source.indexOf("<Dialog open={workspaceDataBelongsToCurrentViewer && formOpen}"),
    source.indexOf("<Dialog open={workspaceDataBelongsToCurrentViewer && detailOpen}"),
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
  const withdrawalNotificationDialogSource = source.slice(
    source.indexOf("function WithdrawalNotificationSettingsDialog"),
    source.indexOf("function TransferNotificationSettingsDialog"),
  );
  const notificationDialogWrappersSource = source.slice(
    source.indexOf("function TransferNotificationSettingsDialog"),
    source.indexOf("function RegistrationCustomerMessageDialog"),
  );

  assertIncludesAll(source, [
    'type WithdrawalViewKey = "applicant" | "operations" | "closed"',
    'type WithdrawalPeriodFilter = "all" | "today" | "week" | "month" | "custom"',
    "type WithdrawalTableColumnKey",
    "WITHDRAWAL_VIEW_TABS",
    "WITHDRAWAL_NOTIFICATION_CHANNELS",
    "WITHDRAWAL_GOOGLE_CHAT_CHANNEL_MAP",
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
  assertIncludesAll(withdrawalNotificationDialogSource, [
    'data-testid="task-notification-settings-containment"',
    "공통 알림 설정 저장 기능이 적용될 때까지 알림 켜기/끄기와 내용 편집은 사용할 수 없습니다.",
    'data-testid="task-notification-webhook-connection"',
    'aria-label="구글챗 · 관리팀 웹훅 관리"',
    'handleOpenWithdrawalWebhookInfo("google_chat_admin")',
    "웹훅 URL 수정",
    "handleOpenWithdrawalWebhookInfo",
    "handleSaveWithdrawalWebhookInfo",
    "selectedWebhookInfo",
    "webhookUrlInput",
    "/api/google-chat?channel=",
    'method: "PATCH"',
    "웹훅 URL 저장",
    "onClick={() => onOpenChange(false)}",
    "닫기",
  ]);
  assert.doesNotMatch(withdrawalNotificationDialogSource, /toggleNotificationSetting|aria-pressed/);
  assert.doesNotMatch(withdrawalNotificationDialogSource, /openWithdrawalNotificationTemplateEditor|selectedNotificationTrigger/);
  assert.doesNotMatch(withdrawalNotificationDialogSource, /알림 내용 수정|withdrawal-notification-title-template|withdrawal-notification-body-template|<Textarea/);
  assert.doesNotMatch(withdrawalNotificationDialogSource, /localStorage|sessionStorage|설정 저장됨|알림 설정을 저장/);
  assert.match(withdrawalNotificationDialogSource, /webhookInfoPanelRef/);
  assert.match(withdrawalNotificationDialogSource, /scrollIntoView\(\{ block: "start" \}\)/);
  assertIncludesAll(notificationDialogWrappersSource, [
    'workflowLabel="전반"',
    'workflowLabel="등록"',
  ]);
  assertIncludesAll(googleChatRouteSource, [
    '.from("google_chat_webhook_settings")',
    'serviceClient.rpc("replace_google_chat_connection_v1"',
    "p_actor: input.actorUserId",
    "p_webhook_url: input.webhookUrl",
    "p_webhook_url_ciphertext: input.webhookUrlCiphertext",
  ]);
  assert.doesNotMatch(googleChatRouteSource, /\.upsert\(/);
  assert.doesNotMatch(source, /NotificationSettings\] = useState<WithdrawalNotificationSetting/);
  assert.doesNotMatch(source, /NotificationTemplates\] = useState<Record<WithdrawalNotificationTriggerKey/);
  assert.match(source, /async function dispatchLegacyOpsTaskSources/);
  assert.doesNotMatch(source, /set(?:Withdrawal|Transfer|Registration)Notification(?:Settings|Templates)/);
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
    /<Button type="submit" disabled=\{saving \|\| \(!canSubmitCurrentForm && form\.type !== "registration"\)\} className="w-full sm:w-auto">/,
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
  assert.doesNotMatch(source, /notifyWithdrawalWorkflow|sendWithdrawalGoogleChatNotification/);
  assert.match(source, /async function dispatchLegacyOpsTaskSources/);
  assert.match(
    source,
    /const receipt = createPayload\.type === "transfer" \|\| createPayload\.type === "withdrawal"[\s\S]*createOpsTransitionTask\(createPayload\)[\s\S]*legacyOpsTaskSourceEventIds\.push\(\.\.\.receipt\.sourceEventIds\)/,
    "new withdrawal applications should dispatch only the server-issued source event ID",
  );
  assert.match(
    source,
    /const receipt = await updateOpsTaskStatus\(task, status\)[\s\S]*dispatchLegacyOpsTaskSources\([\s\S]*receipt\.sourceEventIds/,
    "withdrawal status changes should dispatch only the server-issued source event IDs",
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
    source.indexOf("<Dialog open={workspaceDataBelongsToCurrentViewer && formOpen}"),
    source.indexOf("<Dialog open={workspaceDataBelongsToCurrentViewer && detailOpen}"),
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
    source.indexOf("<Dialog open={workspaceDataBelongsToCurrentViewer && detailOpen}"),
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
    "dispatchLegacyOpsTaskSources",
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
    "async function readOpsClassRows(taskType?: OpsTaskType)",
    "readOpsClassRows(options.taskType)",
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
    "notificationSessionToken,",
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
    "커트라인(합격 개수)",
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
    'runIdempotentOpsTaskProducerRpc("cleanup_created_ops_task_v1"',
    "p_expected_created_at: expectedCreatedAt",
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
    "transition_ops_task_status_v2",
  ]);
  assert.doesNotMatch(
    serviceSource,
    /writeEvent\(currentTask\.id, \"status_changed\", \"status\", currentTask\.status, status\)/,
  );

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
  assertIncludesAll(commentSource, [
    "const task = await loadOpsTaskById(taskId)",
    "if (!task) throw new Error(\"업무 데이터를 다시 불러오세요.\")",
    "runIdempotentOpsTaskProducerRpc(\"add_ops_task_comment_v2\"",
    "producerCommentSourceId(response, commentId)",
  ]);
  assertIncludesAll(attachmentSource, [
    "await assertOpsTaskExists(taskId)",
    "if (error) throwIfMissingOpsTaskReference(error)",
  ]);
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
    "<Button type=\"submit\" disabled={saving || (!canSubmitCurrentForm && form.type !== \"registration\")} className=\"w-full sm:w-auto\">",
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

test("browser workflow scripts target the operation surfaces", async () => {
  const [workspaceSource, serviceSource, scriptSource, sampleScriptSource] = await Promise.all([
    readSource("src/features/tasks/ops-task-workspace.tsx"),
    readSource("src/features/tasks/ops-task-service.ts"),
    readSource("scripts/verify-ops-task-browser-workflow.mjs"),
    readSource("scripts/verify-ops-task-sample-workflow.mjs"),
  ]);

  assert.equal(
    await pathExists("src/features/tasks/ops-task-dashboard-summary.tsx"),
    false,
  );
  assert.doesNotMatch(
    serviceSource,
    /OpsTodoDashboardSummaryData|loadOpsTodoDashboardSummaryData/,
  );

  assertIncludesAll(serviceSource, [
    "type OpsTaskWorkspaceLoadOptions",
    "getOpsTaskWorkspaceCacheKey",
    "const opsTaskWorkspaceDataCache = new Map",
    "if (options.taskType) taskQuery = taskQuery.eq(\"type\", options.taskType)",
    'return readOpsRegistrationParentWorkspaceData(options, metrics)',
    "loadRegistrationTrackSummaries(",
    "registrationTracks: tracksByTaskId.get(task.id) || []",
    "OPS_REGISTRATION_PARENT_LIST_COLUMNS",
    '"ops_registration_details(task_id,pipeline_status,school_grade,school_name,inquiry_at)"',
  ]);

	  assertIncludesAll(workspaceSource, [
	    "getCachedOpsTaskWorkspaceData(workspaceLoadOptions)",
	    "includeProfileOptions: false",
	    "loadOpsTaskWorkspaceData({ ...loadOptions, force })",
	    "loadOpsTaskWorkspaceOptionData({",
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

test("registration create shows locked placement while canonical track editors own enrollment scheduling", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const create = await readSource("src/features/tasks/registration-application-create.tsx");

  assert.match(create, /RegistrationApplicationPlacementSection/);
  assert.match(create, /수업 시작 일정/);
  assert.match(create, /focusKey="classStartDate"/);
  assert.doesNotMatch(create, /classStartSession|fillRegistration/);
  assertIncludesAll(source, ["RegistrationApplication", "admissionActions"]);
});

test("registration canonical editors own class and textbook changes after create omits placement", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const registrationFormStart = source.indexOf('if (form.type === "registration")', source.indexOf("function TypeSpecificFields"));
  const registrationFormSource = source.slice(registrationFormStart, source.indexOf('if (form.type === "withdrawal")', registrationFormStart));

  assertIncludesAll(source, [
    "loadOpsRegistrationClassDetail",
    "registrationClassDetailRequestRef.current += 1",
    "requestToken !== registrationClassDetailRequestRef.current",
    "detail.id !== selectedClassId",
    "registrationClassDetailResult.viewerId === selectedRegistrationViewerId",
    "admissionActions",
  ]);
  assert.doesNotMatch(registrationFormSource, /textbookBillingIssued|registrationTextbookDefaultPendingClassRef|registrationTextbookClearedClassRef/);
});

test("registration completion keeps textbook optional while validating a nonempty linked textbook", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const blockerSource = source.slice(
    source.indexOf("function getOperationCompletionBlockers"),
    source.indexOf("function getTaskCompletionBlockers"),
  );

  assert.match(blockerSource, /if \(!String\(input\.registration\?\.classStartSession/);
  assert.doesNotMatch(blockerSource, /if \(!hasLinkedRecord\(input\.textbookId\)\) blockers\.push\("교재"\)/);
  assert.match(blockerSource, /if \(hasLinkedRecord\(input\.textbookId\) && !findTextbookOption/);
});

test("registration admission checklist remains chronological and visible but locked in create", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const create = await readSource("src/features/tasks/registration-application-create.tsx");
  const checklistStart = source.indexOf("function getRegistrationOperationsChecklist(");
  const checklistSource = source.slice(
    checklistStart,
    source.indexOf("function getRegistrationOperationsChecklistValue", checklistStart),
  );
  const detailStart = source.indexOf("function RegistrationDetailPanel");
  const registrationDetailSource = source.slice(detailStart, source.indexOf("function WithdrawalDetailPanel", detailStart));
  const summaryStart = source.indexOf('if (task.type === "registration" && task.registration)');
  const registrationSummarySource = source.slice(summaryStart, source.indexOf('if (task.type === "withdrawal"', summaryStart));
  const orderedLabels = [
    "입학신청서 발송",
    "메이크에듀 등록(수업, 교재)",
    "청구서 발송",
    "수납 완료 확인",
    "등록 완료",
  ];

  assertInOrder(checklistSource, orderedLabels);
  assert.match(checklistSource, /getRegistrationPipelinePrefix\(registration\?\.pipelineStatus\) === "7\."/);
  assert.doesNotMatch(checklistSource, /textbookBillingIssued|textbookReady|timetableRosterUpdated|교재 청구출고표|교재 준비|수업시간표 명단/);
  assertInOrder(create, orderedLabels);
  assert.match(create, /RegistrationApplicationAdmissionSection/);
  assert.doesNotMatch(registrationDetailSource, /<Info label="교재 준비"|textbookBillingIssued/);
  assertInOrder(registrationSummarySource, orderedLabels);
  assert.doesNotMatch(registrationSummarySource, /autoItems=|textbookBillingIssued|교재 청구출고표|교재 준비|수업시간표 명단/);
});

test("registration form saves common edits through the canonical common writer", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const submitStart = source.indexOf("const submitForm = async");
  const editStart = source.indexOf("if (editingTask)", submitStart);
  const editSource = source.slice(editStart, source.indexOf("} else {", editStart));

  assert.match(editSource, /updateRegistrationCaseCommon/);
  assert.doesNotMatch(editSource, /updateOpsTask\(editingTask\.id, payload\)/);
});

test("pending registration edits do not re-render or mutate downstream completion controls", async () => {
  const create = await readSource("src/features/tasks/registration-application-create.tsx");

  assertIncludesAll(create, ["RegistrationApplicationInquirySection", "RegistrationInitialRouteFields"]);
  assert.doesNotMatch(create, /getRegistrationChecklistEditorState|completionIntentPipelineStatus|checked=\{registrationChecklistEditorState\.completed\}/);
});

test("registration create blocker focus uses normalized section IDs and exact focus markers", async () => {
  const [workspace, workflow, initialPlan] = await Promise.all([
    readSource("src/features/tasks/ops-task-workspace.tsx"),
    readSource("src/features/tasks/registration-workflow.js"),
    readSource("src/features/tasks/registration-initial-plan-control.tsx"),
  ]);
  const focusSource = workspace.slice(
    workspace.indexOf("function focusRegistrationFormSection"),
    workspace.indexOf("const changeStatus", workspace.indexOf("function focusRegistrationFormSection")),
  );

  assert.match(workspace, /getRegistrationBlockerSection/);
  assert.match(focusSource, /getRegistrationBlockerSection\(blocker\)/);
  assert.match(focusSource, /registration-application-\$\{sectionKey\}/);
  assert.match(focusSource, /\[data-registration-focus="\$\{focusKey\}"\]/);
  assert.match(focusSource, /focusTarget \|\| section/);
  assert.match(workflow, /counselor:\$\{subjectCounselor\[1\]\}/);
  assert.match(initialPlan, /data-registration-focus=\{`counselor:\$\{subject\}`\}/);
});

test("registration dirty aggregation drives the application host close guard", async () => {
  const workspace = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const application = await readSource("src/features/tasks/registration-track-editor.tsx");

  assert.match(application, /onDirtyChange\?: \(dirty: boolean\) => void/);
  assert.match(application, /dirtyKeysRef/);
  assert.match(workspace, /registrationApplicationHost\.kind === "detail" && registrationApplicationDirty/);
  assert.match(workspace, /setConfirmingFormClose\(true\)/);
});

test("canonical registration writers rehydrate their committed receipt in the same host", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const atomicStart = source.indexOf('if (createAttempt.writer === "atomic")');
  const atomicEnd = source.indexOf("const inquiryOnlyPayload", atomicStart);
  const atomic = source.slice(atomicStart, atomicEnd);
  const canonicalStart = source.indexOf('if (createAttempt.writer === "canonical")');
  const canonicalEnd = source.indexOf('if (createAttempt.writer === "legacy")', canonicalStart);
  const canonical = source.slice(canonicalStart, canonicalEnd);

  assert.match(source, /type RegistrationCommittedReceipt = \{[\s\S]*?taskId: string[\s\S]*?tracks:/);
  assert.match(source, /const rehydrateCommittedRegistrationCase = useCallback/);
  assert.match(source, /setRegistrationApplicationHost\(\{[\s\S]*?kind: "loading_detail"/);
  assert.match(source, /loadRegistrationCaseForWorkspace\(committed\.taskId, true\)/);
  assert.match(source, /const focusTrackId = detail\.tracks\.find\(/);
  assert.match(source, /committed\.tracks\.some\(\(created\) => created\.id === track\.id\)/);
  assert.match(source, /setRegistrationApplicationHost\(\{[\s\S]*?kind: "detail"[\s\S]*?taskId: detail\.task\.id/);
  assert.match(source, /syncTaskDeepLink\(detail\.task\.id, focusTrackId\)/);
  const rehydrateStart = source.indexOf("const rehydrateCommittedRegistrationCase = useCallback");
  const rehydrateEnd = source.indexOf("\n  const openDetail", rehydrateStart);
  const rehydrate = source.slice(rehydrateStart, rehydrateEnd);
  assert.doesNotMatch(rehydrate, /setFormOpen\(false\)/);

  for (const branch of [atomic, canonical]) {
    assert.match(branch, /if \(registrationCreateAttemptRef\.current === createAttempt\) \{\s*registrationCreateAttemptRef\.current = null\s*\}/);
    assert.match(branch, /registrationCreateAttemptRef\.current = null/);
    assert.match(branch, /const committed: RegistrationCommittedReceipt = \{/);
    assert.match(branch, /await rehydrateCommittedRegistrationCase\(committed\)/);
    assert.doesNotMatch(branch, /setFormOpen\(false\)/);
    assert.doesNotMatch(branch, /savedTasks\.push/);
  }
  assert.match(atomic, /dispatchRegistrationVisitNotificationTargets\(\s*response\.notificationTargets/);
  assert.match(atomic, /try \{[\s\S]*?dispatchRegistrationVisitNotificationTargets[\s\S]*?\} catch \{[\s\S]*?setPendingRegistrationVisitNotificationTargets/);
  assert.match(atomic, /\} catch \{[\s\S]*?await rehydrateCommittedRegistrationCase\(committed\)/);
  assert.doesNotMatch(canonical, /notificationTargets|dispatchRegistrationVisitNotificationTargets/);
});

test("post-commit refresh failure is load-only and remains in the registration host", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const helperStart = source.indexOf("const rehydrateCommittedRegistrationCase = useCallback");
  const helperEnd = source.indexOf("\n  const openDetail", helperStart);
  const helper = source.slice(helperStart, helperEnd);
  const retryStart = source.indexOf("function retryCommittedRegistrationCaseRefresh");
  const retryEnd = source.indexOf("\n  const postRegistrationAdmissionAction", retryStart);
  const retry = source.slice(retryStart, retryEnd);

  assert.match(helper, /kind: "refresh_failed"/);
  assert.match(helper, /저장은 완료됐지만 최신 내용을 불러오지 못했습니다/);
  assert.match(retry, /loadRegistrationCaseForWorkspace/);
  assert.doesNotMatch(retry, /createRegistrationCaseWithInitialWorkflow|createRegistrationCase\(|createOpsTask\(|requestKey/);
  assert.match(source, /registrationApplicationHost\.kind === "refresh_failed"[\s\S]*?최신 내용 다시 불러오기/);
  assert.match(source, /registrationApplicationHost\.kind === "refresh_failed"[\s\S]*?requestRegistrationApplicationClose/);
});

test("generic form and detail dialogs exclude canonical registration application modes", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const genericFormStart = source.indexOf("<Dialog open={workspaceDataBelongsToCurrentViewer && formOpen");
  const genericDetailStart = source.indexOf("<Dialog open={workspaceDataBelongsToCurrentViewer && detailOpen");
  const hostStart = source.indexOf("data-registration-application-host");
  const genericForm = source.slice(genericFormStart, genericDetailStart);
  const genericDetail = source.slice(genericDetailStart, hostStart);

  assert.match(source, /\{registrationApplicationHost\.kind === "closed" \? \(\s*<Dialog open=\{workspaceDataBelongsToCurrentViewer && formOpen\}/);
  assert.match(source, /\{registrationApplicationHost\.kind === "closed" \? \(\s*<Dialog open=\{workspaceDataBelongsToCurrentViewer && detailOpen\}/);
  assert.doesNotMatch(genericForm, /data-registration-application-host/);
  assert.doesNotMatch(genericDetail, /data-registration-application-host/);
  assert.equal((source.match(/data-registration-application-host/g) || []).length, 1);
});
