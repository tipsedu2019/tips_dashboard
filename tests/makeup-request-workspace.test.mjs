import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";

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
const apiRouteSource = readFileSync("src/app/api/google-chat/route.ts", "utf8");
const slotsMigrationSource = readFileSync("supabase/migrations/20260706105512_makeup_request_slots.sql", "utf8");
const notificationMigrationSource = readFileSync("supabase/migrations/20260706123000_makeup_notification_controls.sql", "utf8");
const pushMigrationSource = readOptionalSource("supabase/migrations/20260707143000_dashboard_push_subscriptions.sql");
const manifestSource = readOptionalSource("public/manifest.webmanifest");
const serviceWorkerSource = readOptionalSource("public/sw.js");
const pushClientSource = readOptionalSource("src/lib/dashboard-push-client.ts");
const pushSubscriptionsRouteSource = readOptionalSource("src/app/api/push-subscriptions/route.ts");
const webPushRouteSource = readOptionalSource("src/app/api/web-push/route.ts");
const notificationPopoverSource = readFileSync("src/components/dashboard-notification-popover.tsx", "utf8");
const allMigrationSource = readdirSync("supabase/migrations")
  .filter((name) => name.endsWith(".sql"))
  .map((name) => readFileSync(`supabase/migrations/${name}`, "utf8"))
  .join("\n");

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

