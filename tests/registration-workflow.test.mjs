import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as registrationWorkflow from "../src/features/tasks/registration-workflow.js";

import {
  canEditRegistrationTask,
  canSendRegistrationAdmissionMessage,
  compareRegistrationTasks,
  ensureRegistrationInquiryAt,
  getEmptyRegistrationFilters,
  getManualAdmissionCompletionStatus,
  getRegistrationBlockerFocusKey,
  getRegistrationBranchActions,
  getRegistrationChecklistAvailability,
  getRegistrationConsistencyBlockers,
  getRegistrationCreateBlockers,
  getRegistrationCreateDefaults,
  getRegistrationCreateErrorMessage,
  getRegistrationFilterColumnChange,
  getRegistrationFormState,
  getRegistrationGradeOptions,
  getRegistrationMobileSections,
  getRegistrationPrefillPipelineStatus,
  getRegistrationReopenStatus,
  getRegistrationTaskStatusForPipeline,
  getRegistrationTransitionBlockers,
  getRegistrationViewKey,
  getRegistrationWaitlistAssignmentBlockers,
  getSelectableRegistrationScheduleSessions,
  resolveRegistrationLinkedTextbookDefault,
  hasActiveRegistrationFilters,
  isRegistrationClassWaitlistStatus,
  isRegistrationCompletionImmutable,
  isRegistrationFilterInputExpanded,
  normalizeRegistrationDateRange,
  parseRegistrationSubjects,
  prepareRegistrationLevelTestRetry,
  REGISTRATION_TIME_OPTIONS,
  registrationSubjectIncludes,
  serializeRegistrationSubjects,
  shouldEnsureRegistrationStudent,
  shouldShowRegistrationCompletionBlockers,
} from "../src/features/tasks/registration-workflow.js";

const root = new URL("../", import.meta.url);

async function readSource(pathname) {
  return readFile(new URL(pathname, root), "utf8");
}

function registrationTask(pipelineStatus, overrides = {}) {
  return {
    id: "registration-1",
    title: "등록: 김하윤",
    type: "registration",
    status: "in_progress",
    studentName: "김하윤",
    studentId: "",
    classId: "",
    textbookId: "",
    registration: { pipelineStatus },
    ...overrides,
  };
}

// Set 1: stage model and terminal-state behavior.
test("R01 row actions expose only the branches allowed by the current registration stage", () => {
  assert.deepEqual(
    getRegistrationBranchActions("0. 등록 문의").map(({ prefix, label }) => [prefix, label]),
    [
      ["1.", "레벨테스트 예약"],
      ["2.", "상담 예약"],
      ["4-1.", "현재 학기 수강반 대기"],
      ["4-2.", "현재 학기 개강반 대기"],
      ["4-3.", "다음 학기 개강반 대기"],
      ["9.", "문의 완료"],
    ],
  );
  assert.deepEqual(
    getRegistrationBranchActions("3. 상담 완료").map(({ prefix, label }) => [prefix, label]),
    [
      ["5.", "등록"],
      ["4-1.", "현재 학기 수강반 대기"],
      ["4-2.", "현재 학기 개강반 대기"],
      ["4-3.", "다음 학기 개강반 대기"],
      ["8.", "미등록 완료"],
    ],
  );
  assert.deepEqual(
    getRegistrationBranchActions("4-1. 현재반 대기 신청").map(({ prefix, label }) => [prefix, label]),
    [
      ["1.", "레벨테스트 재응시"],
      ["5.", "재응시 없이 등록"],
    ],
  );
  assert.deepEqual(getRegistrationBranchActions("1. 레벨테스트 예약"), []);
});

test("R02 not-enrolled records do not highlight consultation as the current step", () => {
  assert.equal(getRegistrationFormState("8. 미등록", "canceled").activeSection, null);
});

test("R03 inquiry-only records do not highlight consultation as the current step", () => {
  assert.equal(getRegistrationFormState("9. 문의만", "canceled").activeSection, null);
});

test("R04 canceled registration records cannot enter the normal edit path", () => {
  assert.equal(canEditRegistrationTask(registrationTask("8. 미등록", { status: "canceled" })), false);
});

test("R05 next-opening alerts are not treated as class waitlists", () => {
  assert.equal(isRegistrationClassWaitlistStatus("4-3. 다음 개강 알림 요청"), false);
});

// Set 2: inquiry creation and input quality.
test("R06 a registration inquiry requires a student name", () => {
  const blockers = getRegistrationCreateBlockers({ studentName: "", subject: "영어", registration: { parentPhone: "01012345678" } });
  assert.ok(blockers.includes("학생명"));
});

test("R06b a registration inquiry requires every operator-owned inquiry field in form order", () => {
  assert.deepEqual(
    getRegistrationCreateBlockers({ registration: {} }),
    ["과목", "학생명", "학년", "학부모 전화"],
  );
  assert.equal(
    getRegistrationCreateErrorMessage({ registration: {} }),
    "과목을 하나 이상 선택하세요. 학생명을 입력하세요. 학년을 선택하세요. 학부모 전화를 입력하세요.",
  );
});

test("R07 a registration inquiry requires a subject", () => {
  const blockers = getRegistrationCreateBlockers({ studentName: "김하윤", subject: "", registration: { parentPhone: "01012345678" } });
  assert.ok(blockers.includes("과목"));
});

test("R08 a registration inquiry rejects an invalid parent mobile number", () => {
  const blockers = getRegistrationCreateBlockers({ studentName: "김하윤", subject: "영어", registration: { parentPhone: "123" } });
  assert.ok(blockers.includes("학부모 전화"));
});

