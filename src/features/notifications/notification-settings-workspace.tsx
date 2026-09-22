"use client"

import { useLayoutEffect, useRef, useState, type ReactNode } from "react"
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
  const workspaceRef = useRef<HTMLDivElement>(null)
  const focusedChannel = useRef<HTMLElement | null>(null)
  useLayoutEffect(() => {
    const previous = focusedChannel.current
    if (previous && !previous.isConnected && document.activeElement === document.body) {
      workspaceRef.current?.querySelector<HTMLElement>(`[data-notification-channel="${previous.dataset.notificationChannel}"]`)?.focus()
    }
  }, [availability.status, section])
  return (
    <div ref={workspaceRef} onFocusCapture={event => {
      focusedChannel.current = event.target instanceof HTMLElement && event.target.dataset.notificationChannel ? event.target : null
    }} onBlurCapture={event => {
      if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) focusedChannel.current = null
    }}>
    {availability.status === "enabled" && section !== "customer" ? <NotificationControlPanel workflowKey={initialWorkflow} presentation="page" initialSection={section} initialGroup={initialGroup} customerGuidance={customerGuidance} /> : <Tabs value={section === "customer" ? "customer" : "rules"} activationMode="manual" onValueChange={value => requestAppNavigation(() => setSection(value as NotificationSettingsSection))}>
      <TabsList aria-label="알림 채널" className="w-full justify-start">
        <TabsTrigger value="rules" data-notification-channel="rules">직원 알림 · Google Chat</TabsTrigger>
        {customerGuidance ? <TabsTrigger value="customer" data-notification-channel="customer">고객 안내 · 알림톡</TabsTrigger> : null}
      </TabsList>
      <TabsContent value="rules">
        <div role={availability.status === "loading" ? "status" : "alert"} className="grid min-h-40 place-content-center gap-3 p-5 text-center text-sm text-muted-foreground">
          {availability.status === "loading" ? "Google Chat 설정 준비 상태를 확인하는 중입니다." : availability.status === "disabled" ? "Google Chat 알림 설정이 아직 준비되지 않았습니다." : "Google Chat 설정 준비 상태를 확인할 수 없습니다."}
          {availability.status === "unavailable" ? <Button variant="outline" onClick={() => {
            workspaceRef.current?.querySelector<HTMLElement>('[data-notification-channel="rules"]')?.focus()
            availability.retry()
          }}>다시 불러오기</Button> : null}
        </div>
      </TabsContent>
      {customerGuidance ? <TabsContent value="customer">{customerGuidance}</TabsContent> : null}
    </Tabs>}
    </div>
  )
}
