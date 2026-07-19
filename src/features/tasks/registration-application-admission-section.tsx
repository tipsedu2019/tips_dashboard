import type { ReactNode } from "react"

export type RegistrationApplicationAdmissionSectionProps = {
  editable: boolean
  fields?: ReactNode
  emptyState?: ReactNode
}

export function RegistrationApplicationAdmissionSection({
  editable,
  fields,
  emptyState,
}: RegistrationApplicationAdmissionSectionProps) {
  return (
    <div className="grid gap-3" aria-disabled={!editable}>
      {fields || emptyState || <p className="text-sm text-muted-foreground">입학 처리 전에는 변경할 수 없습니다.</p>}
    </div>
  )
}