test("R09 a new registration records the inquiry timestamp by default", () => {
  const now = "2026-07-10T09:30:00+09:00";
  const defaults = getRegistrationCreateDefaults(now);
  assert.equal(defaults.campus, "본관");
  assert.equal(defaults.registration.inquiryAt, now);
});

test("R09b create submission fills a missing automatic inquiry timestamp without replacing an existing one", () => {
  const now = "2026-07-13T14:55:00+09:00";
  const missing = { type: "registration", registration: { schoolGrade: "고1" } };
  const stamped = ensureRegistrationInquiryAt(missing, now);
  assert.equal(stamped.registration.inquiryAt, now);
  assert.equal(missing.registration.inquiryAt, undefined);

  const existing = {
    type: "registration",
    registration: { inquiryAt: "2026-07-13T14:50:00+09:00" },
  };
  assert.equal(ensureRegistrationInquiryAt(existing, now), existing);
});

test("R09c registration appointment choices stay within 09:00 through 21:00", () => {
  assert.equal(REGISTRATION_TIME_OPTIONS[0], "09:00");
  assert.equal(REGISTRATION_TIME_OPTIONS.at(-1), "21:00");
  assert.equal(REGISTRATION_TIME_OPTIONS.length, 73);
});

test("R09d registration campus accepts only the two operating campuses and defaults an empty value", () => {
  const normalizeRegistrationCampus = registrationWorkflow.normalizeRegistrationCampus;
  assert.equal(typeof normalizeRegistrationCampus, "function");
  assert.equal(normalizeRegistrationCampus(""), "본관");
  assert.equal(normalizeRegistrationCampus("본관"), "본관");
  assert.equal(normalizeRegistrationCampus("별관"), "별관");
  assert.equal(normalizeRegistrationCampus("서관"), "");
});

test("R09e registration persistence failures use operator-facing guidance", () => {
  const getRegistrationPersistenceErrorMessage = registrationWorkflow.getRegistrationPersistenceErrorMessage;
  assert.equal(typeof getRegistrationPersistenceErrorMessage, "function");
  assert.equal(
    getRegistrationPersistenceErrorMessage({ message: "registration_campus_invalid" }),
    "캠퍼스 정보를 확인해 주세요.",
  );
  assert.equal(
    getRegistrationPersistenceErrorMessage({ message: "registration_initial_subject_plan_invalid" }),
    "과목별 다음 업무를 확인해 주세요.",
  );
  assert.equal(
    getRegistrationPersistenceErrorMessage({ message: "registration_initial_appointment_membership_invalid" }),
    "예약에 포함된 과목을 다시 확인해 주세요.",
  );
  assert.equal(
    getRegistrationPersistenceErrorMessage({ message: "registration_director_required" }),
    "상담 책임자를 지정해 주세요.",
  );
});

test("R10 grade choices cover every school grade without a stale year prefix", () => {
  const grades = getRegistrationGradeOptions();
  assert.equal(grades.length, 12);
  assert.ok(grades.includes("초1"));
  assert.equal(grades.some((grade) => grade.includes("년")), false);
});

// Set 3: level test and consultation transition validation.
test("R11 level-test reservation requires a location", () => {
  const blockers = getRegistrationTransitionBlockers({ registration: { levelTestAt: "2026-07-11T10:00", levelTestPlace: "" } }, "1. 레벨테스트 예약");
  assert.ok(blockers.includes("레벨테스트 장소"));
});

test("R12 level-test completion stamps an empty completion timestamp while preserving history", () => {
  const prepareTransition = registrationWorkflow.prepareRegistrationPipelineTransition;
  assert.equal(typeof prepareTransition, "function");

  const now = "2026-07-11T11:00:00+09:00";
  assert.equal(
    prepareTransition({ levelTestCompletedAt: "" }, "1-1. 레벨테스트 완료", now).levelTestCompletedAt,
    now,
  );
  assert.equal(
    prepareTransition({ levelTestCompletedAt: "2026-07-10T11:00:00+09:00" }, "1-1. 레벨테스트 완료", now).levelTestCompletedAt,
    "2026-07-10T11:00:00+09:00",
  );
});

test("R13 level-test completion requires the test-paper and result URL as evidence", () => {
  const blockers = getRegistrationTransitionBlockers({ registration: { levelTestAt: "2026-07-11T10:00", levelTestPlace: "본관" } }, "1-1. 레벨테스트 완료");
  assert.ok(blockers.includes("시험지·결과지 URL"));
  assert.equal(blockers.includes("레벨테스트 결과"), false);
});

test("R14 a visit consultation reservation requires a consultation room", () => {
  const blockers = getRegistrationTransitionBlockers({ registration: { visitConsultationAt: "2026-07-12T10:00", visitConsultationPlace: "" } }, "2. 상담 예약");
  assert.ok(blockers.includes("방문상담실"));
});

test("R15 consultation completion stamps an empty completion timestamp while preserving history", () => {
  const prepareTransition = registrationWorkflow.prepareRegistrationPipelineTransition;
  assert.equal(typeof prepareTransition, "function");

  const now = "2026-07-12T14:00:00+09:00";
  assert.equal(
    prepareTransition({ consultationAt: "" }, "3. 상담 완료", now).consultationAt,
    now,
  );
  assert.equal(
    prepareTransition({ consultationAt: "2026-07-11T14:00:00+09:00" }, "3. 상담 완료", now).consultationAt,
    "2026-07-11T14:00:00+09:00",
  );
});

