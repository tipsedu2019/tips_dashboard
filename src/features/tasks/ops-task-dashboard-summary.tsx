"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { useAuth } from "@/providers/auth-provider"

import { getOpsTaskCalendarItems, hasOpsTaskCalendarDate, hasOpsTaskOverdueCalendarDate, isClosedOpsTask, isOpsTaskAssignedToUser, toDateKey } from "./ops-task-model"
import {
  loadOpsTodoDashboardSummaryData,
  type OpsTask,
  type OpsTodoDashboardSummaryData,
} from "./ops-task-service"

const EMPTY_TODO_SUMMARY_DATA: OpsTodoDashboardSummaryData = {
  tasks: [],
  schemaReady: true,
  error: null,
}

function MetricLink({ href, label, value }: { href: string; label: string; value: number }) {
  if (value <= 0) return null

  return (
    <Link
      href={href}
      className="flex min-w-0 items-center justify-between gap-3 rounded-md border bg-background px-3 py-2 text-sm transition-colors hover:border-primary/40 hover:bg-primary/5"
    >
      <span className="truncate text-muted-foreground">{label}</span>
      <Badge variant="default">{value}</Badge>
    </Link>
  )
}

function hasDashboardTaskSchedule(task: OpsTask) {
  return getOpsTaskCalendarItems([task]).length > 0
}

export function OpsTaskDashboardSummary() {
  const { user } = useAuth()
  const [data, setData] = useState(EMPTY_TODO_SUMMARY_DATA)

  useEffect(() => {
    let isMounted = true
    loadOpsTodoDashboardSummaryData().then((nextData) => {
      if (isMounted) setData(nextData)
    })
    return () => {
      isMounted = false
    }
  }, [])

  const summary = useMemo(() => {
    const todayKey = toDateKey(new Date())
    const openTasks = data.tasks.filter((task) => !isClosedOpsTask(task))
    const openGeneralTasks = openTasks.filter((task) => task.type === "general")
    const currentUserLabel = [user?.name, user?.email, user?.loginId]
      .map((value) => String(value || "").trim())
      .find(Boolean) || ""

    return {
      today: openGeneralTasks.filter((task) => hasOpsTaskCalendarDate(task, todayKey)).length,
      overdue: openGeneralTasks.filter((task) => hasOpsTaskOverdueCalendarDate(task, todayKey)).length,
      mine: openGeneralTasks.filter((task) => isOpsTaskAssignedToUser(task, user?.id || "", currentUserLabel)).length,
      unassigned: openGeneralTasks.filter((task) => !task.assigneeId || !hasDashboardTaskSchedule(task)).length,
    }
  }, [data, user?.email, user?.id, user?.loginId, user?.name])

  const hasSignal = summary.today > 0 || summary.overdue > 0 || summary.mine > 0 || summary.unassigned > 0
  if (!hasSignal) return null

  return (
    <section className="mb-4 grid gap-2 md:grid-cols-4" aria-label="할 일 요약">
      <MetricLink href="/admin/tasks?list=today" label="오늘" value={summary.today} />
      <MetricLink href="/admin/tasks?list=filters&filter=overdue" label="지연" value={summary.overdue} />
      <MetricLink href="/admin/tasks?list=filters&filter=mine" label="내 담당" value={summary.mine} />
      <MetricLink href="/admin/tasks?list=filters&filter=unassigned" label="미정리" value={summary.unassigned} />
    </section>
  )
}
