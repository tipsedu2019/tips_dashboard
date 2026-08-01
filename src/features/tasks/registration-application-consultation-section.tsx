import { Children, type ReactNode } from "react"

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
  const visibleContent = Children.toArray(children)
  return (
    <div className="grid gap-3" aria-disabled={!editable} data-section-state={editable ? "수정 가능" : "잠김"}>
      {visibleContent.length > 0 ? visibleContent : emptyState || <p className="text-sm text-muted-foreground">상담 업무가 아직 없습니다.</p>}
    </div>
  )
}
