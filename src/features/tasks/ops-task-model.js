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

function registrationPipelineValue(prefix, fallback) {
  return REGISTRATION_PIPELINE_STATUSES.find((status) => text(status.value).startsWith(prefix))?.value || fallback;
}

export function buildRegistrationWorkflowPresetPatch(preset, options = {}) {
  const dueTodayValue = text(options.dueTodayValue);
  const dueTomorrowValue = text(options.dueTomorrowValue);
  const inquiryAt = text(options.inquiryNowValue) || dueTodayValue;
  const inquiryPatch = (inquiryChannel = "") => ({
    pipelineStatus: registrationPipelineValue("0.", "0. 등록 문의"),
    ...(inquiryAt ? { inquiryAt } : {}),
    ...(inquiryChannel ? { inquiryChannel } : {}),
  });

  switch (preset) {
    case "inquiry_today":
      return inquiryPatch();
    case "phone_inquiry_today":
      return inquiryPatch("전화");
    case "chat_inquiry_today":
      return inquiryPatch("채널톡");
    case "walk_in_inquiry_today":
      return inquiryPatch("바로 방문");
    case "level_test_today":
      return {
        pipelineStatus: registrationPipelineValue("1.", "1. 레벨테스트 신청"),
        ...(dueTodayValue ? { levelTestAt: dueTodayValue } : {}),
      };
    case "level_test_tomorrow":
      return {
        pipelineStatus: registrationPipelineValue("1.", "1. 레벨테스트 신청"),
        ...(dueTomorrowValue ? { levelTestAt: dueTomorrowValue } : {}),
      };
    case "consult_today":
      return {
        pipelineStatus: registrationPipelineValue("2.", "2. 상담 신청"),
        ...(dueTodayValue ? { consultationAt: dueTodayValue } : {}),
      };
    case "phone_consult_today":
      return {
        pipelineStatus: registrationPipelineValue("2.", "2. 상담 신청"),
        ...(dueTodayValue ? { phoneConsultationAt: dueTodayValue } : {}),
      };
    case "visit_consult_today":
      return {
        pipelineStatus: registrationPipelineValue("2.", "2. 상담 신청"),
        ...(dueTodayValue ? { visitConsultationAt: dueTodayValue } : {}),
      };
    case "consult_tomorrow":
      return {
        pipelineStatus: registrationPipelineValue("2.", "2. 상담 신청"),
        ...(dueTomorrowValue ? { consultationAt: dueTomorrowValue } : {}),
      };
    case "registration_request":
      return {
        pipelineStatus: registrationPipelineValue("5.", "5. 등록 신청"),
      };
    case "payment_in_progress":
      return {
        pipelineStatus: registrationPipelineValue("6.", "6. 수납 진행 중"),
      };
    default:
      return {};
  }
}

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

function compactText(value) {
  return text(value).replace(/\s+/g, "").toLowerCase();
}

