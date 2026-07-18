import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const root = new URL("../", import.meta.url)
const availabilityModuleUrl = new URL(
  "../src/features/notifications/notification-control-plane-availability.ts",
  import.meta.url,
).href
const navigationGuardModuleUrl = new URL(
  "../src/features/notifications/use-notification-navigation-guard.ts",
  import.meta.url,
).href
const asyncStateModuleUrl = new URL(
  "../src/features/notifications/notification-control-plane-async-state.ts",
  import.meta.url,
).href

async function readOptionalSource(pathname) {
  try {
    return await readFile(new URL(pathname, root), "utf8")
  } catch (error) {
    if (error?.code === "ENOENT") return ""
    throw error
  }
}

test("공통 알림 설정 가용성은 정상 false와 정상 true만 각각 legacy와 canonical로 연다", async () => {
  const { resolveNotificationControlPlaneAvailability } = await import(availabilityModuleUrl)
  const resolve = (overrides = {}) => resolveNotificationControlPlaneAvailability({
    hasSession: true,
    settingsFlag: true,
    runtimeVersion: 1,
    capabilityError: false,
    ...overrides,
  })

  assert.equal(resolve(), "enabled")
  assert.equal(resolve({ settingsFlag: false }), "disabled")
  assert.equal(resolve({ hasSession: false }), "unavailable")
  assert.equal(resolve({ capabilityError: true }), "unavailable")
  assert.equal(resolve({ settingsFlag: null }), "unavailable")
  assert.equal(resolve({ runtimeVersion: 0 }), "unavailable")
  assert.equal(resolve({ runtimeVersion: "1" }), "unavailable")
})

test("공통 알림 설정은 서버 플래그와 런타임 마커가 모두 준비된 경우에만 열린다", async () => {
  const [panelSource, availabilitySource] = await Promise.all([
    readOptionalSource("src/features/notifications/notification-control-panel.tsx"),
    readOptionalSource("src/features/notifications/notification-control-plane-availability.ts"),
  ])
  const source = `${panelSource}\n${availabilitySource}`

  assert.match(source, /export function useNotificationControlPlaneAvailability/)
  assert.match(source, /get_notification_runtime_flags_v1/)
  assert.match(source, /common_notification_control_plane_runtime_version/)
  assert.match(source, /Promise\.all/)
  assert.match(source, /status:\s*"loading"\s*\|\s*"enabled"\s*\|\s*"disabled"\s*\|\s*"unavailable"/)
  assert.match(availabilitySource, /runtimeVersion\s*!==\s*1/)
  assert.match(availabilitySource, /settingsFlag\s*!==\s*true[\s\S]*settingsFlag\s*!==\s*false/)
  assert.doesNotMatch(source, /NEXT_PUBLIC_NOTIFICATION_CONTROL_PLANE/)
})

