import { AlertCircle, LoaderCircle, Wifi } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

type DashboardMetrics = {
  activeClassesCount: number
  studentsCount: number
  textbooksCount: number
  progressLogsCount: number
  isLoading: boolean
  isConnected: boolean
  error: string | null
}

type MetricCard = {
  title: string
  value: number
  summary: string
  sourceLabel: string
}

function getConnectionState(metrics: DashboardMetrics): {
  badgeLabel: string
  badgeVariant: "default" | "destructive" | "outline"
  icon: typeof Wifi
  statusCopy: string
} {
  if (metrics.isLoading) {
    return {
      badgeLabel: "연결 확인 중",
      badgeVariant: "outline",
      icon: LoaderCircle,
      statusCopy: "운영 지표를 불러오는 중입니다.",
    }
  }

  if (metrics.error || !metrics.isConnected) {
    return {
      badgeLabel: "점검 필요",
      badgeVariant: "destructive",
      icon: AlertCircle,
      statusCopy: metrics.error || "운영 데이터 연결 상태에 문제가 감지되었습니다.",
    }
  }

  return {
    badgeLabel: "실시간 연결",
    badgeVariant: "default",
    icon: Wifi,
    statusCopy: "현재 운영 데이터 기준으로 집계했습니다.",
  }
}

function formatMetricValue(value: number, metrics: DashboardMetrics) {
  if (metrics.isLoading) {
    return "—"
  }

  if (metrics.error || !metrics.isConnected) {
    return "점검"
  }

  return value.toLocaleString("ko-KR")
}

export function SectionCards({ metrics }: { metrics: DashboardMetrics }) {
  const connectionState = getConnectionState(metrics)
  const cards: MetricCard[] = [
    {
      title: "운영 중 수업",
      value: metrics.activeClassesCount,
      summary: "바로 확인할 수업 현황",
      sourceLabel: "수업일정 기준",
    },
    {
      title: "등록 학생",
      value: metrics.studentsCount,
      summary: "학생 배정과 등록 흐름 점검",
      sourceLabel: "학생관리 기준",
    },
    {
      title: "교재 수",
      value: metrics.textbooksCount,
      summary: "교재 운영 준비도 확인",
      sourceLabel: "교재관리 기준",
    },
    {
      title: "진도 기록",
      value: metrics.progressLogsCount,
      summary: "최근 수업 기록 반영 상태",
      sourceLabel: "진도 로그 기준",
    },
  ]

  return (
    <div className="*:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card dark:*:data-[slot=card]:bg-card *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:shadow-xs grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => {
        const StatusIcon = connectionState.icon

        return (
          <Card key={card.title} className="@container/card">
            <CardHeader>
              <CardDescription>{card.title}</CardDescription>
              <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
                {formatMetricValue(card.value, metrics)}
              </CardTitle>
              <CardAction>
                <Badge variant={connectionState.badgeVariant}>
                  <StatusIcon className={metrics.isLoading ? "animate-spin" : undefined} />
                  {connectionState.badgeLabel}
                </Badge>
              </CardAction>
            </CardHeader>
            <CardFooter className="flex-col items-start gap-1.5 text-sm">
              <div className="font-medium">{card.summary}</div>
              <div className="text-muted-foreground">{card.sourceLabel}</div>
              <div className="text-muted-foreground">{connectionState.statusCopy}</div>
            </CardFooter>
          </Card>
        )
      })}
    </div>
  )
}
