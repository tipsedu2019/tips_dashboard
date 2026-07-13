import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import vm from "node:vm";

import ts from "typescript";

import {
  getAllowedApproverNames,
  getMakeupRequestEffectiveYear,
  hasCancelPart,
  hasMakeupPart,
  isMakeupApproverAllowed,
  normalizeMakeupSlots,
  resolveMakeupApprovalGroup,
} from "../src/features/makeup-requests/makeup-request-model.js";

function readOptionalSource(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

const navigationSource = readFileSync("src/lib/navigation.ts", "utf8");
const authGuardSource = readFileSync("src/components/auth/auth-guard.tsx", "utf8");
const headerSource = readFileSync("src/components/site-header.tsx", "utf8");
const rootLayoutSource = readFileSync("src/app/layout.tsx", "utf8");
const packageSource = readFileSync("package.json", "utf8");
const migrationSource = readFileSync("supabase/migrations/20260706102047_makeup_requests.sql", "utf8");
const workspaceSource = readFileSync("src/features/makeup-requests/makeup-request-workspace.tsx", "utf8");
const dateTimePickerSource = readFileSync("src/components/ui/date-time-picker.tsx", "utf8");
const serviceSource = readFileSync("src/features/makeup-requests/makeup-request-service.ts", "utf8");
const modelSource = readFileSync("src/features/makeup-requests/makeup-request-model.js", "utf8");
const apiRouteSource = readFileSync("src/app/api/google-chat/route.ts", "utf8");
const slotsMigrationSource = readFileSync("supabase/migrations/20260706105512_makeup_request_slots.sql", "utf8");
const notificationMigrationSource = readFileSync("supabase/migrations/20260706123000_makeup_notification_controls.sql", "utf8");
const pushMigrationSource = readOptionalSource("supabase/migrations/20260707143000_dashboard_push_subscriptions.sql");
const flowTypesMigrationSource = readOptionalSource("supabase/migrations/20260707152220_makeup_request_flow_types.sql");
const notificationRetentionMigrationSource = readOptionalSource("supabase/migrations/20260707152233_makeup_notification_delivery_retention.sql");
const refundFlowMigrationSource = readOptionalSource("supabase/migrations/20260708025405_makeup_request_refund_flow.sql");
const manifestSource = readOptionalSource("public/manifest.webmanifest");
const serviceWorkerSource = readOptionalSource("public/sw.js");
const pushClientSource = readOptionalSource("src/lib/dashboard-push-client.ts");
const pushSubscriptionsRouteSource = readOptionalSource("src/app/api/push-subscriptions/route.ts");
const webPushRouteSource = readOptionalSource("src/app/api/web-push/route.ts");
const notificationPopoverSource = readFileSync("src/components/dashboard-notification-popover.tsx", "utf8");
const inFlightRequestModule = await import("../src/lib/in-flight-request.js").catch(() => ({}));
const allMigrationSource = readdirSync("supabase/migrations")
  .filter((name) => name.endsWith(".sql"))
  .map((name) => readFileSync(`supabase/migrations/${name}`, "utf8"))
  .join("\n");

function sourceBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `missing source marker: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `missing source marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

function transpileAndLoad(source, exports, mocks = {}) {
  const compiled = ts.transpileModule(
    `${source}\nmodule.exports = { ${exports.join(", ")} }`,
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    },
  ).outputText;
  const sandboxModule = { exports: {} };
  vm.runInNewContext(compiled, {
    module: sandboxModule,
    exports: sandboxModule.exports,
    ...mocks,
  });
  return sandboxModule.exports;
}

function loadWorkspaceApproverHelpers() {
  const source = sourceBetween(
    workspaceSource,
    "function getMakeupApproverEffectiveYear",
    "function getMakeupActionErrorMessage",
  );
  return transpileAndLoad(
    source,
    ["getMakeupApproverEffectiveYear", "resolveMakeupSubmissionApproverCatalogId"],
    { getAllowedApproverNames, getMakeupRequestEffectiveYear },
  );
}

function loadMakeupPayloadValidation() {
  const managerRoleSource = sourceBetween(
    serviceSource,
    "function isMakeupManagerRole",
    "function buildRequestHref",
  );
  const payloadSource = sourceBetween(
    serviceSource,
    "function buildCreatePayload",
    "export async function createMakeupRequest",
  );
  return transpileAndLoad(
    `${managerRoleSource}\n${payloadSource}`,
    ["buildCreatePayload", "isMakeupManagerRole"],
    {
      getMakeupRequestEffectiveYear,
      hasCancelPart,
      hasMakeupPart,
      isMakeupApproverAllowed,
      normalizeMakeupSlots,
      resolveMakeupApprovalGroup,
      resolveTeacherForClass: (classItem, teachers) => teachers.find((teacher) => teacher.id === classItem.teacherCatalogId),
      text: (value) => String(value ?? "").trim(),
    },
  );
}

test("makeup request route is exposed in admin navigation and quick search", () => {
  assert.match(navigationSource, /title: "휴보강"/);
  assert.doesNotMatch(navigationSource, /title: "휴보강 신청서"/);
  assert.match(navigationSource, /url: "\/admin\/makeup-requests"/);
  assert.match(navigationSource, /match: "\/admin\/makeup-requests"/);
  assert.match(authGuardSource, /"\/admin\/makeup-requests"/);
});

test("makeup request migration creates request event and notification tables", () => {
  assert.match(migrationSource, /create table if not exists public\.makeup_requests/);
  assert.match(migrationSource, /approval_group text not null/);
  assert.match(migrationSource, /makeup_slots jsonb not null default '\[\]'::jsonb/);
  assert.match(migrationSource, /status text not null default 'approval_pending'/);
  assert.match(migrationSource, /check \(status in \('approval_pending', 'revision_requested', 'rejected', 'manager_pending', 'completed', 'canceled'\)\)/);
  assert.match(migrationSource, /create table if not exists public\.makeup_request_events/);
  assert.match(migrationSource, /create table if not exists public\.dashboard_notifications/);
  assert.match(migrationSource, /current_dashboard_role\(\) in \('admin', 'staff'\)/);
  assert.match(slotsMigrationSource, /add column if not exists makeup_slots jsonb not null default '\[\]'::jsonb/);
  assert.match(slotsMigrationSource, /add column if not exists makeup_academic_event_ids jsonb not null default '\[\]'::jsonb/);
  assert.match(notificationMigrationSource, /create table if not exists public\.makeup_notification_settings/);
  assert.match(notificationMigrationSource, /create table if not exists public\.makeup_notification_deliveries/);
  assert.match(notificationMigrationSource, /dedupe_key text/);
  assert.match(notificationMigrationSource, /dashboard_notifications_dedupe_key/);
  assert.match(allMigrationSource, /create table if not exists public\.google_chat_webhook_settings/);
  assert.match(allMigrationSource, /channel text primary key/);
  assert.match(allMigrationSource, /webhook_url text not null default ''/);
  assert.match(allMigrationSource, /grant select, insert, update on public\.google_chat_webhook_settings to service_role/);
  assert.doesNotMatch(allMigrationSource, /grant select, insert, update on public\.google_chat_webhook_settings to authenticated/);
});

test("makeup request schema supports cancel-only and makeup-only flow types", () => {
  assert.match(flowTypesMigrationSource, /add column if not exists request_kind text not null default 'cancel_makeup'/);
  assert.match(flowTypesMigrationSource, /check \(request_kind in \('cancel_makeup', 'cancel_only', 'makeup_only'\)\)/);
  assert.match(flowTypesMigrationSource, /drop constraint if exists makeup_requests_status_check/);
  assert.match(flowTypesMigrationSource, /'makeup_pending'/);
  assert.match(flowTypesMigrationSource, /alter column cancel_date drop not null/);
  assert.match(flowTypesMigrationSource, /alter column makeup_start_at drop not null/);
  assert.match(flowTypesMigrationSource, /alter column makeup_end_at drop not null/);
  assert.match(flowTypesMigrationSource, /alter column makeup_classroom drop not null/);
  assert.match(flowTypesMigrationSource, /makeup_requests_kind_idx/);
  assert.match(flowTypesMigrationSource, /delete from public\.academic_events event/);
  assert.match(flowTypesMigrationSource, /\[\[TIPS_MAKEUP\]\]/);
  assert.match(flowTypesMigrationSource, /->> 'kind'\) = 'makeup'/);
  assert.match(flowTypesMigrationSource, /not exists \(\s*select 1\s*from public\.makeup_requests request/);
  assert.match(flowTypesMigrationSource, /->> 'requestId'\)/);
  assert.match(refundFlowMigrationSource, /drop constraint if exists makeup_requests_status_check/);
  assert.match(refundFlowMigrationSource, /'refund_pending'/);
});

test("makeup notification settings schema allows refund request trigger toggles", () => {
  assert.match(serviceSource, /refund_requested: "환불 신청"/);
  assert.match(allMigrationSource, /drop constraint if exists makeup_notification_settings_trigger_kind_check/);
  assert.match(
    allMigrationSource,
    /add constraint makeup_notification_settings_trigger_kind_check\s*check \(trigger_kind in \('submitted', 'approved', 'returned', 'rejected', 'completed', 'canceled', 'refund_requested'\)\)/,
  );
  assert.match(allMigrationSource, /from unnest\(array\['refund_requested'\]::text\[\]\) trigger_kind/);
});

