"use client"

import { DashboardDailyBrief } from "@/features/dashboard/dashboard-daily-brief"
import { DashboardWorkload } from "@/features/dashboard/dashboard-workload"

export default function Page() {
  return (
    <div className="grid min-w-0 gap-8 px-4 pb-5 sm:px-5 sm:pb-6 lg:px-6">
      <DashboardWorkload />
      <DashboardDailyBrief />
    </div>
  )
}
