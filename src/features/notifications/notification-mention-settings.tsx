"use client"

import * as SwitchPrimitive from "@radix-ui/react-switch"

import type { NotificationMentionSettingDto } from "./notification-mention-settings-types.ts"

export function NotificationMentionToggle({
  setting,
  saving,
  surfaceKey,
  error,
  onChange,
}: {
  setting: NotificationMentionSettingDto | undefined
  saving: boolean
  surfaceKey: "desktop" | "mobile"
  error: string | null
  onChange: (setting: NotificationMentionSettingDto, mentionEnabled: boolean) => void
}) {
  if (!setting) return null
  return (
    <div className="min-w-0 space-y-1" data-notification-mention-setting={setting.ruleId}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium">담당자 멘션</p>
          <p className="text-xs text-muted-foreground">확인된 Google Chat 계정만 멘션합니다.</p>
        </div>
        <SwitchPrimitive.Root
          id={`notification-mention-switch-${surfaceKey}-${setting.ruleId}`}
          aria-label="담당자 멘션"
          checked={setting.mentionEnabled}
          disabled={saving || !setting.editable}
          onCheckedChange={(mentionEnabled) => onChange(setting, mentionEnabled)}
          className="data-[state=checked]:bg-primary relative h-6 w-11 shrink-0 rounded-full bg-input transition-colors disabled:opacity-50"
        >
          <SwitchPrimitive.Thumb className="data-[state=checked]:translate-x-5 block size-5 translate-x-0.5 rounded-full bg-background shadow transition-transform" />
        </SwitchPrimitive.Root>
      </div>
      {error ? <p className="text-xs text-amber-700">{error}</p> : null}
    </div>
  )
}