test("makeup workspace includes approver queues form fields and room availability states", () => {
  assert.match(workspaceSource, /type MakeupRequestView = "mine" \| "approvalPending" \| "makeupPending" \| "refundPending" \| "closed"/);
  assert.match(workspaceSource, /\{ id: "mine", label: "신청" \}/);
  assert.match(workspaceSource, /\{ id: "approvalPending", label: "결재대기" \}/);
  assert.doesNotMatch(workspaceSource, /id: "manager"/);
  assert.doesNotMatch(workspaceSource, /label: "관리팀"/);
  assert.match(workspaceSource, /\{ id: "closed", label: "승인\/반려" \}/);
  assert.doesNotMatch(workspaceSource, /내 신청/);
  assert.doesNotMatch(workspaceSource, /완료\/반려/);
  for (const label of ["과목", "선생님", "수업", "사유", "휴강일", "보강일시", "보강 강의실", "결재자"]) {
    assert.match(workspaceSource, new RegExp(label));
  }
  assert.doesNotMatch(workspaceSource, /보강 시작/);
  assert.doesNotMatch(workspaceSource, /보강 종료/);
  assert.match(workspaceSource, /selectedSubject/);
  assert.match(workspaceSource, /selectedTeacherKey/);
  assert.match(workspaceSource, /availableClasses/);
  assert.match(workspaceSource, /makeupSlots/);
  assert.match(workspaceSource, /function getInputRequestKind/);
  assert.match(workspaceSource, /requestKind: getInputRequestKind\(input, makeupSlots\)/);
  assert.doesNotMatch(workspaceSource, /MAKEUP_REQUEST_KIND_OPTIONS/);
  assert.doesNotMatch(workspaceSource, /handleRequestKindChange/);
  assert.doesNotMatch(workspaceSource, /신청 구분/);
  assert.doesNotMatch(workspaceSource, /휴강\+보강/);
  assert.doesNotMatch(workspaceSource, /휴강만/);
  assert.doesNotMatch(workspaceSource, /보강만/);
  assert.match(workspaceSource, /보강일시 추가/);
  assert.match(workspaceSource, /DatePickerControl/);
  assert.match(workspaceSource, /TimePickerControl/);
  assert.match(workspaceSource, /const canEditMakeupSlots = Boolean\(selectedClass\)/);
  assert.match(
    workspaceSource,
    /<Button type="button" variant="outline" size="sm" onClick=\{addMakeupSlot\} disabled=\{!canEditMakeupSlots\}>/,
    "makeup slot creation should wait until a class is selected",
  );
  assert.match(workspaceSource, /placeholder=\{canEditMakeupSlots \? "날짜 선택" : "수업을 먼저 선택"\}/);
  assert.match(workspaceSource, /ariaLabel=\{`보강일시 \$\{index \+ 1\} 시작시각`\}[\s\S]*disabled=\{!canEditMakeupSlots\}/);
  assert.match(dateTimePickerSource, /disabled\?: boolean/);
  assert.match(dateTimePickerSource, /onOpenChange=\{\(nextOpen\) => setOpen\(disabled \? false : nextOpen\)\}/);
  assert.match(workspaceSource, /getSlotRoomAvailability/);
  assert.match(workspaceSource, /getSlotRoomAvailability\(slot, data, editingRequestId, selectedClass\?\.subject \|\| selectedSubject, canUserManage\(role\)\)/);
  assert.match(workspaceSource, /slot\.classroom/);
  assert.match(workspaceSource, /aria-label=\{`보강일시 \$\{index \+ 1\} 강의실`\}/);
  assert.doesNotMatch(workspaceSource, /type="date"/);
  assert.doesNotMatch(workspaceSource, /type="time"/);
  assert.match(workspaceSource, /buildRoomAvailability/);
  assert.match(workspaceSource, /ignoreOrphanedMakeupEvents: canIgnoreOrphanedMakeupEvents/);
  assert.match(workspaceSource, /빈 강의실/);
  assert.match(workspaceSource, /충돌/);
  assert.doesNotMatch(workspaceSource, /최종 확인/);
  assert.match(workspaceSource, /requestDialogOpen/);
  assert.match(workspaceSource, /휴보강 신청/);
  assert.match(workspaceSource, /DialogTitle>\{editingRequestId \? "휴보강 보완 재상신" : "휴보강 신청"\}/);
  assert.doesNotMatch(workspaceSource, /const shouldShowRequestForm = view === "mine"/);
  const headerActionSource = workspaceSource.slice(
    workspaceSource.indexOf('aria-label="휴보강 흐름"'),
    workspaceSource.indexOf("{message ?"),
  );
  assert.match(headerActionSource, /aria-label="휴보강 알림 설정"/);
  assert.match(headerActionSource, /<Bell className="size-4"/);
  assert.match(headerActionSource, /<Plus className="size-4"/);
  assert.match(headerActionSource, />\s*휴보강 신청\s*</);
  assert.ok(headerActionSource.indexOf('aria-label="휴보강 알림 설정"') < headerActionSource.indexOf("onClick={openRequestDialog}"));
  assert.doesNotMatch(headerActionSource, /<Settings className/);
  assert.doesNotMatch(workspaceSource, /새로고침/);
  assert.doesNotMatch(workspaceSource, /RefreshCw/);
  assert.ok(workspaceSource.indexOf('htmlFor="makeup-subject">과목') < workspaceSource.indexOf('htmlFor="makeup-teacher">선생님'));
  assert.ok(workspaceSource.indexOf('htmlFor="makeup-teacher">선생님') < workspaceSource.indexOf('htmlFor="makeup-class">수업'));
  assert.ok(workspaceSource.lastIndexOf("결재자") > workspaceSource.lastIndexOf("보강 강의실"));
  assert.match(workspaceSource, /SelectValue placeholder="강의실 선택"/);
  assert.match(serviceSource, /makeup_classroom: hasMakeup \? firstSlot\.classroom : null/);
  assert.match(serviceSource, /for \(const slot of slots\)/);
});

