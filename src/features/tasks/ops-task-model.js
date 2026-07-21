const CLOSED_STATUSES = new Set(["done", "canceled"]);

export const OPS_TASK_TYPES = [
  { value: "registration", label: "등록" },
  { value: "withdrawal", label: "퇴원" },
  { value: "transfer", label: "전반" },
  { value: "word_retest", label: "영어 단어 재시험" },
  { value: "textbook", label: "교재" },
  { value: "general", label: "일반" },
];

export const OPS_TASK_STATUSES = [
  { value: "requested", label: "요청" },
  { value: "confirmed", label: "확인" },
  { value: "in_progress", label: "진행" },
  { value: "review_requested", label: "검토 요청" },
  { value: "done", label: "완료" },
  { value: "on_hold", label: "보류" },
  { value: "canceled", label: "취소" },
];

export const OPS_TASK_PRIORITIES = [
  { value: "low", label: "낮음" },
  { value: "normal", label: "보통" },
  { value: "high", label: "높음" },
  { value: "urgent", label: "긴급" },
];

export const WORD_RETEST_STATUSES = [
  { value: "not_started", label: "시작 전" },
  { value: "in_progress", label: "진행 중" },
  { value: "absent", label: "미응시" },
  { value: "done", label: "완료" },
];

export const REGISTRATION_PIPELINE_STATUSES = [
  { value: "0. 등록 문의", label: "0. 등록 문의" },
  { value: "1. 레벨테스트 예약", label: "1. 레벨테스트 예약" },
  { value: "1-1. 레벨테스트 완료", label: "1-1. 레벨테스트 결과" },
  { value: "2. 상담 예약", label: "2. 상담 예약" },
  { value: "3. 상담 완료", label: "3. 상담 결과" },
  { value: "4-1. 현재반 대기 신청", label: "4-1. 현재 학기 수강반 대기" },
  { value: "4-2. 신규반 대기 신청", label: "4-2. 현재 학기 개강반 대기" },
  { value: "4-3. 다음 개강 알림 요청", label: "4-3. 다음 학기 개강반 대기" },
  { value: "5. 입학 등록 결정", label: "5. 입학 등록 결정" },
  { value: "5-1. 입학신청서 발송 완료", label: "5-1. 입학신청서 발송 완료" },
  { value: "6. 수납 확인", label: "6. 수납 확인" },
  { value: "7. 등록 완료", label: "7. 등록 완료" },
  { value: "8. 미등록", label: "8. 미등록 완료" },
  { value: "9. 문의만", label: "9. 문의 완료" },
];

export function getTaskTypeLabel(value) {
  return OPS_TASK_TYPES.find((item) => item.value === value)?.label || "일반";
}

export function getTaskStatusLabel(value) {
  return OPS_TASK_STATUSES.find((item) => item.value === value)?.label || "요청";
}

export function getTaskPriorityLabel(value) {
  return OPS_TASK_PRIORITIES.find((item) => item.value === value)?.label || "보통";
}

export function isClosedOpsTask(task = {}) {
  return CLOSED_STATUSES.has(String(task.status || ""));
}

function text(value) {
  return String(value || "").trim();
}

const ACTION_ASSIGNEE_STATUSES = new Set(["requested", "confirmed", "in_progress", "on_hold"]);
const ACTION_REQUESTER_STATUSES = new Set(["review_requested"]);
const WORD_RETEST_ASSISTANT_ACTION_STATUSES = new Set(["requested", "confirmed", "in_progress", "on_hold"]);
const WORD_RETEST_TEACHER_ACTION_STATUSES = new Set(["review_requested"]);
const WORD_RETEST_SCORE_ENTRY_STATUSES = new Set(["requested", "confirmed", "in_progress", "on_hold"]);
const WORD_RETEST_SCORE_FIELDS = [
  ["firstScore", "first_score"],
  ["secondScore", "second_score"],
  ["thirdScore", "third_score"],
  ["scoreOutOf100", "score_out_of_100"],
];

export const OPS_TASK_WORKFLOW_STATUS_ORDER = [
  "requested",
  "confirmed",
  "in_progress",
  "review_requested",
  "done",
  "on_hold",
  "canceled",
];

function normalizedUserContext(context = {}) {
  return {
    currentUserId: text(context.currentUserId),
    currentUserLabel: text(context.currentUserLabel),
    currentUserTeam: text(context.currentUserTeam),
  };
}