// Set 4: waitlist synchronization and side effects.
test("R16 current-class wait decisions still use the class waitlist", () => {
  assert.equal(isRegistrationClassWaitlistStatus("4-1. 현재반 대기 신청"), true);
});

test("R17 next-opening alerts do not require a class selection", () => {
  const blockers = getRegistrationTransitionBlockers({ studentName: "김하윤", classId: "", registration: {} }, "4-3. 다음 개강 알림 요청");
  assert.equal(blockers.includes("수업"), false);
});

test("R18 next-opening alerts do not create a student-management record early", () => {
  assert.equal(shouldEnsureRegistrationStudent("4-3. 다음 개강 알림 요청", false), false);
});

test("R18b inquiry wait and wait-to-registration paths do not invent a completed consultation", () => {
  const inquiryTask = registrationTask("0. 등록 문의", {
    studentName: "김하윤",
    registration: { pipelineStatus: "0. 등록 문의", parentPhone: "010-1234-5678" },
  });
  const waitingTask = registrationTask("4-3. 다음 개강 알림 요청", {
    studentName: "김하윤",
    registration: { pipelineStatus: "4-3. 다음 개강 알림 요청", parentPhone: "010-1234-5678" },
  });

  assert.equal(
    getRegistrationConsistencyBlockers(inquiryTask, "4-3. 다음 개강 알림 요청").some((blocker) => blocker.startsWith("상담")),
    false,
  );
  assert.equal(
    getRegistrationConsistencyBlockers(waitingTask, "5. 입학 등록 결정").some((blocker) => blocker.startsWith("상담")),
    false,
  );
});

test("R18c returning from wait for a level-test retry clears the previous attempt", () => {
  const nextRegistration = prepareRegistrationLevelTestRetry({
    pipelineStatus: "4-1. 현재반 대기 신청",
    levelTestAt: "2026-07-01T10:00",
    levelTestPlace: "본관",
    levelTestCompletedAt: "2026-07-01T11:00",
    levelTestResult: "중2 상",
    levelTestMaterialLink: "https://drive.google.com/old-result",
  });

  assert.match(nextRegistration.pipelineStatus, /^1\./);
  assert.equal(nextRegistration.levelTestAt, "");
  assert.equal(nextRegistration.levelTestCompletedAt, "");
  assert.equal(nextRegistration.levelTestResult, "");
  assert.equal(nextRegistration.levelTestMaterialLink, "");
  assert.equal(nextRegistration.levelTestPlace, "본관");
});

test("R19 an enrolled student cannot be demoted into the same class waitlist", () => {
  const blockers = getRegistrationWaitlistAssignmentBlockers({ classId: "class-1", studentClassIds: ["class-1"] });
  assert.ok(blockers.includes("이미 등록된 수업"));
});

test("R20 changing waitlist classes restores the previous waitlist when the new link fails", async () => {
  const source = await readSource("src/features/tasks/ops-task-service.ts");
  assert.match(source, /restorePreviousRegistrationWaitlist/);
});

// Set 5: admission-form messaging.
test("R21 MakeEdu manual sending has an explicit completion action", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  assert.match(source, /메이크에듀 발송 완료/);
  assert.match(source, /completeManualRegistrationAdmissionMessage/);
  assert.equal(getManualAdmissionCompletionStatus("5. 입학 등록 결정"), "5-1. 입학신청서 발송 완료");
});

test("R22 SOLAPI status loading surfaces registration-detail query failures", async () => {
  const routeSource = await readSource("src/app/api/solapi/registration/route.ts");
  assert.match(routeSource, /detailResult/);
  assert.match(routeSource, /throwQueryError\(detailResult\.error\)/);
});

test("R23 SOLAPI status loading surfaces message-history query failures", async () => {
  const routeSource = await readSource("src/app/api/solapi/registration/route.ts");
  assert.match(routeSource, /messageResult/);
  assert.match(routeSource, /throwQueryError\(messageResult\.error\)/);
});

test("R24 an indeterminate provider request is not left as forever-pending", async () => {
  const coreSource = await readSource("src/app/api/solapi/registration/core.js");
  assert.match(coreSource, /result: "unknown"/);
  assert.match(coreSource, /deps\.finalize/);
});

test("R25 admission messages cannot be sent after registration is closed", () => {
  assert.equal(canSendRegistrationAdmissionMessage("7. 등록 완료"), false);
  assert.equal(canSendRegistrationAdmissionMessage("5. 입학 등록 결정"), true);
});

// Set 6: manual payment and completion checklist sequencing.
test("R26 admission-form completion is unavailable before an enrollment decision", () => {
  const availability = getRegistrationChecklistAvailability({ pipelineStatus: "0. 등록 문의", registration: {} });
  assert.equal(availability.admissionNoticeSent.enabled, false);
});

test("R27 MakeEdu registration follows admission-form sending", () => {
  const beforeAdmission = getRegistrationChecklistAvailability({ pipelineStatus: "6. 수납 확인", registration: { admissionNoticeSent: false } });
  assert.equal(beforeAdmission.makeeduRegistered.enabled, false);
  assert.match(beforeAdmission.makeeduRegistered.reason, /입학신청서 발송/);

  const afterAdmission = getRegistrationChecklistAvailability({ pipelineStatus: "6. 수납 확인", registration: { admissionNoticeSent: true } });
  assert.equal(afterAdmission.makeeduRegistered.enabled, true);
});

