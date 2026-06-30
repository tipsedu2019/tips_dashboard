"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { useAuth } from "@/providers/auth-provider"

import { isClosedOpsTask, isOpsTaskInUserInbox, isOpsTaskInUserSent } from "./ops-task-model"
import {
  loadOpsTodoDashboardSummaryData,
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
    const openTasks = data.tasks.filter((task) => !isClosedOpsTask(task))
    const openGeneralTasks = openTasks.filter((task) => task.type === "general")
    const completedGeneralTasks = data.tasks.filter((task) => task.type === "general" && isClosedOpsTask(task))
    const currentUserLabel = [user?.name, user?.email, user?.loginId]
      .map((value) => String(value || "").trim())
      .find(Boolean) || ""
    const currentUserTeam = [
      (user as { teacherTeam?: string; teacher_team?: string; team?: string } | null)?.teacherTeam,
      (user as { teacherTeam?: string; teacher_team?: string; team?: string } | null)?.teacher_team,
      (user as { teacherTeam?: string; teacher_team?: string; team?: string } | null)?.team,
    ].map((value) => String(value || "").trim()).find(Boolean) || ""
    const currentUserContext = {
      currentUserId: user?.id || "",
      currentUserLabel,
      currentUserTeam,
    }

    return {
      inbox: openGeneralTasks.filter((task) => isOpsTaskInUserInbox(task, currentUserContext)).length,
      sent: openGeneralTasks.filter((task) => isOpsTaskInUserSent(task, currentUserContext)).length,
      completed: completedGeneralTasks.length,
    }
  }, [data, user])

  const hasSignal = summary.inbox > 0 || summary.sent > 0 || summary.completed > 0
  if (!hasSignal) return null

  return (
    <section className="mb-4 grid gap-2 md:grid-cols-3" aria-label="할 일 요약">
      <MetricLink href="/admin/tasks?list=inbox" label="받은함" value={summary.inbox} />
      <MetricLink href="/admin/tasks?list=sent" label="보낸함" value={summary.sent} />
      <MetricLink href="/admin/tasks?list=completed" label="완료" value={summary.completed} />
    </section>
  )
}
