"use client"

import { useTipsDashboardMetrics } from "@/hooks/use-tips-dashboard-metrics"

import { SectionCards } from "./components/section-cards"

export default function Page() {
  const metrics = useTipsDashboardMetrics()

  return (
    <div className="px-4 pb-6 lg:px-6">
      <SectionCards metrics={metrics} />
    </div>
  )
}
