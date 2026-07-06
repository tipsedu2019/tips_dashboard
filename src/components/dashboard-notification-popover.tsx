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
  markDashboardNotificationRead,
  type DashboardNotification,
} from "@/features/makeup-requests/makeup-request-service"

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

export function DashboardNotificationPopover() {
  const [open, setOpen] = React.useState(false)
  const [notifications, setNotifications] = React.useState<DashboardNotification[]>([])
  const [loading, setLoading] = React.useState(false)

  const unreadCount = notifications.filter((item) => !item.readAt).length

  const refresh = React.useCallback(async () => {
    setLoading(true)
    try {
      setNotifications(await loadDashboardNotifications())
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  React.useEffect(() => {
    if (open) {
      void refresh()
    }
  }, [open, refresh])

  const handleOpenNotification = React.useCallback(async (notification: DashboardNotification) => {
    if (!notification.readAt) {
      await markDashboardNotificationRead(notification.id)
      setNotifications((current) => current.map((item) => (
        item.id === notification.id ? { ...item, readAt: new Date().toISOString() } : item
      )))
    }
    setOpen(false)
  }, [])

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
