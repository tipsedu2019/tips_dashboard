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


const READINESS_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  runtime_not_ready: "알림톡 기능 준비가 필요합니다. 관리자에게 문의해 주세요.",
  activation_off: "이 종류의 알림톡 발송이 꺼져 있습니다. 관리자에게 문의해 주세요.",
  verification_scope_mismatch: "현재 수신자는 시험 발송 대상으로 지정되지 않았습니다.",
  credentials_missing: "발송 서비스 연결을 확인해 주세요.",
  pf_missing: "카카오 채널 연결을 확인해 주세요.",
  template_missing: "이 안내에 사용할 알림톡 템플릿을 등록해 주세요.",
  template_not_verified: "알림톡 템플릿 승인과 내용 확인이 필요합니다.",
  template_drift: "승인된 템플릿과 현재 내용이 다릅니다. 템플릿을 확인해 주세요.",
  source_invalid: "예약과 과목별 진행상태를 확인한 뒤 새 미리보기를 열어 주세요.",
  source_dirty: "등록 정보가 변경되었습니다. 저장 후 새 미리보기를 열어 주세요.",
  duplicate_locked: "같은 내용의 발송 요청이 있습니다. 최근 발송 상태를 확인해 주세요.",
  role_not_authorized: "알림톡 발송은 원장·관리팀이 처리할 수 있습니다.",
})

export function getRegistrationCustomerMessageReadinessMessage(codes: readonly string[]) {
  return [...new Set(codes.map((code) => READINESS_MESSAGES[code] || "발송 준비 상태를 확인해 주세요."))].join(" ")
    || "발송 준비 상태를 확인해 주세요."
}