test("makeup requests auto-select the year-aware director by catalog ID and revalidate submissions", () => {
  assert.match(workspaceSource, /getMakeupRequestEffectiveYear/);
  assert.match(workspaceSource, /getAllowedApproverNames\(selectedClass, approverEffectiveYear\)/);
  assert.match(workspaceSource, /data\.teachers\.find\(\(teacher\) => allowedNames\.includes\(teacher\.name\)\)/);
  assert.match(workspaceSource, /approverTeacherCatalogId: firstApprover\?\.id \|\| ""/);
  assert.match(serviceSource, /getMakeupRequestEffectiveYear/);
  assert.match(serviceSource, /isMakeupApproverAllowed\(\{/);
  assert.match(serviceSource, /classRecord: classItem/);
  assert.match(serviceSource, /approverName: approver\.name/);
  assert.match(serviceSource, /isManager: allowApproverOverride/);
  assert.match(serviceSource, /effectiveYear/);
  assert.match(serviceSource, /throw new Error\("선택할 수 없는 결재자입니다\."\)/);
});

test("new makeup requests refresh the Seoul year at submission while edits keep their created year", () => {
  assert.doesNotMatch(
    workspaceSource,
    /const approverEffectiveYear = useMemo\([\s\S]{0,180}editingRequest\?\.createdAt/,
    "a new request must not cache its effective year for the lifetime of the mounted workspace",
  );
  assert.match(workspaceSource, /const approverEffectiveYear = getMakeupApproverEffectiveYear\(editingRequest\?\.createdAt\)/);

  const submitSource = sourceBetween(
    workspaceSource,
    "const handleSubmit = useCallback",
    "const runAction = useCallback",
  );
  assert.match(submitSource, /const submissionEffectiveYear = getMakeupApproverEffectiveYear\(editingRequest\?\.createdAt\)/);
  assert.match(submitSource, /resolveMakeupSubmissionApproverCatalogId\(\{/);
  assert.match(submitSource, /patchInput\(\{ approverTeacherCatalogId: submissionApproverTeacherCatalogId \}\)/);
  assert.match(submitSource, /approverTeacherCatalogId: submissionApproverTeacherCatalogId/);

  const {
    getMakeupApproverEffectiveYear,
    resolveMakeupSubmissionApproverCatalogId,
  } = loadWorkspaceApproverHelpers();
  const beforeRollover = "2026-12-31T14:59:59.999Z";
  const afterRollover = "2026-12-31T15:00:00.000Z";

  assert.equal(getMakeupApproverEffectiveYear("", beforeRollover), 2026);
  assert.equal(getMakeupApproverEffectiveYear("", afterRollover), 2027);
  assert.equal(getMakeupApproverEffectiveYear("2026-07-11T00:00:00.000Z", afterRollover), 2026);

  const classItem = { id: "english-high-2", subject: "영어", grade: "고2" };
  const teachers = [
    { id: "director-2026", name: "정보영" },
    { id: "director-2027", name: "강부희" },
  ];
  assert.equal(resolveMakeupSubmissionApproverCatalogId({
    classItem,
    teachers,
    selectedApproverTeacherCatalogId: "director-2026",
    effectiveYear: 2027,
    isManager: false,
  }), "director-2027");
  assert.equal(resolveMakeupSubmissionApproverCatalogId({
    classItem,
    teachers,
    selectedApproverTeacherCatalogId: "director-2026",
    effectiveYear: 2027,
    isManager: true,
  }), "director-2026");
});

test("makeup service payload validation executes non-manager rejection and manager override behavior", () => {
  const { buildCreatePayload, isMakeupManagerRole } = loadMakeupPayloadValidation();
  const classItem = {
    id: "english-high-2",
    name: "고2 영어",
    subject: "영어",
    grade: "고2",
    teacher: "담당 교사",
    teacherCatalogId: "class-teacher",
  };
  const teachers = [
    { id: "class-teacher", name: "담당 교사", profileId: "class-teacher-profile" },
    { id: "director-2026", name: "정보영", profileId: "director-2026-profile" },
    { id: "director-2027", name: "강부희", profileId: "director-2027-profile" },
  ];
  const data = { classes: [classItem], teachers, profiles: [] };
  const baseInput = {
    requestKind: "cancel_only",
    classId: classItem.id,
    reason: "연도 경계 검증",
    cancelDate: "2027-01-02",
    makeupSlots: [],
    makeupClassroom: "",
    approverTeacherCatalogId: "director-2026",
  };

  assert.equal(isMakeupManagerRole("teacher"), false);
  assert.throws(
    () => buildCreatePayload(baseInput, "teacher-actor", data, {
      effectiveYear: 2027,
      allowApproverOverride: isMakeupManagerRole("teacher"),
    }),
    /선택할 수 없는 결재자입니다/,
  );

  const resolvedPayload = buildCreatePayload({
    ...baseInput,
    approverTeacherCatalogId: "director-2027",
  }, "teacher-actor", data, {
    effectiveYear: 2027,
    allowApproverOverride: isMakeupManagerRole("teacher"),
  });
  assert.equal(resolvedPayload.approver_teacher_catalog_id, "director-2027");

  assert.equal(isMakeupManagerRole("admin"), true);
  const managerPayload = buildCreatePayload(baseInput, "manager-actor", data, {
    effectiveYear: 2027,
    allowApproverOverride: isMakeupManagerRole("admin"),
  });
  assert.equal(managerPayload.approver_teacher_catalog_id, "director-2026");

  const existingRequestPayload = buildCreatePayload(baseInput, "teacher-actor", data, {
    effectiveYear: getMakeupRequestEffectiveYear("2026-07-11T00:00:00.000Z"),
    allowApproverOverride: isMakeupManagerRole("teacher"),
  });
  assert.equal(existingRequestPayload.approver_teacher_catalog_id, "director-2026");
});

test("makeup workspace infers request kind from cancel date and makeup slots", () => {
  assert.match(workspaceSource, /function hasStartedMakeupSlot/);
  assert.match(workspaceSource, /function hasIncompleteStartedMakeupSlot/);
  assert.match(workspaceSource, /function getInputRequestKind/);
  assert.match(workspaceSource, /const makeupSlots = materializeSlots\(input\)/);
  assert.match(workspaceSource, /const requestHasCancel = Boolean\(input\.cancelDate\)/);
  assert.match(workspaceSource, /const requestHasMakeup = makeupSlots\.length > 0/);
  assert.match(workspaceSource, /if \(!requestHasCancel && !requestHasMakeup\)/);
  assert.match(workspaceSource, /hasIncompleteStartedMakeupSlot\(input\)/);
  assert.match(workspaceSource, /requestHasMakeup && makeupSlots\.some\(\(slot\) => !slot\.classroom\)/);
  assert.match(workspaceSource, /requestHasMakeup && selectedRoomHasCollision/);
  assert.doesNotMatch(workspaceSource, /requestHasCancel && !input\.cancelDate/);
  assert.doesNotMatch(workspaceSource, /!input\.classId \|\| !input\.reason \|\| !input\.cancelDate \|\| !input\.approverTeacherCatalogId/);
});

test("makeup datetime and room controls stay within operational candidates", () => {
  assert.match(dateTimePickerSource, /const TIME_OPTION_START_MINUTES = 9 \* 60/);
  assert.match(dateTimePickerSource, /const TIME_OPTION_END_MINUTES = 23 \* 60 \+ 30/);
  assert.match(dateTimePickerSource, /TIME_OPTION_END_MINUTES - TIME_OPTION_START_MINUTES/);
  assert.doesNotMatch(dateTimePickerSource, /6 \* 60/);
  assert.doesNotMatch(dateTimePickerSource, /오전 06:00/);
  assert.doesNotMatch(dateTimePickerSource, /placeholder="HH:MM"/);
  assert.doesNotMatch(dateTimePickerSource, />\s*적용\s*</);
  assert.match(dateTimePickerSource, /onWheelCapture=\{\(event\) => event\.stopPropagation\(\)\}/);
  assert.match(dateTimePickerSource, /onTouchMoveCapture=\{\(event\) => event\.stopPropagation\(\)\}/);
  assert.match(workspaceSource, /getSlotRoomCollisionState\(formSlot, data, request\.id, request\.subject\)/);
});

test("makeup approval completes makeup-bearing requests and keeps cancel-only requests tracked", () => {
  assert.doesNotMatch(workspaceSource, /finalConfirmRequest/);
  assert.doesNotMatch(workspaceSource, /completeMakeupRequest/);
  assert.match(serviceSource, /approveMakeupRequest/);
  assert.match(serviceSource, /const nextStatus = isRefundApprovalRequest\(request\) \? "refund_pending" : hasMakeupPart\(request\) \? "completed" : "makeup_pending"/);
  assert.match(serviceSource, /if \(!isRefundApproval && hasMakeupPart\(request\)\)/);
  assert.match(serviceSource, /status: nextStatus/);
  assert.match(workspaceSource, /approvalRequest/);
  assert.match(workspaceSource, /approvalNote/);
  assert.match(workspaceSource, /DialogTitle>승인 메모/);
  assert.match(workspaceSource, /htmlFor="makeup-approval-note"/);
  assert.match(workspaceSource, /approveMakeupRequest\(approvalRequest\.id, currentUserId, approvalNote\)/);
  assert.match(serviceSource, /export async function approveMakeupRequest\(requestId: string, actorId: string, note = ""\)/);
  assert.match(serviceSource, /const approvalNote = text\(note\)/);
  assert.match(serviceSource, /final_note: nullable\(approvalNote\)/);
  assert.match(serviceSource, /cancel_academic_event_id: nullable\(cancelAcademicEventId\)/);
  assert.match(serviceSource, /makeup_academic_event_id: nullable\(makeupAcademicEventId\)/);
  assert.doesNotMatch(serviceSource, /cancel_academic_event_id: cancelAcademicEventId/);
  assert.doesNotMatch(serviceSource, /makeup_academic_event_id: makeupAcademicEventId/);
  assert.match(serviceSource, /recordMakeupRequestEvent\(requestId, "approved", \{ actorId, beforeValue: request\.status, afterValue: nextStatus, note: approvalNote \}\)/);
  assert.doesNotMatch(serviceSource, /const finalNote = buildAutoCompletionNote\(request\)/);
  assert.doesNotMatch(serviceSource, /final_note: nullable\(finalNote\)/);
  assert.doesNotMatch(serviceSource, /recordMakeupRequestEvent\(requestId, "approved", \{ actorId, beforeValue: request\.status, afterValue: "completed", note: finalNote \}\)/);
  assert.match(workspaceSource, /getMakeupActionErrorMessage\(actionError, "요청 처리에 실패했습니다\."\)/);
  assert.doesNotMatch(workspaceSource, /window\.prompt\("승인 메모"/);
  assert.doesNotMatch(workspaceSource, /window\.prompt\("관리팀 최종 확인 메모"/);
  assert.doesNotMatch(workspaceSource, /window\.prompt/);
  assert.match(workspaceSource, /DialogContent[\s\S]*className="max-h-\[86vh\] overflow-y-auto sm:max-w-4xl"[\s\S]*closeButtonLabel="저장하지 않고 닫기"[\s\S]*onCloseButtonClick=\{closeRequestDialog\}[\s\S]*showCloseButtonText/);
  assert.match(workspaceSource, />\s*저장하지 않고 닫기\s*<\/Button>/);
  assert.doesNotMatch(workspaceSource, /xl:grid-cols-\[minmax\(360px,420px\)_1fr\]/);
  assert.match(workspaceSource, /md:grid-cols-\[minmax\(150px,1fr\)_minmax\(96px,0\.55fr\)_minmax\(96px,0\.55fr\)_32px\]/);
  assert.doesNotMatch(workspaceSource, /lg:grid-cols-\[minmax\(0,1\.1fr\)_minmax\(110px,0\.65fr\)_minmax\(110px,0\.65fr\)_minmax\(140px,0\.8fr\)_32px\]/);
});

test("makeup request action controls keep approval decisions in one row", () => {
  const actionControlsSource = workspaceSource.slice(
    workspaceSource.indexOf("function MakeupRequestActionControls"),
    workspaceSource.indexOf("function MakeupRequestDetailCard"),
  );

  assert.match(actionControlsSource, /flex-nowrap/);
  assert.match(actionControlsSource, /whitespace-nowrap/);
  assert.doesNotMatch(actionControlsSource, /flex-wrap/);
  assert.match(workspaceSource, /\{ columnKey: "action", label: "액션", width: 250, minWidth: 230, align: "right" \}/);
});

test("makeup request form marks required fields and exposes clear controls", () => {
  assert.match(workspaceSource, /function RequiredFormLabel/);
  assert.match(workspaceSource, /aria-hidden="true">\*<\/span>/);
  assert.match(workspaceSource, /<RequiredFormLabel htmlFor="makeup-subject">과목<\/RequiredFormLabel>/);
  assert.match(workspaceSource, /<RequiredFormLabel htmlFor="makeup-teacher">선생님<\/RequiredFormLabel>/);
  assert.match(workspaceSource, /<RequiredFormLabel htmlFor="makeup-class">수업<\/RequiredFormLabel>/);
  assert.match(workspaceSource, /<RequiredFormLabel htmlFor="makeup-reason">사유<\/RequiredFormLabel>/);
  assert.match(workspaceSource, /<RequiredFormLabel htmlFor="makeup-approver">결재자<\/RequiredFormLabel>/);
  assert.match(workspaceSource, /function getSequencedSelectTriggerClassName/);
  assert.match(workspaceSource, /border-primary\/60 bg-primary\/5/);
  assert.match(workspaceSource, /border-amber-300 bg-amber-50/);
  assert.match(workspaceSource, /<SelectTrigger id="makeup-subject" className=\{getSequencedSelectTriggerClassName\(\{ active: !selectedSubject \}\)\}>/);
  assert.match(workspaceSource, /<SelectTrigger id="makeup-teacher" className=\{getSequencedSelectTriggerClassName\(\{ active: Boolean\(selectedSubject\) && !selectedTeacherKey, dependency: !selectedSubject \}\)\}>/);
  assert.match(workspaceSource, /<SelectTrigger id="makeup-class" className=\{getSequencedSelectTriggerClassName\(\{ active: Boolean\(selectedTeacherKey\) && !input\.classId, dependency: !selectedTeacherKey \}\)\}>/);
  assert.match(workspaceSource, /className=\{slot\.classroom \? "w-full pr-14" : "w-full"\}/);
  assert.match(workspaceSource, /<SelectTrigger id="makeup-approver" className=\{getSequencedSelectTriggerClassName\(\{ active: Boolean\(selectedClass\) && !input\.approverTeacherCatalogId, dependency: !selectedClass \}\)\}>/);
  assert.match(workspaceSource, /const canSubmitRequest = Boolean\(/);
  assert.match(workspaceSource, /input\.classId &&[\s\S]*input\.reason\.trim\(\) &&[\s\S]*input\.approverTeacherCatalogId/);
  assert.match(workspaceSource, /\(requestHasCancelDate \|\| requestHasMakeupSlots\)/);
  assert.match(workspaceSource, /<Select value=\{input\.approverTeacherCatalogId\} onValueChange=\{\(value\) => patchInput\(\{ approverTeacherCatalogId: value \}\)\} disabled=\{!selectedClass\}>/);
  assert.match(workspaceSource, /disabled=\{saving \|\| loading \|\| !canSubmitRequest\}/);
  assert.match(workspaceSource, /function FieldClearButton/);
  assert.match(workspaceSource, /aria-label="휴강일 초기화"/);
  assert.match(workspaceSource, /patchInput\(\{ cancelDate: "" \}\)/);
  assert.match(workspaceSource, /function getMakeupClassScheduleDateOptions/);
  assert.match(workspaceSource, /const selectedClassScheduleDateOptions = useMemo/);
  assert.match(workspaceSource, /linkedDates=\{selectedClassScheduleDateOptions\}/);
  assert.match(workspaceSource, /linkedDatesLabel="수업일정"/);
  assert.match(workspaceSource, /restrictToLinkedDates=\{selectedClassScheduleDateOptions\.length > 0\}/);
  assert.match(dateTimePickerSource, /linkedDates\?: Array<\{ value: string; label\?: string \}>/);
  assert.match(dateTimePickerSource, /disabled=\{restrictToLinkedDates && linkedDateSet\.size > 0 \? \(date\) => !linkedDateSet\.has\(toDateKey\(date\)\) : undefined\}/);
  assert.match(workspaceSource, /aria-label=\{`보강일시 \$\{index \+ 1\} 날짜 초기화`\}/);
  assert.match(workspaceSource, /patchMakeupSlot\(slot\.id \|\| "", \{ date: "" \}\)/);
  assert.match(workspaceSource, /aria-label=\{`보강일시 \$\{index \+ 1\} 시작시각 초기화`\}/);
  assert.match(workspaceSource, /patchMakeupSlot\(slot\.id \|\| "", \{ startTime: "" \}\)/);
  assert.match(workspaceSource, /aria-label=\{`보강일시 \$\{index \+ 1\} 종료시각 초기화`\}/);
  assert.match(workspaceSource, /patchMakeupSlot\(slot\.id \|\| "", \{ endTime: "" \}\)/);
  assert.match(workspaceSource, /aria-label=\{`보강일시 \$\{index \+ 1\} 강의실 초기화`\}/);
  assert.match(workspaceSource, /patchMakeupSlot\(slot\.id \|\| "", \{ classroom: "" \}\)/);
});

test("makeup dialogs provide sr-only descriptions without adding visual helper copy", () => {
  const requestDialogSource = workspaceSource.slice(
    workspaceSource.indexOf('<Dialog open={requestDialogOpen}'),
    workspaceSource.indexOf('<Dialog open={Boolean(detailRequest)}'),
  );
  const detailDialogSource = workspaceSource.slice(
    workspaceSource.indexOf('<Dialog open={Boolean(detailRequest)}'),
    workspaceSource.indexOf('<Dialog open={notificationDialogOpen}'),
  );
  const notificationDialogSource = workspaceSource.slice(
    workspaceSource.indexOf('<Dialog open={notificationDialogOpen}'),
    workspaceSource.indexOf('<Dialog open={Boolean(selectedNotificationSetting)}'),
  );

  assert.match(requestDialogSource, /<DialogDescription className="sr-only">[\s\S]*?휴보강 신청 정보를 입력하고 결재자에게 상신합니다\.[\s\S]*?<\/DialogDescription>/);
  assert.match(detailDialogSource, /<DialogDescription className="sr-only">[\s\S]*?선택한 휴보강 신청의 결재 상태와 처리 내용을 확인합니다\.[\s\S]*?<\/DialogDescription>/);
  assert.match(notificationDialogSource, /<DialogDescription className="sr-only">[\s\S]*?휴보강 프로세스별 웹 알림과 구글챗 발송 설정을 관리합니다\.[\s\S]*?<\/DialogDescription>/);
  assert.doesNotMatch(requestDialogSource, /<DialogDescription(?! className="sr-only")/);
  assert.doesNotMatch(detailDialogSource, /<DialogDescription(?! className="sr-only")/);
  assert.doesNotMatch(notificationDialogSource, /<DialogDescription(?! className="sr-only")/);
});

test("makeup pending requests can continue to makeup scheduling or refund tracking", () => {
  assert.match(serviceSource, /export async function requestMakeupRefund\(requestId: string, actorId: string, note: string\)/);
  assert.match(serviceSource, /canTransitionMakeupRequest\(request\.status, "approval_pending"/);
  assert.match(serviceSource, /status: "approval_pending"/);
  assert.match(serviceSource, /recordMakeupRequestEvent\(requestId, "refund_requested", \{ actorId, beforeValue: request\.status, afterValue: "approval_pending"/);
  assert.match(serviceSource, /function isRefundApprovalRequest\(request: MakeupRequest\)/);
  assert.match(serviceSource, /const nextStatus = isRefundApprovalRequest\(request\) \? "refund_pending" : hasMakeupPart\(request\) \? "completed" : "makeup_pending"/);
  assert.match(serviceSource, /export async function completeMakeupRefund\(requestId: string, actorId: string, note = ""\)/);
  assert.match(serviceSource, /recordMakeupRequestEvent\(requestId, "refund_completed"/);
  assert.match(workspaceSource, /onSchedulePendingMakeup/);
  assert.match(workspaceSource, /onRequestRefund/);
  assert.match(workspaceSource, /onCompleteRefund/);
  assert.match(workspaceSource, /handleSchedulePendingMakeup/);
  assert.match(workspaceSource, /setView\("approvalPending"\)/);
  assert.match(workspaceSource, /requestKind: "cancel_makeup"/);
  assert.match(workspaceSource, /makeupSlots: \[\{ id: createSlotId\(\), date: "", startTime: "", endTime: "", classroom: "" \}\]/);
  assert.match(workspaceSource, /handleOpenActionNoteRequest\(request, "refund"\)/);
  assert.match(workspaceSource, /DialogTitle>\{actionNoteConfig\.title\}<\/DialogTitle>/);
  assert.match(workspaceSource, /requestMakeupRefund\(actionNoteRequest\.request\.id, currentUserId, actionNote\)/);
  assert.match(workspaceSource, /completeMakeupRefund\(actionNoteRequest\.request\.id, currentUserId, actionNote\)/);
  assert.match(workspaceSource, /보강 신청/);
  assert.match(workspaceSource, /환불 신청/);
  assert.match(workspaceSource, /환불완료/);
  assert.match(modelSource, /refund_pending: "환불대기"/);
});

test("makeup workspace separates request status tabs by workflow state", () => {
  assert.match(workspaceSource, /type MakeupRequestView = "mine" \| "approvalPending" \| "makeupPending" \| "refundPending" \| "closed"/);
  assert.match(workspaceSource, /const MAKEUP_REQUEST_VIEW_TABS: Array<\{ id: MakeupRequestView; label: string \}> = \[/);
  assert.match(workspaceSource, /\{ id: "mine", label: "신청" \}/);
  assert.match(workspaceSource, /\{ id: "approvalPending", label: "결재대기" \}/);
  assert.match(workspaceSource, /\{ id: "makeupPending", label: "보강대기" \}/);
  assert.match(workspaceSource, /\{ id: "refundPending", label: "환불대기" \}/);
  assert.match(workspaceSource, /\{ id: "closed", label: "승인\/반려" \}/);
  assert.match(workspaceSource, /request\.status === "approval_pending"/);
  assert.match(workspaceSource, /request\.status === "makeup_pending"/);
  assert.match(workspaceSource, /request\.status === "refund_pending"/);
  assert.doesNotMatch(workspaceSource, /const MAKEUP_REQUEST_ACTIVE_STATUSES = \["approval_pending", "revision_requested", "makeup_pending", "refund_pending"\]/);
  assert.doesNotMatch(workspaceSource, /\{ id: "approvals", label: "결재함" \}/);
});

test("makeup workspace avoids browser prompt and fills wide screens", () => {
  assert.doesNotMatch(workspaceSource, /window\.prompt/);
  assert.match(workspaceSource, /className="flex flex-col gap-4 px-3 pb-6 sm:px-4 lg:px-6"/);
  assert.doesNotMatch(workspaceSource, /className="mx-auto flex w-full max-w-none flex-col gap-4 px-4 py-5 md:px-6"/);
  assert.doesNotMatch(workspaceSource, /max-w-7xl/);
  assert.match(workspaceSource, /className="w-full overflow-x-auto"/);
  assert.match(workspaceSource, /className="grid min-w-0 gap-2"/);
  assert.match(workspaceSource, /className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between"/);
  assert.match(workspaceSource, /role="tablist" aria-label="휴보강 흐름"/);
  assert.doesNotMatch(workspaceSource, /<Card className="gap-0 overflow-hidden rounded-lg py-0">/);
  assert.match(workspaceSource, /className="grid min-w-full border-b bg-muted\/45 text-xs \[grid-template-columns:var\(--makeup-request-grid-template\)\]"/);
  assert.match(workspaceSource, /className="grid min-w-full border-b last:border-b-0 hover:bg-muted\/30 \[grid-template-columns:var\(--makeup-request-grid-template\)\]"/);
});

test("makeup workspace exposes notification controls cancellation and fixed subject ordering", () => {
  assert.match(workspaceSource, /const SUBJECT_SORT_ORDER = \["영어", "수학"\]/);
  assert.match(workspaceSource, /sortSubjectOptions/);
  assert.match(workspaceSource, /알림 설정/);
  assert.match(workspaceSource, /notificationDialogOpen/);
  assert.match(workspaceSource, /발송 현황/);
  assert.match(serviceSource, /google_chat_math: "구글챗 · 수학팀"/);
  assert.match(serviceSource, /google_chat_english: "구글챗 · 영어팀"/);
  assert.doesNotMatch(serviceSource, /Google Chat/);
  assert.doesNotMatch(workspaceSource, /Google Chat/);
  assert.match(workspaceSource, /function getNotificationDeliveryTargetLabel/);
  assert.match(workspaceSource, /delivery\.targetType === "google_chat"/);
  assert.match(workspaceSource, /getNotificationDeliveryTargetLabel\(delivery\)/);
  assert.match(workspaceSource, /formatDateTime\(delivery\.createdAt\)/);
  assert.match(workspaceSource, /toggleMakeupNotificationSetting/);
  assert.match(workspaceSource, /cancelCompletedMakeupRequest/);
  assert.match(workspaceSource, /finalCancelRequest/);
  assert.match(workspaceSource, /승인 취소/);
  assert.doesNotMatch(workspaceSource, /처리 완료 취소/);
  assert.match(workspaceSource, /수업일정과 캘린더 반영을 되돌립니다/);
  assert.match(workspaceSource, /MakeupRequestDataTable/);
  assert.match(workspaceSource, /type MakeupRequestTableColumnKey/);
  assert.match(workspaceSource, /const MAKEUP_REQUEST_TABLE_COLUMN_WIDTHS/);
  assert.match(workspaceSource, /const MAKEUP_REQUEST_TABLE_COLUMN_MIN_WIDTHS/);
  assert.match(workspaceSource, /type MakeupRequestTableSort/);
  assert.match(workspaceSource, /makeupTableSort/);
  assert.match(workspaceSource, /filterColumnKey/);
  assert.match(workspaceSource, /filterValue/);
  assert.match(workspaceSource, /getMakeupRequestTableValue/);
  assert.match(workspaceSource, /MakeupRequestResizableHeaderCell/);
  assert.match(workspaceSource, /aria-label=\{`\$\{label\} 필터\/정렬`\}/);
  assert.match(workspaceSource, /cursor-col-resize/);
  assert.match(workspaceSource, /onPointerDown/);
  assert.match(workspaceSource, /role="columnheader"/);
  assert.match(workspaceSource, /role="cell"/);
  assert.match(workspaceSource, /columnKey: "subject"/);
  assert.match(workspaceSource, /columnKey: "teacher"/);
  assert.match(workspaceSource, /columnKey: "className"/);
  assert.doesNotMatch(workspaceSource, /columnKey: "requestId"/);
  assert.match(workspaceSource, /columnKey: "reason"/);
  assert.match(workspaceSource, /columnKey: "cancelDate"/);
  assert.match(workspaceSource, /columnKey: "makeupAt"/);
  assert.match(workspaceSource, /columnKey: "makeupRoom"/);
  assert.match(workspaceSource, /columnKey: "approver"/);
  assert.doesNotMatch(workspaceSource, /columnKey: "approvedBy"/);
  assert.doesNotMatch(workspaceSource, /columnKey: "managerProcessor"/);
  assert.match(workspaceSource, /columnKey: "submittedAt"/);
  assert.match(workspaceSource, /columnKey: "revisionRequestedAt"/);
  assert.match(workspaceSource, /columnKey: "approvedAt"/);
  assert.match(workspaceSource, /columnKey: "rejectedAt"/);
  assert.doesNotMatch(workspaceSource, /columnKey: "completedAt"/);
  assert.match(workspaceSource, /columnKey: "canceledAt"/);
  assert.match(workspaceSource, /columnKey: "canceledNote"/);
  assert.match(workspaceSource, /columnKey: "returnedReason"/);
  assert.match(workspaceSource, /columnKey: "rejectedReason"/);
  assert.match(workspaceSource, /columnKey: "finalNote"/);
  const tableColumnsSource = workspaceSource.slice(
    workspaceSource.indexOf("const MAKEUP_REQUEST_TABLE_COLUMNS"),
    workspaceSource.indexOf("const hiddenOnCardColumnKeys"),
  );
  const syncedTableOrder = [
    'columnKey: "status"',
    'columnKey: "className"',
    'columnKey: "subject"',
    'columnKey: "teacher"',
    'columnKey: "reason"',
    'columnKey: "cancelDate"',
    'columnKey: "makeupAt"',
    'columnKey: "makeupRoom"',
    'columnKey: "requester"',
    'columnKey: "submittedAt"',
    'columnKey: "revisionRequestedAt"',
    'columnKey: "returnedReason"',
    'columnKey: "approvedAt"',
    'columnKey: "finalNote"',
    'columnKey: "rejectedAt"',
    'columnKey: "rejectedReason"',
    'columnKey: "canceledAt"',
    'columnKey: "canceledNote"',
    'columnKey: "approver"',
    'columnKey: "action"',
  ];
  for (let index = 1; index < syncedTableOrder.length; index += 1) {
    assert.ok(
      tableColumnsSource.indexOf(syncedTableOrder[index - 1]) < tableColumnsSource.indexOf(syncedTableOrder[index]),
      `${syncedTableOrder[index - 1]} should appear before ${syncedTableOrder[index]}`,
    );
  }
  assert.doesNotMatch(workspaceSource, /renderClosedRequestsTable/);
  assert.doesNotMatch(workspaceSource, /grid min-w-\[1180px\] grid-cols-\[/);
  assert.doesNotMatch(workspaceSource, /관리팀 처리자/);
  assert.doesNotMatch(workspaceSource, /신청 ID/);
  assert.doesNotMatch(workspaceSource, /승인자/);
  assert.match(workspaceSource, /승인취소일시/);
  assert.match(workspaceSource, /보완요청일시/);
  assert.match(serviceSource, /canceled: "승인 취소"/);
  assert.doesNotMatch(serviceSource, /completed: "처리 완료"/);
});

test("makeup notification controls render a process by channel matrix", () => {
  const notificationDialogSource = workspaceSource.slice(
    workspaceSource.indexOf("<Dialog open={notificationDialogOpen}"),
    workspaceSource.indexOf("<Dialog open={Boolean(finalCancelRequest)}"),
  );
  assert.match(workspaceSource, /const MAKEUP_NOTIFICATION_CHANNEL_ORDER[\s\S]*= \[/);
  for (const channelKey of [
    "dashboard_personal",
    "dashboard_management",
    "google_chat_executive",
    "google_chat_admin",
    "google_chat_english",
    "google_chat_math",
  ]) {
    assert.match(workspaceSource, new RegExp(`"${channelKey}"`));
  }
  const notificationChannelOrderSource = workspaceSource.slice(
    workspaceSource.indexOf("const MAKEUP_NOTIFICATION_CHANNEL_ORDER"),
    workspaceSource.indexOf("const MAKEUP_NOTIFICATION_TABLE_GRID_STYLE"),
  );
  assert.ok(
    notificationChannelOrderSource.indexOf('"google_chat_english"') < notificationChannelOrderSource.indexOf('"google_chat_math"'),
    "english chat column should appear before math chat column",
  );
  assert.match(notificationDialogSource, /role="table"/);
  assert.match(notificationDialogSource, /aria-label="휴보강 알림 설정 표"/);
  assert.doesNotMatch(notificationDialogSource, /알림\/웹훅/);
  assert.doesNotMatch(notificationDialogSource, /알림\/웹훅 트리거와 구글챗 발송 현황을 확인합니다/);
  assert.doesNotMatch(notificationDialogSource, /<Bell className/);
  assert.doesNotMatch(notificationDialogSource, /알림 제어/);
  assert.doesNotMatch(notificationDialogSource, /읽기 전용/);
  assert.match(notificationDialogSource, /role="columnheader"/);
  assert.match(notificationDialogSource, /프로세스/);
  assert.match(notificationDialogSource, /알림 위치/);
  assert.match(workspaceSource, /const MAKEUP_GOOGLE_CHAT_CHANNEL_MAP/);
  assert.match(notificationDialogSource, /MAKEUP_NOTIFICATION_CHANNEL_ORDER\.map/);
  assert.match(notificationDialogSource, /웹훅 URL 보기/);
  assert.match(notificationDialogSource, /handleOpenWebhookInfo\(channel\)/);
  assert.match(notificationDialogSource, /selectedWebhookInfo/);
  assert.match(notificationDialogSource, /웹훅 URL 수정/);
  assert.match(notificationDialogSource, /webhookUrlInput/);
  assert.match(notificationDialogSource, /handleSaveWebhookInfo/);
  assert.match(notificationDialogSource, /maskedUrl/);
  assert.match(notificationDialogSource, /envName/);
  assert.match(notificationDialogSource, /role="rowheader"/);
  assert.match(notificationDialogSource, /role="cell"/);
  assert.match(notificationDialogSource, /openNotificationTemplateEditor\(triggerKind, settings\)/);
  assert.match(notificationDialogSource, /find\(\(item\) => item\.channel === channel\)/);
  assert.match(notificationDialogSource, /setting\.enabled \? "켜짐" : "꺼짐"/);
  assert.match(notificationDialogSource, /알림 \$\{setting\.enabled \? "끄기" : "켜기"\}/);
  assert.doesNotMatch(notificationDialogSource, /MAKEUP_NOTIFICATION_CHANNEL_LABELS\[channel\]\} 알림 내용 수정/);
  assert.doesNotMatch(notificationDialogSource, /grid-cols-\[1fr_auto\]/);
  assert.doesNotMatch(notificationDialogSource, /rounded-md border bg-muted\/15 p-3 md:grid-cols-\[120px_minmax\(0,1fr\)\]/);
});

test("makeup notification controls use mobile cards instead of a clipped desktop matrix", () => {
  const notificationDialogSource = workspaceSource.slice(
    workspaceSource.indexOf("<Dialog open={notificationDialogOpen}"),
    workspaceSource.indexOf("<Dialog open={Boolean(finalCancelRequest)}"),
  );

  assert.match(notificationDialogSource, /data-testid="makeup-notification-mobile-list"/);
  assert.match(notificationDialogSource, /className="grid gap-2 md:hidden"/);
  assert.match(notificationDialogSource, /className="hidden overflow-x-auto rounded-md border md:block"/);
  assert.match(notificationDialogSource, /aria-label=\{`\$\{triggerLabel\} 모바일 알림 설정`\}/);
  assert.match(notificationDialogSource, /MAKEUP_NOTIFICATION_CHANNEL_ORDER\.map\(\(channel\) => \{/);
  assert.match(notificationDialogSource, /MAKEUP_NOTIFICATION_CHANNEL_LABELS\[channel\]/);
  assert.match(notificationDialogSource, /openNotificationTemplateEditor\(triggerKind, settings\)/);
  assert.match(notificationDialogSource, /handleToggleNotificationSetting\(setting\)/);
  assert.match(notificationDialogSource, /handleOpenWebhookInfo\(channel\)/);
  assert.ok(
    notificationDialogSource.indexOf("{selectedWebhookInfo || webhookInfoError ? (") <
      notificationDialogSource.indexOf('data-testid="makeup-notification-mobile-list"'),
    "webhook connection detail should appear before the long mobile settings list",
  );
  assert.match(workspaceSource, /webhookInfoPanelRef/);
  assert.match(workspaceSource, /scrollIntoView\(\{ block: "start" \}\)/);
});

test("makeup notification controls can preview and edit per-process content templates", () => {
  const notificationDialogSource = workspaceSource.slice(
    workspaceSource.indexOf("<Dialog open={notificationDialogOpen}"),
    workspaceSource.indexOf("<Dialog open={Boolean(finalCancelRequest)}"),
  );
  assert.match(allMigrationSource, /title_template text not null default ''/);
  assert.match(allMigrationSource, /body_template text not null default ''/);
  assert.match(allMigrationSource, /notify pgrst, 'reload schema'/);
  assert.match(serviceSource, /titleTemplate: text\(row\.title_template\)/);
  assert.match(serviceSource, /bodyTemplate: text\(row\.body_template\)/);
  assert.match(serviceSource, /function getDefaultMakeupNotificationTitleTemplate/);
  assert.match(serviceSource, /function getDefaultMakeupNotificationBodyTemplate/);
  assert.match(serviceSource, /function renderMakeupNotificationTemplate/);
  assert.match(serviceSource, /function getNotificationTriggerTemplateSetting/);
  assert.match(serviceSource, /export async function updateMakeupNotificationTriggerContent/);
  assert.match(serviceSource, /MAKEUP_NOTIFICATION_CHANNELS\.map\(\(channel\) => \(\{/);
  assert.match(serviceSource, /title_template: titleTemplate/);
  assert.match(serviceSource, /body_template: bodyTemplate/);
  assert.match(serviceSource, /renderMakeupNotificationTemplate\(templateSetting\?\.titleTemplate/);
  assert.match(serviceSource, /renderMakeupNotificationTemplate\(templateSetting\?\.bodyTemplate/);
  assert.match(serviceSource, /function appendLocalMakeupRequestEvent/);
  assert.match(serviceSource, /function getMakeupApprovalNote/);
  assert.match(workspaceSource, /updateMakeupNotificationTriggerContent/);
  assert.match(workspaceSource, /selectedNotificationSetting/);
  assert.match(workspaceSource, /notificationTemplateInput/);
  assert.match(notificationDialogSource, /내용/);
  assert.match(notificationDialogSource, /DialogTitle>알림 내용 수정/);
  assert.match(notificationDialogSource, /Textarea/);
  assert.match(notificationDialogSource, /미리보기/);
  assert.match(notificationDialogSource, /저장/);
  assert.match(notificationDialogSource, /사용 가능 변수/);
  assert.match(notificationDialogSource, /className="flex max-h-\[calc\(100dvh-2rem\)\] flex-col overflow-hidden sm:max-w-2xl"/);
  assert.match(notificationDialogSource, /className="grid min-h-0 gap-4 overflow-y-auto pr-1"/);
  assert.match(notificationDialogSource, /<DialogFooter className="shrink-0">/);
  const notificationVariableSource = workspaceSource.slice(
    workspaceSource.indexOf("const MAKEUP_NOTIFICATION_TEMPLATE_VARIABLES"),
    workspaceSource.indexOf("const hiddenOnCardColumnKeys"),
  );
  const tableColumnSource = workspaceSource.slice(
    workspaceSource.indexOf("const MAKEUP_REQUEST_TABLE_COLUMNS"),
    workspaceSource.indexOf("const hiddenOnCardColumnKeys"),
  );
  assert.match(notificationVariableSource, /"프로세스"/);
  assert.match(notificationVariableSource, /MAKEUP_REQUEST_TABLE_COLUMNS/);
  assert.match(notificationVariableSource, /\.map\(\(column\) => column\.label\)/);
  assert.match(notificationVariableSource, /\.filter\(\(label\) => label !== "액션"\)/);
  for (const variable of [
    "상태",
    "수업",
    "과목",
    "선생님",
    "사유",
    "휴강일",
    "보강일시",
    "보강 강의실",
    "신청자",
    "상신일시",
    "보완요청일시",
    "보완 사유",
    "승인일시",
    "승인 메모",
    "반려일시",
    "반려 사유",
    "승인취소일시",
    "승인취소 메모",
    "결재자",
  ]) {
    assert.match(tableColumnSource, new RegExp(`label: "${variable}"`));
  }
  assert.match(serviceSource, /const roomSummary = buildMakeupNotificationRoomSummary\(request\)/);
  assert.match(serviceSource, /"보강 강의실": roomSummary/);
  assert.match(serviceSource, /"승인 메모": getMakeupApprovalNote\(request\)/);
  assert.match(serviceSource, /"승인취소 메모": getMakeupNotificationEventNote\(request, \["approval_canceled", "completed_canceled"\]\)/);
  assert.doesNotMatch(serviceSource, /"승인 메모": request\.finalNote \|\| "-"/);
  assert.match(workspaceSource, /function getMakeupApprovalNoteValue/);
  assert.match(workspaceSource, /case "finalNote":[\s\S]*getMakeupApprovalNoteValue\(request\)/);
  assert.doesNotMatch(workspaceSource, /case "finalNote":[\s\S]*return request\.finalNote \|\| "-"/);
});

test("makeup workspace keeps terminal requests in the approval result tab", () => {
  assert.match(workspaceSource, /const MAKEUP_REQUEST_REQUEST_STATUSES = \["revision_requested"\]/);
  assert.match(workspaceSource, /const MAKEUP_REQUEST_CLOSED_STATUSES = \["completed", "rejected", "canceled"\]/);
  assert.match(workspaceSource, /function getMakeupRequestViewRequests/);
  assert.match(workspaceSource, /MAKEUP_REQUEST_REQUEST_STATUSES\.includes\(request\.status\)/);
  assert.match(workspaceSource, /MAKEUP_REQUEST_CLOSED_STATUSES\.includes\(request\.status\)/);
  assert.match(workspaceSource, /getMakeupRequestViewRequests\(data\.requests, view, currentUserId, isManager\)/);
  assert.match(workspaceSource, /MAKEUP_REQUEST_VIEW_TABS\.reduce/);
  assert.match(workspaceSource, /getMakeupRequestViewRequests\(data\.requests, tab\.id, currentUserId, isManager\)\.length/);
});

test("makeup workspace does not expose direct delete for closed request rows", () => {
  assert.match(workspaceSource, /const \{ user, role, loading: authLoading, session \} = useAuth\(\)/);
  assert.doesNotMatch(workspaceSource, /isAdmin/);
  assert.doesNotMatch(workspaceSource, /deleteMakeupRequest/);
  assert.doesNotMatch(workspaceSource, /handleForceDeleteRequest/);
  assert.doesNotMatch(workspaceSource, /canForceDeleteClosedRequests/);
  assert.doesNotMatch(workspaceSource, /canForceDeleteRequest/);
  assert.doesNotMatch(workspaceSource, /onForceDelete/);
});

test("makeup workspace filters table rows by subject teacher period and collapsible search", () => {
  assert.match(workspaceSource, /type MakeupRequestPeriodFilter = "all" \| "today" \| "week" \| "month" \| "custom"/);
  assert.match(workspaceSource, /const MAKEUP_REQUEST_PERIOD_FILTERS/);
  for (const label of ["전체 기간", "오늘", "이번주", "이번달", "직접입력"]) {
    assert.match(workspaceSource, new RegExp(label));
  }
  assert.match(workspaceSource, /selectedSubjectFilter/);
  assert.match(workspaceSource, /selectedTeacherFilter/);
  assert.match(serviceSource, /isVisible: row\.is_visible !== false/);
  assert.match(serviceSource, /sortOrder: Number\(row\.sort_order \|\| row\.sortOrder \|\| 0\)/);
  assert.match(workspaceSource, /function matchesMakeupTeacherSubject/);
  assert.match(workspaceSource, /function getClassTeacherSelectionKey/);
  assert.match(workspaceSource, /function matchesClassTeacherSelection/);
  assert.match(workspaceSource, /data\.teachers[\s\S]*matchesMakeupTeacherSubject\(teacher, selectedSubjectFilter === "all" \? "" : selectedSubjectFilter\)/);
  assert.match(workspaceSource, /data\.teachers[\s\S]*matchesMakeupTeacherSubject\(teacher, selectedSubject\)/);
  assert.match(workspaceSource, /matchesClassTeacherSelection\(classItem, selectedTeacherKey, data\.teachers\)/);
  assert.doesNotMatch(workspaceSource, /selectedClassFilter/);
  assert.doesNotMatch(workspaceSource, /ariaLabel="수업 필터"/);
  assert.doesNotMatch(workspaceSource, /allLabel="수업 전체"/);
  assert.match(workspaceSource, /makeupPeriodFilter/);
  assert.match(workspaceSource, /makeupPeriodStartDate/);
  assert.match(workspaceSource, /makeupPeriodEndDate/);
  assert.match(workspaceSource, /function matchesMakeupRequestSelectionFilters/);
  assert.match(workspaceSource, /function matchesMakeupRequestPeriodFilter/);
  assert.match(workspaceSource, /function getMakeupRequestPeriodDateKeys/);
  assert.match(workspaceSource, /request\.cancelDate/);
  assert.match(workspaceSource, /slot\.startAt/);
  assert.match(workspaceSource, /과목 전체/);
  assert.match(workspaceSource, /선생님 전체/);
  assert.match(workspaceSource, /className="flex flex-wrap items-center gap-2 border-b bg-muted\/20 px-3 py-2"/);
  assert.match(workspaceSource, /aria-label="휴보강 전체 필터"/);
  assert.match(workspaceSource, /className="flex min-w-0 flex-wrap items-center gap-2" aria-label="휴보강 선택 필터"/);
  assert.match(workspaceSource, /aria-label="휴보강 선택 필터"/);
  assert.match(workspaceSource, /aria-label="휴보강 기간 필터"/);
  assert.match(workspaceSource, /filterInputOpen/);
  assert.match(workspaceSource, /const isFilterInputExpanded = filterInputOpen \|\| Boolean\(filterValue\)/);
  assert.match(workspaceSource, /aria-label=\{isFilterInputExpanded \? `\$\{filterColumn\.label\} 검색 접기` : `\$\{filterColumn\.label\} 검색 펼치기`\}/);
  assert.match(workspaceSource, /\{isFilterInputExpanded \? \(/);
  assert.match(workspaceSource, /aria-label=\{`\$\{filterColumn\.label\} 필터`\}/);
  assert.doesNotMatch(workspaceSource, /\{filterColumn\.label\} 필터<\/span>/);
  assert.doesNotMatch(workspaceSource, /오름차순/);
  assert.doesNotMatch(workspaceSource, /내림차순/);
  assert.match(workspaceSource, /ariaLabel="휴보강 기간 시작일"/);
  assert.match(workspaceSource, /ariaLabel="휴보강 기간 종료일"/);
});

test("makeup workspace opens row details and uses cards on narrow viewports", () => {
  const detailDialogSource = workspaceSource.slice(
    workspaceSource.indexOf("<Dialog open={Boolean(detailRequest)}"),
    workspaceSource.indexOf("<Dialog open={notificationDialogOpen}"),
  );
  const detailCardSource = workspaceSource.slice(
    workspaceSource.indexOf("function MakeupRequestDetailCard"),
    workspaceSource.indexOf("function MakeupRequestCardList"),
  );

  assert.match(workspaceSource, /const MAKEUP_REQUEST_CARD_COLUMNS/);
  assert.match(workspaceSource, /function MakeupRequestDetailCard/);
  assert.match(workspaceSource, /function MakeupRequestCardList/);
  assert.match(workspaceSource, /selectedDetailRequest/);
  assert.match(workspaceSource, /setSelectedDetailRequest/);
  assert.match(workspaceSource, /DialogTitle>휴보강 상세/);
  assert.match(detailDialogSource, /variant="detail"/);
  assert.match(detailDialogSource, /className="max-h-\[calc\(100dvh-1rem\)\] overflow-y-auto sm:max-h-\[92vh\] sm:max-w-3xl"/);
  assert.match(workspaceSource, /aria-label="휴보강 신청 상세 열기"/);
  assert.match(workspaceSource, /onKeyDown=\{\(event\) => handleOpenKeyDown\(event, onOpenDetail\)\}/);
  assert.match(workspaceSource, /aria-label="휴보강 신청 카드목록"/);
  assert.match(workspaceSource, /md:hidden/);
  assert.match(workspaceSource, /hidden md:block/);
  assert.match(workspaceSource, /MakeupRequestDetailCard[\s\S]*variant="compact"/);
  assert.match(detailCardSource, /variant\?: "full" \| "compact" \| "detail"/);
  assert.match(detailCardSource, /if \(variant === "detail"\)/);
  assert.match(detailCardSource, /aria-label="휴보강 상세 신청서"/);
  assert.match(detailCardSource, /수업/);
  assert.match(detailCardSource, /과목/);
  assert.match(detailCardSource, /선생님/);
  assert.match(detailCardSource, /사유/);
  assert.match(detailCardSource, /휴강일/);
  assert.match(detailCardSource, /보강일시/);
  assert.match(detailCardSource, /보강 강의실/);
  assert.match(detailCardSource, /신청 · 처리 · 결재/);
  assert.match(detailCardSource, /group rounded-md border/);
  assert.match(detailCardSource, /ChevronRight/);
  assert.match(detailCardSource, /신청자/);
  assert.match(detailCardSource, /상신일시/);
  assert.match(detailCardSource, /보완요청일시/);
  assert.match(detailCardSource, /승인일시/);
  assert.match(detailCardSource, /반려일시/);
  assert.match(detailCardSource, /승인취소일시/);
  assert.match(detailCardSource, /결재자/);
  assert.match(workspaceSource, /const subtitle = \[request\.subject, request\.teacherLabel\]/);
  assert.doesNotMatch(workspaceSource, /\[request\.subject, request\.teacherLabel, request\.requesterLabel\]/);
  assert.match(workspaceSource, /function getVisibleMakeupRequestCardColumns/);
  assert.match(workspaceSource, /return value !== "-"/);
  assert.match(workspaceSource, /const hiddenOnCardColumnKeys = new Set<MakeupRequestTableColumnKey>\(\["className", "subject", "teacher"\]\)/);
  for (const hiddenCardField of ['columnKey: "className"', 'columnKey: "subject"', 'columnKey: "teacher"']) {
    assert.doesNotMatch(workspaceSource.slice(workspaceSource.indexOf("const MAKEUP_REQUEST_CARD_COLUMNS"), workspaceSource.indexOf("function getMakeupRequestCardValue")), new RegExp(hiddenCardField));
  }
  const cardColumnsSource = workspaceSource.slice(
    workspaceSource.indexOf("const MAKEUP_REQUEST_CARD_COLUMNS"),
    workspaceSource.indexOf("function getMakeupRequestCardValue"),
  );
  for (const expectedSnippet of [
    'columnKey: "requester"',
    'columnKey: "submittedAt"',
    'columnKey: "revisionRequestedAt"',
    'columnKey: "returnedReason"',
    'columnKey: "approvedAt"',
    'columnKey: "finalNote"',
    'columnKey: "rejectedAt"',
    'columnKey: "rejectedReason"',
    'columnKey: "canceledAt"',
    'columnKey: "canceledNote"',
    'columnKey: "approver"',
  ]) {
    assert.match(cardColumnsSource, new RegExp(expectedSnippet));
  }
  assert.ok(cardColumnsSource.indexOf('columnKey: "requester"') < cardColumnsSource.indexOf('columnKey: "submittedAt"'));
  assert.ok(cardColumnsSource.indexOf('columnKey: "returnedReason"') > cardColumnsSource.indexOf('columnKey: "revisionRequestedAt"'));
  assert.ok(cardColumnsSource.indexOf('columnKey: "finalNote"') > cardColumnsSource.indexOf('columnKey: "approvedAt"'));
  assert.ok(cardColumnsSource.indexOf('columnKey: "rejectedReason"') > cardColumnsSource.indexOf('columnKey: "rejectedAt"'));
  assert.ok(cardColumnsSource.indexOf('columnKey: "canceledNote"') > cardColumnsSource.indexOf('columnKey: "canceledAt"'));
  assert.ok(cardColumnsSource.indexOf('columnKey: "approver"') > cardColumnsSource.indexOf('columnKey: "canceledNote"'));
  assert.match(workspaceSource, /case "canceledNote":/);
  assert.match(workspaceSource, /getRequestEvent\(request, \["approval_canceled", "completed_canceled"\]\)\?\.note/);
});

test("makeup service writes notifications and sends google chat without blocking state changes", () => {
  assert.match(serviceSource, /dashboard_notifications/);
  assert.match(serviceSource, /sendGoogleChatNotification/);
  assert.match(serviceSource, /function buildRequestUrl/);
  assert.match(serviceSource, /NEXT_PUBLIC_SITE_URL/);
  assert.match(serviceSource, /NEXT_PUBLIC_AUTH_REDIRECT_ORIGIN/);
  assert.match(serviceSource, /function formatGoogleChatLink/);
  assert.match(serviceSource, /<\$\{url\}\|휴보강 바로 열기>/);
  assert.match(serviceSource, /const requestUrl = buildRequestUrl\(request\.id\)/);
  assert.match(serviceSource, /const chatMessageBody = \[chatContent\.title, chatContent\.body, formatGoogleChatLink\(requestUrl\)\]/);
  assert.match(serviceSource, /sendGoogleChatNotification\(chatChannel, chatMessageBody/);
  assert.match(serviceSource, /GOOGLE_CHAT_WEBHOOK_EXECUTIVE/);
  assert.match(serviceSource, /GOOGLE_CHAT_WEBHOOK_ADMIN/);
  assert.match(serviceSource, /google_chat_executive/);
  assert.match(serviceSource, /cancelCompletedMakeupRequest/);
  assert.match(serviceSource, /deleteAcademicEventById/);
  assert.match(serviceSource, /makeup_notification_settings/);
  assert.match(serviceSource, /makeup_notification_deliveries/);
  assert.match(serviceSource, /const MAKEUP_NOTIFICATION_DELIVERY_DISPLAY_LIMIT = 40/);
  assert.match(serviceSource, /async function readNotificationDeliveryRows/);
  assert.match(serviceSource, /\.from\("makeup_notification_deliveries"\)[\s\S]*\.order\("created_at", \{ ascending: false \}\)[\s\S]*\.limit\(MAKEUP_NOTIFICATION_DELIVERY_DISPLAY_LIMIT\)/);
  assert.doesNotMatch(serviceSource, /readTable\("makeup_notification_deliveries", "\*", true\)/);
  assert.doesNotMatch(serviceSource, /\.sort\(\(left, right\) => right\.createdAt\.localeCompare\(left\.createdAt\)\)\s*\.slice\(0, 40\)/);
  assert.match(notificationRetentionMigrationSource, /create or replace function public\.prune_makeup_notification_deliveries/);
  assert.match(notificationRetentionMigrationSource, /row_number\(\) over \(order by created_at desc, id desc\)/);
  assert.match(notificationRetentionMigrationSource, /where row_number > 500/);
  assert.match(notificationRetentionMigrationSource, /after insert on public\.makeup_notification_deliveries/);
  assert.match(serviceSource, /dedupe_key/);
  assert.match(serviceSource, /buildNotificationDedupeKey/);
  assert.match(serviceSource, /recordNotificationDelivery/);
  assert.match(serviceSource, /const addPersonalRecipient = \(profileId: string\) => \{\s*if \(!profileId\) return\s*personalRecipients\.add\(profileId\)\s*\}/);
  assert.doesNotMatch(serviceSource, /managementProfileIds\.includes\(profileId\)/);
  assert.match(serviceSource, /await Promise\.all\(\[[\s\S]*channel: "dashboard_personal"[\s\S]*channel: "dashboard_management"[\s\S]*\]\)/);
  assert.match(serviceSource, /for \(const chatChannel of chatTargets\) \{[\s\S]*status: "disabled"[\s\S]*continue/);
  assert.match(serviceSource, /applyMakeupRequestToSchedulePlan/);
  assert.match(serviceSource, /runAcademicEventMutation/);
  assert.match(serviceSource, /buildMakeupCalendarDrafts/);
  assert.match(serviceSource, /requestKind: MakeupRequestKind/);
  assert.match(serviceSource, /request_kind: input\.requestKind/);
  assert.match(serviceSource, /const hasCancel = hasCancelPart\(input\)/);
  assert.match(serviceSource, /const hasMakeup = hasMakeupPart\(input\)/);
  assert.match(serviceSource, /if \(hasCancel && !text\(input\.cancelDate\)\)/);
  assert.match(serviceSource, /if \(hasMakeup && input\.makeupSlots\.some\(\(slot\) => !text\(slot\.classroom\)\)\)/);
  assert.match(serviceSource, /const nextStatus = isRefundApprovalRequest\(request\) \? "refund_pending" : hasMakeupPart\(request\) \? "completed" : "makeup_pending"/);
  assert.match(serviceSource, /requestMakeupRefund/);
  assert.match(serviceSource, /refund_pending/);
  assert.match(serviceSource, /completed_by: nextStatus === "completed" \? actorId : null/);
  assert.match(serviceSource, /const calendarDrafts = buildMakeupCalendarDrafts\(request\)/);
  assert.doesNotMatch(serviceSource, /const \[cancelDraft, \.\.\.makeupDrafts\] = buildMakeupCalendarDrafts\(request\)/);
  assert.match(serviceSource, /const resubmittedAt = new Date\(\)\.toISOString\(\)/);
  assert.match(serviceSource, /const \{ request: resubmittedRequest \} = await loadSingleMakeupRequest\(requestId, data\)/);
  assert.match(serviceSource, /appendLocalMakeupRequestEvent\(\{[\s\S]*request: resubmittedRequest[\s\S]*eventType: "resubmitted"/);
  assert.match(serviceSource, /const revisionRequestedAt = new Date\(\)\.toISOString\(\)/);
  assert.match(serviceSource, /const returnedReason = text\(note\)/);
  assert.match(serviceSource, /returnedReason \}/);
  assert.match(serviceSource, /appendLocalMakeupRequestEvent\(\{[\s\S]*eventType: "revision_requested"/);
  assert.match(serviceSource, /const rejectedAt = new Date\(\)\.toISOString\(\)/);
  assert.match(serviceSource, /const rejectedReason = text\(note\)/);
  assert.match(serviceSource, /rejectedReason \}/);
  assert.match(serviceSource, /appendLocalMakeupRequestEvent\(\{[\s\S]*eventType: "rejected"/);
  assert.match(serviceSource, /const canceledAt = new Date\(\)\.toISOString\(\)/);
  assert.doesNotMatch(serviceSource, /final_note: nullable\(note \|\| request\.finalNote\)/);
  assert.match(serviceSource, /canceledAt/);
  assert.match(serviceSource, /appendLocalMakeupRequestEvent\(\{[\s\S]*eventType: "approval_canceled"/);
});

test("dashboard header exposes a persistent notification popover", () => {
  assert.match(headerSource, /DashboardNotificationPopover/);
  assert.match(headerSource, /알림/);
});

test("dashboard notifications defer full reads while loading a lightweight unread badge", () => {
  assert.match(serviceSource, /createInFlightRequestStore/);
  assert.match(serviceSource, /loadDashboardNotifications\(viewerId: string, limit = 20\)/);
  assert.match(serviceSource, /loadDashboardUnreadNotificationCount\(viewerId: string\)/);
  assert.match(serviceSource, /count: "exact", head: true/);
  assert.match(serviceSource, /const loadKey = `\$\{viewerId\}:\$\{limit\}`/);
  assert.match(serviceSource, /dashboardNotificationLoadInFlight\.run\(\s*loadKey/);
  assert.match(notificationPopoverSource, /loadDashboardNotifications\(viewerId\)/);
  assert.match(notificationPopoverSource, /loadDashboardUnreadNotificationCount\(viewerId\)/);
  assert.match(notificationPopoverSource, /if \(!viewerId\) return/);
  assert.match(notificationPopoverSource, /unreadCountTimer = window\.setTimeout/);
  assert.match(notificationPopoverSource, /if \(open\) \{[\s\S]{0,120}void refresh\(\)/);
});

test("in-flight read sharing is isolated by viewer and recovers after failure", async () => {
  const createStore = inFlightRequestModule.createInFlightRequestStore;
  assert.equal(typeof createStore, "function");
  if (typeof createStore !== "function") return;

  const store = createStore();
  let sameViewerCalls = 0;
  let releaseFirst;
  const first = store.run("viewer-a:20", () => {
    sameViewerCalls += 1;
    return new Promise((resolve) => { releaseFirst = resolve; });
  });
  const shared = store.run("viewer-a:20", () => {
    sameViewerCalls += 1;
    return Promise.resolve("unexpected");
  });
  const otherViewer = store.run("viewer-b:20", () => Promise.resolve("viewer-b"));

  assert.equal(first, shared);
  assert.equal(sameViewerCalls, 1);
  assert.notEqual(first, otherViewer);
  releaseFirst("viewer-a");
  assert.equal(await shared, "viewer-a");
  assert.equal(await otherViewer, "viewer-b");

  await assert.rejects(store.run("viewer-a:20", () => Promise.reject(new Error("network"))));
  assert.equal(await store.run("viewer-a:20", () => Promise.resolve("retried")), "retried");
});

test("dashboard supports installable web push subscriptions", () => {
  assert.match(packageSource, /"web-push"/);
  assert.match(rootLayoutSource, /manifest: "\/manifest\.webmanifest"/);
  assert.match(manifestSource, /"display": "standalone"/);
  assert.match(manifestSource, /"start_url": "\/admin\/makeup-requests"/);
  assert.match(serviceWorkerSource, /self\.addEventListener\("push"/);
  assert.match(serviceWorkerSource, /showNotification/);
  assert.match(serviceWorkerSource, /self\.addEventListener\("notificationclick"/);
  assert.match(pushClientSource, /navigator\.serviceWorker\.register\("\/sw\.js"\)/);
  assert.match(pushClientSource, /registration\.pushManager\.subscribe/);
  assert.match(pushClientSource, /applicationServerKey: urlBase64ToUint8Array/);
  assert.match(notificationPopoverSource, /휴대폰 알림/);
  assert.match(notificationPopoverSource, /subscribeDashboardPush/);
  assert.match(notificationPopoverSource, /unsubscribeDashboardPush/);
});

test("dashboard push subscriptions are stored behind authenticated RLS", () => {
  assert.match(pushMigrationSource, /create table if not exists public\.dashboard_push_subscriptions/);
  assert.match(pushMigrationSource, /profile_id uuid not null references public\.profiles\(id\) on delete cascade/);
  assert.match(pushMigrationSource, /endpoint text not null unique/);
  assert.match(pushMigrationSource, /p256dh text not null/);
  assert.match(pushMigrationSource, /auth text not null/);
  assert.match(pushMigrationSource, /alter table public\.dashboard_push_subscriptions enable row level security/);
  assert.match(pushMigrationSource, /grant select, insert, update, delete on public\.dashboard_push_subscriptions to authenticated/);
  assert.match(pushMigrationSource, /profile_id = auth\.uid\(\)/);
  assert.match(pushSubscriptionsRouteSource, /auth\.getUser/);
  assert.match(pushSubscriptionsRouteSource, /dashboard_push_subscriptions/);
  assert.match(pushSubscriptionsRouteSource, /profile_id: user\.id/);
  assert.match(pushSubscriptionsRouteSource, /onConflict: "endpoint"/);
  assert.match(pushSubscriptionsRouteSource, /export async function DELETE/);
});

test("makeup dashboard notifications fan out to web push without blocking workflow", () => {
  assert.match(webPushRouteSource, /import webpush from "web-push"/);
  assert.match(webPushRouteSource, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(webPushRouteSource, /WEB_PUSH_PRIVATE_KEY/);
  assert.match(webPushRouteSource, /setVapidDetails/);
  assert.match(webPushRouteSource, /sendNotification/);
  assert.match(webPushRouteSource, /statusCode === 404 \|\| statusCode === 410/);
  assert.match(serviceSource, /sendDashboardWebPushNotification/);
  assert.match(serviceSource, /fetch\("\/api\/web-push"/);
  assert.match(serviceSource, /void sendDashboardWebPushNotification/);
});

test("google chat route keeps webhook URLs server-side", () => {
  assert.match(apiRouteSource, /GOOGLE_CHAT_WEBHOOK_EXECUTIVE/);
  assert.match(apiRouteSource, /GOOGLE_CHAT_WEBHOOK_ADMIN/);
  assert.match(apiRouteSource, /GOOGLE_CHAT_WEBHOOK_MATH/);
  assert.match(apiRouteSource, /GOOGLE_CHAT_WEBHOOK_ENGLISH/);
  assert.match(apiRouteSource, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(apiRouteSource, /function getServiceClient/);
  assert.match(apiRouteSource, /\.from\("google_chat_webhook_settings"\)/);
  assert.match(apiRouteSource, /export async function GET/);
  assert.match(apiRouteSource, /export async function PATCH/);
  assert.match(apiRouteSource, /maskGoogleChatWebhookUrl/);
  assert.match(apiRouteSource, /getGoogleChatWebhookUrl/);
  assert.match(apiRouteSource, /const resolvedWebhookUrl = await getGoogleChatWebhookUrl/);
  assert.match(apiRouteSource, /maskedUrl: maskGoogleChatWebhookUrl\(resolvedWebhookUrl\)/);
  assert.match(apiRouteSource, /configured: Boolean\(resolvedWebhookUrl\)/);
  assert.match(apiRouteSource, /upsert\(\{[\s\S]*channel,[\s\S]*webhook_url: webhookUrl/);
  assert.match(apiRouteSource, /updated_by: user\.id/);
  assert.match(apiRouteSource, /https:\/\/chat\.googleapis\.com\//);
  assert.doesNotMatch(apiRouteSource, /webhookUrl:/);
  assert.doesNotMatch(apiRouteSource, /NEXT_PUBLIC_GOOGLE_CHAT/);
});
