"use client"

import { useTipsDashboardMetrics } from "@/hooks/use-tips-dashboard-metrics"

import { SectionCards } from "./components/section-cards"

export default function Page() {
  const metrics = useTipsDashboardMetrics()

  return (
    <div className="px-3 pb-5 sm:px-4 sm:pb-6 lg:px-6">
      <SectionCards metrics={metrics} />
    </div>
  )
}
