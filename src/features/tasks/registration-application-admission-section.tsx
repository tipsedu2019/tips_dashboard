import { Children, type ReactNode } from "react"

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
  const visibleContent = Children.toArray(fields)
  return (
    <div className="grid gap-3" aria-disabled={!editable} data-section-state={editable ? "수정 가능" : "잠김"}>
      {visibleContent.length > 0 ? visibleContent : emptyState || <p className="text-sm text-muted-foreground">입력된 내용 없음</p>}
    </div>
  )
}
