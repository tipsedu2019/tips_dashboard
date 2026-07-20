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

const REGISTRATION_WAIT_ACTIONS = [
  { prefix: "4-1.", label: "현재 학기 수강반 대기", tone: "outline" },
  { prefix: "4-2.", label: "현재 학기 개강반 대기", tone: "outline" },
  { prefix: "4-3.", label: "다음 학기 개강반 대기", tone: "outline" },
];

const REGISTRATION_BRANCH_ACTIONS = Object.freeze({
  "0.": Object.freeze([
    Object.freeze({ prefix: "1.", label: "레벨테스트 예약", tone: "primary" }),
    Object.freeze({ prefix: "2.", label: "상담 예약", tone: "outline" }),
    ...REGISTRATION_WAIT_ACTIONS.map((action) => Object.freeze({ ...action })),
    Object.freeze({ prefix: "9.", label: "문의 완료", tone: "outline" }),
  ]),
  "3.": Object.freeze([
    Object.freeze({ prefix: "5.", label: "등록", tone: "primary" }),
    ...REGISTRATION_WAIT_ACTIONS.map((action) => Object.freeze({ ...action })),
    Object.freeze({ prefix: "8.", label: "미등록 완료", tone: "outline" }),
  ]),
  "4-1.": Object.freeze([
    Object.freeze({ prefix: "1.", label: "레벨테스트 재응시", tone: "outline" }),
    Object.freeze({ prefix: "5.", label: "재응시 없이 등록", tone: "primary" }),
  ]),
  "4-2.": Object.freeze([
    Object.freeze({ prefix: "1.", label: "레벨테스트 재응시", tone: "outline" }),
    Object.freeze({ prefix: "5.", label: "재응시 없이 등록", tone: "primary" }),
  ]),
  "4-3.": Object.freeze([
    Object.freeze({ prefix: "1.", label: "레벨테스트 재응시", tone: "outline" }),
    Object.freeze({ prefix: "5.", label: "재응시 없이 등록", tone: "primary" }),
  ]),
});

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

const REGISTRATION_SUBJECT_ORDER = ["영어", "수학"];
const REGISTRATION_TIME_START_MINUTES = 9 * 60;
const REGISTRATION_TIME_END_MINUTES = 21 * 60;
const REGISTRATION_TIME_STEP_MINUTES = 10;
export const REGISTRATION_TIME_OPTIONS = Array.from({
  length: Math.floor((REGISTRATION_TIME_END_MINUTES - REGISTRATION_TIME_START_MINUTES) / REGISTRATION_TIME_STEP_MINUTES) + 1,
}, (_, index) => {
  const totalMinutes = REGISTRATION_TIME_START_MINUTES + index * REGISTRATION_TIME_STEP_MINUTES;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
});
const REGISTRATION_FORM_STAGES = ["inquiry", "level_test", "consultation", "placement", "admission"];
const REGISTRATION_WORKFLOW_STAGES = Object.freeze([
  Object.freeze({
    key: "inquiry",
    label: "문의",
    summary: "기본 정보 입력 · 다음 방향 결정",
    details: Object.freeze([
      "입력 · 과목, 학생명, 학년, 학교, 학부모·학생 전화",
      "자동 기록 · 문의일시는 접수할 때 현재 시각으로 저장합니다.",
      "전이 · 레벨테스트 예약, 성적 기반 상담 예약, 대기, 문의 완료 중 다음 방향을 정합니다.",
      "예외 · 고1 1학기 내신 또는 모의고사 성적 제출 시 레벨테스트를 생략할 수 있습니다.",
    ]),
  }),
  Object.freeze({
    key: "level_test",
    label: "레벨테스트",
    summary: "예약 · 진행 · 결과 기록",
    details: Object.freeze([
      "입력 · 예약일시, 장소, 시험지·결과지 URL",
      "운영 · 예약 → 진행 → 결과 자료 기록 순서로 처리합니다.",
      "완료 · 시험지와 결과지를 Google Chat 또는 Drive에 올리고 시험지·결과지 URL을 기록합니다.",
    ]),
  }),
  Object.freeze({
    key: "consulting",
    label: "상담",
    summary: "전화상담 대기 · 방문상담 예약 · 결과 결정",
    details: Object.freeze([
      "전화 · 전화상담 대기 목록을 담당 원장이 순서대로 처리하며, 전화상담은 예약 없이 완료일시와 결과를 기록합니다.",
      "방문 · 방문상담 예약 시 예약일시, 상담실, 상담 책임자를 입력하고 담당자 대시보드와 관리팀 Google Chat에 알립니다.",
      "전이 · 상담 결과를 등록, 미등록 완료, 대기 중 하나로 결정합니다.",
    ]),
  }),
  Object.freeze({
    key: "waiting",
    label: "대기",
    summary: "대기 유형 · 재응시 확인",
    details: Object.freeze([
      "분류 · 현재 학기 수강반 대기, 현재 학기 개강반 대기, 다음 학기 개강반 대기",
      "확인 · 등록 전환 전에 레벨테스트 재응시 필요 여부를 확인합니다.",
      "전이 · 재응시 필요 시 레벨테스트 예약으로 돌아가고, 불필요하면 등록으로 이동합니다.",
    ]),
  }),
  Object.freeze({
    key: "enrollment",
    label: "등록",
    summary: "입학 · 수납 · 운영 처리",
    details: Object.freeze([
      "입력 · 입학 절차와 수업·교재 정보",
      "처리 · 입학신청서 발송 → MakeEdu 수업·교재 등록 → 청구서 발송 → 수납 완료 확인 순서로 처리합니다.",
      "완료 · 네 단계와 학생·수업·수업 시작 정보를 확인한 뒤 등록 완료로 이동합니다.",
    ]),
  }),
  Object.freeze({
    key: "closed",
    label: "완료",
    summary: "등록 또는 미등록으로 종료",
    details: Object.freeze([
      "결과 · 등록 완료 또는 미등록 완료로 닫습니다.",
      "이력 · 문의만 종료는 미등록 계열의 별도 이력으로 유지합니다.",
      "완료 · 닫힌 건은 명시적으로 다시 열기 전까지 운영 목록에서 분리합니다.",
    ]),
  }),
]);

