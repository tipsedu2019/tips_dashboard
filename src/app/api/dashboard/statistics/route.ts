import { createProductionDashboardStatisticsRouteHandler } from "@/features/dashboard/server/statistics-route"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

let handler: ReturnType<typeof createProductionDashboardStatisticsRouteHandler> | null = null

export function GET(request: Request) {
  handler ??= createProductionDashboardStatisticsRouteHandler()
  return handler(request)
}
