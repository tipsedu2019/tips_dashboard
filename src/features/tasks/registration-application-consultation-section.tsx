import type { ReactNode } from "react"

export type RegistrationApplicationConsultationSectionProps = {
  editable: boolean
  children?: ReactNode
  emptyState?: ReactNode
}

export function RegistrationApplicationConsultationSection({
  editable,
  children,
  emptyState,
}: RegistrationApplicationConsultationSectionProps) {
  return (
    <div className="grid gap-3" aria-disabled={!editable}>
      {children || emptyState || <p className="text-sm text-muted-foreground">상담 업무가 아직 없습니다.</p>}
    </div>
  )
}