test("R28 invoice sending follows MakeEdu registration", () => {
  const beforeMakeEdu = getRegistrationChecklistAvailability({ pipelineStatus: "6. 수납 확인", registration: { admissionNoticeSent: true, makeeduRegistered: false } });
  assert.equal(beforeMakeEdu.makeeduInvoiceSent.enabled, false);
  assert.match(beforeMakeEdu.makeeduInvoiceSent.reason, /메이크에듀 등록/);

  const afterMakeEdu = getRegistrationChecklistAvailability({ pipelineStatus: "6. 수납 확인", registration: { admissionNoticeSent: true, makeeduRegistered: true } });
  assert.equal(afterMakeEdu.makeeduInvoiceSent.enabled, true);
});

test("R29 payment confirmation follows invoice sending", () => {
  const beforeInvoice = getRegistrationChecklistAvailability({ pipelineStatus: "6. 수납 확인", registration: { admissionNoticeSent: true, makeeduRegistered: true, makeeduInvoiceSent: false } });
  assert.equal(beforeInvoice.paymentChecked.enabled, false);
  assert.match(beforeInvoice.paymentChecked.reason, /청구서 발송/);

  const afterInvoice = getRegistrationChecklistAvailability({ pipelineStatus: "6. 수납 확인", registration: { admissionNoticeSent: true, makeeduRegistered: true, makeeduInvoiceSent: true } });
  assert.equal(afterInvoice.paymentChecked.enabled, true);
});

test("R30 textbook billing is not a new admission checklist action", () => {
  const availability = getRegistrationChecklistAvailability({ pipelineStatus: "6. 수납 확인", registration: { admissionNoticeSent: true } });
  assert.equal(Object.hasOwn(availability, "textbookBillingIssued"), false);
});

test("R30b unchecking a manual admission step clears only its downstream steps", () => {
  const applyRegistrationChecklistChange = registrationWorkflow.applyRegistrationChecklistChange;
  assert.equal(typeof applyRegistrationChecklistChange, "function");
  const completed = {
    admissionNoticeSent: true,
    makeeduRegistered: true,
    makeeduInvoiceSent: true,
    paymentChecked: true,
    textbookBillingIssued: true,
  };

  assert.deepEqual(applyRegistrationChecklistChange(completed, "admissionNoticeSent", false), {
    ...completed,
    admissionNoticeSent: false,
    makeeduRegistered: false,
    makeeduInvoiceSent: false,
    paymentChecked: false,
  });
  assert.deepEqual(applyRegistrationChecklistChange(completed, "makeeduRegistered", false), {
    ...completed,
    makeeduRegistered: false,
    makeeduInvoiceSent: false,
    paymentChecked: false,
  });
  assert.deepEqual(applyRegistrationChecklistChange(completed, "makeeduInvoiceSent", false), {
    ...completed,
    makeeduInvoiceSent: false,
    paymentChecked: false,
  });
  assert.deepEqual(applyRegistrationChecklistChange(completed, "paymentChecked", false), {
    ...completed,
    paymentChecked: false,
  });
  assert.equal(
    applyRegistrationChecklistChange({ ...completed, pipelineStatus: "6. 수납 확인" }, "admissionNoticeSent", false).pipelineStatus,
    "5. 입학 등록 결정",
  );
  assert.equal(completed.paymentChecked, true);
});

test("R30c a pending 6-to-7 completion editor keeps operational checks enabled without claiming completion", () => {
  const getRegistrationChecklistEditorState = registrationWorkflow.getRegistrationChecklistEditorState;
  assert.equal(typeof getRegistrationChecklistEditorState, "function");

  assert.deepEqual(getRegistrationChecklistEditorState({
    pipelineStatus: "7. 등록 완료",
    taskStatus: "in_progress",
    completionIntentPipelineStatus: "7. 등록 완료",
  }), {
    availabilityPipelineStatus: "6. 수납 확인",
    completed: false,
    pendingCompletion: true,
  });
  assert.deepEqual(getRegistrationChecklistEditorState({
    pipelineStatus: "7. 등록 완료",
    taskStatus: "done",
    completionIntentPipelineStatus: "",
  }), {
    availabilityPipelineStatus: "7. 등록 완료",
    completed: true,
    pendingCompletion: false,
  });
});

// Set 7: table filtering, period ranges, and sorting.
test("R31 changing the target table column clears the previous column value", () => {
  assert.deepEqual(getRegistrationFilterColumnChange("김하윤", "counselor"), { filterColumnKey: "counselor", filterValue: "" });
});

test("R32 a non-empty table filter stays visible until it is cleared", () => {
  assert.equal(isRegistrationFilterInputExpanded(false, "김하윤"), true);
  assert.equal(isRegistrationFilterInputExpanded(false, ""), false);
});

test("R33 active table filters can be detected and reset together", () => {
  const filters = { ...getEmptyRegistrationFilters(), selectedSubjectFilter: "영어", filterValue: "김" };
  assert.equal(hasActiveRegistrationFilters(filters), true);
  assert.deepEqual(getEmptyRegistrationFilters(), {
    selectedSubjectFilter: "all",
    selectedCounselorFilter: "all",
    registrationPeriodFilter: "all",
    registrationPeriodStartDate: "",
    registrationPeriodEndDate: "",
    filterValue: "",
  });
});

test("R34 reversed custom date ranges are normalized instead of returning an empty table", () => {
  assert.deepEqual(normalizeRegistrationDateRange("2026-07-20", "2026-07-01"), { start: "2026-07-01", end: "2026-07-20" });
});

test("R35 registration statuses sort by process order rather than Korean display text", () => {
  const reservation = registrationTask("1. 레벨테스트 예약");
  const completed = registrationTask("1-1. 레벨테스트 완료", { id: "registration-2" });
  assert.equal(compareRegistrationTasks(reservation, completed, "pipelineStatus", "asc") < 0, true);
});

