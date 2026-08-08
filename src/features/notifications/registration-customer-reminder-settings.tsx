"use client"

import * as React from "react"
import * as SwitchPrimitive from "@radix-ui/react-switch"
import { Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { supabase } from "@/lib/supabase"

import {
  createRegistrationCustomerReminderSettingsService,
  type RegistrationCustomerReminderSettings as Settings,
} from "./registration-customer-reminder-service"

async function getAccessToken() {
  if (!supabase) return null
  const { data, error } = await supabase.auth.getSession()
  if (error) return null
  return data.session?.access_token ?? null
}
function statusLabel(settings: Settings) {
  if (settings.status === "ready") {
    return settings.enabled ? "자동 발송 중" : "발송 준비 완료"
  }
  if (settings.status === "scheduler_pending") return "자동 실행 준비 중"
  return "SOLAPI 승인 대기"
}

function errorMessage(error: unknown) {
  if (error instanceof Error && /[가-힣]/u.test(error.message)) return error.message
  return "자동 리마인드 설정을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요."
}

export function RegistrationCustomerReminderSettings() {
  const service = React.useMemo(() => createRegistrationCustomerReminderSettingsService({
    baseUrl: typeof window === "undefined" ? "http://localhost" : window.location.origin,
    getAccessToken,
  }), [])
  const [settings, setSettings] = React.useState<Settings | null>(null)
  const [enabled, setEnabled] = React.useState(false)
  const [leadHours, setLeadHours] = React.useState(3)
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [message, setMessage] = React.useState("")

  React.useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setMessage("")
    void service.get(controller.signal)
      .then((next) => {
        setSettings(next)
        setEnabled(next.enabled)
        setLeadHours(next.leadHours)
      })
      .catch((error) => {
        if (!controller.signal.aborted) setMessage(errorMessage(error))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [service])

  const dirty = Boolean(settings) && (
    enabled !== settings?.enabled || leadHours !== settings?.leadHours
  )
  const validLeadHours = Number.isInteger(leadHours) && leadHours >= 1 && leadHours <= 72
  const canEnable = settings?.ready || enabled

  async function save() {
    if (!settings || !dirty || !validLeadHours || saving) return
    setSaving(true)
    setMessage("")
    try {
      const next = await service.update({
        enabled,
        leadHours,
        expectedRevision: settings.revision,
      })
      setSettings(next)
      setEnabled(next.enabled)
      setLeadHours(next.leadHours)
      setMessage("저장되었습니다.")
    } catch (error) {
      setMessage(errorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card data-registration-customer-reminder-settings>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base">예약 리마인드 알림톡</CardTitle>
          {settings ? (
            <span className="text-xs text-muted-foreground">{statusLabel(settings)}</span>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
        <div className="flex min-h-11 items-center justify-between gap-3 rounded-md border px-3">
          <Label htmlFor="registration-customer-reminder-enabled">자동 발송</Label>
          <SwitchPrimitive.Root
            id="registration-customer-reminder-enabled"
            checked={enabled}
            disabled={loading || saving || !settings?.editable || !canEnable}
            onCheckedChange={setEnabled}
            className="data-[state=checked]:bg-primary relative h-6 w-11 shrink-0 rounded-full bg-input transition-colors disabled:opacity-50"
          >
            <SwitchPrimitive.Thumb className="data-[state=checked]:translate-x-5 block size-5 translate-x-0.5 rounded-full bg-background shadow transition-transform" />
          </SwitchPrimitive.Root>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="registration-customer-reminder-hours">발송 시각</Label>
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-sm">예약</span>
            <Input
              id="registration-customer-reminder-hours"
              type="number"
              inputMode="numeric"
              min={1}
              max={72}
              value={leadHours}
              disabled={loading || saving || !settings?.editable}
              onChange={(event) => setLeadHours(Number(event.target.value))}
              className="w-20"
            />
            <span className="shrink-0 text-sm">시간 전</span>
          </div>
        </div>
        <Button
          type="button"
          disabled={!dirty || !validLeadHours || saving || !settings?.editable}
          onClick={() => void save()}
        >
          {saving ? <Loader2 className="animate-spin" /> : null}
          저장
        </Button>
        {loading ? (
          <p className="text-sm text-muted-foreground sm:col-span-3">설정을 불러오는 중입니다.</p>
        ) : message ? (
          <p role="status" className="text-sm text-muted-foreground sm:col-span-3">{message}</p>
        ) : settings && !settings.ready ? (
          <p className="text-sm text-muted-foreground sm:col-span-3">
            SOLAPI 승인과 자동 실행 준비가 끝나면 ON으로 전환할 수 있습니다.
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}
