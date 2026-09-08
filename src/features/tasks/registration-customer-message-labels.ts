import type { RegistrationCustomerMessageKind, RegistrationCustomerMessageStatus } from "./registration-customer-message-contract"

export const REGISTRATION_CUSTOMER_MESSAGE_LABELS: Record<RegistrationCustomerMessageKind, string> = {
  level_test_booking: "레벨테스트 예약", visit_consultation_booking: "방문상담 예약", appointment_reminder: "예약 리마인드",
  waiting_notice: "대기 안내", admission_application: "입학신청서", observation_booking: "청강 예약", observation_reminder: "청강 리마인드",
  level_test_booking_bundle: "레벨테스트 통합 예약", visit_consultation_booking_bundle: "방문상담 통합 예약", observation_booking_bundle: "청강 통합 예약",
  level_test_reminder_bundle: "레벨테스트 통합 리마인드", visit_consultation_reminder_bundle: "방문상담 통합 리마인드", observation_reminder_bundle: "청강 통합 리마인드",
}

export function registrationCustomerMessageStatusLabel(status: RegistrationCustomerMessageStatus) {
  if (status === "accepted") return "SOLAPI 접수 완료"
  if (status === "unknown") return "발송 결과 확인 필요"
  if (status === "failed_hold") return "발송 실패 · 재발송 보류"
  return "발송 처리 중"
}

export function formatRegistrationMessageTimestamp(value: string) {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return "시간 확인 필요"
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    hourCycle: "h23", timeZone: "Asia/Seoul",
  }).format(new Date(timestamp))
}
