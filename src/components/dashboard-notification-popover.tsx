"use client"

import * as React from "react"
import Link from "next/link"
import { Bell } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  loadDashboardNotifications,
  loadDashboardUnreadNotificationCount,
  markDashboardNotificationRead,
  type DashboardNotification,
} from "@/features/makeup-requests/makeup-request-service"
import {
  beginDashboardInboxLinkClick,
  beginDashboardInboxUnreadCountSync,
  completeDashboardInboxMark,
  completeDashboardInboxUnreadCountSync,
  createDashboardInboxState,
  failDashboardInboxMark,
  failDashboardInboxUnreadCountSync,
  type DashboardInboxState,
} from "@/lib/dashboard-inbox-state"
import {
  attachDashboardPushRefreshListeners,
  getCurrentDashboardPushReadiness,
  invalidateDashboardPushReadiness,
  rebindDashboardPushSubscription,
  refreshDashboardPushReadiness,
  requestDashboardPushPermissionAndBind,
  sendDashboardPushSelfTest,
  unsubscribeDashboardPush,
  type DashboardPushReadiness,
  type DashboardPushRefreshReason,
  type DashboardPushState,
} from "@/lib/dashboard-push-client"
import { useAuth } from "@/providers/auth-provider"

function formatNotificationTime(value: string) {
  if (!value) return ""
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ""

  return new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

function getPushStateLabel(state: DashboardPushState) {
  const labels: Record<DashboardPushState, string> = {
    checking: "현재 브라우저 상태를 확인하는 중입니다.",
    unsupported: "이 브라우저에서는 휴대폰 알림을 사용할 수 없습니다.",
    insecure: "보안 연결에서만 휴대폰 알림을 사용할 수 있습니다.",
    server_unconfigured: "서버 Push 키와 연락처 설정을 확인해야 합니다.",
    asset_missing: "서비스워커 또는 설치 파일을 불러올 수 없습니다.",
    permission_prompt: "이 브라우저의 알림 권한을 허용해 주세요.",
    permission_denied: "브라우저 설정에서 알림 권한을 다시 허용해 주세요.",
    subscription_missing: "현재 브라우저를 이 계정에 연결해야 합니다.",
    subscription_owner_mismatch: "현재 브라우저가 다른 계정 또는 공개키에 연결되어 있습니다.",
    ready: "현재 브라우저가 이 계정에 정상 연결되어 있습니다.",
    self_test_sent: "고정 테스트 알림의 발송 요청이 성공했습니다.",
    self_test_expired: "현재 브라우저 구독이 만료되었습니다.",
    self_test_failed: "고정 테스트 알림 발송에 실패했습니다.",
    check_failed: "현재 브라우저 상태를 확인하지 못했습니다.",
  }
  return labels[state]
}

function getPushPrimaryActionLabel(state: DashboardPushState) {
  if (state === "permission_prompt") return "허용하기"
  if (state === "subscription_missing") return "연결하기"
  if (state === "subscription_owner_mismatch") return "다시 연결"
  if (state === "ready") return "테스트"
  if (["self_test_sent", "self_test_expired", "self_test_failed", "check_failed"].includes(state)) {
    return "다시 확인"
  }
  return ""
}

export function DashboardNotificationPopover() {
  const { session } = useAuth()
  const viewerId = session?.user?.id || ""
  const viewerIdRef = React.useRef(viewerId)
  viewerIdRef.current = viewerId
  const [open, setOpen] = React.useState(false)
  const [inboxState, setInboxState] = React.useState<DashboardInboxState>(() => (
    createDashboardInboxState("", 0)
  ))
  const inboxStateRef = React.useRef(inboxState)
  const inboxGenerationRef = React.useRef(0)
  const inboxRefreshRequestRef = React.useRef(0)
  const inboxSnapshotVersionRef = React.useRef(0)
  const inboxListLoadingRef = React.useRef(false)
  const [loading, setLoading] = React.useState(false)
  const [notificationError, setNotificationError] = React.useState("")
  const [pushReadiness, setPushReadiness] = React.useState<DashboardPushReadiness>(() => (
    getCurrentDashboardPushReadiness()
  ))
  const [pushLoading, setPushLoading] = React.useState(false)
  const [pushError, setPushError] = React.useState("")
  const [selfTestConfirmationOpen, setSelfTestConfirmationOpen] = React.useState(false)
  const pushActionGenerationRef = React.useRef(0)
  const pushActionInFlightRef = React.useRef(false)

  const notifications = inboxState.profileId === viewerId ? inboxState.items : []
  const unreadCount = inboxState.profileId === viewerId ? inboxState.unreadCount : 0
  const pushState = pushReadiness.profileId === viewerId ? pushReadiness.state : "checking"
  const pendingReadIds = React.useMemo(() => new Set(
    Object.entries(inboxState.readStates)
      .filter(([, state]) => state.pending)
      .map(([notificationId]) => notificationId),
  ), [inboxState.readStates])
  const readErrors = React.useMemo(() => Object.fromEntries(
    Object.entries(inboxState.readStates)
      .filter(([, state]) => Boolean(state.error))
      .map(([notificationId, state]) => [notificationId, state.error]),
  ), [inboxState.readStates])

  const commitInboxState = React.useCallback((nextState: DashboardInboxState) => {
    inboxStateRef.current = nextState
    setInboxState(nextState)
  }, [])

  React.useEffect(() => {
    const generation = inboxGenerationRef.current + 1
    inboxGenerationRef.current = generation
    inboxRefreshRequestRef.current += 1
    inboxSnapshotVersionRef.current += 1
    inboxListLoadingRef.current = false
    commitInboxState(createDashboardInboxState(viewerId, generation))
    setLoading(false)
    setNotificationError("")
  }, [commitInboxState, viewerId])

  const refresh = React.useCallback(async () => {
    if (!viewerId) return
    const stateAtStart = inboxStateRef.current
    if (stateAtStart.pendingUnreadCountSyncOperationId !== null) return
    if (Object.values(stateAtStart.readStates).some((state) => state.pending)) return
    const generation = inboxGenerationRef.current
    const markVersion = stateAtStart.markVersion
    const requestId = inboxRefreshRequestRef.current + 1
    inboxRefreshRequestRef.current = requestId
    inboxListLoadingRef.current = true
    setLoading(true)
    try {
      const nextInbox = await loadDashboardNotifications()
      const current = inboxStateRef.current
      if (
        inboxRefreshRequestRef.current !== requestId
        || inboxGenerationRef.current !== generation
        || current.profileId !== viewerId
        || current.markVersion !== markVersion
        || Object.values(current.readStates).some((state) => state.pending)
      ) return
      inboxSnapshotVersionRef.current += 1
      commitInboxState(createDashboardInboxState(viewerId, generation, nextInbox))
      setNotificationError("")
    } catch (error) {
      if (
        inboxRefreshRequestRef.current !== requestId
        || inboxGenerationRef.current !== generation
        || viewerIdRef.current !== viewerId
      ) return
      console.error("대시보드 알림 조회 실패", error)
      setNotificationError("알림을 불러오지 못했습니다. 다시 시도하세요.")
    } finally {
      if (
        inboxRefreshRequestRef.current === requestId
        && inboxGenerationRef.current === generation
        && viewerIdRef.current === viewerId
      ) {
        inboxListLoadingRef.current = false
        setLoading(false)
      }
    }
  }, [commitInboxState, viewerId])

  const refreshUnreadCount = React.useCallback(async () => {
    if (!viewerId) return
    if (inboxListLoadingRef.current) return
    const stateAtStart = inboxStateRef.current
    if (stateAtStart.pendingUnreadCountSyncOperationId !== null) return
    if (Object.values(stateAtStart.readStates).some((state) => state.pending)) return
    const generation = inboxGenerationRef.current
    const markVersion = stateAtStart.markVersion
    const snapshotVersion = inboxSnapshotVersionRef.current
    try {
      const count = await loadDashboardUnreadNotificationCount()
      const current = inboxStateRef.current
      if (
        current.profileId !== viewerId
        || current.generation !== generation
        || current.markVersion !== markVersion
        || inboxSnapshotVersionRef.current !== snapshotVersion
      ) return
      commitInboxState({ ...current, unreadCount: count })
    } catch (error) {
      console.error("대시보드 읽지 않은 알림 수 조회 실패", error)
    }
  }, [commitInboxState, viewerId])

  const refreshPushState = React.useCallback(async (reason: DashboardPushRefreshReason) => {
    const accessToken = session?.access_token || ""
    if (!viewerId || !accessToken) {
      setPushReadiness(invalidateDashboardPushReadiness(viewerId))
      return
    }
    setPushReadiness({ state: "checking", code: "push_checking", profileId: viewerId })
    try {
      const next = await refreshDashboardPushReadiness({ accessToken, profileId: viewerId, reason })
      if (next.profileId !== viewerId || viewerIdRef.current !== viewerId) return
      setPushReadiness(next)
      setPushError("")
    } catch (error) {
      if (viewerIdRef.current !== viewerId) return
      setPushReadiness({
        state: "check_failed",
        code: "push_readiness_check_failed",
        profileId: viewerId,
      })
      setPushError(error instanceof Error ? error.message : "휴대폰 알림 상태를 확인하지 못했습니다.")
    }
  }, [session?.access_token, viewerId])

  React.useEffect(() => {
    pushActionGenerationRef.current += 1
    pushActionInFlightRef.current = false
    setPushReadiness(invalidateDashboardPushReadiness(viewerId))
    setPushLoading(false)
    setPushError("")
    setSelfTestConfirmationOpen(false)
    if (viewerId && session?.access_token) void refreshPushState("profile")
  }, [refreshPushState, session?.access_token, viewerId])

  React.useEffect(() => attachDashboardPushRefreshListeners((reason) => {
    if (viewerId && session?.access_token && !pushActionInFlightRef.current) {
      void refreshPushState(reason)
    }
  }), [refreshPushState, session?.access_token, viewerId])

  React.useEffect(() => {
    if (!viewerId) return
    const unreadCountTimer = window.setTimeout(() => {
      void refreshUnreadCount()
    }, 1500)

    return () => window.clearTimeout(unreadCountTimer)
  }, [refreshUnreadCount, viewerId])

  React.useEffect(() => {
    if (open) {
      void refresh()
      if (!pushActionInFlightRef.current) void refreshPushState("open")
    }
  }, [open, refresh, refreshPushState])

  const synchronizeUnreadCount = React.useCallback(() => {
    const started = beginDashboardInboxUnreadCountSync(inboxStateRef.current)
    if (!started.request) return
    commitInboxState(started.state)
    void loadDashboardUnreadNotificationCount().then((count) => {
      const current = inboxStateRef.current
      const next = completeDashboardInboxUnreadCountSync(current, started.request, count)
      if (next !== current) commitInboxState(next)
    }).catch(() => {
      const current = inboxStateRef.current
      const next = failDashboardInboxUnreadCountSync(current, started.request)
      if (next !== current) commitInboxState(next)
    })
  }, [commitInboxState])

  const startMarkRead = React.useCallback((notification: DashboardNotification) => {
    if (notification.readAt) return
    const started = beginDashboardInboxLinkClick(inboxStateRef.current, notification.id)
    if (!started.request) return
    commitInboxState(started.state)

    void markDashboardNotificationRead(notification.id).then((result) => {
      const current = inboxStateRef.current
      const next = completeDashboardInboxMark(current, started.request, result)
      if (next === current) return
      commitInboxState(next)
      synchronizeUnreadCount()
    }).catch(() => {
      const current = inboxStateRef.current
      const next = failDashboardInboxMark(
        current,
        started.request,
        "알림을 읽음 처리하지 못했습니다. 다시 시도하세요.",
      )
      if (next === current) return
      commitInboxState(next)
      synchronizeUnreadCount()
    })
  }, [commitInboxState, synchronizeUnreadCount])

  const handleNotificationLinkClick = React.useCallback((notification: DashboardNotification) => {
    void startMarkRead(notification)
  }, [startMarkRead])

  const handleMarkReadButton = React.useCallback((
    event: React.MouseEvent<HTMLButtonElement>,
    notification: DashboardNotification,
  ) => {
    event.preventDefault()
    event.stopPropagation()
    void startMarkRead(notification)
  }, [startMarkRead])

  const runPushAction = React.useCallback(async (
    action: () => Promise<DashboardPushReadiness>,
  ) => {
    if (!session?.access_token || !viewerId) {
      setPushError("로그인 세션을 찾을 수 없습니다.")
      return
    }
    const actionGeneration = pushActionGenerationRef.current + 1
    pushActionGenerationRef.current = actionGeneration
    const actionProfileId = viewerId
    pushActionInFlightRef.current = true
    setPushLoading(true)
    setPushError("")
    try {
      const next = await action()
      if (
        pushActionGenerationRef.current === actionGeneration
        && next.profileId === actionProfileId
        && viewerIdRef.current === actionProfileId
      ) setPushReadiness(next)
    } catch (error) {
      if (
        pushActionGenerationRef.current !== actionGeneration
        || viewerIdRef.current !== actionProfileId
      ) return
      const message = error instanceof Error ? error.message : "휴대폰 알림 설정에 실패했습니다."
      await refreshPushState("manual")
      if (
        pushActionGenerationRef.current === actionGeneration
        && viewerIdRef.current === actionProfileId
      ) setPushError(message)
    } finally {
      if (
        pushActionGenerationRef.current === actionGeneration
        && viewerIdRef.current === actionProfileId
      ) {
        pushActionInFlightRef.current = false
        setPushLoading(false)
      }
    }
  }, [refreshPushState, session?.access_token, viewerId])

  const handlePushPrimaryAction = React.useCallback(() => {
    const accessToken = session?.access_token || ""
    if (!accessToken || !viewerId || pushLoading) return
    const context = { accessToken, profileId: viewerId }
    if (pushState === "permission_prompt" || pushState === "subscription_missing") {
      void runPushAction(() => requestDashboardPushPermissionAndBind(context))
      return
    }
    if (pushState === "subscription_owner_mismatch") {
      void runPushAction(() => rebindDashboardPushSubscription(context))
      return
    }
    if (pushState === "ready") {
      setSelfTestConfirmationOpen(true)
      return
    }
    if (["self_test_sent", "self_test_expired", "self_test_failed", "check_failed"].includes(pushState)) {
      void refreshPushState("manual")
    }
  }, [pushLoading, pushState, refreshPushState, runPushAction, session?.access_token, viewerId])

  const handleDisablePush = React.useCallback(() => {
    const accessToken = session?.access_token || ""
    if (!accessToken || !viewerId || pushLoading) return
    void runPushAction(() => unsubscribeDashboardPush({ accessToken, profileId: viewerId }))
  }, [pushLoading, runPushAction, session?.access_token, viewerId])

  const handleConfirmSelfTest = React.useCallback(() => {
    const accessToken = session?.access_token || ""
    if (!accessToken || !viewerId || pushLoading || pushState !== "ready") return
    setSelfTestConfirmationOpen(false)
    void runPushAction(() => sendDashboardPushSelfTest({ accessToken, profileId: viewerId }))
  }, [pushLoading, pushState, runPushAction, session?.access_token, viewerId])

  const pushPrimaryActionLabel = getPushPrimaryActionLabel(pushState)
  const canDisablePush = ["ready", "self_test_sent", "self_test_expired", "self_test_failed"].includes(pushState)

  return (
    <>
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="icon" aria-label="알림" title="알림" className="relative">
          <Bell className="size-4" aria-hidden="true" />
          <span className="sr-only">알림</span>
          {unreadCount > 0 ? (
            <span className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-80 rounded-lg p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <div className="text-sm font-semibold">알림</div>
          <Button type="button" variant="ghost" size="sm" onClick={() => void refresh()} disabled={loading}>
            새로고침
          </Button>
        </div>
        <div className="flex items-center justify-between gap-3 border-b px-3 py-2">
          <div className="grid min-w-0 gap-0.5">
            <div className="text-sm font-medium">휴대폰 알림</div>
            <div className="truncate text-xs text-muted-foreground">
              {pushError || getPushStateLabel(pushState)}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {canDisablePush ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleDisablePush}
                disabled={pushLoading}
              >
                끄기
              </Button>
            ) : null}
            {pushPrimaryActionLabel ? (
              <Button
                type="button"
                variant="default"
                size="sm"
                onClick={handlePushPrimaryAction}
                disabled={pushLoading || pushState === "checking"}
              >
                {pushLoading ? "처리 중" : pushPrimaryActionLabel}
              </Button>
            ) : null}
          </div>
        </div>
        {notificationError ? (
          <div role="alert" className="border-b px-3 py-2 text-xs text-destructive">
            {notificationError}
          </div>
        ) : null}
        <div className="max-h-96 overflow-y-auto">
          {loading && notifications.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">불러오는 중입니다.</div>
          ) : notifications.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">새 알림이 없습니다.</div>
          ) : notifications.map((notification) => {
            const content = (
              <div className="grid gap-1 px-3 py-2 text-left">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-medium">{notification.title}</span>
                  {!notification.readAt ? <span className="mt-1 size-2 rounded-full bg-primary" aria-hidden="true" /> : null}
                </div>
                {notification.body ? <span className="text-xs text-muted-foreground">{notification.body}</span> : null}
                <span className="text-[11px] text-muted-foreground">{formatNotificationTime(notification.createdAt)}</span>
              </div>
            )

            return (
              <div
                key={notification.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-start border-b last:border-b-0 hover:bg-accent"
              >
                {notification.href ? (
                  <Link
                    href={notification.href}
                    onClick={() => handleNotificationLinkClick(notification)}
                    className="min-w-0"
                  >
                    {content}
                  </Link>
                ) : (
                  <div className="min-w-0">{content}</div>
                )}
                {!notification.readAt ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={(event) => handleMarkReadButton(event, notification)}
                    disabled={pendingReadIds.has(notification.id)}
                    className="mr-2 mt-2 h-7 shrink-0 px-2 text-xs"
                  >
                    {pendingReadIds.has(notification.id) ? "처리 중" : "읽음"}
                  </Button>
                ) : null}
                {readErrors[notification.id] ? (
                  <div role="alert" className="col-span-2 px-3 pb-2 text-xs text-destructive">
                    {readErrors[notification.id]}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
    <Dialog open={selfTestConfirmationOpen} onOpenChange={setSelfTestConfirmationOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>고정 테스트 알림을 보낼까요?</DialogTitle>
          <DialogDescription>
            현재 로그인한 계정에 연결된 이 브라우저로 TIPS Dashboard 고정 테스트 알림 한 건만 보냅니다.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setSelfTestConfirmationOpen(false)}>
            취소
          </Button>
          <Button type="button" onClick={handleConfirmSelfTest} disabled={pushLoading || pushState !== "ready"}>
            테스트 알림 보내기
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  )
}
