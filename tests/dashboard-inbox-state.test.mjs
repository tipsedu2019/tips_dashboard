import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const helperUrl = new URL("../src/lib/dashboard-inbox-state.ts", import.meta.url)
const serviceUrl = new URL("../src/features/makeup-requests/makeup-request-service.ts", import.meta.url)
const popoverUrl = new URL("../src/components/dashboard-notification-popover.tsx", import.meta.url)

let inboxState = {}
try {
  inboxState = await import(helperUrl.href)
} catch (error) {
  if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error
}

const notification = (overrides = {}) => ({
  id: "00000000-0000-4000-8000-000000000001",
  title: "휴보강 신청",
  body: "새 신청이 도착했습니다.",
  href: "/admin/makeup-requests",
  type: "makeup.submitted",
  readAt: "",
  createdAt: "2026-07-17T01:02:03.000Z",
  ...overrides,
})

const notificationWire = (overrides = {}) => ({
  id: "00000000-0000-4000-8000-000000000001",
  recipient_profile_id: "00000000-0000-4000-8000-000000000010",
  recipient_team: null,
  actor_profile_id: "00000000-0000-4000-8000-000000000020",
  type: "makeup.submitted",
  title: "휴보강 신청",
  body: "새 신청이 도착했습니다.",
  href: "/admin/makeup-requests",
  metadata: { request_id: "request-1" },
  read_at: null,
  created_at: "2026-07-17T01:02:03.000Z",
  ...overrides,
})