const REGISTRATION_FILTER_DEFAULTS = Object.freeze({
  selectedSubjectFilter: "all",
  selectedCounselorFilter: "all",
  registrationPeriodFilter: "all",
  registrationPeriodStartDate: "",
  registrationPeriodEndDate: "",
  filterValue: "",
});

const REGISTRATION_BLOCKER_FOCUS_KEYS = {
  "학생": "studentName",
  "학생명": "studentName",
  "학년": "schoolGrade",
  "학부모 전화": "parentPhone",
  "문의일시": "inquiryAt",
  "과목": "subject",
  "레벨테스트 예약일시": "levelTestAt",
  "레벨테스트 장소": "levelTestPlace",
  "레벨테스트 완료일시": "levelTestCompletedAt",
  "레벨테스트 결과": "levelTestResult",
  "시험지·결과지 URL": "levelTestMaterialLink",
  "상담 예약일시": "consultationAtReservation",
  "방문상담 예약일시": "visitConsultationAt",
  "방문상담실": "visitConsultationPlace",
  "상담 완료일시": "consultationAt",
  "상담 책임자": "counselor",
  "수업": "classId",
  "교재": "textbookId",
  "수업시작일": "classStartDate",
  "입학신청서": "admissionNoticeSent",
  "입학신청서 발송": "admissionNoticeSent",
  "수납 완료": "paymentChecked",
  "수납 완료 확인": "paymentChecked",
  "메이크에듀 등록": "makeeduRegistered",
  "메이크에듀 등록(수업, 교재)": "makeeduRegistered",
  "청구서 발송": "makeeduInvoiceSent",
};

function text(value) {
  return String(value || "").trim();
}

function hasValue(value) {
  return text(value).length > 0;
}

function registrationScheduleDateKey(value) {
  return text(value).match(/^(\d{4}-\d{2}-\d{2})/)?.[1] || "";
}

/**
 * @typedef {{
 *   value: string,
 *   dateKey: string,
 *   sessionNumber: number,
 *   sessionLabel: string,
 *   state: string,
 * }} RegistrationScheduleSession
 */

/**
 * @param {any} schedulePlan
 * @param {{afterDateKey?: string}} [options]
 * @returns {RegistrationScheduleSession[]}
 */
