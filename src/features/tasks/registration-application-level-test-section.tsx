import type { ReactNode } from "react"

export type RegistrationApplicationLevelTestSectionProps = {
  editable: boolean
  children?: ReactNode
  emptyState?: ReactNode
}

export function RegistrationApplicationLevelTestSection({
  editable,
  children,
  emptyState,
}: RegistrationApplicationLevelTestSectionProps) {
  return (
    <div className="grid gap-3" aria-disabled={!editable}>
      {children || emptyState || <p className="text-sm text-muted-foreground">레벨테스트 업무가 아직 없습니다.</p>}
    </div>
  )
}
