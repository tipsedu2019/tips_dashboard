import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  canEditRegistrationTask,
  canSendRegistrationAdmissionMessage,
  compareRegistrationTasks,
  getEmptyRegistrationFilters,
  getManualAdmissionCompletionStatus,
  getRegistrationBlockerFocusKey,
  getRegistrationChecklistAvailability,
  getRegistrationCreateBlockers,
  getRegistrationCreateDefaults,
  getRegistrationDecisionActions,
  getRegistrationFilterColumnChange,
  getRegistrationFormState,
  getRegistrationGradeOptions,
  getRegistrationMobileSections,
  getRegistrationReopenStatus,
  getRegistrationTransitionBlockers,
  getRegistrationViewKey,
  getRegistrationWaitlistAssignmentBlockers,
  hasActiveRegistrationFilters,
  isRegistrationClassWaitlistStatus,
  isRegistrationFilterInputExpanded,
  normalizeRegistrationDateRange,
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
test("R01 decision menu exposes the inquiry-only terminal outcome", () => {
  assert.equal(getRegistrationDecisionActions().some((action) => action.prefix === "9."), true);
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
  assert.equal(getRegistrationCreateDefaults(now).registration.inquiryAt, now);
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

test("R12 level-test completion requires an actual completion timestamp", () => {
  const blockers = getRegistrationTransitionBlockers({ registration: { levelTestAt: "2026-07-11T10:00", levelTestCompletedAt: "", levelTestResult: "중2 상" } }, "1-1. 레벨테스트 완료");
  assert.ok(blockers.includes("레벨테스트 완료일시"));
});

test("R13 level-test completion requires a result", () => {
  const blockers = getRegistrationTransitionBlockers({ registration: { levelTestAt: "2026-07-11T10:00", levelTestCompletedAt: "2026-07-11T11:00", levelTestResult: "" } }, "1-1. 레벨테스트 완료");
  assert.ok(blockers.includes("레벨테스트 결과"));
});

test("R14 a visit consultation reservation requires a consultation room", () => {
  const blockers = getRegistrationTransitionBlockers({ registration: { visitConsultationAt: "2026-07-12T10:00", visitConsultationPlace: "" } }, "2. 상담 예약");
  assert.ok(blockers.includes("방문상담실"));
});

test("R15 consultation completion requires the recorded completion time", () => {
  const blockers = getRegistrationTransitionBlockers({ registration: { counselor: "정보영", consultationAt: "" } }, "3. 상담 완료");
  assert.ok(blockers.includes("상담 완료일시"));
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
  const source = await readSource("src/app/api/solapi/registration/route.ts");
  assert.match(source, /detailError/);
  assert.match(source, /if \(detailError\) throw detailError/);
});

test("R23 SOLAPI status loading surfaces message-history query failures", async () => {
  const source = await readSource("src/app/api/solapi/registration/route.ts");
  assert.match(source, /historyError/);
  assert.match(source, /if \(historyError\) throw historyError/);
});

test("R24 an indeterminate provider request is not left as forever-pending", async () => {
  const source = await readSource("src/app/api/solapi/registration/route.ts");
  assert.match(source, /status: "unknown"/);
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

test("R27 payment confirmation is unavailable before the admission form is sent", () => {
  const availability = getRegistrationChecklistAvailability({ pipelineStatus: "5-1. 입학신청서 발송 완료", registration: { admissionNoticeSent: false } });
  assert.equal(availability.paymentChecked.enabled, false);
  const beforePaymentStage = getRegistrationChecklistAvailability({ pipelineStatus: "5-1. 입학신청서 발송 완료", registration: { admissionNoticeSent: true } });
  assert.equal(beforePaymentStage.paymentChecked.enabled, false);
});

test("R28 MakeEdu registration is unavailable before payment is confirmed", () => {
  const availability = getRegistrationChecklistAvailability({ pipelineStatus: "6. 수납 확인", registration: { admissionNoticeSent: true, paymentChecked: false } });
  assert.equal(availability.makeeduRegistered.enabled, false);
});

test("R29 invoice sending is unavailable before MakeEdu registration", () => {
  const availability = getRegistrationChecklistAvailability({ pipelineStatus: "6. 수납 확인", registration: { admissionNoticeSent: true, paymentChecked: true, makeeduRegistered: false } });
  assert.equal(availability.makeeduInvoiceSent.enabled, false);
});

test("R30 textbook billing is unavailable without payment, class, and textbook links", () => {
  const availability = getRegistrationChecklistAvailability({ pipelineStatus: "6. 수납 확인", classId: "", textbookId: "", registration: { admissionNoticeSent: true, paymentChecked: true } });
  assert.equal(availability.textbookBillingIssued.enabled, false);
});

// Set 7: table filtering, period ranges, and sorting.
test("R31 changing the target table column clears the previous column value", () => {
  assert.deepEqual(getRegistrationFilterColumnChange("김하윤", "counselor"), { filterColumnKey: "counselor", filterValue: "" });
});

test("R32 the table filter input can collapse even when it contains text", () => {
  assert.equal(isRegistrationFilterInputExpanded(false, "김하윤"), false);
});

test("R33 active table filters can be detected and reset together", () => {
  const filters = { ...getEmptyRegistrationFilters(), selectedSubjectFilter: "영어", filterValue: "김" };
  assert.equal(hasActiveRegistrationFilters(filters), true);
  assert.deepEqual(getEmptyRegistrationFilters(), {
    selectedSubjectFilter: "all",
    selectedCounselorFilter: "all",
    selectedGradeFilter: "all",
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

test("R40 a terminal decision can be explicitly reopened to consultation completion", () => {
  assert.equal(getRegistrationReopenStatus("8. 미등록"), "3. 상담 완료");
  assert.equal(getRegistrationReopenStatus("9. 문의만"), "3. 상담 완료");
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
  const end = source.indexOf("function AutoSyncStatusField", start);
  const checkField = source.slice(start, end);
  assert.match(checkField, /whitespace-normal/);
  assert.doesNotMatch(checkField, /truncate/);
});

test("R44 blocker navigation targets the exact missing registration control", () => {
  assert.equal(getRegistrationBlockerFocusKey("상담 완료일시"), "consultationAt");
  assert.equal(getRegistrationBlockerFocusKey("레벨테스트 결과"), "levelTestResult");
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