export function getSelectableRegistrationScheduleSessions(schedulePlan, options = {}) {
  const sessions = Array.isArray(schedulePlan?.sessions)
    ? schedulePlan.sessions
    : Array.isArray(schedulePlan?.session_list)
      ? schedulePlan.session_list
      : [];
  const seen = new Set();

  return sessions.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const state = text(entry.scheduleState || entry.schedule_state || entry.state || "active").toLowerCase() || "active";
    if (!["active", "normal", "makeup"].includes(state)) return [];
    const dateKey = registrationScheduleDateKey(entry.date || entry.session_date || entry.dateValue || entry.date_value);
    if (options.afterDateKey && dateKey <= options.afterDateKey) return [];
    const rawSessionNumber = Number(entry.sessionNumber ?? entry.session_number);
    const sessionNumber = Number.isInteger(rawSessionNumber) ? rawSessionNumber : 0;
    if (!dateKey || sessionNumber <= 0) return [];
    const value = `${dateKey}:${sessionNumber}`;
    if (seen.has(value)) return [];
    seen.add(value);
    return [{ value, dateKey, sessionNumber, sessionLabel: `${sessionNumber}회차`, state }];
  }).sort((left, right) => left.dateKey.localeCompare(right.dateKey) || left.sessionNumber - right.sessionNumber);
}

/** @param {any} input */
export function resolveRegistrationLinkedTextbookDefault(input = {}) {
  const classId = text(input.classId);
  if (
    !classId ||
    text(input.pendingClassId) !== classId ||
    text(input.clearedClassId) === classId ||
    hasValue(input.textbookId)
  ) return "";

  const availableIds = new Set((Array.isArray(input.availableTextbookIds) ? input.availableTextbookIds : []).map(text).filter(Boolean));
  return (Array.isArray(input.linkedTextbookIds) ? input.linkedTextbookIds : [])
    .map(text)
    .find((textbookId) => availableIds.has(textbookId)) || "";
}

function statusForPrefix(prefix) {
  return REGISTRATION_PIPELINE_STATUSES.find((status) => text(status.value).startsWith(prefix))?.value || "";
}

export function getRegistrationPipelinePrefix(value) {
  const match = text(value).match(/^\d(?:-\d)?\./);
  return match?.[0] || "";
}

export function prepareRegistrationPipelineTransition(registration = {}, pipelineStatus = "", now = new Date().toISOString()) {
  const prefix = getRegistrationPipelinePrefix(pipelineStatus);
  return {
    ...registration,
    pipelineStatus,
    ...(prefix === "1-1." && !hasValue(registration.levelTestCompletedAt)
      ? { levelTestCompletedAt: now }
      : {}),
    ...(prefix === "3." && !hasValue(registration.consultationAt)
      ? { consultationAt: now }
      : {}),
  };
}

export function getRegistrationDecisionActions() {
  return getRegistrationBranchActions("3. 상담 완료");
}

export function getRegistrationBranchActions(pipelineStatus) {
  const prefix = getRegistrationPipelinePrefix(pipelineStatus);
  return (REGISTRATION_BRANCH_ACTIONS[prefix] || []).map((action) => ({ ...action }));
}

export function prepareRegistrationLevelTestRetry(registration = {}) {
  return {
    ...registration,
    pipelineStatus: statusForPrefix("1."),
    levelTestAt: "",
    levelTestCompletedAt: "",
    levelTestResult: "",
    levelTestMaterialLink: "",
  };
}

export function getRegistrationWorkflowStages() {
  return REGISTRATION_WORKFLOW_STAGES;
}

export function getRegistrationGradeOptions() {
  return [...REGISTRATION_GRADE_OPTIONS];
}

export function parseRegistrationSubjects(value) {
  const subjects = (Array.isArray(value) ? value : [value])
    .flatMap((item) => text(item).split(/[,·/+&]/))
    .map(text)
    .filter(Boolean);
  const uniqueSubjects = [...new Set(subjects)];

  return uniqueSubjects.sort((left, right) => {
    const leftIndex = REGISTRATION_SUBJECT_ORDER.indexOf(left);
    const rightIndex = REGISTRATION_SUBJECT_ORDER.indexOf(right);
    const leftOrder = leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex;
    const rightOrder = rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    return left.localeCompare(right, "ko", { numeric: true });
  });
}

export function serializeRegistrationSubjects(values = []) {
  return parseRegistrationSubjects(values).join(", ");
}