// Set 8: detail view and recovery actions.
test("R36 inquiry details do not show final-enrollment blockers", () => {
  assert.equal(shouldShowRegistrationCompletionBlockers("0. 등록 문의"), false);
  assert.equal(shouldShowRegistrationCompletionBlockers("6. 수납 확인"), true);
  assert.equal(getRegistrationFormState("7. 등록 완료", "in_progress").editable, true);
});

test("R37 registration detail follows level-test then consultation order", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const start = source.indexOf("function RegistrationDetailPanel");
  const end = source.indexOf("function WithdrawalDetailPanel", start);
  const detail = source.slice(start, end);
  assert.ok(detail.indexOf('label="레벨테스트"') < detail.indexOf('label="전화상담"'));
});

test("R38 registration detail includes the selected textbook", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const start = source.indexOf("function RegistrationDetailPanel");
  const end = source.indexOf("function WithdrawalDetailPanel", start);
  assert.match(source.slice(start, end), /label="교재" value=\{task\.textbookTitle/);
});

test("R39 the level-test Drive URL is a safe clickable link", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  assert.match(source, /function RegistrationExternalLinkInfo/);
  assert.match(source, /target="_blank" rel="noreferrer"/);
});

test("R40 terminal decisions reopen at the operational stage they came from", () => {
  assert.equal(getRegistrationReopenStatus("8. 미등록"), "3. 상담 완료");
  assert.equal(getRegistrationReopenStatus("9. 문의만"), "0. 등록 문의");
});

// Set 9: mobile, keyboard, and accessibility behavior.
test("R41 text fields emit one state update per browser input event", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const start = source.indexOf("function TextField");
  const end = source.indexOf("function TextareaField", start);
  assert.doesNotMatch(source.slice(start, end), /onInput=/);
});

test("R42 the long one-page registration form action bar does not float over fields", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const start = source.indexOf('"-mx-6 -mb-6 flex flex-col gap-2 border-t bg-background px-6 py-4');
  const end = source.indexOf("</form>", start);
  const actionBarSource = source.slice(start, end);
  assert.match(actionBarSource, /-mx-6 -mb-6/);
  assert.doesNotMatch(actionBarSource, /sticky bottom-0|backdrop-blur/);
});

test("R43 checklist labels wrap instead of hiding important words", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  const start = source.indexOf("function CheckField");
  const end = source.indexOf("type ChecklistStatusItem", start);
  const checkField = source.slice(start, end);
  assert.match(checkField, /whitespace-normal/);
  assert.doesNotMatch(checkField, /truncate/);
});

test("R44 blocker navigation targets the exact missing registration control", () => {
  assert.equal(getRegistrationBlockerFocusKey("학년"), "schoolGrade");
  assert.equal(getRegistrationBlockerFocusKey("문의일시"), "inquiryAt");
  assert.equal(getRegistrationBlockerFocusKey("시험지·결과지 URL"), "levelTestMaterialLink");
  assert.equal(getRegistrationBlockerFocusKey("교재"), "textbookId");
});

test("R45 inquiry-stage mobile cards omit future workflow sections", () => {
  assert.deepEqual(getRegistrationMobileSections("0. 등록 문의"), ["inquiry"]);
});

// Set 10: error, race, fallback, and partial-write protection.
test("R46 an unknown open pipeline value remains visible in the inquiry view", () => {
  assert.equal(getRegistrationViewKey("legacy status", "in_progress"), "inquiry");
});

test("R47 an unknown closed pipeline value remains visible in the closed view", () => {
  assert.equal(getRegistrationViewKey("legacy status", "done"), "closed");
});

test("R48 a failed non-final update rolls registration detail and waitlist effects back", async () => {
  const source = await readSource("src/features/tasks/ops-task-service.ts");
  assert.match(source, /rollbackRegistrationUpdate/);
});

test("R49 message-status loading aborts stale responses when the selected task changes", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  assert.match(source, /AbortController/);
  assert.match(source, /requestTaskId/);
});

test("R50 an accepted provider send is not reported as failed when local refresh fails", async () => {
  const source = await readSource("src/features/tasks/ops-task-workspace.tsx");
  assert.match(source, /providerAccepted/);
  assert.match(source, /알림톡은 접수됐지만 화면 새로고침/);
});

// Set 11: annotated add-modal feedback.
test("R51 English and Math serialize to one stable scalar registration payload", () => {
  assert.deepEqual(parseRegistrationSubjects("영어"), ["영어"]);
  assert.deepEqual(parseRegistrationSubjects("수학, 영어"), ["영어", "수학"]);
  assert.equal(
    serializeRegistrationSubjects(["수학", "영어", "수학"]),
    "영어, 수학",
  );
});

test("R52 a complete English-and-Math inquiry is valid for create", () => {
  const payload = {
    studentName: "김하윤",
    subject: serializeRegistrationSubjects(["영어", "수학"]),
    registration: {
      schoolGrade: "중2",
      parentPhone: "010-1234-5678",
      inquiryAt: "2026-07-11T09:00",
    },
  };

  assert.equal(payload.subject, "영어, 수학");
  assert.deepEqual(getRegistrationCreateBlockers(payload), []);
});

test("R53 inquiry stage enables early test and consultation fields only", () => {
  const state = getRegistrationFormState("0. 등록 문의", "requested");

  assert.equal(state.activeSection, "inquiry");
  assert.deepEqual(state.enabledSections, ["inquiry", "level_test", "consultation"]);
  assert.equal(state.enabledSections.includes("placement"), false);
  assert.equal(state.enabledSections.includes("admission"), false);
});