test("makeup workspace includes approver queues form fields and room availability states", () => {
  assert.match(workspaceSource, /type MakeupRequestView = "mine" \| "approvals" \| "closed"/);
  assert.match(workspaceSource, /\{ id: "mine", label: "신청" \}/);
  assert.match(workspaceSource, /결재함/);
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
  assert.doesNotMatch(workspaceSource, /최종 확인/);
  assert.match(workspaceSource, /requestDialogOpen/);
  assert.match(workspaceSource, /휴보강 신청/);
  assert.match(workspaceSource, /DialogTitle>\{editingRequestId \? "휴보강 보완 재상신" : "휴보강 신청"\}/);
  assert.doesNotMatch(workspaceSource, /const shouldShowRequestForm = view === "mine"/);
  const createButtonSource = workspaceSource.slice(
    workspaceSource.indexOf('<Button type="button" size="sm" onClick={openRequestDialog}'),
    workspaceSource.indexOf('<Button type="button" variant="outline" size="sm" onClick={() => setNotificationDialogOpen(true)}'),
  );
  assert.match(createButtonSource, />\s*신청\s*</);
  assert.doesNotMatch(createButtonSource, /휴보강 신청/);
  assert.doesNotMatch(workspaceSource, /새로고침/);
  assert.doesNotMatch(workspaceSource, /RefreshCw/);
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

test("makeup approval auto-completes without manager confirmation UI", () => {
  assert.doesNotMatch(workspaceSource, /finalConfirmRequest/);
  assert.doesNotMatch(workspaceSource, /completeMakeupRequest/);
  assert.match(serviceSource, /approveMakeupRequest/);
  assert.match(serviceSource, /status: "completed"/);
  assert.match(serviceSource, /buildAutoCompletionNote/);
  assert.match(workspaceSource, /getMakeupActionErrorMessage\(actionError, "요청 처리에 실패했습니다\."\)/);
  assert.doesNotMatch(workspaceSource, /window\.prompt\("관리팀 최종 확인 메모"/);
  assert.match(workspaceSource, /DialogContent className="max-h-\[86vh\] overflow-y-auto sm:max-w-4xl"/);
  assert.doesNotMatch(workspaceSource, /xl:grid-cols-\[minmax\(360px,420px\)_1fr\]/);
  assert.match(workspaceSource, /md:grid-cols-\[minmax\(150px,1fr\)_minmax\(96px,0\.55fr\)_minmax\(96px,0\.55fr\)_32px\]/);
  assert.doesNotMatch(workspaceSource, /lg:grid-cols-\[minmax\(0,1\.1fr\)_minmax\(110px,0\.65fr\)_minmax\(110px,0\.65fr\)_minmax\(140px,0\.8fr\)_32px\]/);
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
  assert.match(workspaceSource, /updateMakeupNotificationTriggerContent/);
  assert.match(workspaceSource, /selectedNotificationSetting/);
  assert.match(workspaceSource, /notificationTemplateInput/);
  assert.match(notificationDialogSource, /내용/);
  assert.match(notificationDialogSource, /DialogTitle>알림 내용 수정/);
  assert.match(notificationDialogSource, /Textarea/);
  assert.match(notificationDialogSource, /미리보기/);
  assert.match(notificationDialogSource, /저장/);
  assert.match(notificationDialogSource, /사용 가능 변수/);
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
  assert.match(serviceSource, /"승인취소 메모": getMakeupNotificationEventNote\(request, \["approval_canceled", "completed_canceled"\]\)/);
});

test("makeup workspace keeps approval-canceled requests out of the active request tab", () => {
  assert.match(workspaceSource, /const MAKEUP_REQUEST_ACTIVE_STATUSES = \["approval_pending", "revision_requested"\]/);
  assert.match(workspaceSource, /const MAKEUP_REQUEST_CLOSED_STATUSES = \["completed", "rejected", "canceled"\]/);
  assert.match(workspaceSource, /function getMakeupRequestViewRequests/);
  assert.match(workspaceSource, /MAKEUP_REQUEST_ACTIVE_STATUSES\.includes\(request\.status\)/);
  assert.match(workspaceSource, /MAKEUP_REQUEST_CLOSED_STATUSES\.includes\(request\.status\)/);
  assert.match(workspaceSource, /getMakeupRequestViewRequests\(data\.requests, view, currentUserId\)/);
  assert.match(workspaceSource, /getMakeupRequestViewRequests\(data\.requests, "mine", currentUserId\)\.length/);
  assert.match(workspaceSource, /getMakeupRequestViewRequests\(data\.requests, "closed", currentUserId\)\.length/);
});

test("makeup workspace lets only operators delete closed request rows", () => {
  assert.match(workspaceSource, /const \{ user, role, isAdmin, loading: authLoading, session \} = useAuth\(\)/);
  assert.match(workspaceSource, /const canForceDeleteClosedRequests = isAdmin/);
  assert.match(workspaceSource, /deleteMakeupRequest\(request\.id, currentUserId\)/);
  assert.match(workspaceSource, /onForceDelete=\{handleForceDeleteRequest\}/);
  assert.match(workspaceSource, /canForceDelete=\{canForceDeleteClosedRequests\}/);
  assert.match(workspaceSource, /MAKEUP_REQUEST_CLOSED_STATUSES\.includes\(request\.status\)/);
  assert.match(workspaceSource, /Trash2/);
  assert.match(serviceSource, /export async function deleteMakeupRequest\(requestId: string, actorId: string\)/);
  assert.match(serviceSource, /actor\?\.role !== "admin"/);
  assert.match(serviceSource, /\.from\("makeup_requests"\)\.delete\(\)\.eq\("id", id\)\.select\("id"\)/);
  assert.match(allMigrationSource, /grant select, insert, update, delete on public\.makeup_requests to authenticated/);
  assert.match(allMigrationSource, /create policy makeup_requests_delete_operator_closed/);
  assert.match(allMigrationSource, /for delete\s+to authenticated[\s\S]*public\.current_dashboard_role\(\) = 'admin'/);
  assert.match(allMigrationSource, /status in \('completed', 'rejected', 'canceled'\)/);
  assert.doesNotMatch(allMigrationSource, /makeup_requests_delete_operator_closed[\s\S]{0,600}current_dashboard_role\(\) = 'staff'/);
});

test("makeup workspace filters table rows by subject teacher class and period", () => {
  assert.match(workspaceSource, /type MakeupRequestPeriodFilter = "all" \| "today" \| "week" \| "month" \| "custom"/);
  assert.match(workspaceSource, /const MAKEUP_REQUEST_PERIOD_FILTERS/);
  for (const label of ["전체 기간", "오늘", "이번주", "이번달", "직접입력"]) {
    assert.match(workspaceSource, new RegExp(label));
  }
  assert.match(workspaceSource, /selectedSubjectFilter/);
  assert.match(workspaceSource, /selectedTeacherFilter/);
  assert.match(workspaceSource, /selectedClassFilter/);
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
  assert.match(workspaceSource, /수업 전체/);
  assert.match(workspaceSource, /className="flex flex-wrap items-center gap-2 border-b bg-muted\/20 px-3 py-2"/);
  assert.match(workspaceSource, /aria-label="휴보강 전체 필터"/);
  assert.match(workspaceSource, /className="flex min-w-0 flex-wrap items-center gap-2" aria-label="휴보강 선택 필터"/);
  assert.match(workspaceSource, /aria-label="휴보강 선택 필터"/);
  assert.match(workspaceSource, /aria-label="휴보강 기간 필터"/);
  assert.match(workspaceSource, /className="ml-auto flex min-w-\[12rem\] items-center gap-2 text-sm font-medium"/);
  assert.match(workspaceSource, /aria-label=\{`\$\{filterColumn\.label\} 필터`\}/);
  assert.doesNotMatch(workspaceSource, /\{filterColumn\.label\} 필터<\/span>/);
  assert.doesNotMatch(workspaceSource, /오름차순/);
  assert.doesNotMatch(workspaceSource, /내림차순/);
  assert.match(workspaceSource, /ariaLabel="휴보강 기간 시작일"/);
  assert.match(workspaceSource, /ariaLabel="휴보강 기간 종료일"/);
});

test("makeup workspace opens row details and uses cards on narrow viewports", () => {
  assert.match(workspaceSource, /const MAKEUP_REQUEST_CARD_COLUMNS/);
  assert.match(workspaceSource, /function MakeupRequestDetailCard/);
  assert.match(workspaceSource, /function MakeupRequestCardList/);
  assert.match(workspaceSource, /selectedDetailRequest/);
  assert.match(workspaceSource, /setSelectedDetailRequest/);
  assert.match(workspaceSource, /DialogTitle>휴보강 상세/);
  assert.match(workspaceSource, /aria-label="휴보강 신청 상세 열기"/);
  assert.match(workspaceSource, /onKeyDown=\{\(event\) => handleOpenKeyDown\(event, onOpenDetail\)\}/);
  assert.match(workspaceSource, /aria-label="휴보강 신청 카드목록"/);
  assert.match(workspaceSource, /md:hidden/);
  assert.match(workspaceSource, /hidden md:block/);
  assert.match(workspaceSource, /MakeupRequestDetailCard[\s\S]*variant="compact"/);
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
