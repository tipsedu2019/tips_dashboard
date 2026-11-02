import type { ReactNode } from "react"
import { getRegistrationResultLinkHref } from "./registration-appointment-draft"
import type { OpsRegistrationAppointment, OpsRegistrationEnrollment } from "./registration-track-service"

const dateTime = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
})
export function registrationTeacherTime(value: string | null | undefined) {
  if (!value) return "미입력"
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) ? dateTime.format(parsed) : "시간 확인 불가"
}
export function isRegistrationTeacherPermissionError(error: unknown) {
  if (!error || typeof error !== "object") return false
  const value = error as { code?: unknown; status?: unknown }
  return value.code === "42501" || value.status === 401 || value.status === 403
}
export function RegistrationTeacherFact({ label, children }: { label: string; children?: ReactNode }) {
  return <div className="min-w-0">
    <dt className="text-xs text-muted-foreground">{label}</dt>
    <dd className="mt-1 break-words whitespace-pre-wrap [overflow-wrap:anywhere]">{children === "" || children == null ? "미입력" : children}</dd>
  </div>
}

// Match the management editors' persisted labels without importing their write hooks.
export function registrationTeacherReminderLabel(reminder: OpsRegistrationAppointment["customerReminder"]) {
  switch (reminder?.state) {
    case "sent": return "과거 고객 리마인드 발송 이력 · 발송 완료"
    case "unknown": return "과거 고객 리마인드 발송 이력 · 전달 여부 확인 필요"
    case "processing": return "과거 고객 리마인드 처리 이력 · 상태 확인 필요"
    case "failed_hold": return "과거 고객 리마인드 발송 이력 · 발송 실패"
    default: return null
  }
}

export function registrationTeacherEnrollmentLabel(enrollment: OpsRegistrationEnrollment) {
  if (enrollment.status === "canceled") return "수강 취소"
  if (enrollment.status === "enrolled" && !enrollment.rosterActive) {
    const source = enrollment.rosterReleaseKind === "transfer" ? "전반"
      : enrollment.rosterReleaseKind === "withdrawal" ? "퇴원" : "소유권 해제"
    return `${source} 이력`
  }
  if (enrollment.status === "enrolled") return "수강 중"
  if (enrollment.status === "waitlisted") return "대기"
  return enrollment.admissionBatchId ? "입학 처리 중" : "저장됨"
}

export function isRegistrationTeacherMutableEnrollment(enrollment: OpsRegistrationEnrollment) {
  return enrollment.status === "planned"
    && !enrollment.admissionBatchId
    && !enrollment.studentId
    && !enrollment.rosterActive
    && !enrollment.rosterReleasedAt
    && !enrollment.rosterReleaseReason
    && !enrollment.rosterReleaseSourceTaskId
    && !enrollment.rosterReleaseKind
}
export function RegistrationTeacherResultLink({ value }: { value?: string | null }) {
  const href = getRegistrationResultLinkHref(value || "")
  return href
    ? <a className="underline underline-offset-4 [overflow-wrap:anywhere]" href={href} target="_blank" rel="noopener noreferrer">{value}</a>
    : <>{value || "미입력"}</>
}