test("R54 early reservation input promotes an inquiry to the matching workflow stage", () => {
  assert.match(getRegistrationPrefillPipelineStatus({
    registration: {
      pipelineStatus: "0. 등록 문의",
      levelTestAt: "2026-07-12T10:00",
    },
  }), /^1\./);
  assert.match(getRegistrationPrefillPipelineStatus({
    registration: {
      pipelineStatus: "0. 등록 문의",
      phoneConsultationAt: "2026-07-12T11:00",
    },
  }), /^2\./);
  assert.match(getRegistrationPrefillPipelineStatus({
    registration: {
      pipelineStatus: "0. 등록 문의",
      levelTestAt: "2026-07-12T10:00",
      phoneConsultationAt: "2026-07-12T11:00",
    },
  }), /^1\./);
  assert.match(getRegistrationPrefillPipelineStatus({
    registration: {
      pipelineStatus: "0. 등록 문의",
      levelTestAt: "2026-07-12T10:00",
      levelTestMaterialLink: "https://drive.google.com/test-result",
      phoneConsultationAt: "2026-07-12T11:00",
    },
  }), /^2\./);
  assert.equal(getRegistrationPrefillPipelineStatus({
    registration: {
      pipelineStatus: "5. 입학 등록 결정",
      phoneConsultationAt: "2026-07-12T11:00",
    },
  }), "5. 입학 등록 결정");
});

test("R55 combined registration subjects remain filterable by either subject", () => {
  assert.equal(registrationSubjectIncludes("영어, 수학", "영어"), true);
  assert.equal(registrationSubjectIncludes("영어, 수학", "수학"), true);
  assert.equal(registrationSubjectIncludes("영어", "수학"), false);
});

test("R56 invalid filled parent phone explains the required mobile format", () => {
  assert.equal(
    getRegistrationCreateErrorMessage({
      studentName: "김하윤",
      subject: "영어",
      registration: {
        schoolGrade: "중2",
        parentPhone: "654-4644-6456",
        inquiryAt: "2026-07-11T09:00",
      },
    }),
    "학부모 전화번호를 010-1234-5678 형식으로 입력하세요.",
  );
});

// Set 12: cumulative registration history and checklist consistency.
test("R57 level-test completion keeps its reservation and location", () => {
  const blockers = getRegistrationConsistencyBlockers({
    registration: {
      pipelineStatus: "1-1. 레벨테스트 완료",
      levelTestMaterialLink: "https://drive.google.com/test-result",
    },
  });

  assert.ok(blockers.includes("레벨테스트 예약일시"));
  assert.ok(blockers.includes("레벨테스트 장소"));
});

test("R58 level-test completion cannot precede its reservation", () => {
  const blockers = getRegistrationConsistencyBlockers({
    registration: {
      pipelineStatus: "1-1. 레벨테스트 완료",
      levelTestAt: "2026-07-12T11:00",
      levelTestPlace: "본관",
      levelTestCompletedAt: "2026-07-12T10:45",
      levelTestMaterialLink: "https://drive.google.com/test-result",
    },
  });

  assert.ok(blockers.includes("레벨테스트 완료일시"));
});

test("R59 consultation completion requires a prior phone or visit reservation", () => {
  const withoutReservation = getRegistrationConsistencyBlockers({
    registration: {
      pipelineStatus: "3. 상담 완료",
      consultationAt: "2026-07-12T13:00",
      counselor: "정보영",
    },
  });
  const beforeReservation = getRegistrationConsistencyBlockers({
    registration: {
      pipelineStatus: "3. 상담 완료",
      phoneConsultationAt: "2026-07-12T14:00",
      consultationAt: "2026-07-12T13:00",
      counselor: "정보영",
    },
  });

  assert.ok(withoutReservation.includes("상담 예약일시"));
  assert.ok(beforeReservation.includes("상담 완료일시"));
});

test("R60 a retained visit reservation keeps its consultation room", () => {
  const blockers = getRegistrationConsistencyBlockers({
    registration: {
      pipelineStatus: "4-1. 현재반 대기 신청",
      visitConsultationAt: "2026-07-12T14:00",
      visitConsultationPlace: "",
      consultationAt: "2026-07-12T15:00",
      counselor: "정보영",
    },
  });

  assert.ok(blockers.includes("방문상담실"));
  assert.equal(getRegistrationBlockerFocusKey("방문상담실"), "visitConsultationPlace");
});

test("R61 a consultation-only path remains valid without level-test fields", () => {
  assert.deepEqual(getRegistrationConsistencyBlockers({
    registration: {
      pipelineStatus: "3. 상담 완료",
      phoneConsultationAt: "2026-07-12T13:00",
      consultationAt: "2026-07-12T14:00",
      counselor: "정보영",
    },
  }), []);
});

test("R62 later workflow stages retain a completed consultation", () => {
  const blockers = getRegistrationConsistencyBlockers({
    registration: {
      pipelineStatus: "5. 입학 등록 결정",
      phoneConsultationAt: "2026-07-12T13:00",
      counselor: "정보영",
    },
  });

  assert.ok(blockers.includes("상담 완료일시"));
});

