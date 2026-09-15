const calendarFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
})

export function dashboardLocalDate(now = new Date()): string {
  return calendarFormatter.format(now)
}

export function nextDashboardMidnight(localDate: string): number {
  return Date.parse(`${localDate}T00:00:00+09:00`) + 86_400_000
}
