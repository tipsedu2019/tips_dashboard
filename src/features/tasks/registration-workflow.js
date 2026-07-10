import { REGISTRATION_PIPELINE_STATUSES } from "./ops-task-model.js";

const REGISTRATION_PIPELINE_ORDER = [
  "0.",
  "1.",
  "1-1.",
  "2.",
  "3.",
  "4-1.",
  "4-2.",
  "4-3.",
  "5.",
  "5-1.",
  "6.",
  "7.",
  "8.",
  "9.",
];

const REGISTRATION_DECISION_ACTIONS = [
  { prefix: "5.", label: "입학 등록", tone: "primary" },
  { prefix: "4-1.", label: "현재반 대기", tone: "outline" },
  { prefix: "4-2.", label: "신규반 대기", tone: "outline" },
  { prefix: "4-3.", label: "다음 개강 알림", tone: "outline" },
  { prefix: "8.", label: "미등록", tone: "outline" },
  { prefix: "9.", label: "문의만", tone: "outline" },
];

const REGISTRATION_GRADE_OPTIONS = [
  "초1",
  "초2",
  "초3",
  "초4",
  "초5",
  "초6",
  "중1",
  "중2",
  "중3",
  "고1",
  "고2",
  "고3",
];

const REGISTRATION_FORM_STAGES = ["inquiry", "level_test", "consultation", "placement", "admission"];

const REGISTRATION_FILTER_DEFAULTS = Object.freeze({
  selectedSubjectFilter: "all",
  selectedCounselorFilter: "all",
  selectedGradeFilter: "all",
  registrationPeriodFilter: "all",
  registrationPeriodStartDate: "",
  registrationPeriodEndDate: "",
  filterValue: "",
});

const REGISTRATION_BLOCKER_FOCUS_KEYS = {
  "학생": "studentName",
  "학생명": "studentName",
  "학부모 전화": "parentPhone",
  "과목": "subject",
  "레벨테스트 예약일시": "levelTestAt",
  "레벨테스트 장소": "levelTestPlace",
  "레벨테스트 완료일시": "levelTestCompletedAt",
  "레벨테스트 결과": "levelTestResult",
  "상담 예약일시": "consultationAtReservation",
  "방문상담실": "visitConsultationPlace",
  "상담 완료일시": "consultationAt",
  "상담 책임자": "counselor",
  "수업": "classId",
  "교재": "textbookId",
  "수업시작일": "classStartDate",
  "입학신청서": "admissionNoticeSent",
  "수납 완료": "paymentChecked",
  "메이크에듀 등록": "makeeduRegistered",
  "청구서 발송": "makeeduInvoiceSent",
  "교재 청구출고표": "textbookBillingIssued",
};

function text(value) {
  return String(value || "").trim();
}

function hasValue(value) {
  return text(value).length > 0;
}

function statusForPrefix(prefix) {
  return REGISTRATION_PIPELINE_STATUSES.find((status) => text(status.value).startsWith(prefix))?.value || "";
}

export function getRegistrationPipelinePrefix(value) {
  const match = text(value).match(/^\d(?:-\d)?\./);
  return match?.[0] || "";
}

export function getRegistrationDecisionActions() {
  return REGISTRATION_DECISION_ACTIONS.map((action) => ({ ...action }));
}

export function getRegistrationGradeOptions() {
  return [...REGISTRATION_GRADE_OPTIONS];
}

export function isRegistrationClassWaitlistStatus(value) {
  const prefix = getRegistrationPipelinePrefix(value);
  return prefix === "4-1." || prefix === "4-2.";
}

export function isRegistrationTerminalStatus(value, taskStatus = "") {
  const prefix = getRegistrationPipelinePrefix(value);
  const normalizedTaskStatus = text(taskStatus);
  if (normalizedTaskStatus) return ["done", "canceled"].includes(normalizedTaskStatus);
  return ["7.", "8.", "9."].includes(prefix);
}