test("R63 admission checklist values cannot outlive their new chronological prerequisites", () => {
  assert.ok(getRegistrationConsistencyBlockers({ registration: {
    pipelineStatus: "6. 수납 확인",
    admissionNoticeSent: false,
    makeeduRegistered: true,
  } }).includes("입학신청서 발송"));
  assert.ok(getRegistrationConsistencyBlockers({ registration: {
    pipelineStatus: "6. 수납 확인",
    admissionNoticeSent: true,
    makeeduRegistered: false,
    makeeduInvoiceSent: true,
  } }).includes("메이크에듀 등록(수업, 교재)"));
  assert.ok(getRegistrationConsistencyBlockers({ registration: {
    pipelineStatus: "6. 수납 확인",
    admissionNoticeSent: true,
    makeeduRegistered: true,
    makeeduInvoiceSent: false,
    paymentChecked: true,
  } }).includes("청구서 발송"));
});

test("R64 registration completion does not require textbook billing when no textbook is selected", () => {
  const blockers = getRegistrationConsistencyBlockers({
    registration: {
      pipelineStatus: "7. 등록 완료",
      admissionNoticeSent: true,
      makeeduRegistered: true,
      makeeduInvoiceSent: false,
      paymentChecked: false,
      textbookBillingIssued: true,
    },
  });

  assert.deepEqual(
    blockers.filter((blocker) => ["입학신청서 발송", "메이크에듀 등록(수업, 교재)", "청구서 발송", "수납 완료 확인", "교재 청구출고표", "교재"].includes(blocker)),
    ["청구서 발송", "수납 완료 확인"],
  );

  const legacyBillingFlagWithoutTextbook = getRegistrationConsistencyBlockers({
    classId: "class-1",
    textbookId: "",
    registration: {
      pipelineStatus: "7. 등록 완료",
      admissionNoticeSent: true,
      paymentChecked: true,
      makeeduRegistered: true,
      makeeduInvoiceSent: true,
      textbookBillingIssued: true,
    },
  });
  assert.equal(legacyBillingFlagWithoutTextbook.includes("교재"), false);
});

test("R65 transition validation includes cumulative consistency blockers", () => {
  const blockers = getRegistrationTransitionBlockers({
    registration: {
      pipelineStatus: "4-3. 다음 개강 알림 요청",
      phoneConsultationAt: "2026-07-12T15:00",
      consultationAt: "2026-07-12T14:00",
      counselor: "정보영",
      parentPhone: "010-1234-5678",
    },
    studentName: "김하윤",
  }, "4-3. 다음 개강 알림 요청");

  assert.ok(blockers.includes("상담 완료일시"));
});

test("R66 an open case can end as inquiry-only before consultation is completed", () => {
  const blockers = getRegistrationTransitionBlockers({
    registration: {
      pipelineStatus: "0. 등록 문의",
      parentPhone: "010-1234-5678",
    },
    studentName: "김하윤",
  }, "9. 문의만");

  assert.deepEqual(blockers, []);
});

test("R67 legacy level-test results remain historical while the material URL is completion evidence", () => {
  const legacyResultOnly = getRegistrationConsistencyBlockers({
    registration: {
      pipelineStatus: "2. 상담 예약",
      levelTestResult: "중2 상",
      phoneConsultationAt: "2026-07-12T13:00",
    },
  });
  const materialEvidence = getRegistrationConsistencyBlockers({
    registration: {
      pipelineStatus: "1-1. 레벨테스트 완료",
      levelTestMaterialLink: "https://drive.google.com/test-result",
      phoneConsultationAt: "2026-07-12T13:00",
    },
  });

  assert.equal(legacyResultOnly.includes("레벨테스트 완료일시"), false);
  assert.equal(legacyResultOnly.includes("레벨테스트 결과"), false);
  assert.ok(materialEvidence.includes("레벨테스트 예약일시"));
  assert.ok(materialEvidence.includes("레벨테스트 장소"));
});

test("R68 a recorded consultation completion always identifies its owner", () => {
  const blockers = getRegistrationConsistencyBlockers({
    registration: {
      pipelineStatus: "2. 상담 예약",
      phoneConsultationAt: "2026-07-12T13:00",
      consultationAt: "2026-07-12T14:00",
    },
  });

  assert.ok(blockers.includes("상담 책임자"));
});

test("R69 saving a held registration cannot silently resume it", () => {
  assert.equal(getRegistrationTaskStatusForPipeline("0. 등록 문의", "on_hold"), "on_hold");
  assert.equal(getRegistrationTaskStatusForPipeline("4-1. 현재반 대기 신청", "on_hold"), "on_hold");
  assert.equal(getRegistrationTaskStatusForPipeline("2. 상담 예약", "requested"), "in_progress");
  assert.equal(getRegistrationTaskStatusForPipeline("7. 등록 완료", "in_progress"), "done");
  assert.equal(getRegistrationTaskStatusForPipeline("9. 문의만", "in_progress"), "canceled");
});

test("R70 inquiry-only terminal cards do not invent test or consultation history", () => {
  assert.deepEqual(getRegistrationMobileSections("9. 문의만", {}), ["inquiry"]);
  assert.deepEqual(getRegistrationMobileSections("8. 미등록", {
    phoneConsultationAt: "2026-07-12T13:00",
  }), ["inquiry", "consultation"]);
  assert.deepEqual(getRegistrationMobileSections("8. 미등록", {
    levelTestAt: "2026-07-12T10:00",
    levelTestPlace: "본관",
  }), ["inquiry", "level_test"]);
});

test("R71 completed enrollment is immutable until a compensating correction flow exists", () => {
  assert.equal(isRegistrationCompletionImmutable("7. 등록 완료"), true);
  assert.equal(isRegistrationCompletionImmutable("8. 미등록"), false);
  assert.equal(isRegistrationCompletionImmutable("9. 문의만"), false);
});

