"use client"

import * as SwitchPrimitive from "@radix-ui/react-switch"

import type { NotificationMentionSettingDto } from "./notification-mention-settings-types.ts"

export function NotificationMentionToggle({
  setting,
  contextLabel,
  saving,
  surfaceKey,
  error,
  onChange,
}: {
  setting: NotificationMentionSettingDto | undefined
  contextLabel: string
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
          <label htmlFor={`notification-mention-switch-${surfaceKey}-${setting.ruleId}`} className="cursor-pointer text-xs font-medium">담당자 멘션</label>
        </div>
        <SwitchPrimitive.Root
          id={`notification-mention-switch-${surfaceKey}-${setting.ruleId}`}
          aria-label={`${contextLabel} · 담당자 멘션`}
          aria-describedby={`notification-mention-description-${surfaceKey}-${setting.ruleId}`}
          checked={setting.mentionEnabled}
          disabled={saving || !setting.editable}
          onCheckedChange={(mentionEnabled) => onChange(setting, mentionEnabled)}
          className="data-[state=checked]:bg-primary relative h-6 w-11 shrink-0 rounded-full bg-input transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring disabled:opacity-50"
        >
          <SwitchPrimitive.Thumb className="data-[state=checked]:translate-x-5 block size-5 translate-x-0.5 rounded-full bg-background shadow transition-transform" />
        </SwitchPrimitive.Root>
      </div>
      <p id={`notification-mention-description-${surfaceKey}-${setting.ruleId}`} className="sr-only">확인된 Google Chat 계정만 멘션합니다. 변경사항 저장을 누르면 적용됩니다.</p>
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
    </div>
  )
}