export function getRegistrationFormState(pipelineStatus, taskStatus = "") {
  const prefix = getRegistrationPipelinePrefix(pipelineStatus);
  const terminal = isRegistrationTerminalStatus(pipelineStatus, taskStatus);
  const historicalSection = ["1.", "1-1."].includes(prefix)
    ? "level_test"
    : ["2.", "3.", "8.", "9."].includes(prefix)
      ? "consultation"
      : ["4-1.", "4-2.", "4-3.", "5."].includes(prefix)
        ? "placement"
        : ["5-1.", "6.", "7."].includes(prefix)
          ? "admission"
          : "inquiry";
  const historicalIndex = REGISTRATION_FORM_STAGES.indexOf(historicalSection);

  return {
    activeSection: terminal ? null : historicalSection,
    editable: !terminal,
    enabledSections: terminal ? [] : REGISTRATION_FORM_STAGES.slice(0, historicalIndex + 1),
  };
}

/** @param {any} task */
export function canEditRegistrationTask(task = {}) {
  if (task.type && task.type !== "registration") return task.status !== "done";
  return !isRegistrationTerminalStatus(task.registration?.pipelineStatus, task.status);
}

export function normalizeRegistrationPhone(value) {
  const digits = text(value).replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  if (digits.length === 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}

export function isValidRegistrationMobilePhone(value) {
  const digits = text(value).replace(/\D/g, "");
  return /^01(?:0|1|[6-9])\d{7,8}$/.test(digits);
}

/** @param {any} input */
export function getRegistrationCreateBlockers(input = {}) {
  const blockers = [];
  if (!hasValue(input.studentName)) blockers.push("학생명");
  if (!hasValue(input.subject)) blockers.push("과목");
  if (!isValidRegistrationMobilePhone(input.registration?.parentPhone)) blockers.push("학부모 전화");
  return blockers;
}

export function getRegistrationCreateDefaults(now = new Date().toISOString()) {
  return {
    registration: {
      pipelineStatus: statusForPrefix("0.") || "0. 등록 문의",
      inquiryAt: now,
    },
  };
}

/** @param {any} task */
export function getRegistrationTransitionBlockers(task = {}, pipelineStatus = "") {
  const blockers = [];
  const registration = task.registration || {};
  const prefix = getRegistrationPipelinePrefix(pipelineStatus);

  if (prefix === "1.") {
    if (!hasValue(registration.levelTestAt)) blockers.push("레벨테스트 예약일시");
    if (!hasValue(registration.levelTestPlace)) blockers.push("레벨테스트 장소");
  }

  if (prefix === "1-1.") {
    if (!hasValue(registration.levelTestAt)) blockers.push("레벨테스트 예약일시");
    if (!hasValue(registration.levelTestCompletedAt)) blockers.push("레벨테스트 완료일시");
    if (!hasValue(registration.levelTestResult)) blockers.push("레벨테스트 결과");
  }

  if (prefix === "2.") {
    const hasPhoneConsultation = hasValue(registration.phoneConsultationAt);
    const hasVisitConsultation = hasValue(registration.visitConsultationAt);
    if (!hasPhoneConsultation && !hasVisitConsultation) blockers.push("상담 예약일시");
    if (hasVisitConsultation && !hasValue(registration.visitConsultationPlace)) blockers.push("방문상담실");
  }

  if (prefix === "3.") {
    if (!hasValue(registration.consultationAt)) blockers.push("상담 완료일시");
    if (!hasValue(registration.counselor)) blockers.push("상담 책임자");
  }

  if (isRegistrationClassWaitlistStatus(pipelineStatus)) {
    if (!hasValue(task.studentId || task.studentName)) blockers.push("학생");
    if (!hasValue(task.classId)) blockers.push("수업");
  }

  if (prefix === "4-3.") {
    if (!hasValue(task.studentId || task.studentName)) blockers.push("학생");
    if (!isValidRegistrationMobilePhone(registration.parentPhone)) blockers.push("학부모 전화");
  }

  if (prefix === "5.") {
    if (!hasValue(task.studentId || task.studentName)) blockers.push("학생");
    if (!isValidRegistrationMobilePhone(registration.parentPhone)) blockers.push("학부모 전화");
  }

  return [...new Set(blockers)];
}

export function shouldEnsureRegistrationStudent(pipelineStatus, completed = false) {
  return Boolean(completed || isRegistrationClassWaitlistStatus(pipelineStatus));
}

/** @param {{ classId?: string, studentClassIds?: string[] }} input */
export function getRegistrationWaitlistAssignmentBlockers({ classId = "", studentClassIds = [] } = {}) {
  if (hasValue(classId) && studentClassIds.map(text).includes(text(classId))) return ["이미 등록된 수업"];
  return [];
}

export function canSendRegistrationAdmissionMessage(pipelineStatus) {
  const prefix = getRegistrationPipelinePrefix(pipelineStatus);
  return ["5.", "5-1.", "6."].includes(prefix);
}

export function getManualAdmissionCompletionStatus(pipelineStatus) {
  return getRegistrationPipelinePrefix(pipelineStatus) === "5."
    ? statusForPrefix("5-1.") || "5-1. 입학신청서 발송 완료"
    : "";
}

function checklistAvailability(enabled, reason = "") {
  return { enabled: Boolean(enabled), reason: enabled ? "" : reason };
}

/** @param {any} input */
export function getRegistrationChecklistAvailability({ pipelineStatus = "", registration = {}, classId = "", textbookId = "" } = {}) {
  const prefix = getRegistrationPipelinePrefix(pipelineStatus);
  const admissionStage = ["5.", "5-1.", "6."].includes(prefix);
  const paymentStage = prefix === "6.";
  const operationsStage = prefix === "6.";
  const admissionReady = Boolean(registration.admissionNoticeSent);
  const paymentReady = Boolean(registration.paymentChecked);
  const makeEduReady = Boolean(registration.makeeduRegistered);

  return {
    admissionNoticeSent: checklistAvailability(admissionStage, "입학 등록 결정 후 확인할 수 있습니다."),
    paymentChecked: checklistAvailability(paymentStage && admissionReady, admissionReady ? "수납 확인 단계에서 확인할 수 있습니다." : "입학신청서 발송을 먼저 완료하세요."),
    makeeduRegistered: checklistAvailability(operationsStage && paymentReady, paymentReady ? "수납 확인 단계에서 확인할 수 있습니다." : "수납 완료를 먼저 확인하세요."),
    makeeduInvoiceSent: checklistAvailability(operationsStage && makeEduReady, makeEduReady ? "수납 확인 단계에서 확인할 수 있습니다." : "메이크에듀 등록을 먼저 완료하세요."),
    textbookBillingIssued: checklistAvailability(
      operationsStage && paymentReady && hasValue(classId) && hasValue(textbookId),
      !paymentReady ? "수납 완료를 먼저 확인하세요." : !hasValue(classId) || !hasValue(textbookId) ? "수업과 교재를 먼저 연결하세요." : "수납 확인 단계에서 확인할 수 있습니다.",
    ),
  };
}

export function getRegistrationFilterColumnChange(_currentValue, nextColumnKey) {
  return { filterColumnKey: nextColumnKey, filterValue: "" };
}

export function isRegistrationFilterInputExpanded(filterInputOpen) {
  return Boolean(filterInputOpen);
}

export function getEmptyRegistrationFilters() {
  return { ...REGISTRATION_FILTER_DEFAULTS };
}

/** @param {Record<string, unknown>} filters */
export function hasActiveRegistrationFilters(filters = {}) {
  return Object.entries(REGISTRATION_FILTER_DEFAULTS).some(([key, defaultValue]) => text(filters[key]) !== text(defaultValue));
}

export function normalizeRegistrationDateRange(startDate, endDate) {
  const start = text(startDate);
  const end = text(endDate);
  if (start && end && start > end) return { start: end, end: start };
  return { start, end };
}

function checklistSortValue(registration = {}) {
  return [
    registration.admissionNoticeSent,
    registration.paymentChecked,
    registration.makeeduRegistered,
    registration.makeeduInvoiceSent,
    registration.timetableRosterUpdated,
    registration.textbookReady,
    registration.textbookBillingIssued,
  ].filter(Boolean).length;
}

/** @param {any} task */
export function getRegistrationSortValue(task = {}, columnKey = "") {
  const registration = task.registration || {};
  if (columnKey === "pipelineStatus") {
    const index = REGISTRATION_PIPELINE_ORDER.indexOf(getRegistrationPipelinePrefix(registration.pipelineStatus));
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  }
  if (columnKey === "inquiryAt") return Date.parse(registration.inquiryAt || "") || 0;
  if (columnKey === "levelTestAt") return Date.parse(registration.levelTestAt || "") || 0;
  if (columnKey === "phoneConsultationAt") return Date.parse(registration.phoneConsultationAt || "") || 0;
  if (columnKey === "visitConsultationAt") return Date.parse(registration.visitConsultationAt || "") || 0;
  if (columnKey === "classStartDate") return Date.parse(registration.classStartDate || "") || 0;
  if (columnKey === "operationsChecklist") return checklistSortValue(registration);
  const values = {
    subject: task.subject,
    schoolGrade: registration.schoolGrade,
    schoolName: registration.schoolName,
    student: task.studentName,
    parentPhone: text(registration.parentPhone).replace(/\D/g, ""),
    inquiryChannel: registration.inquiryChannel,
    counselor: registration.counselor,
    className: task.className,
    classStartSession: registration.classStartSession,
    requestNote: registration.requestNote,
  };
  return text(values[columnKey]).toLocaleLowerCase("ko");
}

/** @param {any} left @param {any} right */
export function compareRegistrationTasks(left, right, columnKey, direction = "asc") {
  const leftValue = getRegistrationSortValue(left, columnKey);
  const rightValue = getRegistrationSortValue(right, columnKey);
  const result = typeof leftValue === "number" && typeof rightValue === "number"
    ? leftValue - rightValue
    : String(leftValue).localeCompare(String(rightValue), "ko", { numeric: true });
  return direction === "asc" ? result : -result;
}

export function shouldShowRegistrationCompletionBlockers(pipelineStatus) {
  return getRegistrationPipelinePrefix(pipelineStatus) === "6.";
}

export function getRegistrationReopenStatus(pipelineStatus) {
  return ["8.", "9."].includes(getRegistrationPipelinePrefix(pipelineStatus))
    ? statusForPrefix("3.") || "3. 상담 완료"
    : "";
}

export function getRegistrationBlockerFocusKey(blocker) {
  return REGISTRATION_BLOCKER_FOCUS_KEYS[text(blocker)] || "";
}

export function getRegistrationMobileSections(pipelineStatus) {
  const prefix = getRegistrationPipelinePrefix(pipelineStatus);
  if (["1.", "1-1."].includes(prefix)) return ["inquiry", "level_test"];
  if (["2.", "3.", "8.", "9."].includes(prefix)) return ["inquiry", "level_test", "consultation"];
  if (["4-1.", "4-2.", "4-3.", "5."].includes(prefix)) return ["inquiry", "level_test", "consultation", "placement"];
  if (["5-1.", "6.", "7."].includes(prefix)) return [...REGISTRATION_FORM_STAGES];
  return ["inquiry"];
}

export function getRegistrationViewKey(pipelineStatus, taskStatus = "") {
  const prefix = getRegistrationPipelinePrefix(pipelineStatus);
  if (prefix === "0.") return "inquiry";
  if (["1.", "1-1.", "2.", "3."].includes(prefix)) return "consulting";
  if (["4-1.", "4-2.", "4-3."].includes(prefix)) return "waiting";
  if (["5.", "5-1.", "6."].includes(prefix)) return "enrollment";
  if (["7.", "8.", "9."].includes(prefix)) return "closed";
  return ["done", "canceled"].includes(text(taskStatus)) ? "closed" : "inquiry";
}
