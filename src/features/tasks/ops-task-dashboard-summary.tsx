"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { useAuth } from "@/providers/auth-provider"

import {
  getOpsTaskBasicCompletionBlockers,
  getOpsTaskCalendarItems,
  hasOpsTaskCalendarDate,
  hasOpsTaskOverdueCalendarDate,
  isOpsTaskActionable,
  isOpsTaskBasicConfirmationCandidate,
  isOpsTaskAssignedToUser,
  toDateKey,
} from "./ops-task-model"
import {
  loadOpsTodoDashboardSummaryData,
  type OpsClassOption,
  type OpsStudentOption,
  type OpsTeacherOption,
  type OpsTextbookOption,
  type OpsTask,
  type OpsTodoDashboardSummaryData,
} from "./ops-task-service"

const EMPTY_TODO_SUMMARY_DATA: OpsTodoDashboardSummaryData = {
  tasks: [],
  classes: [],
  students: [],
  textbooks: [],
  teachers: [],
  schemaReady: true,
  error: null,
}

function MetricLink({ href, label, value, detail = "" }: { href: string; label: string; value: number; detail?: string }) {
  if (value <= 0) return null

  return (
    <Link
      href={href}
      className="flex min-w-0 items-center justify-between gap-3 rounded-md border bg-background px-3 py-2 text-sm transition-colors hover:border-primary/40 hover:bg-primary/5"
    >
      <span className="min-w-0">
        <span className="block truncate text-muted-foreground">{label}</span>
        {detail ? <span className="mt-0.5 block truncate text-xs text-muted-foreground">{detail}</span> : null}
      </span>
      <Badge variant="default">{value}</Badge>
    </Link>
  )
}

function hasDashboardTaskSchedule(task: OpsTask) {
  return getOpsTaskCalendarItems([task]).length > 0
}

function hasDashboardTaskOrganizationIssue(
  task: OpsTask,
  classes: OpsClassOption[],
  students: OpsStudentOption[],
  textbooks: OpsTextbookOption[],
  teachers: OpsTeacherOption[],
) {
  return !task.assigneeId || !hasDashboardTaskSchedule(task) || getOpsTaskBasicCompletionBlockers(task, { classes, students, textbooks, teachers }).length > 0
}

function getDashboardTaskOrganizationIssueLabels(
  task: OpsTask,
  classes: OpsClassOption[],
  students: OpsStudentOption[],
  textbooks: OpsTextbookOption[],
  teachers: OpsTeacherOption[],
) {
  const issueLabels = [
    !task.assigneeId ? "담당자 미정" : "",
    !hasDashboardTaskSchedule(task) ? "일정 미정" : "",
    ...getOpsTaskBasicCompletionBlockers(task, { classes, students, textbooks, teachers }),
  ]

  return issueLabels.filter(Boolean)
}

function getDashboardTaskConfirmationIssueLabels(
  task: OpsTask,
  classes: OpsClassOption[],
  students: OpsStudentOption[],
  textbooks: OpsTextbookOption[],
  teachers: OpsTeacherOption[],
) {
  if (String(task.status || "").trim() === "requested") {
    return ["요청 확인"]
  }

  return getOpsTaskBasicCompletionBlockers(task, { classes, students, textbooks, teachers })
}

function formatDashboardMetricDetail(labels: string[]) {
  const uniqueLabels = [...new Set(labels.map((label) => label.trim()).filter(Boolean))]
  if (uniqueLabels.length === 0) return ""
  if (uniqueLabels.length === 1) return uniqueLabels[0]
  return `${uniqueLabels[0]} 외 ${uniqueLabels.length - 1}`
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
    const actionableQueueTasks = data.tasks.filter((task) => isOpsTaskActionable(task, { today: todayKey }))
    const currentUserLabel = [user?.name, user?.email, user?.loginId]
      .map((value) => String(value || "").trim())
      .find(Boolean) || ""
    const organizationIssueLabels = actionableQueueTasks.flatMap((task) =>
      hasDashboardTaskOrganizationIssue(task, data.classes, data.students, data.textbooks, data.teachers)
        ? getDashboardTaskOrganizationIssueLabels(task, data.classes, data.students, data.textbooks, data.teachers)
        : [],
    )
    const confirmationIssueLabels = actionableQueueTasks.flatMap((task) =>
      isOpsTaskBasicConfirmationCandidate(task, { classes: data.classes, students: data.students, textbooks: data.textbooks, teachers: data.teachers })
        ? getDashboardTaskConfirmationIssueLabels(task, data.classes, data.students, data.textbooks, data.teachers)
        : [],
    )

    return {
      today: actionableQueueTasks.filter((task) => hasOpsTaskCalendarDate(task, todayKey)).length,
      overdue: actionableQueueTasks.filter((task) => hasOpsTaskOverdueCalendarDate(task, todayKey)).length,
      mine: actionableQueueTasks.filter((task) => isOpsTaskAssignedToUser(task, user?.id || "", currentUserLabel)).length,
      unassigned: actionableQueueTasks.filter((task) => hasDashboardTaskOrganizationIssue(task, data.classes, data.students, data.textbooks, data.teachers)).length,
      confirmation: actionableQueueTasks.filter((task) => isOpsTaskBasicConfirmationCandidate(task, { classes: data.classes, students: data.students, textbooks: data.textbooks, teachers: data.teachers })).length,
      unassignedDetail: formatDashboardMetricDetail(organizationIssueLabels),
      confirmationDetail: formatDashboardMetricDetail(confirmationIssueLabels),
    }
  }, [data, user?.email, user?.id, user?.loginId, user?.name])

  const hasSignal = summary.today > 0 || summary.overdue > 0 || summary.mine > 0 || summary.unassigned > 0 || summary.confirmation > 0
  if (!hasSignal) return null

  return (
    <section className="mb-4 grid gap-2 md:grid-cols-5" aria-label="할 일 요약">
      <MetricLink href="/admin/tasks?list=today" label="오늘" value={summary.today} />
      <MetricLink href="/admin/tasks?list=filters&filter=overdue" label="지연" value={summary.overdue} />
      <MetricLink href="/admin/tasks?list=mine" label="내 담당" value={summary.mine} />
      <MetricLink href="/admin/tasks?list=filters&filter=unassigned" label="미정리" value={summary.unassigned} detail={summary.unassignedDetail} />
      <MetricLink href="/admin/tasks?list=filters&filter=confirmation" label="확인 필요" value={summary.confirmation} detail={summary.confirmationDetail} />
    </section>
  )
}
