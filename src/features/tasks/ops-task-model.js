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
  { value: "1. 레벨테스트 신청", label: "1. 레벨테스트 신청" },
  { value: "2. 상담 신청", label: "2. 상담 신청" },
  { value: "3. 상담 완료 (7일 동안 기다리는 중)", label: "3. 상담 완료" },
  { value: "4-1. 현재반 대기 신청", label: "4-1. 현재반 대기" },
  { value: "4-2. 신규반 대기 신청", label: "4-2. 신규반 대기" },
  { value: "4-3. 다음 개강 알림 요청", label: "4-3. 다음 개강 알림" },
  { value: "5. 등록 신청", label: "5. 등록 신청" },
  { value: "6. 수납 진행 중", label: "6. 수납 진행 중" },
  { value: "7. 등록 완료", label: "7. 등록 완료" },
  { value: "8. 미등록", label: "8. 미등록" },
  { value: "9. 문의만", label: "9. 문의만" },
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
        addCalendarItem(items, task, "응시", detail.testAt || detail.test_at);
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