function matchesIdentity(ids, labels, context = {}) {
  const { currentUserId, currentUserLabel } = normalizedUserContext(context);
  const safeIds = ids.map(text).filter(Boolean);
  if (currentUserId && safeIds.includes(currentUserId)) return true;

  const safeLabels = labels.map(text).filter(Boolean);
  return Boolean(currentUserLabel && safeLabels.includes(currentUserLabel));
}

function matchesTeam(teams, context = {}) {
  const { currentUserTeam } = normalizedUserContext(context);
  if (!currentUserTeam) return false;
  return teams.map(text).filter(Boolean).includes(currentUserTeam);
}

function matchesRequester(task = {}, context = {}) {
  return matchesIdentity(
    [task.requestedBy, task.requested_by],
    [task.requestedByLabel, task.requested_by_label],
    context,
  ) || matchesTeam([task.requestedTeam, task.requested_team], context);
}

function matchesAssignee(task = {}, context = {}) {
  return matchesIdentity(
    [
      task.assigneeId,
      task.assignee_id,
      task.secondaryAssigneeId,
      task.secondary_assignee_id,
    ],
    [
      task.assigneeLabel,
      task.assignee_label,
      task.secondaryAssigneeLabel,
      task.secondary_assignee_label,
    ],
    context,
  ) || matchesTeam([task.assigneeTeam, task.assignee_team], context);
}

export function isOpsTaskInUserInbox(task = {}, context = {}) {
  if (isClosedOpsTask(task)) return false;
  const status = text(task.status || "requested");
  if (ACTION_REQUESTER_STATUSES.has(status)) return matchesRequester(task, context);
  if (ACTION_ASSIGNEE_STATUSES.has(status)) return matchesAssignee(task, context);
  return false;
}

export function isOpsTaskInUserSent(task = {}, context = {}) {
  if (isClosedOpsTask(task)) return false;
  const status = text(task.status || "requested");
  if (ACTION_REQUESTER_STATUSES.has(status)) return matchesAssignee(task, context);
  if (ACTION_ASSIGNEE_STATUSES.has(status)) return matchesRequester(task, context);
  return false;
}

function getWordRetestDetail(task = {}) {
  return task.wordRetest || task.word_retest || {};
}

function wordRetestScoreValue(detail = {}, [camelKey, snakeKey]) {
  const value = detail[camelKey] ?? detail[snakeKey];
  return value === null || value === undefined ? "" : String(value).trim();
}

function hasNewOrChangedWordRetestScore(currentDetail = {}, inputDetail = {}) {
  return WORD_RETEST_SCORE_FIELDS.some((field) => {
    const nextValue = wordRetestScoreValue(inputDetail, field);
    return nextValue !== "" && nextValue !== wordRetestScoreValue(currentDetail, field);
  });
}

export function getWordRetestScoreSavePlan(task = {}, input = {}) {
  if (text(task.type) !== "word_retest" || text(input.type) !== "word_retest") {
    return { requiresStartTransition: false, input };
  }

  const currentStatus = text(task.status || "requested");
  const inputStatus = text(input.status || currentStatus);
  const currentDetail = getWordRetestDetail(task);
  const inputDetail = getWordRetestDetail(input);
  const currentRetestStatus = text(currentDetail.retestStatus || currentDetail.retest_status || "not_started");
  const inputRetestStatus = text(inputDetail.retestStatus || inputDetail.retest_status || currentRetestStatus);
  const scoreCanStart = hasNewOrChangedWordRetestScore(currentDetail, inputDetail)
    && WORD_RETEST_SCORE_ENTRY_STATUSES.has(currentStatus)
    && WORD_RETEST_SCORE_ENTRY_STATUSES.has(inputStatus)
    && !["absent", "done"].includes(currentRetestStatus)
    && !["absent", "done"].includes(inputRetestStatus);

  if (!scoreCanStart) return { requiresStartTransition: false, input };

  return {
    requiresStartTransition: currentStatus !== "in_progress" || currentRetestStatus !== "in_progress",
    input: {
      ...input,
      status: "in_progress",
      completedAt: "",
      wordRetest: {
        ...inputDetail,
        retestStatus: "in_progress",
      },
    },
  };
}

function matchesWordRetestTeacher(task = {}, context = {}) {
  const detail = getWordRetestDetail(task);
  return matchesIdentity(
    [detail.teacherId, detail.teacher_id, task.requestedBy, task.requested_by],
    [detail.teacherName, detail.teacher_name, task.requestedByLabel, task.requested_by_label],
    context,
  ) || matchesTeam([task.requestedTeam, task.requested_team], context);
}

