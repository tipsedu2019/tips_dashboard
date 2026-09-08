export const REGISTRATION_CUSTOMER_GUIDANCE = [
  { messageKind: "level_test_booking", label: "레벨테스트 예약", flow: "level_test" },
  { messageKind: "visit_consultation_booking", label: "방문상담 예약", flow: "consultation_requested" },
  { messageKind: "observation_booking", label: "청강 예약", flow: "observation" },
  { messageKind: "waiting_notice", label: "대기 안내", flow: "waiting" },
  { messageKind: "admission_application", label: "입학신청서", flow: "enrollment" },
] as const

export type RegistrationCustomerGuidanceSetting = Readonly<{
  messageKind: typeof REGISTRATION_CUSTOMER_GUIDANCE[number]["messageKind"]
  mode: "off" | "verification" | "live"
  templateVerifiedAt: string | null
}>

export function parseRegistrationCustomerGuidanceSettings(value: unknown): RegistrationCustomerGuidanceSetting[] {
  const invalid = (): never => { throw new Error("registration_customer_message_settings_unavailable") }
  if (!Array.isArray(value) || value.length !== REGISTRATION_CUSTOMER_GUIDANCE.length) return invalid()
  return REGISTRATION_CUSTOMER_GUIDANCE.map(({ messageKind }) => {
    const entries = value.filter((entry) => entry && entry.messageKind === messageKind)
    const item = entries[0]
    if (entries.length !== 1 || Object.keys(item).some((key) => !["messageKind", "mode", "templateVerifiedAt"].includes(key))
      || !["off", "verification", "live"].includes(item.mode)
      || !(item.templateVerifiedAt === null || (typeof item.templateVerifiedAt === "string" && /^\d{4}-\d{2}-\d{2}T/u.test(item.templateVerifiedAt) && Number.isFinite(Date.parse(item.templateVerifiedAt))))) return invalid()
    return { messageKind, mode: item.mode, templateVerifiedAt: item.templateVerifiedAt }
  })
}
