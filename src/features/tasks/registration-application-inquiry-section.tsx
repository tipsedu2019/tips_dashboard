import type { ReactNode } from "react"

export type RegistrationApplicationInquirySectionProps = {
  mode: "create" | "detail"
  inquiryAt: string | null
  editable: boolean
  lockReason: string
  commonInfoContent: ReactNode
  subjectSyncContent: ReactNode
  exceptionContent?: ReactNode
  onSaveCommonInfo?: () => void
  onDirtyChange?: (scope: "common" | "subjects", dirty: boolean) => void
}

export function RegistrationApplicationInquirySection({
  mode,
  inquiryAt,
  editable,
  commonInfoContent,
  subjectSyncContent,
  exceptionContent,
  onSaveCommonInfo,
}: RegistrationApplicationInquirySectionProps) {
  const inquiryAtLabel = mode === "create"
    ? "저장 시 자동 기록"
    : inquiryAt || "기록된 문의 일시가 없습니다"

  return (
    <div className="grid gap-4" aria-disabled={!editable}>
      <div className="grid gap-3">
        {commonInfoContent}
        {onSaveCommonInfo ? (
          <div>
            <button type="button" onClick={onSaveCommonInfo} disabled={!editable}>
              문의 정보 저장
            </button>
          </div>
        ) : null}
      </div>

      <div className="grid gap-1 text-sm">
        <span className="text-muted-foreground">문의일시</span>
        <output>{inquiryAtLabel}</output>
      </div>

      <div className="grid gap-3 border-t pt-4">
        {subjectSyncContent}
      </div>

      {exceptionContent ? <div className="grid gap-3 border-t pt-4">{exceptionContent}</div> : null}
    </div>
  )
}