export function registrationSubjectIncludes(value, selectedSubject) {
  const selected = text(selectedSubject);
  if (!selected || selected === "all") return true;
  return parseRegistrationSubjects(value).includes(selected);
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
  const minimumEditableIndex = REGISTRATION_FORM_STAGES.indexOf("consultation");

  return {
    activeSection: terminal ? null : historicalSection,
    editable: !terminal,
    enabledSections: terminal
      ? []
      : REGISTRATION_FORM_STAGES.slice(0, Math.max(historicalIndex, minimumEditableIndex) + 1),
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

export function normalizeRegistrationCampus(value) {
  const campus = String(value ?? "").trim();
  if (!campus) return "본관";
  return campus === "본관" || campus === "별관" ? campus : "";
}

export function getRegistrationPersistenceErrorMessage(error, fallback = "저장하지 못했습니다.") {
  const message = String(error?.message ?? error ?? "");
  if (message.includes("registration_campus_invalid")) return "캠퍼스 정보를 확인해 주세요.";
  if (message.includes("registration_initial_subject_plan_invalid")) return "과목별 다음 업무를 확인해 주세요.";
  if (message.includes("registration_initial_appointment_membership_invalid")) return "예약에 포함된 과목을 다시 확인해 주세요.";
  if (message.includes("registration_initial_appointment_invalid") || message.includes("registration_initial_appointment_datetime_invalid")) return "예약 일시와 장소를 확인해 주세요.";
  if (message.includes("registration_director_required") || message.includes("registration_director_override_invalid")) return "상담 책임자를 지정해 주세요.";
  if (message.includes("registration_persistence_mode_changed")) return "등록 저장 환경이 변경되었습니다. 창을 닫고 최신 상태에서 다시 등록해 주세요.";
  if (message.includes("registration_legacy_create_outcome_unknown")) return "이전 저장 결과를 확인해야 합니다. 목록을 새로고침해 중복 등록 여부를 확인해 주세요.";
  if (message.includes("registration_fixture_forced_failure")) return "등록을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.";
  if (message.includes("idempotency_key_reused")) return "입력 내용이 변경되었습니다. 다시 저장해 주세요.";
  return fallback;
}

/** @param {any} input */
export function getRegistrationCreateBlockers(input = {}) {
  const blockers = [];
  if (!hasValue(input.subject)) blockers.push("과목");
  if (!hasValue(input.studentName)) blockers.push("학생명");
  if (!hasValue(input.registration?.schoolGrade)) blockers.push("학년");
  if (!isValidRegistrationMobilePhone(input.registration?.parentPhone)) blockers.push("학부모 전화");
  return blockers;
}

export function getRegistrationCreateErrorMessage(input = {}) {
  const messages = [];
  if (!hasValue(input.subject)) messages.push("과목을 하나 이상 선택하세요.");
  if (!hasValue(input.studentName)) messages.push("학생명을 입력하세요.");
  if (!hasValue(input.registration?.schoolGrade)) messages.push("학년을 선택하세요.");
  const parentPhone = text(input.registration?.parentPhone);
  if (!parentPhone) {
    messages.push("학부모 전화를 입력하세요.");
  } else if (!isValidRegistrationMobilePhone(parentPhone)) {
    messages.push("학부모 전화번호를 010-1234-5678 형식으로 입력하세요.");
  }
  return messages.join(" ");
}

/** @param {any} input */
export function ensureRegistrationInquiryAt(input = {}, now = new Date().toISOString()) {
  if (input.type !== "registration" || hasValue(input.registration?.inquiryAt)) return input;
  return {
    ...input,
    registration: {
      ...(input.registration || {}),
      inquiryAt: now,
    },
  };
}

export function getRegistrationCreateDefaults(now = new Date().toISOString()) {
  return {
    campus: "본관",
    registration: {
      pipelineStatus: statusForPrefix("0.") || "0. 등록 문의",
      inquiryAt: now,
    },
  };
}

/** @param {any} input */
export function getRegistrationPrefillPipelineStatus(input = {}) {
  const registration = input.registration || {};
  const currentStatus = text(registration.pipelineStatus) || statusForPrefix("0.") || "0. 등록 문의";
  if (getRegistrationPipelinePrefix(currentStatus) !== "0.") return currentStatus;
  if (hasValue(registration.consultationAt)) return statusForPrefix("3.") || "3. 상담 완료";
  const hasCompletedLevelTest = hasValue(registration.levelTestMaterialLink);
  if (hasValue(registration.levelTestAt) && !hasCompletedLevelTest) {
    return statusForPrefix("1.") || "1. 레벨테스트 예약";
  }
  if (hasValue(registration.phoneConsultationAt) || hasValue(registration.visitConsultationAt)) {
    return statusForPrefix("2.") || "2. 상담 예약";
  }
  if (hasCompletedLevelTest) return statusForPrefix("1-1.") || "1-1. 레벨테스트 완료";
  return currentStatus;
}

export function getRegistrationTaskStatusForPipeline(pipelineStatus, currentStatus = "") {
  if (text(currentStatus) === "on_hold") return "on_hold";
  const prefix = getRegistrationPipelinePrefix(pipelineStatus);
  if (prefix === "7.") return "done";
  if (prefix === "8." || prefix === "9.") return "canceled";
  if (prefix === "0.") return "requested";
  return "in_progress";
}

function isRegistrationDateBefore(value, referenceValue) {
  const valueTime = Date.parse(text(value));
  const referenceTime = Date.parse(text(referenceValue));
  return Number.isFinite(valueTime) && Number.isFinite(referenceTime) && valueTime < referenceTime;
}

/** @param {any} task */
export function getRegistrationConsistencyBlockers(task = {}, pipelineStatus = "") {
  const blockers = [];
  const registration = task.registration || {};
  const prefix = getRegistrationPipelinePrefix(pipelineStatus || registration.pipelineStatus);

  const hasLevelTestReservation = hasValue(registration.levelTestAt);
  const hasLevelTestCompletedAt = hasValue(registration.levelTestCompletedAt);
  const hasLevelTestResult = hasValue(registration.levelTestResult);
  const hasLevelTestMaterialLink = hasValue(registration.levelTestMaterialLink);
  const hasLevelTestCompletion = hasLevelTestCompletedAt || hasLevelTestResult || hasLevelTestMaterialLink;
  const hasLevelTestHistory = hasLevelTestReservation || hasLevelTestCompletion || prefix === "1-1.";

  if (hasLevelTestCompletion || prefix === "1-1.") {
    if (!hasLevelTestReservation) blockers.push("레벨테스트 예약일시");
  }
  if (hasLevelTestHistory && !hasValue(registration.levelTestPlace)) blockers.push("레벨테스트 장소");
  if (isRegistrationDateBefore(registration.levelTestCompletedAt, registration.levelTestAt)) {
    blockers.push("레벨테스트 완료일시");
  }

  const hasPhoneConsultation = hasValue(registration.phoneConsultationAt);
  const hasVisitConsultation = hasValue(registration.visitConsultationAt);
  const hasConsultationCompletion = hasValue(registration.consultationAt);
  const hasConsultationHistory = hasPhoneConsultation || hasVisitConsultation || hasConsultationCompletion || hasValue(registration.counselor);
  const requiresCompletedConsultation = prefix === "3." || (["5.", "5-1.", "6.", "7."].includes(prefix) && hasConsultationHistory);

  if (hasVisitConsultation && !hasValue(registration.visitConsultationPlace)) blockers.push("방문상담실");
  if (requiresCompletedConsultation) {
    if (!hasConsultationCompletion) blockers.push("상담 완료일시");
    if (!hasValue(registration.counselor)) blockers.push("상담 책임자");
  }
  if ((requiresCompletedConsultation || hasConsultationCompletion) && !hasPhoneConsultation && !hasVisitConsultation) {
    blockers.push("상담 예약일시");
  }
  if (hasConsultationCompletion && !hasValue(registration.counselor)) blockers.push("상담 책임자");
  if (
    hasConsultationCompletion &&
    (
      isRegistrationDateBefore(registration.consultationAt, registration.phoneConsultationAt) ||
      isRegistrationDateBefore(registration.consultationAt, registration.visitConsultationAt)
    )
  ) {
    blockers.push("상담 완료일시");
  }

  const admissionNoticeRequired = ["5-1.", "6.", "7."].includes(prefix);
  const completionRequired = prefix === "7.";
  if (admissionNoticeRequired && !registration.admissionNoticeSent) blockers.push("입학신청서 발송");
  if (registration.makeeduRegistered && !registration.admissionNoticeSent) blockers.push("입학신청서 발송");
  if (registration.makeeduInvoiceSent && !registration.makeeduRegistered) blockers.push("메이크에듀 등록(수업, 교재)");
  if (registration.paymentChecked && !registration.makeeduInvoiceSent) blockers.push("청구서 발송");
  if (completionRequired) {
    if (!registration.makeeduRegistered) blockers.push("메이크에듀 등록(수업, 교재)");
    if (!registration.makeeduInvoiceSent) blockers.push("청구서 발송");
    if (!registration.paymentChecked) blockers.push("수납 완료 확인");
  }

  return [...new Set(blockers)];
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
    if (!hasValue(registration.levelTestMaterialLink)) blockers.push("시험지·결과지 URL");
  }

  if (prefix === "2.") {
    const hasPhoneConsultation = hasValue(registration.phoneConsultationAt);
    const hasVisitConsultation = hasValue(registration.visitConsultationAt);
    if (!hasPhoneConsultation && !hasVisitConsultation) blockers.push("상담 예약일시");
    if (!hasValue(task.secondaryAssigneeId)) blockers.push("상담 책임자");
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

  return [...new Set([...blockers, ...getRegistrationConsistencyBlockers(task, pipelineStatus)])];
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
export function getRegistrationChecklistAvailability({ pipelineStatus = "", registration = {} } = {}) {
  const prefix = getRegistrationPipelinePrefix(pipelineStatus);
  const admissionStage = ["5.", "5-1.", "6."].includes(prefix);
  const operationsStage = prefix === "6.";
  const admissionReady = Boolean(registration.admissionNoticeSent);
  const makeEduReady = Boolean(registration.makeeduRegistered);
  const invoiceReady = Boolean(registration.makeeduInvoiceSent);

  return {
    admissionNoticeSent: checklistAvailability(admissionStage, "입학 등록 결정 후 확인할 수 있습니다."),
    makeeduRegistered: checklistAvailability(operationsStage && admissionReady, admissionReady ? "수납 확인 단계에서 확인할 수 있습니다." : "입학신청서 발송을 먼저 완료하세요."),
    makeeduInvoiceSent: checklistAvailability(operationsStage && makeEduReady, makeEduReady ? "수납 확인 단계에서 확인할 수 있습니다." : "메이크에듀 등록을 먼저 완료하세요."),
    paymentChecked: checklistAvailability(operationsStage && invoiceReady, invoiceReady ? "수납 확인 단계에서 확인할 수 있습니다." : "청구서 발송을 먼저 완료하세요."),
  };
}

export function getRegistrationChecklistEditorState({
  pipelineStatus = "",
  taskStatus = "",
  completionIntentPipelineStatus = "",
} = {}) {
  const pendingCompletion = getRegistrationPipelinePrefix(completionIntentPipelineStatus) === "7.";
  return {
    availabilityPipelineStatus: pendingCompletion
      ? statusForPrefix("6.") || "6. 수납 확인"
      : pipelineStatus,
    completed: !pendingCompletion && text(taskStatus) === "done" && getRegistrationPipelinePrefix(pipelineStatus) === "7.",
    pendingCompletion,
  };
}

export function applyRegistrationChecklistChange(registration = {}, field = "", checked = false) {
  const nextRegistration = { ...registration, [field]: Boolean(checked) };
  if (checked) return nextRegistration;

  if (field === "admissionNoticeSent") {
    if (["5-1.", "6."].includes(getRegistrationPipelinePrefix(nextRegistration.pipelineStatus))) {
      nextRegistration.pipelineStatus = statusForPrefix("5.") || "5. 입학 등록 결정";
    }
    nextRegistration.makeeduRegistered = false;
    nextRegistration.makeeduInvoiceSent = false;
    nextRegistration.paymentChecked = false;
  }
  if (field === "makeeduRegistered") {
    nextRegistration.makeeduInvoiceSent = false;
    nextRegistration.paymentChecked = false;
  }
  if (field === "makeeduInvoiceSent") nextRegistration.paymentChecked = false;
  return nextRegistration;
}

export function getRegistrationFilterColumnChange(_currentValue, nextColumnKey) {
  return { filterColumnKey: nextColumnKey, filterValue: "" };
}

export function isRegistrationFilterInputExpanded(filterInputOpen, filterValue = "") {
  return Boolean(filterInputOpen || hasValue(filterValue));
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
    registration.makeeduRegistered,
    registration.makeeduInvoiceSent,
    registration.paymentChecked,
    getRegistrationPipelinePrefix(registration.pipelineStatus) === "7.",
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
  const prefix = getRegistrationPipelinePrefix(pipelineStatus);
  if (prefix === "8.") return statusForPrefix("3.") || "3. 상담 완료";
  if (prefix === "9.") return statusForPrefix("0.") || "0. 등록 문의";
  return "";
}

export function isRegistrationCompletionImmutable(pipelineStatus) {
  return getRegistrationPipelinePrefix(pipelineStatus) === "7.";
}

export function getRegistrationBlockerFocusKey(blocker) {
  const normalized = text(blocker);
  const subjectCounselor = normalized.match(/^(영어|수학) 상담 책임자$/);
  if (subjectCounselor) return `counselor:${subjectCounselor[1]}`;
  return REGISTRATION_BLOCKER_FOCUS_KEYS[normalized] || "";
}

export function getRegistrationBlockerSection(blocker) {
  const normalized = text(blocker);
  if (["학생", "학생명", "학년", "학부모 전화", "문의일시", "과목"].includes(normalized)) return "inquiry";
  if (["레벨테스트 예약일시", "레벨테스트 장소", "레벨테스트 완료일시", "레벨테스트 결과", "시험지·결과지 URL"].includes(normalized)) return "level_test";
  if (/^(영어|수학) 상담 책임자$/.test(normalized)) return "consultation";
  if (["상담 예약일시", "방문상담 예약일시", "방문상담실", "상담 완료일시", "상담 책임자"].includes(normalized)) return "consultation";
  if (["수업", "교재", "수업시작일"].includes(normalized)) return "placement";
  return "admission";
}

export function getRegistrationMobileSections(pipelineStatus, registration = {}) {
  const prefix = getRegistrationPipelinePrefix(pipelineStatus);
  const hasLevelTest = [
    registration.levelTestAt,
    registration.levelTestPlace,
    registration.levelTestCompletedAt,
    registration.levelTestResult,
    registration.levelTestMaterialLink,
  ].some(hasValue);
  const hasConsultation = [
    registration.phoneConsultationAt,
    registration.visitConsultationAt,
    registration.visitConsultationPlace,
    registration.consultationAt,
    registration.counselor,
  ].some(hasValue);
  const hasPlacement = [
    registration.classId,
    registration.className,
    registration.textbookId,
    registration.textbookTitle,
    registration.classStartDate,
    registration.classStartSession,
  ].some(hasValue);
  const hasAdmission = [
    registration.admissionNoticeSent,
    registration.admissionFormCompleted,
    registration.paymentChecked,
    registration.paymentConfirmed,
    registration.makeeduRegistered,
    registration.makeeduInvoiceSent,
  ].some(Boolean);
  const sectionsWithActualHistory = (requiredSections = []) => {
    const sections = ["inquiry"];
    if (hasLevelTest) sections.push("level_test");
    if (hasConsultation) sections.push("consultation");
    if (hasPlacement) sections.push("placement");
    if (hasAdmission) sections.push("admission");
    for (const section of requiredSections) {
      if (!sections.includes(section)) sections.push(section);
    }
    return REGISTRATION_FORM_STAGES.filter((section) => sections.includes(section));
  };

  if (["1.", "1-1."].includes(prefix)) return ["inquiry", "level_test"];
  if (["8.", "9."].includes(prefix)) return sectionsWithActualHistory();
  if (["2.", "3."].includes(prefix)) return sectionsWithActualHistory(["consultation"]);
  if (["4-1.", "4-2.", "4-3.", "5."].includes(prefix)) return sectionsWithActualHistory(["placement"]);
  if (["5-1.", "6.", "7."].includes(prefix)) return sectionsWithActualHistory(["placement", "admission"]);
  return ["inquiry"];
}

export function getRegistrationViewKey(pipelineStatus, taskStatus = "") {
  const prefix = getRegistrationPipelinePrefix(pipelineStatus);
  if (prefix === "0.") return "inquiry";
  if (["1.", "1-1."].includes(prefix)) return "level_test";
  if (["2.", "3."].includes(prefix)) return "consulting";
  if (["4-1.", "4-2.", "4-3."].includes(prefix)) return "waiting";
  if (["5.", "5-1.", "6."].includes(prefix)) return "enrollment";
  if (["7.", "8.", "9."].includes(prefix)) return "closed";
  return ["done", "canceled"].includes(text(taskStatus)) ? "closed" : "inquiry";
}