export function getWordRetestWorkspaceRole(task = {}) {
  if (text(task.type) !== "word_retest") return "none";
  if (isClosedOpsTask(task)) return "completed";

  const status = text(task.status || "requested");
  if (WORD_RETEST_TEACHER_ACTION_STATUSES.has(status)) return "teacher";
  if (WORD_RETEST_ASSISTANT_ACTION_STATUSES.has(status)) return "assistant";
  return "none";
}

export function isWordRetestInAssistantQueue(task = {}, context = {}) {
  if (getWordRetestWorkspaceRole(task) !== "assistant") return false;
  const normalized = normalizedUserContext(context);
  if (!normalized.currentUserId && !normalized.currentUserLabel && !normalized.currentUserTeam) return true;
  return matchesAssignee(task, context);
}

export function isWordRetestInTeacherQueue(task = {}, context = {}) {
  if (getWordRetestWorkspaceRole(task) !== "teacher") return false;
  const normalized = normalizedUserContext(context);
  if (!normalized.currentUserId && !normalized.currentUserLabel && !normalized.currentUserTeam) return true;
  return matchesWordRetestTeacher(task, context);
}

export function toDateKey(value) {
  if (!value) return "";
  const raw = String(value).trim();
  const match = raw.match(/\d{4}-\d{2}-\d{2}/);
  if (match) return match[0];

  const date = value instanceof Date ? value : new Date(raw);
  if (Number.isNaN(date.getTime())) return "";

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function shouldAutoMarkWordRetestAbsent(task = {}, todayKey = toDateKey(new Date())) {
  if (text(task.type) !== "word_retest") return false;
  if (!["requested", "confirmed", "on_hold"].includes(text(task.status))) return false;
  const detail = getWordRetestDetail(task);
  if (text(detail.retryOfTaskId || detail.retry_of_task_id)) return false;
  if (text(detail.retestStatus || detail.retest_status || "not_started") !== "not_started") return false;
  const testAt = toDateKey(detail.testAt || detail.test_at || task.dueAt || task.startAt);
  if (!testAt || !todayKey) return false;
  const deadline = new Date(`${testAt}T00:00:00+09:00`);
  deadline.setDate(deadline.getDate() + 7);
  return todayKey > toDateKey(deadline);
}

function taskPrimaryDate(task = {}) {
  return getOpsTaskCalendarItems([task])[0]?.date || "";
}

const TODO_PRIORITY_ORDER = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
};

function taskPriorityOrder(task = {}) {
  const priority = text(task.priority || "normal");
  return Object.prototype.hasOwnProperty.call(TODO_PRIORITY_ORDER, priority) ? TODO_PRIORITY_ORDER[priority] : TODO_PRIORITY_ORDER.normal;
}

function taskDateBucket(task = {}, todayKey = "") {
  const date = taskPrimaryDate(task);
  if (!date) return 3;
  if (date < todayKey) return 0;
  if (date === todayKey) return 1;
  return 2;
}

function compareFallback(left = {}, right = {}) {
  const priorityDiff = taskPriorityOrder(left) - taskPriorityOrder(right);
  if (priorityDiff !== 0) return priorityDiff;

  return String(right.createdAt || right.created_at || right.updatedAt || right.updated_at || "")
    .localeCompare(String(left.createdAt || left.created_at || left.updatedAt || left.updated_at || ""));
}

export function sortOpsTasksByWorkDate(tasks = [], todayKey = toDateKey(new Date())) {
  const safeTodayKey = toDateKey(todayKey);
  return [...(tasks || [])].sort((left, right) => {
    const leftBucket = taskDateBucket(left, safeTodayKey);
    const rightBucket = taskDateBucket(right, safeTodayKey);
    if (leftBucket !== rightBucket) return leftBucket - rightBucket;

    const leftDate = taskPrimaryDate(left);
    const rightDate = taskPrimaryDate(right);
    if (leftDate && rightDate && leftDate !== rightDate) return leftDate.localeCompare(rightDate);

    return compareFallback(left, right);
  });
}

function workflowStatusOrder(task = {}) {
  const status = text(task.status || "requested");
  const index = OPS_TASK_WORKFLOW_STATUS_ORDER.indexOf(status);
  return index === -1 ? OPS_TASK_WORKFLOW_STATUS_ORDER.length : index;
}