test("브라우저 알림 서비스는 viewer ID나 직접 테이블 접근 없이 세 RPC만 사용한다", async () => {
  const source = await readFile(serviceUrl, "utf8")
  const inboxBlock = source.slice(source.indexOf("function loadDashboardNotifications"))

  assert.match(inboxBlock, /get_dashboard_notification_inbox_v1/)
  assert.match(inboxBlock, /get_dashboard_notification_unread_count_v1/)
  assert.match(inboxBlock, /mark_dashboard_notification_read_v1/)
  assert.doesNotMatch(inboxBlock, /loadDashboardNotifications\(viewerId:/)
  assert.doesNotMatch(inboxBlock, /loadDashboardUnreadNotificationCount\(viewerId:/)
  assert.doesNotMatch(inboxBlock, /\.from\(["']dashboard_notifications["']\)/)
  assert.doesNotMatch(inboxBlock, /new Map|groupKey|dedupeKey/)
  assert.doesNotMatch(inboxBlock, /\.update\(\{\s*read_at:/)
})

test("배포 전 DB의 정확한 알림함 RPC 부재만 호환 상태로 분류한다", () => {
  const classify = inboxState.isDashboardNotificationInboxRpcUnavailable
  const normalize = inboxState.normalizeDashboardNotificationRpcError
  const isUnavailable = inboxState.isDashboardNotificationInboxUnavailableError
  assert.equal(typeof classify, "function")
  assert.equal(typeof normalize, "function")
  assert.equal(typeof isUnavailable, "function")
  if (
    typeof classify !== "function"
    || typeof normalize !== "function"
    || typeof isUnavailable !== "function"
  ) return

  assert.equal(classify({
    code: "PGRST202",
    message: "Could not find the function public.get_dashboard_notification_unread_count_v1 without parameters in the schema cache",
  }, "get_dashboard_notification_unread_count_v1"), true)
  assert.equal(classify({
    code: "42883",
    message: "function public.get_dashboard_notification_inbox_v1(integer) does not exist",
  }, "get_dashboard_notification_inbox_v1"), true)
  assert.equal(classify({
    message: "Could not find the function public.get_dashboard_notification_unread_count_v1 in the schema cache",
  }, "get_dashboard_notification_unread_count_v1"), true)

  assert.equal(classify({
    code: "42501",
    message: "permission denied for function get_dashboard_notification_unread_count_v1",
  }, "get_dashboard_notification_unread_count_v1"), false)
  assert.equal(classify({
    code: "PGRST202",
    message: "Could not find the function public.unrelated_rpc in the schema cache",
  }, "get_dashboard_notification_unread_count_v1"), false)
  assert.equal(classify({ message: "Failed to fetch" }, "get_dashboard_notification_inbox_v1"), false)
  assert.equal(classify({ code: "PGRST202" }, "unrelated_rpc"), false)

  const unavailable = normalize({
    code: "PGRST202",
    message: "Could not find the function public.mark_dashboard_notification_read_v1 in the schema cache",
  }, "mark_dashboard_notification_read_v1")
  assert.equal(unavailable instanceof Error, true)
  assert.equal(isUnavailable(unavailable), true)
  assert.equal(unavailable.message, "알림함 기능이 아직 준비되지 않았습니다. 잠시 후 다시 확인해 주세요.")

  const denied = normalize({
    code: "42501",
    message: "permission denied for function get_dashboard_notification_unread_count_v1",
  }, "get_dashboard_notification_unread_count_v1")
  assert.equal(denied instanceof Error, true)
  assert.equal(isUnavailable(denied), false)
  assert.match(denied.message, /42501/)
  assert.match(denied.message, /permission denied/)
})

test("알림함 목록·배지·읽음은 이전 DB 오류를 한글 준비 상태로 표시하고 다른 오류는 보존한다", async () => {
  const [source, popoverSource] = await Promise.all([
    readFile(serviceUrl, "utf8"),
    readFile(popoverUrl, "utf8"),
  ])
  const inboxBlock = source.slice(source.indexOf("function loadDashboardNotifications"))

  for (const rpcName of [
    "get_dashboard_notification_inbox_v1",
    "get_dashboard_notification_unread_count_v1",
    "mark_dashboard_notification_read_v1",
  ]) {
    assert.match(
      inboxBlock,
      new RegExp(`normalizeDashboardNotificationRpcError\\(\\s*error,\\s*"${rpcName}",?\\s*\\)`),
    )
  }
  assert.match(popoverSource, /isDashboardNotificationInboxUnavailableError/)
  assert.match(popoverSource, /DASHBOARD_NOTIFICATION_INBOX_UNAVAILABLE_MESSAGE/)
  const unreadBlock = popoverSource.slice(
    popoverSource.indexOf("const refreshUnreadCount"),
    popoverSource.indexOf("const refreshPushState"),
  )
  assert.match(unreadBlock, /if \(isDashboardNotificationInboxUnavailableError\(error\)\)[\s\S]*return[\s\S]*console\.error\("대시보드 읽지 않은 알림 수 조회 실패"/)
  const unreadCatch = unreadBlock.slice(unreadBlock.indexOf("} catch (error)"))
  assert.match(
    unreadCatch,
    /const current = inboxStateRef\.current[\s\S]*current\.profileId !== viewerId[\s\S]*viewerIdRef\.current !== viewerId[\s\S]*\) return[\s\S]*if \(isDashboardNotificationInboxUnavailableError\(error\)\)/,
  )

  const synchronizeBlock = popoverSource.slice(
    popoverSource.indexOf("const synchronizeUnreadCount"),
    popoverSource.indexOf("const startMarkRead"),
  )
  assert.match(
    synchronizeBlock,
    /if \(next === current\) return[\s\S]*setNotificationError\(DASHBOARD_NOTIFICATION_INBOX_UNAVAILABLE_MESSAGE\)/,
  )
})

test("엄격한 inbox wire mapper는 snake_case를 한 번만 매핑한다", () => {
  assert.equal(typeof inboxState.mapDashboardNotificationInboxWire, "function")

  const mapped = inboxState.mapDashboardNotificationInboxWire({
    items: [notificationWire()],
    unread_count: "1",
    next_cursor: {
      created_at: "2026-07-17T01:02:03.000Z",
      id: "00000000-0000-4000-8000-000000000001",
    },
  })

  assert.deepEqual(mapped, {
    items: [notification()],
    unreadCount: 1,
    nextCursor: {
      createdAt: "2026-07-17T01:02:03.000Z",
      id: "00000000-0000-4000-8000-000000000001",
    },
  })
})

test("unread_count는 canonical decimal string이면서 안전 정수일 때만 허용한다", () => {
  assert.equal(typeof inboxState.mapDashboardNotificationUnreadCountWire, "function")
  assert.equal(inboxState.mapDashboardNotificationUnreadCountWire({ unread_count: "0" }), 0)
  assert.equal(
    inboxState.mapDashboardNotificationUnreadCountWire({ unread_count: "9007199254740991" }),
    Number.MAX_SAFE_INTEGER,
  )

  for (const invalid of [0, 1, -1, "", "01", "-1", "+1", "1.0", "1e3", "9007199254740992"]) {
    assert.throws(
      () => inboxState.mapDashboardNotificationUnreadCountWire({ unread_count: invalid }),
      /dashboard_notification_wire_invalid/,
    )
  }
  assert.throws(
    () => inboxState.mapDashboardNotificationUnreadCountWire({ unread_count: "1", extra: true }),
    /dashboard_notification_wire_invalid/,
  )
})

test("mark wire mapper는 서버의 readAt과 unreadCount를 보존하고 닫힌 응답만 허용한다", () => {
  assert.equal(typeof inboxState.mapDashboardNotificationReadWire, "function")
  assert.deepEqual(inboxState.mapDashboardNotificationReadWire({
    notification_id: "00000000-0000-4000-8000-000000000001",
    newly_read: false,
    read_at: "2026-07-17T01:03:00.000Z",
    unread_count: "7",
  }), {
    notificationId: "00000000-0000-4000-8000-000000000001",
    newlyRead: false,
    readAt: "2026-07-17T01:03:00.000Z",
    unreadCount: 7,
  })

  assert.throws(() => inboxState.mapDashboardNotificationReadWire({
    notification_id: "00000000-0000-4000-8000-000000000001",
    newly_read: true,
    read_at: "2026-07-17T01:03:00.000Z",
    unread_count: 7,
  }), /dashboard_notification_wire_invalid/)
})

test("mark 상태는 profile과 generation이 다른 비동기 완료를 무시한다", () => {
  const createState = inboxState.createDashboardInboxState
  const beginMark = inboxState.beginDashboardInboxMark
  const completeMark = inboxState.completeDashboardInboxMark
  assert.equal(typeof createState, "function")
  assert.equal(typeof beginMark, "function")
  assert.equal(typeof completeMark, "function")

  const profileA = createState("profile-a", 1, {
    items: [notification()], unreadCount: 1, nextCursor: null,
  })
  const started = beginMark(profileA, notification().id)
  assert.ok(started.request)

  const profileB = createState("profile-b", 2, {
    items: [notification()], unreadCount: 1, nextCursor: null,
  })
  const staleProfile = completeMark(profileB, started.request, {
    notificationId: notification().id,
    newlyRead: true,
    readAt: "2026-07-17T01:03:00.000Z",
    unreadCount: 0,
  })
  assert.strictEqual(staleProfile, profileB)

  const nextGeneration = createState("profile-a", 2, {
    items: [notification()], unreadCount: 1, nextCursor: null,
  })
  const staleGeneration = completeMark(nextGeneration, started.request, {
    notificationId: notification().id,
    newlyRead: true,
    readAt: "2026-07-17T01:03:00.000Z",
    unreadCount: 0,
  })
  assert.strictEqual(staleGeneration, nextGeneration)
})

test("항목별 pending은 중복 mark를 막고 실패 뒤 같은 항목 재시도를 허용한다", () => {
  const original = inboxState.createDashboardInboxState("profile-a", 1, {
    items: [notification()], unreadCount: 1, nextCursor: null,
  })
  const first = inboxState.beginDashboardInboxMark(original, notification().id)
  const duplicate = inboxState.beginDashboardInboxMark(first.state, notification().id)
  assert.ok(first.request)
  assert.equal(first.state.readStates[notification().id].pending, true)
  assert.equal(duplicate.request, null)
  assert.strictEqual(duplicate.state, first.state)

  const failed = inboxState.failDashboardInboxMark(first.state, first.request, "잠시 후 다시 시도하세요.")
  assert.equal(failed.readStates[notification().id].pending, false)
  assert.equal(failed.readStates[notification().id].error, "잠시 후 다시 시도하세요.")
  assert.equal(failed.items[0].readAt, "")
  assert.equal(failed.unreadCount, 1)

  const retried = inboxState.beginDashboardInboxMark(failed, notification().id)
  assert.ok(retried.request)
  assert.notEqual(retried.request.operationId, first.request.operationId)
  assert.equal(retried.state.readStates[notification().id].error, "")
})

test("읽음 성공은 로컬 감소값이 아니라 서버 unread count를 적용한다", () => {
  const original = inboxState.createDashboardInboxState("profile-a", 1, {
    items: [notification()], unreadCount: 9, nextCursor: null,
  })
  const started = inboxState.beginDashboardInboxMark(original, notification().id)
  const completed = inboxState.completeDashboardInboxMark(started.state, started.request, {
    notificationId: notification().id,
    newlyRead: false,
    readAt: "2026-07-17T01:03:00.000Z",
    unreadCount: 4,
  })

  assert.equal(completed.items[0].readAt, "2026-07-17T01:03:00.000Z")
  assert.equal(completed.unreadCount, 4)
  assert.equal(completed.readStates[notification().id].pending, false)
  assert.equal(completed.readStates[notification().id].error, "")
})

test("링크 click 계획은 mark를 즉시 시작하되 navigation을 기다리거나 막지 않는다", () => {
  const original = inboxState.createDashboardInboxState("profile-a", 1, {
    items: [notification()], unreadCount: 1, nextCursor: null,
  })
  const planned = inboxState.beginDashboardInboxLinkClick(original, notification().id)

  assert.ok(planned.request)
  assert.equal(planned.state.readStates[notification().id].pending, true)
  assert.equal(planned.blockNavigation, false)
  assert.equal(typeof planned?.then, "undefined")
})

test("동시 mark 완료는 서버 count를 적용한 뒤 안전한 count 재동기화를 예약한다", () => {
  const firstId = notification().id
  const secondId = "00000000-0000-4000-8000-000000000002"
  const original = inboxState.createDashboardInboxState("profile-a", 3, {
    items: [notification(), notification({ id: secondId, title: "두 번째 알림" })],
    unreadCount: 6,
    nextCursor: null,
  })
  const first = inboxState.beginDashboardInboxMark(original, firstId)
  const second = inboxState.beginDashboardInboxMark(first.state, secondId)

  const secondCompletedFirst = inboxState.completeDashboardInboxMark(second.state, second.request, {
    notificationId: secondId,
    newlyRead: true,
    readAt: "2026-07-17T01:04:00.000Z",
    unreadCount: 4,
  })
  const firstCompletedLast = inboxState.completeDashboardInboxMark(secondCompletedFirst, first.request, {
    notificationId: firstId,
    newlyRead: true,
    readAt: "2026-07-17T01:03:00.000Z",
    unreadCount: 5,
  })

  assert.equal(firstCompletedLast.unreadCount, 5)
  assert.equal(firstCompletedLast.requiresUnreadCountSync, true)
  const sync = inboxState.beginDashboardInboxUnreadCountSync(firstCompletedLast)
  assert.ok(sync.request)
  const reconciled = inboxState.completeDashboardInboxUnreadCountSync(sync.state, sync.request, 4)
  assert.equal(reconciled.unreadCount, 4)
  assert.equal(reconciled.requiresUnreadCountSync, false)
})

test("count 재동기화 실패는 pending을 해제해 같은 scope에서 다시 시도할 수 있다", () => {
  const firstId = notification().id
  const secondId = "00000000-0000-4000-8000-000000000002"
  const original = inboxState.createDashboardInboxState("profile-a", 4, {
    items: [notification(), notification({ id: secondId })],
    unreadCount: 2,
    nextCursor: null,
  })
  const first = inboxState.beginDashboardInboxMark(original, firstId)
  const second = inboxState.beginDashboardInboxMark(first.state, secondId)
  const firstDone = inboxState.completeDashboardInboxMark(second.state, first.request, {
    notificationId: firstId,
    newlyRead: true,
    readAt: "2026-07-17T01:03:00.000Z",
    unreadCount: 1,
  })
  const bothDone = inboxState.completeDashboardInboxMark(firstDone, second.request, {
    notificationId: secondId,
    newlyRead: true,
    readAt: "2026-07-17T01:04:00.000Z",
    unreadCount: 0,
  })
  const sync = inboxState.beginDashboardInboxUnreadCountSync(bothDone)

  const failed = inboxState.failDashboardInboxUnreadCountSync(sync.state, sync.request)
  assert.equal(failed.requiresUnreadCountSync, true)
  assert.equal(failed.pendingUnreadCountSyncOperationId, null)
  assert.ok(inboxState.beginDashboardInboxUnreadCountSync(failed).request)
})
