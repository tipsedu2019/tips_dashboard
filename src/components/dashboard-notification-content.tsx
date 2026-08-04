"use client"

import * as React from "react"
import Link from "next/link"

import { Button } from "@/components/ui/button"
import type { DashboardNotification } from "@/features/makeup-requests/makeup-request-service"

const KNOWN_LEADING_STATUS_EMOJI = Object.freeze([
  "↩️",
  "⏰",
  "▶️",
  "☎️",
  "⛔",
  "✅",
  "➖",
  "👀",
  "💬",
  "💳",
  "📅",
  "📝",
  "📥",
  "🔁",
  "🔄",
  "🚫",
])

const NOTIFICATION_BODY_ISO_DATE_TIME_PATTERN = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})\b/g
const notificationBodyDateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
})

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

function formatNotificationBody(value: string) {
  return value.replace(NOTIFICATION_BODY_ISO_DATE_TIME_PATTERN, (isoDateTime) => {
    const date = new Date(isoDateTime)
    if (!Number.isFinite(date.getTime())) return isoDateTime

    const parts = Object.fromEntries(
      notificationBodyDateTimeFormatter.formatToParts(date).map((part) => [part.type, part.value]),
    )
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`
  })
}

function splitKnownLeadingStatusEmoji(title: string) {
  const emoji = KNOWN_LEADING_STATUS_EMOJI.find((candidate) => title.startsWith(`${candidate} `))
  if (!emoji) return { emoji: "", text: title }
  return { emoji, text: title.slice(emoji.length + 1) }
}

type DashboardNotificationContentProps = Readonly<{
  notification: DashboardNotification
  isRead: boolean
  isMarkingRead: boolean
  readError: string
  onOpen: (notification: DashboardNotification) => void
  onMarkRead: (notification: DashboardNotification) => void
}>

export function DashboardNotificationContent({
  notification,
  isRead,
  isMarkingRead,
  readError,
  onOpen,
  onMarkRead,
}: DashboardNotificationContentProps) {
  const title = splitKnownLeadingStatusEmoji(notification.title)
  const createdAtLabel = formatNotificationTime(notification.createdAt)
  const content = (
    <div className="grid min-w-0 gap-1.5 px-3 py-3 text-left">
      <p className="min-w-0 text-sm font-medium leading-5 [overflow-wrap:anywhere]">
        {title.emoji ? (
          <span aria-hidden="true" className="mr-1.5">{title.emoji}</span>
        ) : null}
        <span>{title.text}</span>
      </p>
      {notification.body ? (
        <p className="whitespace-pre-wrap text-sm leading-5 text-muted-foreground [overflow-wrap:anywhere]">
          {formatNotificationBody(notification.body)}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <time dateTime={notification.createdAt}>{createdAtLabel}</time>
        {!isRead ? (
          <span role="status" className="font-medium text-primary">읽지 않음</span>
        ) : null}
      </div>
    </div>
  )

  const handleMarkRead = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    onMarkRead(notification)
  }

  return (
    <article
      role="listitem"
      data-dashboard-notification-id={notification.id}
      data-dashboard-notification-read={isRead ? "true" : "false"}
      className="grid grid-cols-[minmax(0,1fr)_auto] items-start border-b last:border-b-0 hover:bg-accent"
    >
      {notification.href ? (
        <Link
          href={notification.href}
          onClick={() => onOpen(notification)}
          className="min-w-0 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {content}
        </Link>
      ) : (
        <div className="min-w-0">{content}</div>
      )}
      {!isRead ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleMarkRead}
          disabled={isMarkingRead}
          aria-label={`${notification.title} 읽음 처리`}
          className="mr-1 mt-1 min-h-11 min-w-11 shrink-0 px-2 text-xs"
        >
          {isMarkingRead ? "처리 중" : "읽음"}
        </Button>
      ) : null}
      {readError ? (
        <div role="alert" className="col-span-2 px-3 pb-3 text-xs text-destructive">
          {readError}
        </div>
      ) : null}
    </article>
  )
}