test("R72 consultation-only mobile cards do not invent a level-test row", () => {
  assert.deepEqual(getRegistrationMobileSections("2. 상담 예약", {
    phoneConsultationAt: "2026-07-12T13:00",
  }), ["inquiry", "consultation"]);
  assert.deepEqual(getRegistrationMobileSections("3. 상담 완료", {
    phoneConsultationAt: "2026-07-12T13:00",
    consultationAt: "2026-07-12T14:00",
    counselor: "정보영",
  }), ["inquiry", "consultation"]);
});

test("R73 terminal mobile cards retain real placement and admission history", () => {
  assert.deepEqual(getRegistrationMobileSections("8. 미등록", {
    classId: "class-1",
    className: "중2 영어",
    textbookId: "textbook-1",
    textbookTitle: "중등 독해",
    admissionNoticeSent: true,
  }), ["inquiry", "placement", "admission"]);
});

// Set 13: six-stage operating chart and split work views.
test("R74 level-test and consultation pipeline stages use separate top views", () => {
  assert.equal(getRegistrationViewKey("1. 레벨테스트 예약", "in_progress"), "level_test");
  assert.equal(getRegistrationViewKey("1-1. 레벨테스트 완료", "in_progress"), "level_test");
  assert.equal(getRegistrationViewKey("2. 상담 예약", "in_progress"), "consulting");
  assert.equal(getRegistrationViewKey("3. 상담 완료", "in_progress"), "consulting");
});

test("R75 registration workflow stages preserve the six ordered operating decisions", () => {
  const getRegistrationWorkflowStages = registrationWorkflow.getRegistrationWorkflowStages;

  assert.equal(typeof getRegistrationWorkflowStages, "function");
  const stages = getRegistrationWorkflowStages();
  assert.equal(stages.length, 6);
  assert.deepEqual(stages.map((stage) => stage.label), ["문의", "레벨테스트", "상담", "대기", "등록", "완료"]);

  const operatingCopy = JSON.stringify(stages);
  for (const requiredCopy of [
    "고1 1학기 내신",
    "모의고사 성적",
    "레벨테스트를 생략",
    "시험지·결과지 URL",
    "상담 책임자",
    "관리팀 Google Chat",
    "현재 학기 수강반",
    "현재 학기 개강반",
    "다음 학기 개강반",
    "레벨테스트 예약으로 돌아",
    "수납",
    "MakeEdu",
    "미등록",
  ]) {
    assert.ok(operatingCopy.includes(requiredCopy), requiredCopy);
  }
  assert.ok(operatingCopy.includes("전화상담 대기 목록"));
  assert.ok(operatingCopy.includes("전화상담은 예약 없이"));
  assert.ok(operatingCopy.includes("방문상담 예약 시"));
  assert.equal(operatingCopy.includes("전화 또는 방문 예약일시"), false);
  assert.equal(operatingCopy.includes("전화상담 예약 시"), false);
});

test("R76 registration workflow source cannot reintroduce inquiry-channel fields", async () => {
  const source = await readSource("src/features/tasks/registration-workflow.js");
  assert.doesNotMatch(source, /inquiryChannel|inquiry_channel|문의채널|문의 채널/);
});

test("R77 registration schedule sessions keep only active normal and makeup dates in date/session order", () => {
  const sessions = getSelectableRegistrationScheduleSessions({
    sessions: [
      { date: "2026-07-15", sessionNumber: 3, scheduleState: "makeup" },
      { date: "2026-07-12", sessionNumber: 2, scheduleState: "active" },
      { date: "2026-07-12", sessionNumber: 1, scheduleState: "normal" },
      { date: "2026-07-13", sessionNumber: 4, scheduleState: "exception" },
      { date: "2026-07-14", sessionNumber: 5, scheduleState: "tbd" },
      { date: "2026-07-16", sessionNumber: 6, scheduleState: "canceled" },
      { date: "", sessionNumber: 7, scheduleState: "active" },
      { date: "2026-07-17", sessionNumber: 0, scheduleState: "active" },
      { date: "2026-07-18", sessionNumber: 1.5, scheduleState: "active" },
    ],
  });

  assert.deepEqual(sessions, [
    { value: "2026-07-12:1", dateKey: "2026-07-12", sessionNumber: 1, sessionLabel: "1회차", state: "normal" },
    { value: "2026-07-12:2", dateKey: "2026-07-12", sessionNumber: 2, sessionLabel: "2회차", state: "active" },
    { value: "2026-07-15:3", dateKey: "2026-07-15", sessionNumber: 3, sessionLabel: "3회차", state: "makeup" },
  ]);
});

test("R78 linked textbook default requires current class-change intent and respects saved or explicit empty choices", () => {
  const base = {
    classId: "class-b",
    linkedTextbookIds: ["missing", "textbook-2", "textbook-1"],
    availableTextbookIds: ["textbook-1", "textbook-2"],
    textbookId: "",
  };

  assert.equal(resolveRegistrationLinkedTextbookDefault({ ...base, pendingClassId: "class-b", clearedClassId: "" }), "textbook-2");
  assert.equal(resolveRegistrationLinkedTextbookDefault({ ...base, pendingClassId: "", clearedClassId: "" }), "", "opening a saved empty textbook must stay empty");
  assert.equal(resolveRegistrationLinkedTextbookDefault({ ...base, pendingClassId: "class-b", clearedClassId: "class-b" }), "", "an explicit current-class clear must persist");
  assert.equal(resolveRegistrationLinkedTextbookDefault({ ...base, pendingClassId: "class-b", clearedClassId: "", textbookId: "textbook-1" }), "", "a manual valid selection must not be replaced");
});
