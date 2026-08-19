const REGISTRATION_CUSTOMER_MESSAGE_ERROR_MESSAGES = Object.freeze([
  [
    "registration_customer_message_source_ineligible",
    "현재 이 예약을 진행하는 과목이 없습니다. 과목별 진행상태를 확인해 주세요.",
  ],
  [
    "registration_customer_message_admission_schedule_incomplete",
    "수업의 요일·시간, 선생님, 강의실, 첫 수업일을 모두 저장한 뒤 다시 시도해 주세요.",
  ],
  [
    "registration_customer_message_confirmation_conflict",
    "등록 수업 정보가 변경되었습니다. 새 미리보기를 확인해 주세요.",
  ],
  [
    "registration_customer_message_template_drift",
    "새 알림톡 템플릿 승인 후 발송할 수 있습니다.",
  ],
  [
    "registration_customer_message_body_too_long",
    "등록 수업 정보가 길어 알림톡을 만들 수 없습니다. 수업 정보를 확인해 주세요.",
  ],
  [
    "registration_customer_message_bundle_source_ambiguous",
    "같은 유형에 같은 과목 예약이 둘 이상 있습니다. 예약 내용을 정리한 뒤 다시 시도해 주세요.",
  ],
  [
    "registration_customer_message_bundle_stale",
    "예약 내용이 변경되었습니다. 새 미리보기를 확인해 주세요.",
  ],
  [
    "registration_customer_message_bundle_runtime_inactive",
    "묶음 알림톡 기능은 아직 활성화되지 않았습니다.",
  ],
] as const)

export function getRegistrationCustomerMessageErrorMessage(
  cause: unknown,
  fallback: string,
) {
  const message = cause instanceof Error ? cause.message : ""
  return REGISTRATION_CUSTOMER_MESSAGE_ERROR_MESSAGES.find(([code]) => (
    message.includes(code)
  ))?.[1] ?? fallback
}