export function sortOpsTasksByWorkflowStatus(tasks = [], todayKey = toDateKey(new Date())) {
  return [...(tasks || [])].sort((left, right) => {
    const statusDiff = workflowStatusOrder(left) - workflowStatusOrder(right);
    if (statusDiff !== 0) return statusDiff;
    return sortOpsTasksByWorkDate([left, right], todayKey)[0] === left ? -1 : 1;
  });
}

export function sortOpsTasksByPriority(tasks = [], todayKey = toDateKey(new Date())) {
  return [...(tasks || [])].sort((left, right) => {
    const priorityDiff = taskPriorityOrder(left) - taskPriorityOrder(right);
    if (priorityDiff !== 0) return priorityDiff;
    return sortOpsTasksByWorkDate([left, right], todayKey)[0] === left ? -1 : 1;
  });
}

function addCalendarItem(items, task, kind, value) {
  const date = toDateKey(value);
  if (!date) return;

  items.push({
    id: `${text(task.id)}:${kind}:${date}`,
    taskId: text(task.id),
    title: text(task.title) || "업무",
    taskType: text(task.type),
    status: text(task.status),
    kind,
    date,
  });
}

export function getOpsTaskCalendarItems(tasks = [], { includeClosed = false } = {}) {
  return (tasks || [])
    .flatMap((task) => {
      if (!includeClosed && isClosedOpsTask(task)) return [];

      const items = [];
      if (!task.type || task.type === "general") {
        addCalendarItem(items, task, "시작", task.startAt || task.start_at);
        addCalendarItem(items, task, "마감", task.dueAt || task.due_at);
      } else {
        addCalendarItem(items, task, "예정", task.dueAt || task.due_at);
      }

      if (task.type === "registration") {
        const detail = task.registration || {};
        addCalendarItem(items, task, "문의", detail.inquiryAt || detail.inquiry_at);
        addCalendarItem(items, task, "상담", detail.consultationAt || detail.consultation_at);
        addCalendarItem(items, task, "레벨테스트", detail.levelTestAt || detail.level_test_at);
        addCalendarItem(items, task, "수업 시작", detail.classStartDate || detail.class_start_date);
      }

      if (task.type === "withdrawal") {
        const detail = task.withdrawal || {};
        addCalendarItem(items, task, "퇴원일", detail.withdrawalDate || detail.withdrawal_date);
      }

      if (task.type === "transfer") {
        const detail = task.transfer || {};
        addCalendarItem(items, task, "전 수업 종료", detail.fromClassEndDate || detail.from_class_end_date);
        addCalendarItem(items, task, "후 수업 시작", detail.toClassStartDate || detail.to_class_start_date);
      }

      if (task.type === "word_retest") {
        const detail = task.wordRetest || task.word_retest || {};
        addCalendarItem(items, task, "본시험", detail.testAt || detail.test_at);
      }

      return items;
    })
    .sort((left, right) => (
      left.date.localeCompare(right.date) ||
      left.kind.localeCompare(right.kind, "ko") ||
      left.title.localeCompare(right.title, "ko", { numeric: true })
    ));
}

export function hasOpsTaskCalendarDate(task = {}, dateKey = "") {
  const targetDate = toDateKey(dateKey);
  if (!targetDate || isClosedOpsTask(task)) return false;
  return getOpsTaskCalendarItems([task]).some((item) => item.date === targetDate);
}

export function hasOpsTaskOverdueCalendarDate(task = {}, dateKey = "") {
  const targetDate = toDateKey(dateKey);
  if (!targetDate || isClosedOpsTask(task)) return false;
  return getOpsTaskCalendarItems([task]).some((item) => item.date < targetDate);
}

export function isOpsTaskAssignedToUser(task = {}, currentUserId = "", currentUserLabel = "") {
  const userId = text(currentUserId);
  const userLabel = text(currentUserLabel);
  if (!userId && !userLabel) return false;

  const wordRetest = task.wordRetest || task.word_retest || {};
  const ids = [
    task.assigneeId,
    task.assignee_id,
    task.secondaryAssigneeId,
    task.secondary_assignee_id,
    task.requestedBy,
    task.requested_by,
    wordRetest.teacherId,
    wordRetest.teacher_id,
  ].map(text);

  if (userId && ids.includes(userId)) return true;

  const labels = [
    task.assigneeLabel,
    task.assignee_label,
    task.secondaryAssigneeLabel,
    task.secondary_assignee_label,
    task.requestedByLabel,
    task.requested_by_label,
    wordRetest.teacherName,
    wordRetest.teacher_name,
  ].map(text);

  return Boolean(userLabel && labels.includes(userLabel));
}

