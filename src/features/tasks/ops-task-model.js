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
      addCalendarItem(items, task, "예정", task.dueAt || task.due_at);

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
