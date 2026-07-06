import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const navigationSource = readFileSync("src/lib/navigation.ts", "utf8");
const authGuardSource = readFileSync("src/components/auth/auth-guard.tsx", "utf8");
const headerSource = readFileSync("src/components/site-header.tsx", "utf8");
const migrationSource = readFileSync("supabase/migrations/20260706102047_makeup_requests.sql", "utf8");
const workspaceSource = readFileSync("src/features/makeup-requests/makeup-request-workspace.tsx", "utf8");
const dateTimePickerSource = readFileSync("src/components/ui/date-time-picker.tsx", "utf8");
const serviceSource = readFileSync("src/features/makeup-requests/makeup-request-service.ts", "utf8");
const apiRouteSource = readFileSync("src/app/api/google-chat/route.ts", "utf8");
const slotsMigrationSource = readFileSync("supabase/migrations/20260706105512_makeup_request_slots.sql", "utf8");
const notificationMigrationSource = readFileSync("supabase/migrations/20260706123000_makeup_notification_controls.sql", "utf8");

test("makeup request route is exposed in admin navigation and quick search", () => {
  assert.match(navigationSource, /title: "휴보강 신청서"/);
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
});

test("makeup workspace includes role queues form fields and room availability states", () => {
  assert.match(workspaceSource, /type MakeupRequestView = "mine" \| "approvals" \| "manager" \| "closed"/);
  assert.match(workspaceSource, /내 신청/);
  assert.match(workspaceSource, /결재함/);
  assert.match(workspaceSource, /관리팀/);
  assert.match(workspaceSource, /완료\/반려/);
  for (const label of ["과목", "선생님", "수업", "사유", "휴강일", "보강일시", "보강 강의실", "결재자"]) {
    assert.match(workspaceSource, new RegExp(label));
  }
  assert.doesNotMatch(workspaceSource, /보강 시작/);
  assert.doesNotMatch(workspaceSource, /보강 종료/);
  assert.match(workspaceSource, /selectedSubject/);
  assert.match(workspaceSource, /selectedTeacherKey/);
  assert.match(workspaceSource, /availableClasses/);
  assert.match(workspaceSource, /makeupSlots/);
  assert.match(workspaceSource, /보강일시 추가/);
  assert.match(workspaceSource, /DatePickerControl/);
  assert.match(workspaceSource, /TimePickerControl/);
  assert.match(workspaceSource, /getSlotRoomAvailability/);
  assert.match(workspaceSource, /getSlotRoomAvailability\(slot, data, editingRequestId, selectedClass\?\.subject \|\| selectedSubject\)/);
  assert.match(workspaceSource, /slot\.classroom/);
  assert.match(workspaceSource, /aria-label=\{`보강일시 \$\{index \+ 1\} 강의실`\}/);
  assert.doesNotMatch(workspaceSource, /type="date"/);
  assert.doesNotMatch(workspaceSource, /type="time"/);
  assert.match(workspaceSource, /buildRoomAvailability/);
  assert.match(workspaceSource, /빈 강의실/);
  assert.match(workspaceSource, /충돌/);
  assert.match(workspaceSource, /최종 확인/);
  assert.ok(workspaceSource.indexOf('htmlFor="makeup-subject">과목') < workspaceSource.indexOf('htmlFor="makeup-teacher">선생님'));
  assert.ok(workspaceSource.indexOf('htmlFor="makeup-teacher">선생님') < workspaceSource.indexOf('htmlFor="makeup-class">수업'));
  assert.ok(workspaceSource.lastIndexOf("결재자") > workspaceSource.lastIndexOf("보강 강의실"));
  assert.match(workspaceSource, /SelectValue placeholder="강의실 선택"/);
  assert.match(serviceSource, /makeup_classroom: firstSlot\.classroom/);
  assert.match(serviceSource, /for \(const slot of slots\)/);
});

test("makeup datetime and room controls stay within operational candidates", () => {
  assert.match(dateTimePickerSource, /const TIME_OPTION_START_MINUTES = 9 \* 60/);
  assert.match(dateTimePickerSource, /const TIME_OPTION_END_MINUTES = 23 \* 60 \+ 30/);
  assert.match(dateTimePickerSource, /TIME_OPTION_END_MINUTES - TIME_OPTION_START_MINUTES/);
  assert.doesNotMatch(dateTimePickerSource, /6 \* 60/);
  assert.doesNotMatch(dateTimePickerSource, /오전 06:00/);
  assert.match(workspaceSource, /getSlotRoomCollisionState\(formSlot, data, request\.id, request\.subject\)/);
});