export function summarizeOpsTasks(tasks = [], { now = new Date(), currentUserId = "", currentUserLabel = "" } = {}) {
  const today = toDateKey(now);
  const openTasks = (tasks || []).filter((task) => !isClosedOpsTask(task));

  return {
    todayDue: openTasks.filter((task) => hasOpsTaskCalendarDate(task, today)).length,
    overdue: openTasks.filter((task) => hasOpsTaskOverdueCalendarDate(task, today)).length,
    assignedToMe: openTasks.filter((task) => isOpsTaskAssignedToUser(task, currentUserId, currentUserLabel)).length,
    needsConfirmation: openTasks.filter((task) => text(task.status || "requested") === "requested").length,
  };
}

export function groupOpsTasksByStatus(tasks = []) {
  return OPS_TASK_STATUSES.map((status) => ({
    key: status.value,
    label: status.label,
    tasks: (tasks || []).filter((task) => text(task.status || "requested") === status.value),
  }));
}

export function groupOpsTasksByAssignee(tasks = []) {
  const groups = new Map();

  (tasks || []).forEach((task) => {
    const key = text(task.assigneeId || task.assignee_id || task.assigneeLabel || task.assignee_label) || "unassigned";
    const label = text(task.assigneeLabel || task.assignee_label) || "미지정";
    const current = groups.get(key) || { key, label, tasks: [] };
    current.tasks.push(task);
    groups.set(key, current);
  });

  return [...groups.values()].sort((left, right) => (
    right.tasks.length - left.tasks.length ||
    left.label.localeCompare(right.label, "ko", { numeric: true })
  ));
}

/** @param {string} [value] */
function normalizeTaskHistoryUrl(value = "") {
  const url = new URL(String(value || "/"), "https://ops-task.local");
  return {
    pathAndQuery: `${url.pathname}${url.search}`,
    taskId: text(url.searchParams.get("taskId")),
  };
}

/**
 * @param {{ currentUrl?: string, nextUrl?: string, intent?: "push" | "replace" }} [input]
 * @returns {"none" | "push" | "replace"}
 */
export function getOpsTaskHistoryMutation({
  currentUrl = "",
  nextUrl = "",
  intent = "replace",
} = {}) {
  const current = normalizeTaskHistoryUrl(currentUrl);
  const next = normalizeTaskHistoryUrl(nextUrl);
  if (current.pathAndQuery === next.pathAndQuery) return "none";
  if (intent === "push" && !current.taskId && next.taskId) return "push";
  return "replace";
}

/**
 * @param {{
 *   urlHasTask?: boolean,
 *   hostKind?: string,
 *   dirty?: boolean,
 *   taskId?: string,
 *   focusTrackId?: string | null,
 *   appointmentId?: string | null,
 * }} [input]
 * @returns {{
 *   requestClose: boolean,
 *   restoreDeepLink: { taskId: string, focusTrackId: string | null, appointmentId: string | null } | null,
 * }}
 */
export function getRegistrationDirtyBackPlan({
  urlHasTask = false,
  hostKind = "",
  dirty = false,
  taskId = "",
  focusTrackId = null,
  appointmentId = null,
} = {}) {
  if (
    urlHasTask
    || !["loading_detail", "detail", "refresh_failed"].includes(hostKind)
    || !text(taskId)
  ) {
    return { requestClose: false, restoreDeepLink: null };
  }
  return {
    requestClose: true,
    restoreDeepLink: hostKind === "detail" && dirty
      ? { taskId, focusTrackId, appointmentId }
      : null,
  };
}

/**
 * @param {"cancel" | "discard"} [decision]
 * @param {{ taskId: string, focusTrackId: string | null, appointmentId: string | null } | null} [restoreDeepLink]
 * @param {{ canRestoreForward?: boolean }} [options]
 * @returns {{
 *   close: boolean,
 *   restoreDeepLink: { taskId: string, focusTrackId: string | null, appointmentId: string | null } | null,
 *   historyRestore: "none" | "forward" | "replace",
 * }}
 */
export function getRegistrationDirtyCloseDecision(
  decision = "discard",
  restoreDeepLink = null,
  { canRestoreForward = false } = {},
) {
  if (decision === "cancel") {
    return {
      close: false,
      restoreDeepLink: restoreDeepLink ? { ...restoreDeepLink } : null,
      historyRestore: restoreDeepLink
        ? canRestoreForward ? "forward" : "replace"
        : "none",
    };
  }
  return { close: true, restoreDeepLink: null, historyRestore: "none" };
}
