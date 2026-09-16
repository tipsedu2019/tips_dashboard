import type { ComponentProps } from "react"

import { cn } from "@/lib/utils"

import { Button } from "@/components/ui/button"

import { getRegistrationSaveActionPresentation } from "./registration-application-model"

type RegistrationSaveButtonProps = Omit<
  ComponentProps<typeof Button>,
  "children" | "disabled" | "variant"
> & {
  dirty: boolean
  saving?: boolean
  blocked?: boolean
  actionLabel: string
  cleanLabel?: string
}

export function RegistrationSaveButton({
  dirty,
  saving = false,
  blocked = false,
  actionLabel,
  cleanLabel = "저장됨",
  className,
  size = "form",
  ...buttonProps
}: RegistrationSaveButtonProps) {
  const presentation = getRegistrationSaveActionPresentation({
    dirty,
    saving,
    blocked,
    actionLabel,
    cleanLabel,
  })

  return (
    <Button
      {...buttonProps}
      size={size}
      className={cn("min-w-28 shrink-0", className)}
      aria-busy={saving || undefined}
      variant={presentation.emphasis === "primary" ? "default" : "outline"}
      disabled={presentation.disabled}
    >
      {presentation.label}
    </Button>
  )
}
