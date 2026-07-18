"use client"

import { BellRing, Loader2 } from "lucide-react"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

import {
  NotificationControlPanel,
  useNotificationControlPlaneAvailability,
} from "./notification-control-panel"

const WORKFLOW_ORDER_TEXT =
  "할 일 · 영어 단어 재시험 · 등록 · 전반 · 퇴원 · 휴보강 · 전자결재"

type NotificationSettingsWorkspaceProps = {
  initialSection?: "rules" | "deliveries" | "connections"
}

export function NotificationSettingsWorkspace({
  initialSection = "rules",
}: NotificationSettingsWorkspaceProps) {
  const availability = useNotificationControlPlaneAvailability()

  if (availability.status === "loading") {
    return (
      <div className="flex min-h-[40vh] items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="animate-spin" /> 알림 설정 준비 상태를 확인하는 중입니다.
      </div>
    )
  }

  if (availability.status === "disabled") {
    return (
      <Card className="mx-auto w-full max-w-2xl">
        <CardHeader>
          <div className="mb-2 flex size-10 items-center justify-center rounded-full bg-muted">
            <BellRing className="size-5" />
          </div>
          <CardTitle>공통 알림 설정이 아직 준비되지 않았습니다</CardTitle>
          <CardDescription>
            서버 설정과 런타임 버전이 모두 확인되면 이 화면에서 일곱 업무의 알림을 관리할 수 있습니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{WORKFLOW_ORDER_TEXT}</p>
        </CardContent>
      </Card>
    )
  }

  if (availability.status === "unavailable") {
    return (
      <Card className="mx-auto w-full max-w-2xl">
        <CardHeader>
          <div className="mb-2 flex size-10 items-center justify-center rounded-full bg-muted">
            <BellRing className="size-5" />
          </div>
          <CardTitle>알림 설정 준비 상태를 확인할 수 없습니다</CardTitle>
          <CardDescription>
            로그인 상태나 서버 연결을 확인한 뒤 페이지를 새로고침해 주세요. 확인 전에는 기존 설정과 공통 설정을 모두 숨깁니다.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <NotificationControlPanel
      workflowKey="tasks"
      presentation="page"
      initialSection={initialSection}
    />
  )
}