test("makeup manager completion uses an in-app dialog and contained layout grids", () => {
  assert.match(workspaceSource, /finalConfirmRequest/);
  assert.match(workspaceSource, /DialogContent className="sm:max-w-md"/);
  assert.match(workspaceSource, /getMakeupActionErrorMessage\(actionError, "요청 처리에 실패했습니다\."\)/);
  assert.doesNotMatch(workspaceSource, /window\.prompt\("관리팀 최종 확인 메모"/);
  assert.match(workspaceSource, /2xl:grid-cols-\[minmax\(500px,0\.95fr\)_minmax\(0,1fr\)\]/);
  assert.doesNotMatch(workspaceSource, /xl:grid-cols-\[minmax\(360px,420px\)_1fr\]/);
  assert.match(workspaceSource, /md:grid-cols-\[minmax\(150px,1fr\)_minmax\(96px,0\.55fr\)_minmax\(96px,0\.55fr\)_32px\]/);
  assert.doesNotMatch(workspaceSource, /lg:grid-cols-\[minmax\(0,1\.1fr\)_minmax\(110px,0\.65fr\)_minmax\(110px,0\.65fr\)_minmax\(140px,0\.8fr\)_32px\]/);
});

test("makeup workspace exposes notification controls cancellation and fixed subject ordering", () => {
  assert.match(workspaceSource, /const SUBJECT_SORT_ORDER = \["영어", "수학"\]/);
  assert.match(workspaceSource, /sortSubjectOptions/);
  assert.match(workspaceSource, /알림\/웹훅/);
  assert.match(workspaceSource, /알림 설정/);
  assert.match(workspaceSource, /notificationDialogOpen/);
  assert.match(workspaceSource, /발송 현황/);
  assert.match(workspaceSource, /toggleMakeupNotificationSetting/);
  assert.match(workspaceSource, /cancelCompletedMakeupRequest/);
  assert.match(workspaceSource, /finalCancelRequest/);
  assert.match(workspaceSource, /처리 완료 취소/);
  assert.match(workspaceSource, /수업일정과 캘린더 반영을 되돌립니다/);
  assert.match(workspaceSource, /const shouldShowRequestForm = view === "mine"/);
  assert.match(workspaceSource, /renderClosedRequestsTable/);
  assert.match(workspaceSource, /TableHeader/);
  assert.match(workspaceSource, /TableRow/);
  assert.doesNotMatch(workspaceSource, /grid min-w-\[1180px\] grid-cols-\[/);
  assert.match(workspaceSource, /관리팀 처리자/);
  assert.match(workspaceSource, /formatRequestTimeline/);
  assert.match(workspaceSource, /approvedByLabel/);
  assert.match(workspaceSource, /completedByLabel/);
  assert.match(workspaceSource, /canceledByLabel/);
});

test("makeup service writes notifications and sends google chat without blocking state changes", () => {
  assert.match(serviceSource, /dashboard_notifications/);
  assert.match(serviceSource, /sendGoogleChatNotification/);
  assert.match(serviceSource, /GOOGLE_CHAT_WEBHOOK_EXECUTIVE/);
  assert.match(serviceSource, /GOOGLE_CHAT_WEBHOOK_ADMIN/);
  assert.match(serviceSource, /google_chat_executive/);
  assert.match(serviceSource, /completeMakeupRequest/);
  assert.match(serviceSource, /cancelCompletedMakeupRequest/);
  assert.match(serviceSource, /deleteAcademicEventById/);
  assert.match(serviceSource, /makeup_notification_settings/);
  assert.match(serviceSource, /makeup_notification_deliveries/);
  assert.match(serviceSource, /dedupe_key/);
  assert.match(serviceSource, /buildNotificationDedupeKey/);
  assert.match(serviceSource, /recordNotificationDelivery/);
  assert.match(serviceSource, /applyMakeupRequestToSchedulePlan/);
  assert.match(serviceSource, /runAcademicEventMutation/);
  assert.match(serviceSource, /buildMakeupCalendarDrafts/);
});

test("dashboard header exposes a persistent notification popover", () => {
  assert.match(headerSource, /DashboardNotificationPopover/);
  assert.match(headerSource, /알림/);
});

test("google chat route keeps webhook URLs server-side", () => {
  assert.match(apiRouteSource, /GOOGLE_CHAT_WEBHOOK_EXECUTIVE/);
  assert.match(apiRouteSource, /GOOGLE_CHAT_WEBHOOK_ADMIN/);
  assert.match(apiRouteSource, /GOOGLE_CHAT_WEBHOOK_MATH/);
  assert.match(apiRouteSource, /GOOGLE_CHAT_WEBHOOK_ENGLISH/);
  assert.doesNotMatch(apiRouteSource, /NEXT_PUBLIC_GOOGLE_CHAT/);
});
