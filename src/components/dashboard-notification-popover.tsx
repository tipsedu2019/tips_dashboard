"use client"

import * as React from "react"
import Link from "next/link"
import { Bell } from "lucide-react"

import { Button } from "@/components/ui/button"
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
  getDashboardPushState,
  subscribeDashboardPush,
  unsubscribeDashboardPush,
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
  if (state === "subscribed") return "켜짐"
  if (state === "unsupported") return "미지원"
  if (state === "unconfigured") return "설정 필요"
  if (state === "denied") return "차단됨"
  return "꺼짐"
}

export function DashboardNotificationPopover() {
  const { session } = useAuth()
  const viewerId = session?.user?.id || ""
  const [open, setOpen] = React.useState(false)
  const [notificationState, setNotificationState] = React.useState<{
    viewerId: string
    items: DashboardNotification[]
  }>({ viewerId: "", items: [] })
  const [unreadState, setUnreadState] = React.useState({ viewerId: "", count: 0 })
  const [loading, setLoading] = React.useState(false)
  const [notificationError, setNotificationError] = React.useState("")
  const [pushState, setPushState] = React.useState<DashboardPushState>("unsupported")
  const [pushLoading, setPushLoading] = React.useState(false)
  const [pushError, setPushError] = React.useState("")

  const notifications = notificationState.viewerId === viewerId ? notificationState.items : []
  const unreadCount = unreadState.viewerId === viewerId ? unreadState.count : 0

  const refresh = React.useCallback(async () => {
    if (!viewerId) return
    setLoading(true)
    try {
      const nextNotifications = await loadDashboardNotifications(viewerId)
      setNotificationState({ viewerId, items: nextNotifications })
      setUnreadState({
        viewerId,
        count: nextNotifications.filter((item) => !item.readAt).length,
      })
      setNotificationError("")
    } catch (error) {
      console.error("대시보드 알림 조회 실패", error)
      setNotificationError("알림을 불러오지 못했습니다. 다시 시도하세요.")
    } finally {
      setLoading(false)
    }
  }, [viewerId])

  const refreshUnreadCount = React.useCallback(async () => {
    if (!viewerId) return
    try {
      const count = await loadDashboardUnreadNotificationCount(viewerId)
      setUnreadState({ viewerId, count })
    } catch (error) {
      console.error("대시보드 읽지 않은 알림 수 조회 실패", error)
    }
  }, [viewerId])

  const refreshPushState = React.useCallback(async () => {
    try {
      setPushState(await getDashboardPushState())
      setPushError("")
    } catch (error) {
      setPushState("unsupported")
      setPushError(error instanceof Error ? error.message : "휴대폰 알림 상태를 확인하지 못했습니다.")
    }
  }, [])

  React.useEffect(() => {
    void refreshPushState()
  }, [refreshPushState])

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
      void refreshPushState()
    }
  }, [open, refresh, refreshPushState])

  const handleOpenNotification = React.useCallback(async (notification: DashboardNotification) => {
    if (!notification.readAt) {
      await markDashboardNotificationRead(notification.id)
      setNotificationState((current) => current.viewerId !== viewerId
        ? current
        : {
            ...current,
            items: current.items.map((item) => (
              item.id === notification.id ? { ...item, readAt: new Date().toISOString() } : item
            )),
          })
      setUnreadState((current) => current.viewerId !== viewerId
        ? current
        : { ...current, count: Math.max(0, current.count - 1) })
    }
    setOpen(false)
  }, [viewerId])

  const handleTogglePush = React.useCallback(async () => {
    if (!session?.access_token) {
      setPushError("로그인 세션을 찾을 수 없습니다.")
      return
    }

    setPushLoading(true)
    setPushError("")
    try {
      if (pushState === "subscribed") {
        await unsubscribeDashboardPush(session.access_token)
      } else {
        await subscribeDashboardPush(session.access_token)
      }
      await refreshPushState()
    } catch (error) {
      setPushError(error instanceof Error ? error.message : "휴대폰 알림 설정에 실패했습니다.")
      await refreshPushState()
    } finally {
      setPushLoading(false)
    }
  }, [pushState, refreshPushState, session?.access_token])

  const canTogglePush = !pushLoading && !["unsupported", "unconfigured", "denied"].includes(pushState)

  return (
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
          <Button
            type="button"
            variant={pushState === "subscribed" ? "outline" : "default"}
            size="sm"
            onClick={() => void handleTogglePush()}
            disabled={!canTogglePush}
            className="shrink-0"
          >
            {pushLoading ? "저장 중" : pushState === "subscribed" ? "끄기" : "켜기"}
          </Button>
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
              <div className="grid gap-1 px-3 py-2 text-left hover:bg-accent">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-medium">{notification.title}</span>
                  {!notification.readAt ? <span className="mt-1 size-2 rounded-full bg-primary" aria-hidden="true" /> : null}
                </div>
                {notification.body ? <span className="text-xs text-muted-foreground">{notification.body}</span> : null}
                <span className="text-[11px] text-muted-foreground">{formatNotificationTime(notification.createdAt)}</span>
              </div>
            )

            return notification.href ? (
              <Link
                key={notification.id}
                href={notification.href}
                onClick={() => void handleOpenNotification(notification)}
                className="block border-b last:border-b-0"
              >
                {content}
              </Link>
            ) : (
              <button
                key={notification.id}
                type="button"
                onClick={() => void handleOpenNotification(notification)}
                className="block w-full border-b last:border-b-0"
              >
                {content}
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}