test("가용성 확인은 인증 세션 초기화를 기다린 뒤 서버 capability를 읽는다", async () => {
  const source = await readOptionalSource(
    "src/features/notifications/notification-control-panel.tsx",
  )
  const hookSource = source.slice(
    source.indexOf("export function useNotificationControlPlaneAvailability"),
    source.indexOf("export function NotificationControlPanel"),
  )

  assert.match(hookSource, /supabase\.auth\.getSession\(\)/)
  assert.ok(
    hookSource.indexOf("supabase.auth.getSession()") < hookSource.indexOf("Promise.all"),
  )
  assert.match(hookSource, /session[\s\S]*setStatus\("unavailable"\)/)
  assert.doesNotMatch(hookSource, /catch\([\s\S]*setStatus\("disabled"\)/)
})

test("공통 패널은 page와 dialog가 동일한 서버 스냅샷, 초안, 저장 경계를 사용한다", async () => {
  const source = await readOptionalSource(
    "src/features/notifications/notification-control-panel.tsx",
  )

  assert.match(source, /type NotificationControlPanelProps/)
  assert.match(source, /presentation:\s*"page"\s*\|\s*"dialog"/)
  assert.match(source, /createNotificationControlPlaneService/)
  assert.match(source, /createNotificationDraft/)
  assert.match(source, /buildNotificationPatch/)
  assert.match(source, /isNotificationDraftDirty/)
  assert.match(source, /saveControlPlane/)
  assert.doesNotMatch(source, /autoSave|autosave/i)
})

test("공통 패널은 서버가 반환한 규칙만 데스크톱 표와 모바일 카드에 렌더한다", async () => {
  const source = await readOptionalSource(
    "src/features/notifications/notification-control-panel.tsx",
  )

  assert.match(source, /snapshot\.rules/)
  assert.match(source, /hidden[^"\n]*md:block/)
  assert.match(source, /md:hidden/)
  assert.match(source, /<table/)
  assert.match(source, /<thead>/)
  assert.match(source, /<tbody>/)
  assert.match(source, /group\.rules\.map/)
  assert.match(source, /data-notification-draft-source="shared"/)
  assert.match(source, /규칙 및 템플릿/)
  assert.match(source, /내용 수정/)
  assert.doesNotMatch(source, /NOTIFICATION_EVENT_KEYS_BY_WORKFLOW/)
  assert.doesNotMatch(source, /NOTIFICATION_AUDIENCES_BY_WORKFLOW/)
})

test("등록 예약 알림은 세 한국어 시점 라벨을 데스크톱과 모바일의 공통 초안에서 표시한다", async () => {
  const source = await readOptionalSource(
    "src/features/notifications/notification-control-panel.tsx",
  )

  assert.match(source, /function notificationRuleVariantLabel/)
  assert.match(source, /예약 전날 \$\{schedule\.localTime\}/)
  assert.match(source, /예약 당일 \$\{schedule\.localTime\}/)
  assert.match(source, /예약 1시간 전/)
  assert.match(source, /notificationRuleVariantLabel\(rule, draft\)/)
  assert.match(source, /hidden[^"\n]*md:block/)
  assert.match(source, /md:hidden/)
  assert.doesNotMatch(source, />\{rule\.ruleVariantKey\}</)
})

test("등록 예약 알림이 모두 꺼져 있으면 경고하고 첫 적용 가능한 스위치로 초점을 이동한다", async () => {
  const source = await readOptionalSource(
    "src/features/notifications/notification-control-panel.tsx",
  )

  assert.match(source, /registration\.appointment_reminder_due/)
  assert.match(source, /allAppointmentRemindersDisabled/)
  assert.match(source, /현재 예약 알림이 발송되지 않습니다/)
  assert.match(source, /첫 예약 알림 설정하기/)
  assert.match(source, /notification-rule-switch-\$\{surfaceKey\}-\$\{rule\.id\}/)
  assert.match(source, /surfaceKey="desktop"/)
  assert.match(source, /surfaceKey="mobile"/)
  assert.match(source, /querySelectorAll<HTMLElement>\([\s\S]*data-notification-rule-switch[\s\S]*offsetParent !== null[\s\S]*\?\.focus\(\)/)
  assert.match(source, /data-notification-rule-switch/)
})

test("예약 시각 편집은 KST 벽시각과 1분부터 7일 범위만 초안에 허용한다", async () => {
  const [panelSource, modelSource] = await Promise.all([
    readOptionalSource("src/features/notifications/notification-control-panel.tsx"),
    readOptionalSource("src/features/notifications/notification-control-plane-model.ts"),
  ])

  assert.match(panelSource, /type="time"/)
  assert.match(panelSource, /한국 시간\(KST\) 기준/)
  assert.match(panelSource, /min=\{1\}/)
  assert.match(panelSource, /max=\{10080\}/)
  assert.match(panelSource, /1분부터 7일 전까지/)
  assert.match(modelSource, /scheduleConfig\.timezone !== "Asia\/Seoul"/)
  assert.match(modelSource, /scheduleConfig\.leadMinutes >= 1/)
  assert.match(modelSource, /scheduleConfig\.leadMinutes <= 10080/)
  assert.match(modelSource, /invalid_schedule/)
})

test("알림 설정은 명시적으로 저장하고 저장 결과와 재계산 상태를 분리한다", async () => {
  const source = await readOptionalSource(
    "src/features/notifications/notification-control-panel.tsx",
  )

  assert.match(source, /변경사항 저장/)
  assert.match(source, /저장 중/)
  assert.match(source, /저장됨 · 알림 재계산 중/)
  assert.match(source, /저장됨 · 알림 재계산 완료/)
  assert.match(source, /저장됨 · 알림 재계산 실패 · 다시 시도/)
  assert.match(source, /position:\s*sticky|sticky bottom-(?:0|3)/)
})

test("저장 후 재계산은 bounded poll하고 실패 재시도는 설정 저장을 반복하지 않는다", async () => {
  const source = await readOptionalSource(
    "src/features/notifications/notification-control-panel.tsx",
  )

  assert.match(source, /RECONCILIATION_POLL_MAX_ATTEMPTS/)
  assert.match(source, /get_notification_orchestration_job_status_v1/)
  assert.match(source, /retry_notification_orchestration_job_v1/)
  assert.match(source, /expected_attempt_count/)
  const retryBlock = source.slice(
    source.indexOf("async function retryReconciliationJob"),
    source.indexOf("function connectionStatusLabel"),
  )
  assert.match(retryBlock, /retry_notification_orchestration_job_v1/)
  assert.doesNotMatch(retryBlock, /saveControlPlane/)
})

test("재계산 polling 상한을 소진하면 지연 실패로 닫아 수동 재시도를 허용한다", async () => {
  const source = await readOptionalSource(
    "src/features/notifications/notification-control-panel.tsx",
  )
  const pollBlock = source.slice(
    source.indexOf("const pollReconciliation"),
    source.indexOf("const handleSave"),
  )

  assert.match(
    pollBlock,
    /for \(let attempt[\s\S]*\n    setSavePhase\("reconciliation_failed"\)\n    setMessage\("알림 재계산 상태 확인이 지연되고 있습니다/,
  )
  assert.match(
    pollBlock,
    /const nextJob = await getReconciliationJobStatus\(currentJob\)[\s\S]*if \(reconciliationPollGenerationRef\.current !== generation\) return[\s\S]*currentJob = nextJob[\s\S]*setReconciliationJob\(currentJob\)/,
  )
  assert.match(
    pollBlock,
    /catch \{\s*if \(reconciliationPollGenerationRef\.current !== generation\) return[\s\S]*setSavePhase\("reconciliation_failed"\)/,
  )
})

test("revision conflict는 초안을 유지하고 최신 설정 또는 내 변경 유지로 해소한다", async () => {
  const source = await readOptionalSource(
    "src/features/notifications/notification-control-panel.tsx",
  )

  assert.match(source, /NotificationControlPlaneHttpError/)
  assert.match(source, /notification_revision_conflict/)
  assert.match(source, /rebaseNotificationDraft/)
  assert.match(source, /최신 설정 불러오기/)
  assert.match(source, /내 변경 유지/)
  assert.match(source, /같은 항목을 덮어쓰기/)
  assert.match(source, /conflictOverride/)
  assert.match(source, /conflictingFields/)
  assert.match(source, /requestId:\s*crypto\.randomUUID\(\)/)
})

test("같은 초안의 모호한 저장 재시도는 save request ID를 유지하고 초안 변경 시 폐기한다", async () => {
  const source = await readOptionalSource(
    "src/features/notifications/notification-control-panel.tsx",
  )

  assert.match(source, /saveRequestRef/)
  assert.match(source, /saveSignature/)
  assert.match(source, /saveRequestRef\.current\?\.signature\s*===\s*saveSignature/)
  const updateRuleSource = source.slice(
    source.indexOf("const updateRule"),
    source.indexOf("const pollReconciliation"),
  )
  assert.match(updateRuleSource, /saveRequestRef\.current\s*=\s*null/)
  assert.match(updateRuleSource, /reconciliationPollGenerationRef\.current\s*\+=\s*1/)
  assert.match(updateRuleSource, /setReconciliationJob\(null\)/)
  assert.match(updateRuleSource, /setSavePhase\("idle"\)/)
})

test("충돌 덮어쓰기 확인 뒤 초안을 바꾸면 감사 확인 상태를 복원한다", async () => {
  const source = await readOptionalSource(
    "src/features/notifications/notification-control-panel.tsx",
  )
  const updateRuleSource = source.slice(
    source.indexOf("const updateRule"),
    source.indexOf("const pollReconciliation"),
  )

  assert.match(
    updateRuleSource,
    /if \(conflictOverride && snapshot\) \{[\s\S]*setConflict\(\{[\s\S]*remoteSnapshot: snapshot,[\s\S]*conflictingFields: \[\.\.\.conflictOverride\.conflictingFields\],[\s\S]*overwriteConfirmationRequired: true/,
  )
  assert.match(updateRuleSource, /setConflictOverride\(null\)/)
  assert.ok(
    updateRuleSource.indexOf("setConflict({") < updateRuleSource.indexOf("setConflictOverride(null)"),
    "editing after overwrite confirmation must restore the audited conflict before clearing the override",
  )
})

test("재계산 비동기 세대 helper는 같은 세대의 결과만 허용한다", async () => {
  const { isNotificationAsyncGenerationCurrent } = await import(asyncStateModuleUrl)

  assert.equal(isNotificationAsyncGenerationCurrent(7, 7), true)
  assert.equal(isNotificationAsyncGenerationCurrent(7, 8), false)
  assert.equal(isNotificationAsyncGenerationCurrent(8, 7), false)
})

test("재계산 재시도는 RPC 응답·오류·poll 시작 전마다 캡처한 세대를 재확인한다", async () => {
  const source = await readOptionalSource(
    "src/features/notifications/notification-control-panel.tsx",
  )
  const retrySource = source.slice(
    source.indexOf("const handleRetryReconciliation"),
    source.indexOf("const navigationGuard"),
  )

  assert.match(retrySource, /const generation = reconciliationPollGenerationRef\.current \+ 1/)
  assert.match(retrySource, /reconciliationPollGenerationRef\.current = generation/)
  assert.match(
    retrySource,
    /await retryReconciliationJob\(reconciliationJob\)[\s\S]*if \(!isNotificationAsyncGenerationCurrent\(generation, reconciliationPollGenerationRef\.current\)\) return/,
  )
  assert.match(
    retrySource,
    /if \(!isNotificationAsyncGenerationCurrent\(generation, reconciliationPollGenerationRef\.current\)\) return\s*void pollReconciliation\(retriedJob\)/,
  )
  assert.match(
    retrySource,
    /catch \{\s*if \(!isNotificationAsyncGenerationCurrent\(generation, reconciliationPollGenerationRef\.current\)\) return[\s\S]*setSavePhase\("reconciliation_failed"\)/,
  )
})

test("dirty navigation guard는 닫기, 링크, 뒤로 가기, 새로고침을 한 확인 흐름으로 막는다", async () => {
  const [guardSource, panelSource] = await Promise.all([
    readOptionalSource(
      "src/features/notifications/use-notification-navigation-guard.ts",
    ),
    readOptionalSource(
      "src/features/notifications/notification-control-panel.tsx",
    ),
  ])

  assert.match(guardSource, /beforeunload/)
  assert.match(guardSource, /popstate/)
  assert.match(guardSource, /addEventListener\("click",[\s\S]*true/)
  assert.match(guardSource, /requestNavigation/)
  assert.match(panelSource, /onEscapeKeyDown/)
  assert.match(panelSource, /onPointerDownOutside/)
  assert.match(panelSource, /저장하지 않은 변경사항이 있습니다/)
  assert.match(panelSource, /저장하고 이동/)
  assert.match(panelSource, /저장하지 않고 이동/)
  assert.match(panelSource, /계속 편집/)
  assert.match(panelSource, /variant="ghost"[\s\S]*disabled=\{saving\}[\s\S]*onClick=\{navigationGuard\.continueEditing\}/)
  assert.match(panelSource, /variant="outline"[\s\S]*disabled=\{saving\}[\s\S]*onClick=\{navigationGuard\.discardAndContinue\}/)
})

test("저장 중에는 dirty navigation 결정을 코드 수준에서도 실행하지 않는다", async () => {
  const { canResolveNotificationNavigation } = await import(navigationGuardModuleUrl)
  assert.equal(canResolveNotificationNavigation(false), true)
  assert.equal(canResolveNotificationNavigation(true), false)

  const source = await readOptionalSource(
    "src/features/notifications/use-notification-navigation-guard.ts",
  )
  assert.match(source, /if \(!canResolveNotificationNavigation\(saving\)\) return/)
})

test("dirty navigation guard는 dirty 해제 시 같은 URL의 sentinel history를 정리한다", async () => {
  const source = await readOptionalSource(
    "src/features/notifications/use-notification-navigation-guard.ts",
  )

  assert.match(source, /guardEntryActiveRef/)
  assert.match(source, /removeGuardHistoryEntry/)
  assert.match(source, /window\.history\.back\(\)/)
  assert.match(source, /if \(!dirty\)[\s\S]*removeGuardHistoryEntry/)
})

test("sentinel 정리는 다음 popstate 한 번을 명시적으로 소비한다", async () => {
  const source = await readOptionalSource(
    "src/features/notifications/use-notification-navigation-guard.ts",
  )

  assert.match(source, /suppressNextPopRef/)
  assert.match(source, /if \(suppressNextPopRef\.current\)[\s\S]*suppressNextPopRef\.current = false[\s\S]*return/)
  assert.doesNotMatch(source, /queueMicrotask/)
})

test("연결 관리는 규칙 표와 분리되고 관리자 동작은 자동 테스트 발송을 하지 않는다", async () => {
  const source = await readOptionalSource(
    "src/features/notifications/notification-control-panel.tsx",
  )

  assert.match(source, /Connections/)
  assert.match(source, /webhookUrlMask/)
  assert.match(source, /editable/)
  assert.match(source, /연결 교체/)
  assert.match(source, /연결 해제/)
  assert.match(source, /테스트 메시지 보내기/)
  assert.match(source, /body\.confirmed\s*=\s*true/)
  const replaceClick = source.slice(
    source.indexOf("await onMutate("),
    source.indexOf("setWebhookInputs", source.indexOf("await onMutate(")),
  )
  assert.match(replaceClick, /"replace"/)
  assert.doesNotMatch(replaceClick, /"verify"/)
  assert.equal(source.match(/fetch\("\/api\/notifications\/connections"/g)?.length, 1)
  assert.match(source, /const replaced = await onMutate/)
  assert.match(source, /if \(replaced\)[\s\S]*setWebhookInputs/)
})

test("연결 검증과 해제는 공통 확인 대화상자를 사용한다", async () => {
  const source = await readOptionalSource(
    "src/features/notifications/notification-control-panel.tsx",
  )

  assert.doesNotMatch(source, /window\.confirm/)
  assert.match(source, /테스트 메시지 한 건을 보낼까요/)
  assert.match(source, /Google Chat 연결을 해제할까요/)
  assert.match(source, /pendingConnectionAction/)
})

test("이미 켜진 규칙의 연결이 끊기면 초안을 지우지 않고 연결 필요로 표시한다", async () => {
  const source = await readOptionalSource(
    "src/features/notifications/notification-control-panel.tsx",
  )

  assert.match(source, /connectionState\s*===\s*"disconnected"/)
  assert.match(source, /연결 필요/)
  assert.match(source, /rule\.enabled/)
  assert.doesNotMatch(source, /connectionState\s*===\s*"disconnected"[\s\S]{0,180}enabled:\s*false/)
})

test("업무별 대화상자는 권한별 연결 행동 문구와 마지막 검증 시각을 표시한다", async () => {
  const source = await readOptionalSource(
    "src/features/notifications/notification-control-panel.tsx",
  )

  assert.match(source, /snapshot\.connections\.some\(\(connection\) => connection\.editable\)/)
  assert.match(source, /connectionsEditable \? "연결 관리" : "연결 상태 보기"/)
  assert.match(source, /마지막 검증 \{formatTimestamp\(connection\.lastVerifiedAt\)\}/)
})

test("충돌의 최신 설정 불러오기는 dirty 초안을 버리기 전에 한글 확인을 받는다", async () => {
  const source = await readOptionalSource(
    "src/features/notifications/notification-control-panel.tsx",
  )

  assert.match(source, /latestSnapshotConfirmationOpen/)
  assert.match(source, /최신 설정으로 바꿀까요/)
  assert.match(source, /현재 편집 중인 변경사항은 사라집니다/)
  assert.match(source, /최신 설정 적용/)
  assert.doesNotMatch(source, /onClick=\{acceptLatestSnapshot\}[\s\S]{0,120}>\s*최신 설정 불러오기/)
})

test("전역 페이지는 redirect 없이 쿼리 탭과 한글 비활성·확인불가 상태 또는 공통 화면을 렌더한다", async () => {
  const [pageSource, workspaceSource, panelSource] = await Promise.all([
    readOptionalSource("src/app/admin/settings/notifications/page.tsx"),
    readOptionalSource(
      "src/features/notifications/notification-settings-workspace.tsx",
    ),
    readOptionalSource(
      "src/features/notifications/notification-control-panel.tsx",
    ),
  ])

  assert.doesNotMatch(pageSource, /redirect\(/)
  assert.match(pageSource, /NotificationSettingsWorkspace/)
  assert.match(panelSource, /NOTIFICATION_WORKFLOW_OPTIONS/)
  assert.match(workspaceSource, /NotificationControlPanel/)
  assert.match(workspaceSource, /공통 알림 설정이 아직 준비되지 않았습니다/)
  assert.match(workspaceSource, /알림 설정 준비 상태를 확인할 수 없습니다/)
  assert.match(panelSource, /알림 업무 선택/)
  assert.match(pageSource, /searchParams/)
  assert.match(pageSource, /section\s*===\s*"connections"/)
  assert.match(pageSource, /initialSection/)
  assert.match(workspaceSource, /initialSection/)
})

test("알림 설정 준비 상태 카드는 좁은 고유 폭으로 축소되지 않고 사용 가능한 너비를 채운다", async () => {
  const source = await readOptionalSource(
    "src/features/notifications/notification-settings-workspace.tsx",
  )

  assert.equal(
    source.match(/<Card className="mx-auto w-full max-w-2xl">/g)?.length,
    2,
  )
})

test("알림 설정 페이지는 공통 설정 여백 셸을 사용하고 중복 제목을 만들지 않는다", async () => {
  const [pageSource, workspaceSource] = await Promise.all([
    readOptionalSource("src/app/admin/settings/notifications/page.tsx"),
    readOptionalSource(
      "src/features/notifications/notification-settings-workspace.tsx",
    ),
  ])

  assert.match(pageSource, /SettingsWorkspaceShell/)
  assert.match(
    pageSource,
    /<SettingsWorkspaceShell>[\s\S]*<NotificationSettingsWorkspace[\s\S]*<\/SettingsWorkspaceShell>/,
  )
  assert.doesNotMatch(workspaceSource, /<h1[^>]*>알림 설정<\/h1>/)
  assert.doesNotMatch(workspaceSource, /개 업무의 규칙, 문구, 연결 상태를 한곳에서 관리합니다/)
})

test("알림 업무와 화면 섹션 선택은 반응형 1차·2차 제어로 구분한다", async () => {
  const source = await readOptionalSource(
    "src/features/notifications/notification-control-panel.tsx",
  )

  assert.match(source, /grid grid-cols-2 gap-1 rounded-lg border bg-muted\/35 p-1 sm:grid-cols-4 xl:grid-cols-7/)
  assert.match(source, /variant=\{activeWorkflow === option\.key \? "default" : "ghost"\}/)
  assert.match(source, /\[scrollbar-width:none\] \[&::-webkit-scrollbar\]:hidden/)
  assert.match(source, /"grid h-auto w-full rounded-lg border bg-muted\/35 p-1"/)
  assert.match(source, /<TabsTrigger value="connections"[^>]*>연결<\/TabsTrigger>/)
  assert.doesNotMatch(source, /연결 \(Connections\)/)
})

test("공유 알림 다이얼로그는 연결 탭이 없을 때 두 탭이 전체 폭을 사용한다", async () => {
  const source = await readOptionalSource(
    "src/features/notifications/notification-control-panel.tsx",
  )

  assert.match(
    source,
    /presentation === "page" \? "grid-cols-3" : "grid-cols-2"/,
  )
})

test("알림 규칙 표와 저장바는 조밀한 표 및 화면 안쪽 고정 작업 영역을 사용한다", async () => {
  const source = await readOptionalSource(
    "src/features/notifications/notification-control-panel.tsx",
  )

  assert.match(source, /<table className="w-full min-w-\[900px\] table-fixed/)
  assert.match(source, /compact \? "space-y-2 rounded-lg border bg-background p-3"/)
  assert.match(source, /"flex min-w-\[11rem\] items-center justify-end gap-2"/)
  assert.match(source, /sticky bottom-3 z-20/)
  assert.match(source, /role="region"/)
  assert.match(source, /aria-label="알림 설정 저장"/)
  assert.match(source, /className="h-9 w-full sm:w-auto"/)
})

test("대시보드 알림함은 viewer ID 없이 서버의 세 RPC 결과만 사용한다", async () => {
  const [popoverSource, serviceSource] = await Promise.all([
    readOptionalSource("src/components/dashboard-notification-popover.tsx"),
    readOptionalSource("src/features/makeup-requests/makeup-request-service.ts"),
  ])

  assert.match(serviceSource, /get_dashboard_notification_inbox_v1/)
  assert.match(serviceSource, /get_dashboard_notification_unread_count_v1/)
  assert.match(serviceSource, /mark_dashboard_notification_read_v1/)
  assert.doesNotMatch(serviceSource, /loadDashboardNotifications\(viewerId:/)
  assert.doesNotMatch(serviceSource, /loadDashboardUnreadNotificationCount\(viewerId:/)
  assert.doesNotMatch(popoverSource, /loadDashboardNotifications\(viewerId/)
  assert.doesNotMatch(popoverSource, /loadDashboardUnreadNotificationCount\(viewerId/)
  assert.doesNotMatch(popoverSource, /nextNotifications\.filter\(\(item\) => !item\.readAt\)/)
})

test("읽지 않은 알림은 Link 바깥의 형제 읽음 버튼과 항목별 상태를 사용한다", async () => {
  const source = await readOptionalSource("src/components/dashboard-notification-popover.tsx")
  const rows = source.slice(source.indexOf("notifications.map"))

  assert.match(rows, /grid-cols-\[minmax\(0,1fr\)_auto\]/)
  assert.match(rows, /<Link[\s\S]*<\/Link>[\s\S]*<Button[\s\S]*읽음[\s\S]*<\/Button>/)
  assert.doesNotMatch(rows, /<Link[\s\S]{0,1200}<Button[\s\S]{0,600}<\/Link>/)
  assert.match(source, /pendingReadIds/)
  assert.match(source, /readErrors/)
  assert.match(source, /preventDefault\(\)/)
  assert.match(source, /stopPropagation\(\)/)
})

test("알림 링크는 읽음 RPC를 동기 시작하지만 이동을 기다리거나 닫지 않는다", async () => {
  const source = await readOptionalSource("src/components/dashboard-notification-popover.tsx")
  const handler = source.slice(
    source.indexOf("const handleNotificationLinkClick"),
    source.indexOf("const handleMarkReadButton"),
  )

  assert.match(handler, /void startMarkRead\(notification\)/)
  assert.doesNotMatch(handler, /async/)
  assert.doesNotMatch(handler, /await/)
  assert.doesNotMatch(handler, /preventDefault/)
  assert.doesNotMatch(handler, /setOpen\(false\)/)
})

test("목록과 badge 갱신은 진행 중인 읽음 처리와 새 snapshot을 덮어쓰지 않는다", async () => {
  const source = await readOptionalSource("src/components/dashboard-notification-popover.tsx")
  const refreshSource = source.slice(
    source.indexOf("const refresh ="),
    source.indexOf("const refreshUnreadCount"),
  )
  const countSource = source.slice(
    source.indexOf("const refreshUnreadCount"),
    source.indexOf("const refreshPushState"),
  )

  assert.match(refreshSource, /stateAtStart\.readStates[\s\S]*state\.pending/)
  assert.match(refreshSource, /pendingUnreadCountSyncOperationId !== null/)
  assert.match(refreshSource, /const markVersion = stateAtStart\.markVersion/)
  assert.match(refreshSource, /current\.markVersion !== markVersion/)
  assert.match(refreshSource, /inboxRefreshRequestRef\.current !== requestId/)
  assert.match(refreshSource, /inboxSnapshotVersionRef\.current \+= 1[\s\S]*createDashboardInboxState/)
  assert.match(countSource, /const snapshotVersion = inboxSnapshotVersionRef\.current/)
  assert.match(countSource, /if \(inboxListLoadingRef\.current\) return/)
  assert.match(countSource, /pendingUnreadCountSyncOperationId !== null/)
  assert.match(countSource, /stateAtStart\.readStates[\s\S]*state\.pending/)
  assert.match(countSource, /inboxSnapshotVersionRef\.current !== snapshotVersion/)
  assert.match(source, /completeDashboardInboxMark[\s\S]*if \(next === current\) return[\s\S]*synchronizeUnreadCount/)
  assert.match(source, /failDashboardInboxMark[\s\S]*if \(next === current\) return[\s\S]*synchronizeUnreadCount/)
})

test("Push 준비 상태는 현재 브라우저와 profile 소유권의 닫힌 상태를 모두 표시한다", async () => {
  const [popoverSource, pushSource] = await Promise.all([
    readOptionalSource("src/components/dashboard-notification-popover.tsx"),
    readOptionalSource("src/lib/dashboard-push-client.ts"),
  ])
  const source = `${popoverSource}\n${pushSource}`

  for (const state of [
    "checking",
    "unsupported",
    "insecure",
    "server_unconfigured",
    "asset_missing",
    "permission_prompt",
    "permission_denied",
    "subscription_missing",
    "subscription_owner_mismatch",
    "ready",
    "self_test_sent",
    "self_test_expired",
    "self_test_failed",
  ]) {
    assert.match(source, new RegExp(`\\b${state}\\b`))
  }
  assert.match(source, /visibilitychange/)
  assert.match(source, /addEventListener\("focus"/)
  assert.match(source, /selfTestConfirmationOpen/)
  assert.match(source, /고정 테스트 알림/)
  assert.doesNotMatch(pushSource, /\b(?:target|content|href)\s*:/)
})

test("Push 동작 오류와 loading은 profile별 최신 action 세대만 갱신한다", async () => {
  const source = await readOptionalSource("src/components/dashboard-notification-popover.tsx")
  const actionSource = source.slice(
    source.indexOf("const runPushAction"),
    source.indexOf("const handlePushPrimaryAction"),
  )

  assert.match(source, /pushActionGenerationRef/)
  assert.match(source, /pushActionInFlightRef/)
  assert.match(source, /pushActionGenerationRef\.current \+= 1[\s\S]*invalidateDashboardPushReadiness/)
  assert.match(source, /!pushActionInFlightRef\.current[\s\S]*refreshPushState\(reason\)/)
  assert.match(source, /if \(!pushActionInFlightRef\.current\) void refreshPushState\("open"\)/)
  assert.match(actionSource, /const actionGeneration = pushActionGenerationRef\.current \+ 1/)
  assert.match(actionSource, /pushActionInFlightRef\.current = true/)
  assert.match(actionSource, /await refreshPushState\("manual"\)[\s\S]*setPushError\(message\)/)
  assert.match(actionSource, /finally[\s\S]*pushActionGenerationRef\.current === actionGeneration[\s\S]*setPushLoading\(false\)/)
  assert.match(actionSource, /pushActionInFlightRef\.current = false[\s\S]*setPushLoading\(false\)/)
})