function phoneDigits(value) {
  return text(value).replace(/\D/g, "");
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

const DEFAULT_AUTOMATION_TIMEZONE_OFFSET = "+09:00";

function integerValue(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function dateFromKey(dateKey) {
  const key = toDateKey(dateKey);
  if (!key) return null;
  const date = new Date(`${key}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateKeyFromUtcDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function addDaysToDateKey(dateKey, days) {
  const date = dateFromKey(dateKey);
  if (!date) return "";
  date.setUTCDate(date.getUTCDate() + integerValue(days, 0));
  return dateKeyFromUtcDate(date);
}

function latestDateKey(...values) {
  return values.map(toDateKey).filter(Boolean).sort().at(-1) || "";
}

function normalizeTime(value, fallback = "23:59") {
  const raw = text(value);
  const match = raw.match(/^(\d{1,2})(?::([0-5]\d))?$/);
  if (!match) return fallback;
  const hour = Number(match[1]);
  if (!Number.isFinite(hour) || hour < 0 || hour > 23) return fallback;
  return `${String(hour).padStart(2, "0")}:${match[2] || "00"}`;
}

function formatAutomationDueAt(dateKey, timeValue, timezoneOffset = DEFAULT_AUTOMATION_TIMEZONE_OFFSET) {
  const key = toDateKey(dateKey);
  if (!key) return "";
  const timePart = normalizeTime(timeValue);
  const offset = text(timezoneOffset) || DEFAULT_AUTOMATION_TIMEZONE_OFFSET;
  return `${key}T${timePart}:00${offset}`;
}

function daysInUtcMonth(year, monthIndex) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function monthlyDateKey(year, monthIndex, dayValue) {
  const day = Math.min(Math.max(integerValue(dayValue, 1), 1), daysInUtcMonth(year, monthIndex));
  return [
    year,
    String(monthIndex + 1).padStart(2, "0"),
    String(day).padStart(2, "0"),
  ].join("-");
}

function normalizeWeekday(value, fallback = 1) {
  const day = integerValue(value, fallback);
  return day >= 0 && day <= 6 ? day : fallback;
}

function normalizeWeekdays(values, fallback = []) {
  const source = Array.isArray(values) ? values : fallback;
  return [...new Set(source.map((value) => normalizeWeekday(value, Number.NaN)).filter((value) => Number.isFinite(value)))].sort((left, right) => left - right);
}

function lastWeekdayDateKey(year, monthIndex, weekdayValue) {
  const weekday = normalizeWeekday(weekdayValue, 5);
  const date = new Date(Date.UTC(year, monthIndex + 1, 0));
  while (date.getUTCDay() !== weekday) date.setUTCDate(date.getUTCDate() - 1);
  return dateKeyFromUtcDate(date);
}

function nextDailyOccurrence(fromDateKey, intervalValue = 1) {
  const interval = Math.max(integerValue(intervalValue, 1), 1);
  let candidate = fromDateKey;
  if (interval === 1) return candidate;
  const start = dateFromKey(fromDateKey);
  if (!start) return "";
  for (let index = 0; index < 370; index += interval) {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + index);
    candidate = dateKeyFromUtcDate(date);
    if (candidate >= fromDateKey) return candidate;
  }
  return candidate;
}

function nextWeeklyOccurrence(fromDateKey, weekdaysValue) {
  const fromDate = dateFromKey(fromDateKey);
  if (!fromDate) return "";
  const weekdays = normalizeWeekdays(weekdaysValue, [fromDate.getUTCDay()]);
  for (let offset = 0; offset <= 14; offset += 1) {
    const date = new Date(fromDate);
    date.setUTCDate(fromDate.getUTCDate() + offset);
    if (weekdays.includes(date.getUTCDay())) return dateKeyFromUtcDate(date);
  }
  return "";
}

function nextMonthlyOccurrence(fromDateKey, dayValue) {
  const fromDate = dateFromKey(fromDateKey);
  if (!fromDate) return "";
  const monthDay = integerValue(dayValue, 1);
  for (let offset = 0; offset <= 24; offset += 1) {
    const year = fromDate.getUTCFullYear();
    const monthIndex = fromDate.getUTCMonth() + offset;
    const normalizedYear = year + Math.floor(monthIndex / 12);
    const normalizedMonth = monthIndex % 12;
    const candidate = monthlyDateKey(normalizedYear, normalizedMonth, monthDay);
    if (candidate >= fromDateKey) return candidate;
  }
  return "";
}

function nextMonthlyLastWeekdayOccurrence(fromDateKey, weekdayValue) {
  const fromDate = dateFromKey(fromDateKey);
  if (!fromDate) return "";
  for (let offset = 0; offset <= 24; offset += 1) {
    const year = fromDate.getUTCFullYear();
    const monthIndex = fromDate.getUTCMonth() + offset;
    const normalizedYear = year + Math.floor(monthIndex / 12);
    const normalizedMonth = monthIndex % 12;
    const candidate = lastWeekdayDateKey(normalizedYear, normalizedMonth, weekdayValue);
    if (candidate >= fromDateKey) return candidate;
  }
  return "";
}

export function buildOpsRecurringTaskOccurrence(template = {}, options = {}) {
  if (template.enabled === false) return null;

  const templateId = text(template.id || template.templateId);
  if (!templateId) return null;

  const todayKey = toDateKey(options.fromDate || options.now || new Date());
  const startKey = toDateKey(template.startDate) || todayKey;
  const afterKey = toDateKey(options.afterDate || template.lastScheduledFor);
  const searchFrom = latestDateKey(todayKey, startKey, afterKey ? addDaysToDateKey(afterKey, 1) : "");
  if (!searchFrom) return null;

  let scheduledFor = "";
  switch (text(template.frequency)) {
    case "daily":
      scheduledFor = nextDailyOccurrence(searchFrom, template.interval);
      break;
    case "weekly":
      scheduledFor = nextWeeklyOccurrence(searchFrom, template.weekdays);
      break;
    case "monthly_date":
      scheduledFor = nextMonthlyOccurrence(searchFrom, template.monthDay);
      break;
    case "monthly_last_weekday":
      scheduledFor = nextMonthlyLastWeekdayOccurrence(searchFrom, template.weekday);
      break;
    default:
      return null;
  }

  const endKey = toDateKey(template.endDate);
  if (!scheduledFor || (endKey && scheduledFor > endKey)) return null;

  const createLeadDays = Math.max(integerValue(template.createLeadDays, 0), 0);
  return {
    templateId,
    title: text(template.title),
    scheduledFor,
    createOn: addDaysToDateKey(scheduledFor, -createLeadDays),
    dueAt: formatAutomationDueAt(scheduledFor, template.dueTime, template.timezoneOffset),
    dedupeKey: `${templateId}:${scheduledFor}`,
  };
}

function readPath(root, path) {
  return text(path).split(".").filter(Boolean).reduce((current, key) => (
    current && typeof current === "object" ? current[key] : undefined
  ), root);
}

function hasPathValue(root, path) {
  const value = readPath(root, path);
  if (Array.isArray(value)) return value.length > 0;
  return value !== undefined && value !== null && text(value) !== "";
}

function isStateBoardResidenceTrigger(trigger) {
  const key = text(trigger).toLowerCase();
  return key.includes("status_held") || key.includes("pipeline_status_held") || key.endsWith(".held");
}

function buildAutomationSourceKey(rule = {}, event = {}) {
  const ruleId = text(rule.id || rule.ruleId);
  const sourceType = text(event.sourceType || rule.target || event.task?.type || "ops");
  const sourceId = text(event.sourceId || event.task?.id || event.id);
  const trigger = text(event.trigger || rule.trigger);
  return [ruleId, sourceType, sourceId, trigger].filter(Boolean).join(":");
}

function hasGeneratedAutomationTask(existingTasks = [], dedupeKey = "") {
  if (!dedupeKey) return false;
  return (existingTasks || []).some((task) => text(task.automationSourceKey || task.automation_source_key) === dedupeKey);
}

function findGeneratedAutomationTask(existingTasks = [], dedupeKey = "") {
  if (!dedupeKey) return null;
  return (existingTasks || []).find((task) => text(task.automationSourceKey || task.automation_source_key) === dedupeKey) || null;
}

function getAutomationActionKind(action = {}) {
  const kind = text(action.kind);
  if (kind) return kind;
  const actionType = text(action.type);
  return actionType === "create_follow_up_task" ? actionType : "create_follow_up_task";
}

function getAutomationTaskType(action = {}) {
  const value = text(action.taskType || action.task_type || action.todoType || action.todo_type);
  const allowed = new Set(["registration", "withdrawal", "transfer", "word_retest", "textbook", "general"]);
  if (allowed.has(value)) return value;
  const legacyType = text(action.type);
  return allowed.has(legacyType) ? legacyType : "general";
}

function renderAutomationTemplate(templateValue, event = {}) {
  const task = event.task || {};
  const academicEvent = event.academicEvent || event.academic_event || {};
  const values = {
    studentName: text(task.studentName || task.student_name || event.student?.name || event.studentName),
    student: text(task.studentName || task.student_name || event.student?.name || event.studentName),
    className: text(task.className || task.class_name || event.classItem?.name || event.className),
    class: text(task.className || task.class_name || event.classItem?.name || event.className),
    teacherName: text(event.teacher?.name || task.teacherName || task.teacher_name),
    teacher: text(event.teacher?.name || task.teacherName || task.teacher_name),
    eventTitle: text(academicEvent.title || academicEvent.name || event.title),
    eventType: text(academicEvent.type || academicEvent.typeLabel || academicEvent.type_label),
    eventDate: text(academicEvent.start || academicEvent.startDate || academicEvent.start_date || academicEvent.date),
    schoolName: text(academicEvent.schoolName || academicEvent.school_name || academicEvent.school),
    school: text(academicEvent.schoolName || academicEvent.school_name || academicEvent.school),
    grade: text(academicEvent.grade || task.grade || event.student?.grade),
  };

  return text(templateValue).replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key) => values[key] || "");
}

function automationConditionValuesFor(key, event = {}) {
  const task = event.task || {};
  const academicEvent = event.academicEvent || event.academic_event || {};
  const root = { event, task };
  const explicit = readPath(root, key);
  const aliases = {
    campus: [
      task.campus,
      task.branch,
      event.classItem?.campus,
      event.classItem?.branch,
      event.class_item?.campus,
      event.class_item?.branch,
      task.wordRetest?.branch,
      task.word_retest?.branch,
      task.registration?.campus,
      academicEvent.campus,
      academicEvent.branch,
    ],
    subject: [
      task.subject,
      task.classSubject,
      task.class_subject,
      event.classItem?.subject,
      event.class_item?.subject,
      academicEvent.subject,
      academicEvent.type,
      academicEvent.typeLabel,
      academicEvent.type_label,
    ],
    grade: [
      task.grade,
      task.schoolGrade,
      task.school_grade,
      task.registration?.schoolGrade,
      task.registration?.school_grade,
      task.withdrawal?.schoolGrade,
      task.withdrawal?.school_grade,
      event.classItem?.grade,
      event.class_item?.grade,
      event.student?.grade,
      event.student?.schoolGrade,
      event.student?.school_grade,
      academicEvent.grade,
      academicEvent.schoolGrade,
      academicEvent.school_grade,
    ],
    team: [
      task.team,
      task.assigneeTeam,
      task.assignee_team,
      task.teacherTeam,
      task.teacher_team,
      event.classItem?.team,
      event.class_item?.team,
      event.teacher?.team,
      event.teacher?.teamKey,
      event.teacher?.team_key,
      academicEvent.team,
      academicEvent.teamKey,
      academicEvent.team_key,
    ],
    status: [
      task.status,
      task.registration?.pipelineStatus,
      task.registration?.pipeline_status,
      task.wordRetest?.retestStatus,
      task.word_retest?.retest_status,
      academicEvent.status,
    ],
  };
  return [explicit, ...(aliases[key] || [])].map(text).filter(Boolean);
}

function conditionExpectedValues(value) {
  if (Array.isArray(value)) return value.map(text).filter((item) => item && item !== "all");
  const raw = text(value);
  if (!raw || raw === "all") return [];
  return raw.split(",").map(text).filter((item) => item && item !== "all");
}

function matchesAutomationConditionFilters(conditions = {}, event = {}) {
  const filters = conditions.filters && typeof conditions.filters === "object" ? conditions.filters : {};
  return Object.entries(filters).every(([key, expected]) => {
    const expectedValues = conditionExpectedValues(expected);
    if (expectedValues.length === 0) return true;
    const actualValues = automationConditionValuesFor(key, event);
    return actualValues.some((actual) => expectedValues.includes(actual));
  });
}

function getAutomationDuplicatePolicy(conditions = {}) {
  const policy = text(conditions.duplicatePolicy || conditions.duplicate_policy);
  if (policy === "update_due" || policy === "update_due_at") return "update_due";
  return "skip";
}

function resolveAutomationAssignee(assignee = {}, event = {}) {
  const task = event.task || {};
  switch (text(assignee.strategy)) {
    case "teacher":
    case "responsible_teacher":
      return text(event.teacher?.profileId || event.teacher?.profile_id || task.teacherProfileId || task.teacher_profile_id || task.wordRetest?.teacherProfileId || task.wordRetest?.teacher_profile_id);
    case "operator":
    case "task_assignee":
    case "current_assignee":
      return text(task.assigneeId || task.assignee_id);
    case "fixed":
      return text(assignee.fixedProfileId || assignee.fixed_profile_id || assignee.profileId || assignee.profile_id);
    case "requester":
    case "creator":
      return text(task.requestedBy || task.requested_by);
    default:
      return "";
  }
}

function resolveAutomationDueDate(rule = {}, event = {}) {
  const due = rule.due || {};
  const basisPath = text(due.basis);
  const root = { event, task: event.task || {} };
  const basisValue = basisPath ? readPath(root, basisPath) : event.occurredAt;
  const basisKey = toDateKey(basisValue || event.occurredAt || new Date());
  if (!basisKey) return "";
  return addDaysToDateKey(basisKey, integerValue(due.offsetDays, 0));
}

function normalizeAutomationChecklist(value) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  return text(value).split(/\n|,/).map(text).filter(Boolean);
}

function buildAutomationChecklistItems(value, event = {}) {
  return normalizeAutomationChecklist(value)
    .map((item) => renderAutomationTemplate(item, event))
    .map(text)
    .filter(Boolean)
    .map((label, index) => ({
      id: `automation-${index + 1}`,
      label,
      checked: false,
    }));
}

function buildAutomationTaskMemo(action = {}, event = {}) {
  const parts = [];
  const memo = renderAutomationTemplate(action.memo, event);
  if (memo) parts.push(memo);

  const relatedRoute = text(action.relatedRoute || action.related_route || action.relatedMenu || action.related_menu);
  if (relatedRoute) parts.push(`관련 메뉴: ${relatedRoute}`);
  return parts.join("\n\n");
}

export function buildOpsTriggeredTaskDraft(rule = {}, event = {}, existingTasks = []) {
  if (rule.enabled === false) return null;
  const trigger = text(event.trigger || rule.trigger);
  if (!trigger || trigger !== text(rule.trigger)) return null;
  if (rule.target && text(rule.target) !== text(event.sourceType || event.task?.type)) return null;
  if (isStateBoardResidenceTrigger(trigger)) return null;

  const action = rule.action || {};
  if (getAutomationActionKind(action) !== "create_follow_up_task") return null;

  const root = { event, task: event.task || {} };
  const requiredPaths = Array.isArray(rule.conditions?.required) ? rule.conditions.required : [];
  if (requiredPaths.some((path) => !hasPathValue(root, path))) return null;
  if (!matchesAutomationConditionFilters(rule.conditions || {}, event)) return null;

  const dedupeKey = text(rule.dedupeKey) || buildAutomationSourceKey(rule, event);
  if (!dedupeKey) return null;

  const task = event.task || {};
  const dueDate = resolveAutomationDueDate(rule, event);
  const dueAt = dueDate ? formatAutomationDueAt(dueDate, rule.due?.dueTime, rule.due?.timezoneOffset) : "";
  const title = renderAutomationTemplate(action.title, event) || "후속 업무";
  const memo = buildAutomationTaskMemo(action, event);
  const checklistItems = buildAutomationChecklistItems(action.checklist || action.checklistItems || action.checklist_items, event);
  const assigneeId = resolveAutomationAssignee(rule.assignee || {}, event);
  const sourceType = text(event.sourceType || task.type || rule.target);
  const sourceId = text(event.sourceId || task.id || event.classItem?.id || event.class_item?.id);
  const classId = text(task.classId || task.class_id || event.classItem?.id || event.class_item?.id);
  const className = text(task.className || task.class_name || event.classItem?.name || event.class_item?.name);

  const draft = {
    dedupeKey,
    task: {
      title,
      type: getAutomationTaskType(action),
      status: "requested",
      priority: text(action.priority) || "normal",
      assigneeId,
      studentId: text(task.studentId || task.student_id),
      studentName: text(task.studentName || task.student_name),
      classId,
      className,
      dueAt,
      memo,
      checklistItems,
      automationRuleId: text(rule.id || rule.ruleId),
      automationSourceType: sourceType,
      automationSourceId: sourceId,
      automationSourceKey: dedupeKey,
    },
    notification: {
      enabled: rule.notification?.enabled !== false,
      channelKey: text(rule.notification?.channelKey || rule.notification?.teamKey),
    },
  };

  const existingTask = findGeneratedAutomationTask(existingTasks, dedupeKey);
  if (!existingTask) return draft;
  if (getAutomationDuplicatePolicy(rule.conditions || {}) === "update_due") {
    return {
      ...draft,
      existingTaskId: text(existingTask.id),
      updateTask: {
        id: text(existingTask.id),
        patch: {
          dueAt,
        },
      },
    };
  }

  return null;
}

function sanitizeChatThreadKey(value) {
  return text(value)
    .replace(/[^a-zA-Z0-9가-힣]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

export function buildGoogleChatTaskNotificationPayload({ task = {}, event = "created" } = {}) {
  const title = text(task.title) || "새 할 일";
  const assignee = text(task.assigneeLabel || task.assignee_label);
  const dueDate = toDateKey(task.dueAt || task.due_at);
  const student = text(task.studentName || task.student_name);
  const lines = [
    event === "created" ? `새 할 일: ${title}` : `할 일 알림: ${title}`,
    assignee ? `담당: ${assignee}` : "",
    dueDate ? `마감: ${dueDate}` : "",
    student ? `학생: ${student}` : "",
  ].filter(Boolean);

  return {
    text: lines.join("\n"),
    thread: {
      threadKey: sanitizeChatThreadKey(task.automationSourceKey || task.automation_source_key || task.id || title),
    },
  };
}

export function getOpsAutomationSourceLabel(task = {}) {
  const sourceType = text(task.automationSourceType || task.automation_source_type);
  const sourceKey = text(task.automationSourceKey || task.automation_source_key);
  if (!sourceType || !sourceKey) return "";

  if (sourceType === "recurring") return "자동 생성 · 반복 업무";

  const triggerKey = sourceKey.split(":").at(-1) || "";
  const completedFollowUpLabels = {
    registration: "등록 완료 후속",
    transfer: "전반 완료 후속",
    withdrawal: "퇴원 완료 후속",
    word_retest: "재시험 완료 후속",
    curriculum: "수업계획 후속",
    academic_calendar: "학사일정 후속",
  };

  const followUpLabel = triggerKey.includes("completed")
    ? completedFollowUpLabels[sourceType] || "후속 업무"
    : completedFollowUpLabels[sourceType] || "자동화 업무";
  return `자동 생성 · ${followUpLabel}`;
}

function firstNumber(value) {
  const match = text(value).replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!match) return Number.NaN;
  return Number(match[0]);
}

function hasPositiveNumber(value) {
  const number = firstNumber(value);
  return Number.isFinite(number) && number > 0;
}

function hasNonNegativeNumber(value) {
  const number = firstNumber(value);
  return Number.isFinite(number) && number >= 0;
}

function moneyNumber(value) {
  const number = firstNumber(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function sessionNumber(value) {
  const number = firstNumber(value);
  return Number.isFinite(number) && number > 0 ? number : Number.NaN;
}

function arrayValue(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function objectValue(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function classReferenceMatches(classItem = {}, reference) {
  const rawReference = text(reference);
  if (!rawReference) return false;
  if ([classItem.id, classItem.classId, classItem.class_id].map(text).includes(rawReference)) return true;

  const lookup = compactText(rawReference);
  return [classItem.label, classItem.name, classItem.className, classItem.class_name, classItem.title]
    .map(compactText)
    .filter(Boolean)
    .includes(lookup);
}

function findClassReference(classes = [], ...references) {
  return (classes || []).find((classItem) => references.some((reference) => classReferenceMatches(classItem, reference)));
}

function studentReferenceMatches(student = {}, reference) {
  const rawReference = text(reference);
  if (!rawReference) return false;
  if ([student.id, student.studentId, student.student_id].map(text).includes(rawReference)) return true;

  const lookup = compactText(rawReference);
  return [student.label, student.name, student.studentName, student.student_name, student.title]
    .map(compactText)
    .filter(Boolean)
    .includes(lookup);
}

function findStudentReference(students = [], ...references) {
  return (students || []).find((student) => references.some((reference) => studentReferenceMatches(student, reference)));
}

function textbookReferenceMatches(textbook = {}, reference) {
  const rawReference = text(reference);
  if (!rawReference) return false;
  if ([textbook.id, textbook.textbookId, textbook.textbook_id].map(text).includes(rawReference)) return true;

  const lookup = compactText(rawReference);
  return [textbook.label, textbook.title, textbook.name, textbook.textbookTitle, textbook.textbook_title]
    .map(compactText)
    .filter(Boolean)
    .includes(lookup);
}

function findTextbookReference(textbooks = [], ...references) {
  return (textbooks || []).find((textbook) => references.some((reference) => textbookReferenceMatches(textbook, reference)));
}

function referenceLabel(item = {}, fallback = "") {
  return text(item.label || item.name || item.title || item.studentName || item.student_name || item.className || item.class_name) || text(fallback || item.id);
}

function detailLabel(...values) {
  return values.map(text).filter(Boolean).join(" · ");
}

function idList(value) {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

function hasRosterLink(student = {}, classItem = {}) {
  const studentId = text(student.id);
  const classId = text(classItem.id);
  if (!studentId || !classId) return false;

  return (
    idList(student.classIds ?? student.class_ids).includes(classId) ||
    idList(student.waitlistClassIds ?? student.waitlist_class_ids).includes(classId) ||
    idList(classItem.studentIds ?? classItem.student_ids).includes(studentId) ||
    idList(classItem.waitlistIds ?? classItem.waitlist_ids).includes(studentId)
  );
}

function addRosterCompletionBlocker(blockers, students, classes, studentReferences = [], classReferences = [], label = "수업 명단") {
  if (!Array.isArray(students) || !Array.isArray(classes)) return;

  const student = findStudentReference(students, ...studentReferences);
  const classItem = findClassReference(classes, ...classReferences);
  if (student && classItem && !hasRosterLink(student, classItem)) blockers.push(label);
}

function classSessionCount(classItem = {}) {
  const value = classItem.sessionCount ?? classItem.session_count ?? classItem.sessionsCount ?? classItem.sessions_count;
  const count = Number(value);
  return Number.isFinite(count) ? count : Number.NaN;
}

function hasExplicitPlannedSessionCount(classItem = {}) {
  const plannedValue = classItem.plannedSessionCount ?? classItem.planned_session_count;
  const unplannedValue = classItem.unplannedSessionCount ?? classItem.unplanned_session_count;
  return (plannedValue !== undefined && plannedValue !== null && plannedValue !== "")
    || (unplannedValue !== undefined && unplannedValue !== null && unplannedValue !== "");
}

function classPlannedSessionCount(classItem = {}) {
  const totalSessions = classSessionCount(classItem);
  const rawValue = classItem.plannedSessionCount ?? classItem.planned_session_count;
  const rawPlannedSessions = Number(rawValue);
  if (rawValue !== undefined && rawValue !== null && rawValue !== "" && Number.isFinite(rawPlannedSessions) && rawPlannedSessions >= 0) {
    return Number.isFinite(totalSessions) && totalSessions > 0
      ? Math.min(rawPlannedSessions, totalSessions)
      : rawPlannedSessions;
  }

  const rawUnplannedValue = classItem.unplannedSessionCount ?? classItem.unplanned_session_count;
  const rawUnplannedSessions = Number(rawUnplannedValue);
  if (rawUnplannedValue !== undefined && rawUnplannedValue !== null && rawUnplannedValue !== "" && Number.isFinite(rawUnplannedSessions) && rawUnplannedSessions >= 0) {
    return Number.isFinite(totalSessions) && totalSessions > 0
      ? Math.max(totalSessions - Math.min(rawUnplannedSessions, totalSessions), 0)
      : Number.NaN;
  }

  return Number.isFinite(totalSessions) && totalSessions > 0 ? totalSessions : Number.NaN;
}

function classPlanSessionOrder(session = {}, index = 0) {
  const explicitOrder = session.sessionOrder ?? session.session_order ?? session.sessionNumber ?? session.session_number ?? session.number ?? session.order;
  const parsedOrder = sessionNumber(explicitOrder);
  return Number.isFinite(parsedOrder) ? parsedOrder : index + 1;
}

function hasClassPlanSessionContent(session = {}) {
  if (session.planned === true || session.hasPlan === true || session.has_plan === true) return true;
  if (session.planned === false || session.hasPlan === false || session.has_plan === false) return false;

  const entries = arrayValue(session.textbookEntries ?? session.textbook_entries ?? session.entries);
  return entries.some((entry) => {
    const parsedPlan = objectValue(entry.plan);
    const plan = Object.keys(parsedPlan).length > 0 ? parsedPlan : entry;
    return Boolean(
      text(plan.label || plan.rangeLabel || plan.range_label) ||
        text(plan.start || plan.from || plan.startRange || plan.start_range) ||
        text(plan.end || plan.to || plan.endRange || plan.end_range) ||
        text(plan.memo || plan.note || plan.teacherNote || plan.teacher_note),
    );
  });
}

function classPlanSessions(classItem = {}) {
  const plan = objectValue(classItem.schedulePlan || classItem.schedule_plan);
  return arrayValue(classItem.planSessions ?? classItem.plan_sessions ?? classItem.sessions ?? plan.sessions)
    .map((session, index) => ({
      sessionOrder: classPlanSessionOrder(session, index),
      planned: hasClassPlanSessionContent(session),
    }))
    .filter((session) => Number.isFinite(session.sessionOrder) && session.sessionOrder > 0);
}

function addClassPlanSessionBlocker(blockers, classItem, sessionValue, labels = {}) {
  if (!classItem) return;

  const sessionLabel = labels.session || "수업계획 회차";
  const progressLabel = labels.progress || "수업계획 진도";
  const selectedSession = sessionNumber(sessionValue);
  if (!Number.isFinite(selectedSession)) return;

  const exactSessions = classPlanSessions(classItem);
  if (exactSessions.length > 0) {
    const exactSession = exactSessions.find((session) => session.sessionOrder === selectedSession);
    if (!exactSession) {
      blockers.push(sessionLabel);
      return;
    }
    if (!exactSession.planned) blockers.push(progressLabel);
    return;
  }

  const totalSessions = classSessionCount(classItem);
  if (!Number.isFinite(totalSessions)) return;

  if (totalSessions <= 0 || selectedSession > totalSessions) {
    blockers.push(sessionLabel);
    return;
  }

  if (hasExplicitPlannedSessionCount(classItem)) {
    const plannedSessions = classPlannedSessionCount(classItem);
    if (!Number.isFinite(plannedSessions) || plannedSessions <= 0 || selectedSession > plannedSessions) {
      blockers.push(progressLabel);
    }
  }
}

function hasClassTextbookInfo(classItem = {}) {
  return Object.prototype.hasOwnProperty.call(classItem, "textbookIds") ||
    Object.prototype.hasOwnProperty.call(classItem, "textbook_ids");
}

function classTextbookCount(classItem = {}) {
  const textbookIds = classItem.textbookIds ?? classItem.textbook_ids;
  return Array.isArray(textbookIds) ? textbookIds.map(text).filter(Boolean).length : 0;
}

function classTextbookIds(classItem = {}) {
  const textbookIds = classItem.textbookIds ?? classItem.textbook_ids;
  return Array.isArray(textbookIds) ? [...new Set(textbookIds.map(text).filter(Boolean))] : [];
}

function classSingleTextbookId(classItem = {}) {
  const textbookIds = classTextbookIds(classItem);
  return textbookIds.length === 1 ? textbookIds[0] : "";
}

function classBranch(classItem = {}) {
  const branchText = [
    classItem.branch,
    classItem.branch_name,
    classItem.campus,
    classItem.room,
    classItem.meta,
  ].map(text).filter(Boolean).join(" ");
  if (branchText.includes("별관")) return "별관";
  if (branchText.includes("본관")) return "본관";
  return "";
}

function addClassPlanTextbookBlocker(blockers, classItem, label = "수업계획 교재") {
  if (hasEmptyClassPlanTextbooks(classItem)) blockers.push(label);
}

function hasEmptyClassPlanTextbooks(classItem = {}) {
  return Boolean(classItem && hasClassTextbookInfo(classItem) && classTextbookCount(classItem) <= 0);
}

export function buildWithdrawalSettlementDefaults({ withdrawal = {}, classItem = {} } = {}) {
  const totalSessions = classSessionCount(classItem);
  if (!Number.isFinite(totalSessions) || totalSessions <= 0) return {};

  const plannedSessions = classPlannedSessionCount(classItem);
  const enteredWithdrawalSession = sessionNumber(withdrawal.withdrawalSession);
  const completedSessionBasis = Number.isFinite(enteredWithdrawalSession)
    ? enteredWithdrawalSession
    : plannedSessions;

  const defaults = {};
  if (Number.isFinite(plannedSessions) && plannedSessions > 0 && !text(withdrawal.withdrawalSession)) defaults.withdrawalSession = `${plannedSessions}회차`;
  if (Number.isFinite(completedSessionBasis) && completedSessionBasis > 0 && !text(withdrawal.completedLessonHours)) defaults.completedLessonHours = String(completedSessionBasis);
  if (!text(withdrawal.fourWeekLessonHours)) defaults.fourWeekLessonHours = String(totalSessions);
  return defaults;
}

function textbookLabelList(textbooks = []) {
  return [...new Set((textbooks || [])
    .map((textbook) => text(textbook.label || textbook.title || textbook.name))
    .filter(Boolean))]
    .join(", ");
}

export function buildWithdrawalTextbookDefaults({ withdrawal = {}, classTextbooks = [] } = {}) {
  const textbookList = textbookLabelList(classTextbooks);
  if (!textbookList || text(withdrawal.undistributedTextbooks)) return {};
  return { undistributedTextbooks: textbookList };
}

export function buildWithdrawalClassPlanPatch({ withdrawal = {}, classItem = {}, classTextbooks = [] } = {}) {
  return {
    ...buildWithdrawalSettlementDefaults({ withdrawal, classItem }),
    ...buildWithdrawalTextbookDefaults({ withdrawal, classTextbooks }),
  };
}

export function buildWithdrawalWorkflowPresetPatch(preset, options = {}) {
  const withdrawal = options.withdrawal || {};
  const classItem = options.classItem || {};
  const classTextbooks = Array.isArray(options.classTextbooks) ? options.classTextbooks : [];
  const todayDate = toDateKey(options.dueTodayValue);

  switch (preset) {
    case "today_with_class_plan":
      return {
        ...(todayDate ? { withdrawalDate: todayDate } : {}),
        ...buildWithdrawalClassPlanPatch({ withdrawal, classItem, classTextbooks }),
      };
    default:
      return {};
  }
}

export function buildWordRetestWorkflowPresetPatch(preset, options = {}) {
  const dueTodayValue = text(options.dueTodayValue);
  const dueTomorrowValue = text(options.dueTomorrowValue);

  switch (preset) {
    case "today_main":
      return {
        ...(dueTodayValue ? { testAt: dueTodayValue } : {}),
        branch: "본관",
      };
    case "today_annex":
      return {
        ...(dueTodayValue ? { testAt: dueTodayValue } : {}),
        branch: "별관",
      };
    case "tomorrow_main":
      return {
        ...(dueTomorrowValue ? { testAt: dueTomorrowValue } : {}),
        branch: "본관",
      };
    case "tomorrow_annex":
      return {
        ...(dueTomorrowValue ? { testAt: dueTomorrowValue } : {}),
        branch: "별관",
      };
    default:
      return {};
  }
}

export function buildTransferScheduleDefaults({ transfer = {}, fromClass = {}, toClass = {} } = {}) {
  const plannedFromSession = classPlannedSessionCount(fromClass);
  const currentFromSession = sessionNumber(transfer.fromClassEndSession);
  const baseFromSession = Number.isFinite(currentFromSession)
    ? currentFromSession
    : Number.isFinite(plannedFromSession) && plannedFromSession > 0
      ? plannedFromSession
      : Number.NaN;
  const toTotalSessions = classSessionCount(toClass);
  const defaults = {};

  if (!text(transfer.fromClassEndSession) && Number.isFinite(plannedFromSession) && plannedFromSession > 0) {
    defaults.fromClassEndSession = `${plannedFromSession}회차`;
  }

  const nextSession = Number.isFinite(baseFromSession) ? baseFromSession + 1 : Number.NaN;
  const plannedToSession = classPlannedSessionCount(toClass);
  const hasTargetPlanProgress = !hasExplicitPlannedSessionCount(toClass)
    || (Number.isFinite(plannedToSession) && plannedToSession > 0 && nextSession <= plannedToSession);
  const canUseNextSession = Number.isFinite(nextSession)
    && Number.isFinite(toTotalSessions)
    && toTotalSessions > 0
    && nextSession <= toTotalSessions
    && hasTargetPlanProgress;
  if (!text(transfer.toClassStartSession) && canUseNextSession) {
    defaults.toClassStartSession = `${nextSession}회차`;
  }

  return defaults;
}

export function buildTransferTextbookDefaults({ transfer = {}, fromTextbooks = [], toTextbooks = [] } = {}) {
  const defaults = {};
  const fromTextbookList = textbookLabelList(fromTextbooks);
  const toTextbookList = textbookLabelList(toTextbooks);

  if (fromTextbookList && !text(transfer.fromUndistributedTextbooks)) {
    defaults.fromUndistributedTextbooks = fromTextbookList;
  }
  if (toTextbookList && !text(transfer.toUndistributedTextbooks)) {
    defaults.toUndistributedTextbooks = toTextbookList;
  }

  return defaults;
}

export function buildTransferClassPlanPatch({
  transfer = {},
  fromClass = {},
  toClass = {},
  fromTextbooks = [],
  toTextbooks = [],
} = {}) {
  return {
    ...buildTransferScheduleDefaults({ transfer, fromClass, toClass }),
    ...buildTransferTextbookDefaults({ transfer, fromTextbooks, toTextbooks }),
  };
}

export function buildTransferWorkflowPresetPatch(preset, options = {}) {
  const transfer = options.transfer || {};
  const fromClass = options.fromClass || {};
  const toClass = options.toClass || {};
  const fromTextbooks = Array.isArray(options.fromTextbooks) ? options.fromTextbooks : [];
  const toTextbooks = Array.isArray(options.toTextbooks) ? options.toTextbooks : [];
  const todayDate = toDateKey(options.dueTodayValue);
  const tomorrowDate = toDateKey(options.dueTomorrowValue);

  switch (preset) {
    case "today_to_tomorrow_with_class_plan":
      return {
        ...(todayDate ? { fromClassEndDate: todayDate } : {}),
        ...(tomorrowDate ? { toClassStartDate: tomorrowDate } : {}),
        ...buildTransferClassPlanPatch({ transfer, fromClass, toClass, fromTextbooks, toTextbooks }),
      };
    default:
      return {};
  }
}

export function getOpsTaskScheduleCompletionBlockers(input = {}, options = {}) {
  const blockers = [];
  const classes = Array.isArray(options.classes) ? options.classes : [];

  if (input.type === "registration") {
    const registration = input.registration || {};
    const completed = text(input.status) === "done" || text(registration.pipelineStatus).startsWith("7.");
    if (completed) {
      if (!Number.isFinite(sessionNumber(registration.classStartSession))) blockers.push("수업시작회차");
      const classItem = findClassReference(classes, input.classId, input.className);
      addClassPlanSessionBlocker(blockers, classItem, registration.classStartSession);
      addClassPlanTextbookBlocker(blockers, classItem);
    }
  }

  if (input.type === "withdrawal" && text(input.status) === "done") {
    const withdrawal = input.withdrawal || {};
    if (!Number.isFinite(sessionNumber(withdrawal.withdrawalSession))) blockers.push("퇴원회차");
    if (!hasNonNegativeNumber(withdrawal.completedLessonHours)) blockers.push("진행 수업시수");
    if (!hasPositiveNumber(withdrawal.fourWeekLessonHours)) blockers.push("4주 기준 수업시수");
    const completedLessonHours = firstNumber(withdrawal.completedLessonHours);
    const fourWeekLessonHours = firstNumber(withdrawal.fourWeekLessonHours);
    if (
      Number.isFinite(completedLessonHours) &&
      Number.isFinite(fourWeekLessonHours) &&
      completedLessonHours >= 0 &&
      fourWeekLessonHours > 0 &&
      completedLessonHours > fourWeekLessonHours
    ) {
      blockers.push("수업시수 충돌");
    }
    const classItem = findClassReference(classes, input.classId, input.className);
    addClassPlanSessionBlocker(blockers, classItem, withdrawal.withdrawalSession);
    addClassPlanTextbookBlocker(blockers, classItem);
  }

  if (input.type === "transfer" && text(input.status) === "done") {
    const transfer = input.transfer || {};
    const fromSession = sessionNumber(transfer.fromClassEndSession);
    const toSession = sessionNumber(transfer.toClassStartSession);

    if (!Number.isFinite(fromSession)) blockers.push("전 수업 종료회차");
    if (!Number.isFinite(toSession)) blockers.push("후 수업 시작회차");

    if (Number.isFinite(fromSession) && Number.isFinite(toSession)) {
      if (toSession <= fromSession) blockers.push("회차 충돌");
      if (toSession > fromSession + 1) blockers.push("회차 공백");
    }

    const fromDate = toDateKey(transfer.fromClassEndDate);
    const toDate = toDateKey(transfer.toClassStartDate);
    if (fromDate && toDate && toDate < fromDate) blockers.push("일정 충돌");

    const fromClass = findClassReference(classes, transfer.fromClassId, transfer.fromClassName);
    const toClass = findClassReference(classes, transfer.toClassId || input.classId, transfer.toClassName || input.className);
    addClassPlanSessionBlocker(blockers, fromClass, transfer.fromClassEndSession, {
      session: "전 수업계획 회차",
      progress: "전 수업계획 진도",
    });
    addClassPlanSessionBlocker(blockers, toClass, transfer.toClassStartSession, {
      session: "후 수업계획 회차",
      progress: "후 수업계획 진도",
    });
    addClassPlanTextbookBlocker(blockers, fromClass, "전 수업계획 교재");
    addClassPlanTextbookBlocker(blockers, toClass, "후 수업계획 교재");
  }

  return [...new Set(blockers)];
}

export function getRegistrationDuplicateStudentCandidates(input = {}, students = []) {
  if (input.type && input.type !== "registration") return [];

  const registration = input.registration || {};
  const studentPhone = phoneDigits(registration.studentPhone);
  const parentPhone = phoneDigits(registration.parentPhone);
  const studentName = compactText(input.studentName || registration.studentName);
  const schoolName = compactText(registration.schoolName || input.schoolName);
  const candidates = new Map();

  function addCandidate(student, reason, rank) {
    const id = text(student.id);
    if (!id) return;
    const existing = candidates.get(id);
    const next = existing || {
      id,
      label: text(student.label || student.name) || id,
      meta: text(student.meta) || [student.grade, student.school].map(text).filter(Boolean).join(" · "),
      grade: text(student.grade),
      school: text(student.school),
      contact: text(student.contact),
      parentContact: text(student.parentContact || student.parent_contact),
      reason,
      reasons: [],
      rank,
    };

    if (!next.reasons.includes(reason)) next.reasons.push(reason);
    if (!existing || rank < existing.rank) {
      next.reason = reason;
      next.rank = rank;
    }

    candidates.set(id, next);
  }

  (students || []).forEach((student) => {
    const contact = phoneDigits(student.contact);
    const parentContact = phoneDigits(student.parentContact || student.parent_contact);
    const candidateName = compactText(student.label || student.name);
    const candidateSchool = compactText(student.school);

    if (studentPhone && contact && studentPhone === contact) {
      addCandidate(student, "학생 전화 중복", 0);
    }

    if (parentPhone && parentContact && parentPhone === parentContact) {
      addCandidate(student, "학부모 전화 중복", 1);
    }

    if (studentName && schoolName && studentName === candidateName && schoolName === candidateSchool) {
      addCandidate(student, "이름/학교 중복", 2);
    }
  });

  return [...candidates.values()]
    .sort((left, right) => (
      left.rank - right.rank ||
      left.label.localeCompare(right.label, "ko", { numeric: true })
    ))
    .map(({ rank: _rank, ...candidate }) => candidate);
}

export function getRegistrationDuplicateCompletionBlockers(input = {}, students = []) {
  if (input.type && input.type !== "registration") return [];

  const registration = input.registration || {};
  const completed = text(input.status) === "done" || text(registration.pipelineStatus).startsWith("7.");
  if (!completed) return [];

  const candidates = getRegistrationDuplicateStudentCandidates(input, students);
  if (candidates.length === 0) return [];

  const linkedStudentId = text(input.studentId);
  if (linkedStudentId && candidates.every((candidate) => text(candidate.id) === linkedStudentId)) return [];

  return ["기존 학생 후보"];
}

export const REGISTRATION_COMPLETION_CHECK_ITEMS = [
  { key: "principalPlacementChecked", label: "원장 반배정", phase: "배정" },
  { key: "admissionNoticeSent", label: "입학안내문", phase: "안내" },
  { key: "paymentChecked", label: "수납", phase: "수납" },
  { key: "makeeduRegistered", label: "메이크에듀 등록", phase: "메이크에듀" },
  { key: "makeeduInvoiceSent", label: "청구서 발송", phase: "메이크에듀" },
  { key: "textbookBillingIssued", label: "교재 청구출고표", phase: "교재" },
];

export function getRegistrationCompletionChecklistItems(registration = {}) {
  return REGISTRATION_COMPLETION_CHECK_ITEMS.map((item, index) => ({
    ...item,
    order: index + 1,
    checked: Boolean(registration?.[item.key]),
  }));
}

export function getRegistrationPrincipalQueueSummary(input = {}) {
  const registration = input.registration || input;
  const pipelineStatus = text(registration.pipelineStatus || registration.pipeline_status || input.registrationPipelineStatus);
  const hasPlacementWork = Boolean(
    text(registration.levelTestAt || registration.level_test_at) ||
    text(registration.levelTestResult || registration.level_test_result) ||
    text(registration.principalReviewNote || registration.principal_review_note) ||
    registration.principalPlacementChecked ||
    registration.principal_placement_checked ||
    (pipelineStatus && !pipelineStatus.startsWith("0.")),
  );
  if (!hasPlacementWork) return null;

  const levelTestResult = text(registration.levelTestResult || registration.level_test_result);
  const levelTestAt = registration.levelTestAt || registration.level_test_at;
  const levelTestDate = toDateKey(levelTestAt);
  const levelTestTime = timeKey(levelTestAt);
  const levelTestMaterialLink = text(registration.levelTestMaterialLink || registration.level_test_material_link);
  const principalReviewNote = text(registration.principalReviewNote || registration.principal_review_note);
  const placementChecked = Boolean(registration.principalPlacementChecked || registration.principal_placement_checked);

  return {
    testAtLabel: levelTestDate ? `레벨테스트 ${[levelTestDate, levelTestTime].filter(Boolean).join(" ")}` : "레벨테스트 미정",
    materialLabel: levelTestMaterialLink ? "자료 연결" : "자료 미연결",
    resultLabel: levelTestResult ? `결과 ${levelTestResult}` : "결과 미입력",
    analysisLabel: principalReviewNote ? "원장 분석 완료" : "원장 분석 필요",
    placementLabel: placementChecked ? "원장 반배정 완료" : "반배정 대기",
  };
}

export const WITHDRAWAL_COMPLETION_CHECK_ITEMS = [
  { key: "timetableRosterUpdated", label: "시간표 명단 변경", phase: "명단", auto: true },
  { key: "studentStatusUpdated", label: "학생 상태 변경", phase: "학생", auto: true },
  { key: "makeeduWithdrawalDone", label: "메이크에듀 퇴원처리", phase: "메이크에듀" },
  { key: "feeProcessed", label: "수업료 처리", phase: "정산" },
  { key: "textbookFeeProcessed", label: "교재비 처리", phase: "정산" },
];

export function getWithdrawalCompletionChecklistItems(withdrawal = {}) {
  return WITHDRAWAL_COMPLETION_CHECK_ITEMS.map((item, index) => ({
    ...item,
    order: index + 1,
    checked: Boolean(withdrawal?.[item.key]),
  }));
}

export const TRANSFER_COMPLETION_CHECK_ITEMS = [
  { key: "timetableRosterUpdated", label: "시간표 명단 변경", phase: "명단", auto: true },
  { key: "makeeduTransferDone", label: "메이크에듀 전반처리", phase: "메이크에듀" },
  { key: "feeProcessed", label: "수업료 처리", phase: "정산" },
  { key: "textbookFeeProcessed", label: "교재비 처리", phase: "정산" },
];

export function getTransferCompletionChecklistItems(transfer = {}) {
  return TRANSFER_COMPLETION_CHECK_ITEMS.map((item, index) => ({
    ...item,
    order: index + 1,
    checked: Boolean(transfer?.[item.key]),
  }));
}

function hasCompletionReference(...values) {
  return values.some((value) => Boolean(text(value)));
}

function isMissingOptionReference(options, value) {
  const reference = text(value);
  if (!reference || !Array.isArray(options)) return false;
  return !options.some((option) => text(option.id || option.value) === reference);
}

function isSameCompletionReference(first, second) {
  const firstValue = text(first);
  const secondValue = text(second);
  return Boolean(firstValue && secondValue && firstValue === secondValue);
}

function getMissingChecklistLabels(items = [], { includeAuto = false } = {}) {
  return (items || [])
    .filter((item) => (includeAuto || !item.auto) && !item.checked)
    .map((item) => item.label);
}

function getCompletionScheduleInput(input = {}) {
  const registration = input.registration || {};
  const withdrawal = input.withdrawal || {};
  const transfer = input.transfer || {};

  return {
    ...input,
    type: text(input.type),
    status: "done",
    classId: text(input.classId || input.class_id),
    className: text(input.className || input.class_name),
    registration: {
      ...registration,
      pipelineStatus: text(registration.pipelineStatus || registration.pipeline_status) || "7. 등록 완료",
      classStartSession: registration.classStartSession || registration.class_start_session,
      classStartDate: registration.classStartDate || registration.class_start_date,
    },
    withdrawal: {
      ...withdrawal,
      withdrawalDate: withdrawal.withdrawalDate || withdrawal.withdrawal_date,
      withdrawalSession: withdrawal.withdrawalSession || withdrawal.withdrawal_session,
      completedLessonHours: withdrawal.completedLessonHours || withdrawal.completed_lesson_hours,
      fourWeekLessonHours: withdrawal.fourWeekLessonHours || withdrawal.four_week_lesson_hours,
    },
    transfer: {
      ...transfer,
      fromClassId: transfer.fromClassId || transfer.from_class_id,
      fromClassName: transfer.fromClassName || transfer.from_class_name,
      fromClassEndDate: transfer.fromClassEndDate || transfer.from_class_end_date,
      fromClassEndSession: transfer.fromClassEndSession || transfer.from_class_end_session,
      toClassId: transfer.toClassId || transfer.to_class_id,
      toClassName: transfer.toClassName || transfer.to_class_name,
      toClassStartDate: transfer.toClassStartDate || transfer.to_class_start_date,
      toClassStartSession: transfer.toClassStartSession || transfer.to_class_start_session,
    },
  };
}

function shouldRequireBasicWordRetestScore(detail = {}) {
  return text(detail.retestStatus || detail.retest_status) !== "absent" && !hasWordRetestScore(detail);
}

export function getWordRetestEffectiveTextbookId(input = {}, options = {}) {
  const explicitTextbookId = text(input.textbookId || input.textbook_id);
  if (explicitTextbookId) return explicitTextbookId;

  const wordRetest = input.wordRetest || input.word_retest || {};
  const classes = Array.isArray(options.classes) ? options.classes : [];
  const classItem = findClassReference(
    classes,
    input.classId || input.class_id,
    input.className || input.class_name,
    wordRetest.className || wordRetest.class_name,
  );
  return classSingleTextbookId(classItem);
}

export function getWordRetestEffectiveBranch(input = {}, options = {}) {
  const wordRetest = input.wordRetest || input.word_retest || {};
  const explicitBranch = text(wordRetest.branch || wordRetest.branch_name || input.campus || input.branch);
  if (explicitBranch) return explicitBranch;

  const classes = Array.isArray(options.classes) ? options.classes : [];
  const classItem = findClassReference(
    classes,
    input.classId || input.class_id,
    input.className || input.class_name,
    wordRetest.className || wordRetest.class_name,
  );
  return classBranch(classItem);
}

export function getOpsTaskBasicCompletionBlockers(input = {}, options = {}) {
  const type = text(input.type || "general");
  if (type === "general") return [];

  const blockers = [];
  const registration = input.registration || {};
  const withdrawal = input.withdrawal || {};
  const transfer = input.transfer || {};
  const wordRetest = input.wordRetest || input.word_retest || {};
  const scheduleInput = getCompletionScheduleInput(input);
  const students = Array.isArray(options.students) ? options.students : undefined;
  const classes = Array.isArray(options.classes) ? options.classes : undefined;
  const textbooks = Array.isArray(options.textbooks) ? options.textbooks : undefined;
  const teachers = Array.isArray(options.teachers) ? options.teachers : undefined;

  if (type === "registration") {
    const textbookId = getRegistrationEffectiveTextbookId({
      ...input,
      classId: scheduleInput.classId,
      className: scheduleInput.className,
      textbookId: input.textbookId || input.textbook_id,
    }, options);
    const classItem = findClassReference(classes || [], scheduleInput.classId, scheduleInput.className);
    const classPlanNeedsTextbook = hasEmptyClassPlanTextbooks(classItem);

    if (!hasCompletionReference(registration.classStartDate, registration.class_start_date)) blockers.push("수업시작일");
    if (!hasCompletionReference(input.studentId, input.student_id, input.studentName, input.student_name, registration.studentName, registration.student_name)) blockers.push("학생");
    if (isMissingOptionReference(students, input.studentId || input.student_id)) blockers.push("학생");
    getRegistrationDuplicateCompletionBlockers(scheduleInput, students || []).forEach((blocker) => blockers.push(blocker));
    if (!hasCompletionReference(input.classId, input.class_id)) blockers.push("수업");
    if (isMissingOptionReference(classes, input.classId || input.class_id)) blockers.push("수업");
    if (!hasCompletionReference(textbookId) && !classPlanNeedsTextbook) blockers.push("교재");
    if (isMissingOptionReference(textbooks, textbookId)) blockers.push("교재");
    if (!hasCompletionReference(registration.principalReviewNote, registration.principal_review_note)) blockers.push("원장 분석");
    getMissingChecklistLabels(getRegistrationCompletionChecklistItems(registration), { includeAuto: true })
      .forEach((label) => blockers.push(label));
  }

  if (type === "withdrawal") {
    if (!hasCompletionReference(withdrawal.withdrawalDate, withdrawal.withdrawal_date)) blockers.push("퇴원일");
    if (!hasCompletionReference(input.studentId, input.student_id)) blockers.push("학생");
    if (isMissingOptionReference(students, input.studentId || input.student_id)) blockers.push("학생");
    if (!hasCompletionReference(input.classId, input.class_id)) blockers.push("수업");
    if (isMissingOptionReference(classes, input.classId || input.class_id)) blockers.push("수업");
    addRosterCompletionBlocker(
      blockers,
      students,
      classes,
      [input.studentId, input.student_id, input.studentName, input.student_name],
      [input.classId, input.class_id, input.className, input.class_name],
    );
    getMissingChecklistLabels(getWithdrawalCompletionChecklistItems(withdrawal))
      .forEach((label) => blockers.push(label));
  }

  if (type === "transfer") {
    const fromClassId = transfer.fromClassId || transfer.from_class_id;
    const toClassId = transfer.toClassId || transfer.to_class_id || input.classId || input.class_id;

    if (!hasCompletionReference(transfer.fromClassEndDate, transfer.from_class_end_date)) blockers.push("전 수업 종료일");
    if (!hasCompletionReference(transfer.toClassStartDate, transfer.to_class_start_date)) blockers.push("후 수업 시작일");
    if (!hasCompletionReference(input.studentId, input.student_id)) blockers.push("학생");
    if (isMissingOptionReference(students, input.studentId || input.student_id)) blockers.push("학생");
    if (!hasCompletionReference(fromClassId)) blockers.push("전 수업");
    if (isMissingOptionReference(classes, fromClassId)) blockers.push("전 수업");
    if (!hasCompletionReference(toClassId)) blockers.push("후 수업");
    if (isMissingOptionReference(classes, toClassId)) blockers.push("후 수업");
    if (isSameCompletionReference(fromClassId, toClassId)) blockers.push("다른 수업");
    addRosterCompletionBlocker(
      blockers,
      students,
      classes,
      [input.studentId, input.student_id, input.studentName, input.student_name],
      [transfer.fromClassId, transfer.from_class_id, transfer.fromClassName, transfer.from_class_name],
      "전 수업 명단",
    );
    getMissingChecklistLabels(getTransferCompletionChecklistItems(transfer))
      .forEach((label) => blockers.push(label));
  }

  if (type === "word_retest") {
    const textbookId = getWordRetestEffectiveTextbookId(input, options);
    const branch = getWordRetestEffectiveBranch(input, options);

    if (!hasCompletionReference(input.studentId, input.student_id)) blockers.push("학생");
    if (isMissingOptionReference(students, input.studentId || input.student_id)) blockers.push("학생");
    if (!hasCompletionReference(input.classId, input.class_id)) blockers.push("수업");
    if (isMissingOptionReference(classes, input.classId || input.class_id)) blockers.push("수업");
    addRosterCompletionBlocker(
      blockers,
      students,
      classes,
      [input.studentId, input.student_id, input.studentName, input.student_name, wordRetest.studentName, wordRetest.student_name],
      [input.classId, input.class_id, input.className, input.class_name, wordRetest.className, wordRetest.class_name],
    );
    if (!hasCompletionReference(wordRetest.teacherId, wordRetest.teacher_id)) blockers.push("선생님");
    if (isMissingOptionReference(teachers, wordRetest.teacherId || wordRetest.teacher_id)) blockers.push("선생님");
    if (!hasCompletionReference(branch)) blockers.push("지점");
    if (!hasCompletionReference(textbookId)) blockers.push("교재");
    if (isMissingOptionReference(textbooks, textbookId)) blockers.push("교재");
    if (!hasCompletionReference(wordRetest.testAt, wordRetest.test_at)) blockers.push("응시일시");
    if (!hasCompletionReference(wordRetest.unit)) blockers.push("단원");
    if (shouldRequireBasicWordRetestScore(wordRetest)) blockers.push("점수");
  }

  getOpsTaskScheduleCompletionBlockers(scheduleInput, options).forEach((blocker) => blockers.push(blocker));
  return [...new Set(blockers)];
}

function registrationPipelinePrefix(value) {
  const match = text(value).match(/^\d(?:-\d)?\./);
  return match?.[0] || "";
}

export function isOpsTaskBasicConfirmationCandidate(input = {}, options = {}) {
  const type = text(input.type || "general");
  const status = text(input.status);
  if (type === "general" || CLOSED_STATUSES.has(status)) return false;
  if (status === "requested") return true;

  const blockers = getOpsTaskBasicCompletionBlockers(input, options);
  if (blockers.length === 0) return false;

  const registration = input.registration || {};
  if (type === "registration" && registrationPipelinePrefix(registration.pipelineStatus || registration.pipeline_status) === "6.") {
    return true;
  }

  return status === "in_progress";
}

export function getRegistrationCompletionSyncItems(input = {}, options = {}) {
  if (input.type && input.type !== "registration") return [];

  const students = Array.isArray(options.students) ? options.students : [];
  const classes = Array.isArray(options.classes) ? options.classes : [];
  const textbooks = Array.isArray(options.textbooks) ? options.textbooks : [];
  const registration = input.registration || {};
  const student = findStudentReference(students, input.studentId, input.studentName, registration.studentName);
  const classItem = findClassReference(classes, input.classId, input.className);
  const classLinked = Boolean(text(input.classId || input.className));
  const textbookId = getRegistrationEffectiveTextbookId(input, { classes });
  const textbook = findTextbookReference(textbooks, textbookId, input.textbookTitle, input.textbookName);
  const classTextbookIdList = classTextbookIds(classItem);
  const studentLinked = Boolean(text(input.studentId));
  const studentNamed = Boolean(text(input.studentName || input.registration?.studentName));
  const studentIdentified = studentLinked || studentNamed;
  const studentLabel = referenceLabel(student, input.studentName || input.registration?.studentName || input.studentId);
  const classLabel = referenceLabel(classItem, input.className || input.classId);
  const textbookLabel = referenceLabel(textbook, input.textbookTitle || input.textbookName || textbookId);
  const classStudentIds = (classItem?.studentIds || classItem?.student_ids || [])
    .map(text)
    .filter(Boolean);
  const rosterState = !studentIdentified || !classLinked
    ? "missing"
    : studentLinked && classStudentIds.includes(text(input.studentId))
      ? "already_linked"
      : "will_add";

  return [
    {
      label: "학생관리",
      state: studentLinked ? "will_link" : studentNamed ? "will_create" : "missing",
      detail: studentLabel,
    },
    {
      label: "수업명단",
      state: rosterState,
      detail: detailLabel(studentLabel, classLabel),
    },
    {
      label: "교재 연결",
      state: !textbookId || !classLinked
        ? "missing"
        : classTextbookIdList.includes(textbookId)
          ? "already_linked"
          : "will_link",
      detail: detailLabel(classLabel, textbookLabel),
    },
    {
      label: "교재 청구/출고",
      state: studentIdentified && classLinked && textbookId ? "will_create" : "missing",
      detail: detailLabel(studentLabel, classLabel, textbookLabel),
    },
    {
      label: "교재 준비",
      state: !studentIdentified || !classLinked || !textbookId
        ? "missing"
        : registration.textbookReady || registration.textbook_ready
          ? "already_linked"
          : "will_check",
      detail: detailLabel(studentLabel, textbookLabel),
    },
  ];
}

function checkedText(value, doneLabel, missingLabel) {
  return value ? doneLabel : missingLabel;
}

export function getRegistrationCompletionReviewItems(input = {}) {
  if (input.type && input.type !== "registration") return [];

  const registration = input.registration || {};
  return [
    {
      label: "원장 분석",
      value: reviewText(registration.principalReviewNote || registration.principal_review_note, "분석 미입력"),
    },
    {
      label: "반배정",
      value: checkedText(
        registration.principalPlacementChecked || registration.principal_placement_checked,
        "원장 반배정 완료",
        "원장 반배정 미완료",
      ),
    },
    {
      label: "수업 시작",
      value: detailLabel(
        reviewText(input.className || registration.className || registration.class_name, "수업 미선택"),
        reviewText(toDateKey(registration.classStartDate || registration.class_start_date), "시작일 미입력"),
        reviewText(registration.classStartSession || registration.class_start_session, "회차 미입력"),
      ),
    },
    {
      label: "교재",
      value: reviewText(input.textbookTitle || registration.textbookTitle || registration.textbook_title, "교재 미선택"),
    },
    {
      label: "메이크에듀",
      value: `${checkedText(registration.makeeduRegistered || registration.makeedu_registered, "등록 완료", "등록 미완료")} / ${checkedText(registration.makeeduInvoiceSent || registration.makeedu_invoice_sent, "청구서 발송", "청구서 미발송")}`,
    },
  ];
}

export function getWithdrawalCompletionSyncItems(input = {}, options = {}) {
  if (input.type && input.type !== "withdrawal") return [];

  const students = Array.isArray(options.students) ? options.students : [];
  const classes = Array.isArray(options.classes) ? options.classes : [];
  const withdrawal = input.withdrawal || {};
  const student = findStudentReference(students, input.studentId, input.studentName, withdrawal.studentName);
  const classItem = findClassReference(classes, input.classId, input.className);
  const studentLinked = Boolean(student);
  const classLinked = Boolean(classItem);
  const rosterLinked = studentLinked && classLinked && hasRosterLink(student, classItem);
  const studentLabel = studentLinked ? referenceLabel(student, input.studentName) : "";
  const classLabel = classLinked ? referenceLabel(classItem, input.className) : "";
  const rosterDetail = [studentLabel, classLabel].filter(Boolean).join(" · ");

  return [
    {
      label: "수업명단",
      state: rosterLinked ? "will_remove" : "missing",
      detail: rosterDetail,
    },
    {
      label: "학생 상태",
      state: studentLinked ? "will_mark_withdrawn" : "missing",
      detail: studentLinked ? studentLabel : "",
    },
  ];
}

export function getTransferCompletionSyncItems(input = {}, options = {}) {
  if (input.type && input.type !== "transfer") return [];

  const students = Array.isArray(options.students) ? options.students : [];
  const classes = Array.isArray(options.classes) ? options.classes : [];
  const transfer = input.transfer || {};
  const student = findStudentReference(students, input.studentId, input.studentName, transfer.studentName);
  const fromClass = findClassReference(classes, transfer.fromClassId, transfer.fromClassName);
  const toClass = findClassReference(classes, transfer.toClassId || input.classId, transfer.toClassName || input.className);
  const studentLinked = Boolean(student);
  const fromRosterLinked = studentLinked && fromClass && hasRosterLink(student, fromClass);
  const toClassLinked = Boolean(toClass);
  const toRosterLinked = studentLinked && toClassLinked && hasRosterLink(student, toClass);
  const studentLabel = studentLinked ? referenceLabel(student, input.studentName) : "";
  const fromClassLabel = fromClass ? referenceLabel(fromClass, transfer.fromClassName) : "";
  const toClassLabel = toClass ? referenceLabel(toClass, transfer.toClassName || input.className) : "";
  const fromDetail = [studentLabel, fromClassLabel].filter(Boolean).join(" · ");
  const toDetail = [studentLabel, toClassLabel].filter(Boolean).join(" · ");

  return [
    {
      label: "전 수업명단",
      state: fromRosterLinked ? "will_remove" : "missing",
      detail: fromDetail,
    },
    {
      label: "후 수업명단",
      state: !studentLinked || !toClassLinked ? "missing" : toRosterLinked ? "already_linked" : "will_add",
      detail: studentLinked && toClassLinked ? toDetail : "",
    },
    {
      label: "학생 상태",
      state: studentLinked ? "will_mark_active" : "missing",
      detail: studentLinked ? studentLabel : "",
    },
  ];
}

function reviewText(value, fallback = "미입력") {
  return text(value) || fallback;
}

export function getWithdrawalCompletionReviewItems(input = {}) {
  if (input.type && input.type !== "withdrawal") return [];

  const withdrawal = input.withdrawal || {};
  return [
    {
      label: "수업",
      value: reviewText(input.className || withdrawal.className || withdrawal.class_name),
    },
    {
      label: "선생님",
      value: reviewText(withdrawal.teacherName || withdrawal.teacher_name, "선생님 미입력"),
    },
    {
      label: "퇴원 일정",
      value: detailLabel(
        reviewText(toDateKey(withdrawal.withdrawalDate || withdrawal.withdrawal_date)),
        reviewText(withdrawal.withdrawalSession || withdrawal.withdrawal_session, "회차 미입력"),
      ),
    },
    {
      label: "정산 기준",
      value: `진행 ${reviewText(withdrawal.completedLessonHours || withdrawal.completed_lesson_hours)} / 4주 ${reviewText(withdrawal.fourWeekLessonHours || withdrawal.four_week_lesson_hours)}`,
    },
    {
      label: "미배부 교재",
      value: reviewText(withdrawal.undistributedTextbooks || withdrawal.undistributed_textbooks),
    },
    {
      label: "선생님 의견",
      value: reviewText(withdrawal.teacherOpinion || withdrawal.teacher_opinion, "의견 미입력"),
    },
  ];
}

export function getTransferCompletionReviewItems(input = {}) {
  if (input.type && input.type !== "transfer") return [];

  const transfer = input.transfer || {};
  const fromTextbooks = reviewText(transfer.fromUndistributedTextbooks || transfer.from_undistributed_textbooks);
  const toTextbooks = reviewText(transfer.toUndistributedTextbooks || transfer.to_undistributed_textbooks);
  const fromTeacher = reviewText(transfer.fromTeacherName || transfer.from_teacher_name, "선생님 미입력");
  const toTeacher = reviewText(transfer.toTeacherName || transfer.to_teacher_name, "선생님 미입력");

  return [
    {
      label: "전 수업 종료",
      value: detailLabel(
        reviewText(transfer.fromClassName || transfer.from_class_name),
        reviewText(toDateKey(transfer.fromClassEndDate || transfer.from_class_end_date)),
        reviewText(transfer.fromClassEndSession || transfer.from_class_end_session, "회차 미입력"),
      ),
    },
    {
      label: "후 수업 시작",
      value: detailLabel(
        reviewText(transfer.toClassName || transfer.to_class_name || input.className),
        reviewText(toDateKey(transfer.toClassStartDate || transfer.to_class_start_date)),
        reviewText(transfer.toClassStartSession || transfer.to_class_start_session, "회차 미입력"),
      ),
    },
    {
      label: "선생님",
      value: `전 ${fromTeacher} / 후 ${toTeacher}`,
    },
    {
      label: "미배부 교재",
      value: `전 ${fromTextbooks} / 후 ${toTextbooks}`,
    },
  ];
}

export function getWordRetestCompletionReviewItems(input = {}, options = {}) {
  if (input.type && input.type !== "word_retest") return [];

  const wordRetest = input.wordRetest || input.word_retest || {};
  const executionSummary = getWordRetestExecutionSummary(input, options) || {};
  const scoreLabel = executionSummary.scoreLabel || getWordRetestScoreLabel(wordRetest);
  const stageLabel = executionSummary.stageLabel || "상태 미입력";

  return [
    {
      label: "수업",
      value: reviewText(input.className || input.class_name || wordRetest.className || wordRetest.class_name, "수업 미선택"),
    },
    {
      label: "선생님",
      value: reviewText(wordRetest.teacherName || wordRetest.teacher_name, "선생님 미입력"),
    },
    {
      label: "응시 일정",
      value: detailLabel(
        reviewText(toDateKey(wordRetest.testAt || wordRetest.test_at || input.dueAt || input.due_at), "응시일 미입력"),
        reviewText(wordRetest.branch || wordRetest.branch_name || input.campus || input.branch, "지점 미입력"),
      ),
    },
    {
      label: "범위",
      value: detailLabel(
        reviewText(input.textbookTitle || input.textbook_title || wordRetest.textbookName || wordRetest.textbook_name, "교재 미선택"),
        reviewText(wordRetest.unit || wordRetest.scope || wordRetest.range, "단원 미입력"),
      ),
    },
    {
      label: "응시 결과",
      value: detailLabel(stageLabel, scoreLabel),
    },
  ];
}

export function getRegistrationEffectiveTextbookId(input = {}, options = {}) {
  const explicitTextbookId = text(input.textbookId);
  if (explicitTextbookId) return explicitTextbookId;

  const classes = Array.isArray(options.classes) ? options.classes : [];
  const classItem = findClassReference(classes, input.classId, input.className);
  return classSingleTextbookId(classItem);
}

function toMonthKey(value) {
  return toDateKey(value).slice(0, 7);
}

function getTextbookSalePrice(textbook = {}) {
  return moneyNumber(textbook.sale_price || textbook.salePrice || textbook.price || textbook.list_price || textbook.listPrice);
}

export function buildRegistrationTextbookSaleDraft({
  input = {},
  student = {},
  classRow = {},
  textbook = {},
} = {}) {
  const registration = input.registration || {};
  const studentId = text(student.id || input.studentId);
  const classId = text(classRow.id || input.classId);
  const textbookId = text(textbook.id || input.textbookId) || classSingleTextbookId(classRow);
  const chargeMonth = toMonthKey(registration.classStartDate || input.dueAt || new Date());

  if (!studentId || !classId || !textbookId || !chargeMonth) return null;

  const studentLabel = text(student.name || input.studentName) || studentId;
  const classLabel = text(classRow.name || input.className) || classId;
  const textbookLabel = text(textbook.title || textbook.name || input.textbookTitle) || textbookId;

  return {
    sale: {
      class_id: classId,
      charge_month: chargeMonth,
      status: "charged",
      memo: `등록 자동 생성 · ${classLabel}`,
    },
    line: {
      student_id: studentId,
      class_id: classId,
      textbook_id: textbookId,
      charge_month: chargeMonth,
      quantity: 1,
      unit_price: getTextbookSalePrice(textbook),
      status: "charged",
      memo: `등록 자동 생성 · ${studentLabel} · ${textbookLabel}`,
    },
  };
}

export function isWordRetestScoreValue(value) {
  const scoreText = text(value);
  if (!scoreText) return false;
  if (!/^\d{1,3}$/.test(scoreText)) return false;

  const score = Number(scoreText);
  return Number.isInteger(score) && score >= 0 && score <= 100;
}

function hasWordRetestScore(detail = {}) {
  return [
    detail.firstScore,
    detail.secondScore,
    detail.thirdScore,
    detail.first_score,
    detail.second_score,
    detail.third_score,
  ].some((score) => isWordRetestScoreValue(score));
}

export function getWordRetestExecutionStage(task = {}, options = {}) {
  if (task.type && task.type !== "word_retest") return "other";

  const detail = task.wordRetest || task.word_retest || {};
  const retestStatus = text(detail.retestStatus || detail.retest_status);
  const taskStatus = text(task.status);
  const testAt = detail.testAt || detail.test_at || task.dueAt || task.due_at;
  const testDate = toDateKey(testAt);
  const today = text(options.today) || toDateKey(new Date());
  const hasScore = hasWordRetestScore(detail);

  if (retestStatus === "absent") return "absent";
  if (retestStatus === "done" && !hasScore) return "needs_score";
  if (CLOSED_STATUSES.has(taskStatus) && !hasScore) return "needs_score";
  if (CLOSED_STATUSES.has(taskStatus) || retestStatus === "done") return "done";
  if (hasScore) return "in_progress";
  if (retestStatus === "in_progress" || taskStatus === "in_progress") return "in_progress";
  if (testDate && testDate < today && !hasScore) return "needs_score";
  if (testDate === today && !hasScore && isWordRetestTestTimePassed(testAt, options.now)) return "needs_score";
  if (testDate === today) return "today";
  return "upcoming";
}

export function isOpsTaskActionable(task = {}, options = {}) {
  const taskStatus = text(task.status);
  if (!CLOSED_STATUSES.has(taskStatus)) return true;
  if (taskStatus === "canceled" || task.type !== "word_retest") return false;

  const stage = getWordRetestExecutionStage(task, options);
  return stage === "needs_score" || stage === "absent";
}

const WORD_RETEST_EXECUTION_STAGE_LABELS = {
  needs_score: "점수 입력",
  in_progress: "진행 중",
  today: "오늘 응시",
  absent: "미응시",
  upcoming: "예정",
  done: "완료",
  other: "기타",
};

function getWordRetestScoreLabel(detail = {}) {
  const scores = [
    ["1차", detail.firstScore ?? detail.first_score],
    ["2차", detail.secondScore ?? detail.second_score],
    ["3차", detail.thirdScore ?? detail.third_score],
  ]
    .map(([label, value]) => {
      const score = text(value);
      if (!score) return "";
      return isWordRetestScoreValue(score) ? `${label} ${score}` : `${label} 확인 필요`;
    })
    .filter(Boolean);

  return scores.length > 0 ? scores.join(" · ") : "점수 없음";
}

function timeKey(value) {
  const raw = text(value);
  const match = raw.match(/[T\s](\d{2}:\d{2})/);
  return match?.[1] || "";
}

function wordRetestTestAtLabel(value) {
  const date = toDateKey(value);
  if (!date) return "";

  const time = timeKey(value);
  return `응시 ${[date, time].filter(Boolean).join(" ")}`;
}

function isWordRetestTestTimePassed(testAt, nowValue) {
  if (!timeKey(testAt) || !nowValue) return false;

  const testTime = Date.parse(text(testAt));
  const nowTime = nowValue instanceof Date ? nowValue.getTime() : Date.parse(text(nowValue));
  return Number.isFinite(testTime) && Number.isFinite(nowTime) && testTime < nowTime;
}

export function getWordRetestExecutionSummary(task = {}, options = {}) {
  if (task.type && task.type !== "word_retest") return null;

  const detail = task.wordRetest || task.word_retest || {};
  const stage = getWordRetestExecutionStage(task, options);
  const testAt = detail.testAt || detail.test_at || task.dueAt || task.due_at;
  const teacherLabel = text(detail.teacherName || detail.teacher_name || task.teacherName || task.teacher_name || task.assigneeLabel);
  const textbookLabel = text(
    detail.textbookTitle ||
    detail.textbook_title ||
    detail.textbookName ||
    detail.textbook_name ||
    task.textbookTitle ||
    task.textbook_title ||
    task.textbookName ||
    task.textbook_name,
  );
  const unitLabel = text(detail.unit);

  return {
    stage,
    stageLabel: WORD_RETEST_EXECUTION_STAGE_LABELS[stage] || WORD_RETEST_EXECUTION_STAGE_LABELS.other,
    scoreLabel: getWordRetestScoreLabel(detail),
    branchLabel: text(detail.branch || detail.branch_name || task.campus || task.branch),
    testAtLabel: wordRetestTestAtLabel(testAt),
    teacherLabel,
    scopeLabel: [textbookLabel, unitLabel].filter(Boolean).join(" · "),
  };
}

const WORD_RETEST_EXECUTION_STAGE_ORDER = {
  needs_score: 0,
  in_progress: 1,
  today: 2,
  absent: 3,
  upcoming: 4,
  done: 5,
  other: 6,
};

function dateTimeSortValue(value) {
  const rawValue = text(value);
  if (!rawValue) return "";

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(rawValue)) return rawValue;

  const date = toDateKey(rawValue);
  return date ? `${date}T00:00` : "";
}

export function sortWordRetestExecutionQueue(tasks = [], options = {}) {
  return [...tasks].sort((left, right) => {
    const leftStage = getWordRetestExecutionStage(left, options);
    const rightStage = getWordRetestExecutionStage(right, options);
    const stageGap = (WORD_RETEST_EXECUTION_STAGE_ORDER[leftStage] ?? 99) - (WORD_RETEST_EXECUTION_STAGE_ORDER[rightStage] ?? 99);
    if (stageGap !== 0) return stageGap;

    const leftDetail = left.wordRetest || left.word_retest || {};
    const rightDetail = right.wordRetest || right.word_retest || {};
    const leftTime = dateTimeSortValue(leftDetail.testAt || leftDetail.test_at || left.dueAt || left.due_at);
    const rightTime = dateTimeSortValue(rightDetail.testAt || rightDetail.test_at || right.dueAt || right.due_at);
    if (leftTime && rightTime && leftTime !== rightTime) return leftTime.localeCompare(rightTime);
    if (leftTime && !rightTime) return -1;
    if (!leftTime && rightTime) return 1;
    return text(left.title || left.id).localeCompare(text(right.title || right.id), "ko");
  });
}

export function isWordRetestInExecutionQueue(task = {}, queue = "all", options = {}) {
  const stage = getWordRetestExecutionStage(task, options);
  if (stage === "other") return false;
  if (queue === "all") return true;
  return stage === queue;
}

export function isWordRetestInBranchQueue(task = {}, branch = "all") {
  if (task.type && task.type !== "word_retest") return false;
  if (branch === "all") return true;

  const detail = task.wordRetest || task.word_retest || {};
  const branchText = text(detail.branch || detail.branch_name || task.campus || task.branch);
  if (!branchText) return false;

  if (branch === "본관") return branchText.includes("본관");
  if (branch === "별관") return branchText.includes("별관");
  return false;
}

export function getWordRetestAssistantQuickActions(task = {}, options = {}) {
  const stage = getWordRetestExecutionStage(task, options);
  const detail = task.wordRetest || task.word_retest || {};
  const hasScore = hasWordRetestScore(detail);

  if (stage === "today") {
    return [
      { key: "start", label: "응시 시작", kind: "status", status: "in_progress", retestStatus: "in_progress" },
      { key: "absent", label: "미응시", kind: "status", status: "confirmed", retestStatus: "absent", clearScores: true },
    ];
  }

  if (stage === "in_progress" || stage === "needs_score") {
    if (hasScore) {
      return [
        { key: "score", label: "점수 수정", kind: "edit_scores" },
        { key: "done", label: "완료", kind: "status", status: "done", retestStatus: "done" },
      ];
    }

    return [
      { key: "quick_score", label: "점수 저장", kind: "quick_score", status: "done", retestStatus: "done", scoreField: "firstScore" },
      { key: "absent", label: "미응시", kind: "status", status: "confirmed", retestStatus: "absent", clearScores: true },
    ];
  }

  return [];
}

export function buildWordRetestAssistantActionPatch(task = {}, action = {}) {
  if (task.type && task.type !== "word_retest") return null;
  if (action.kind === "edit_scores") return null;

  const detail = task.wordRetest || task.word_retest || {};
  const nextWordRetest = {
    ...detail,
    retestStatus: action.retestStatus || detail.retestStatus || detail.retest_status || "not_started",
    firstScore: action.clearScores ? "" : text(detail.firstScore ?? detail.first_score),
    secondScore: action.clearScores ? "" : text(detail.secondScore ?? detail.second_score),
    thirdScore: action.clearScores ? "" : text(detail.thirdScore ?? detail.third_score),
  };

  if (action.kind === "quick_score") {
    const score = text(action.score);
    if (!isWordRetestScoreValue(score)) return null;
    const scoreField = text(action.scoreField) || "firstScore";
    nextWordRetest[scoreField] = score;
  }

  return {
    status: action.status || task.status || "requested",
    wordRetest: nextWordRetest,
  };
}

export function buildWordRetestRerequestDraft(task = {}, options = {}) {
  if (task.type !== "word_retest") return null;
  const detail = task.wordRetest || task.word_retest || {};
  if (text(detail.retestStatus || detail.retest_status) !== "absent") return null;

  const nextTestAt = text(options.nextTestAt || options.testAt);
  const previousDate = toDateKey(detail.testAt || detail.test_at || task.dueAt || task.due_at);
  const previousNote = text(detail.requestNote || detail.request_note);
  const requestNote = ["미응시 재요청", previousDate, previousNote].filter(Boolean).join(" · ");
  const studentName = text(task.studentName || task.student_name || detail.studentName || detail.student_name);
  const textbookTitle = text(task.textbookTitle || task.textbook_title || detail.textbookName || detail.textbook_name);
  const branch = text(detail.branch || detail.branch_name || task.campus || task.branch);
  const teacherId = text(detail.teacherId || detail.teacher_id);

  return {
    title: `${studentName || "학생"} 단어 재시험 재요청`,
    type: "word_retest",
    status: "requested",
    priority: text(task.priority) || "normal",
    assigneeId: text(task.assigneeId || task.assignee_id),
    secondaryAssigneeId: "",
    studentId: text(task.studentId || task.student_id),
    studentName,
    classId: text(task.classId || task.class_id),
    className: text(task.className || task.class_name || detail.className || detail.class_name),
    textbookId: text(task.textbookId || task.textbook_id),
    textbookTitle,
    campus: branch,
    subject: text(task.subject),
    dueAt: nextTestAt,
    memo: "",
    wordRetest: {
      branch,
      teacherId,
      teacherName: text(detail.teacherName || detail.teacher_name),
      textbookName: textbookTitle,
      unit: text(detail.unit),
      testAt: nextTestAt,
      retestStatus: "not_started",
      firstScore: "",
      secondScore: "",
      thirdScore: "",
      requestNote,
    },
  };
}

export function isWordRetestRerequestable(task = {}) {
  return Boolean(buildWordRetestRerequestDraft(task));
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
      if (!includeClosed && !isOpsTaskActionable(task)) return [];

      const items = [];
      addCalendarItem(items, task, "예정", task.dueAt || task.due_at);

      if (task.type === "registration") {
        const detail = task.registration || {};
        addCalendarItem(items, task, "문의", detail.inquiryAt || detail.inquiry_at);
        addCalendarItem(items, task, "전화상담", detail.phoneConsultationAt || detail.phone_consultation_at);
        addCalendarItem(items, task, "방문상담", detail.visitConsultationAt || detail.visit_consultation_at);
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
  if (!targetDate || !isOpsTaskActionable(task, { today: targetDate })) return false;
  return getOpsTaskCalendarItems([task]).some((item) => item.date === targetDate);
}

export function hasOpsTaskOverdueCalendarDate(task = {}, dateKey = "") {
  const targetDate = toDateKey(dateKey);
  if (!targetDate || !isOpsTaskActionable(task, { today: targetDate })) return false;
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
  const openTasks = (tasks || []).filter((task) => isOpsTaskActionable(task, { today }));

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
