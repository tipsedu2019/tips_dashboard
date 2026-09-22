"use client"

import { useState, type ReactNode } from "react"
import { requestAppNavigation } from "@/lib/guarded-navigation"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { NotificationControlPanel, useNotificationControlPlaneAvailability } from "./notification-control-panel"
import type { NotificationWorkflowKey } from "./notification-control-plane-types"
import type { NotificationSettingsSection, RegistrationSettingsGroup } from "./notification-settings-editor-state"

type NotificationSettingsWorkspaceProps = {
  initialSection?: NotificationSettingsSection
  initialWorkflow?: NotificationWorkflowKey
  initialGroup?: RegistrationSettingsGroup | null
  customerGuidance?: ReactNode
}

export function NotificationSettingsWorkspace({ initialSection = "rules", initialWorkflow = "registration", initialGroup = null, customerGuidance }: NotificationSettingsWorkspaceProps) {
  const availability = useNotificationControlPlaneAvailability()
  const [section, setSection] = useState(initialSection)
  if (availability.status === "enabled" && section !== "customer") return <NotificationControlPanel workflowKey={initialWorkflow} presentation="page" initialSection={section} initialGroup={initialGroup} customerGuidance={customerGuidance} />
  return (
    <Tabs value={section === "customer" ? "customer" : "rules"} activationMode="manual" onValueChange={value => requestAppNavigation(() => setSection(value as NotificationSettingsSection))}>
      <TabsList aria-label="알림 채널" className="w-full justify-start">
        <TabsTrigger value="rules">직원 알림 · Google Chat</TabsTrigger>
        {customerGuidance ? <TabsTrigger value="customer">고객 안내 · 알림톡</TabsTrigger> : null}
      </TabsList>
      <TabsContent value="rules">
        <div role={availability.status === "loading" ? "status" : "alert"} className="grid min-h-40 place-content-center gap-3 p-5 text-center text-sm text-muted-foreground">
          {availability.status === "loading" ? "Google Chat 설정 준비 상태를 확인하는 중입니다." : availability.status === "disabled" ? "Google Chat 알림 설정이 아직 준비되지 않았습니다." : "Google Chat 설정 준비 상태를 확인할 수 없습니다."}
          {availability.status === "unavailable" ? <Button variant="outline" onClick={availability.retry}>다시 불러오기</Button> : null}
        </div>
      </TabsContent>
      {customerGuidance ? <TabsContent value="customer">{customerGuidance}</TabsContent> : null}
    </Tabs>
  )
}
