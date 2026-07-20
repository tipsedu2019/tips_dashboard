import type { ReactNode } from "react"

export type RegistrationApplicationInquirySectionProps = {
  mode: "create" | "detail"
  editable: boolean
  lockReason: string
  commonInfoContent: ReactNode
  subjectSyncContent: ReactNode
  exceptionContent?: ReactNode
  onDirtyChange?: (scope: "common" | "subjects", dirty: boolean) => void
}

export function RegistrationApplicationInquirySection({
  editable,
  commonInfoContent,
  subjectSyncContent,
  exceptionContent,
}: RegistrationApplicationInquirySectionProps) {
  return (
    <div className="grid gap-4" aria-disabled={!editable}>
      <div className="grid gap-3">{subjectSyncContent}</div>
      <div className="grid gap-3">{commonInfoContent}</div>
      {exceptionContent ? <div className="grid gap-3 border-t pt-4">{exceptionContent}</div> : null}
    </div>
  )
}
