import type { ReactNode } from "react"

export type RegistrationApplicationPlacementSectionProps = {
  editable: boolean
  fields?: ReactNode
  emptyState?: ReactNode
}

export function RegistrationApplicationPlacementSection({
  editable,
  fields,
  emptyState,
}: RegistrationApplicationPlacementSectionProps) {
  return (
    <div className="grid gap-3" aria-disabled={!editable}>
      {fields || emptyState || <p className="text-sm text-muted-foreground">등록 결정 후 입력할 수 있습니다.</p>}
    </div>
  )
}
