export const DEFAULT_LOGIN_EMAIL_DOMAIN = "tipsedu.co.kr"

export type DashboardRole = "admin" | "staff" | "teacher" | "viewer"

export function normalizeLoginLocalPart(value: string) {
  const normalized = String(value || "").trim().toLowerCase()
  if (!normalized) {
    return ""
  }

  const digits = normalized.replace(/\D/g, "")
  const isPhoneLike = /^[\d\s()+-]+$/.test(normalized)

  if (isPhoneLike && digits.length >= 8) {
    return digits.slice(-8)
  }

  return normalized
}

export function normalizeLoginIdentifier(
  value: string,
  defaultDomain = DEFAULT_LOGIN_EMAIL_DOMAIN,
) {
  const normalized = String(value || "").trim().toLowerCase()
  if (!normalized) {
    return ""
  }

  if (normalized.includes("@")) {
    const atIndex = normalized.lastIndexOf("@")
    const localPart = normalized.slice(0, atIndex)
    const domainPart = normalized.slice(atIndex + 1) || defaultDomain
    return `${normalizeLoginLocalPart(localPart)}@${domainPart}`
  }

  return `${normalizeLoginLocalPart(normalized)}@${defaultDomain}`
}

export function normalizeDashboardRole(role: string | null | undefined): DashboardRole {
  const normalized = String(role || "").trim().toLowerCase()

  if (normalized === "admin") return "admin"
  if (normalized === "staff") return "staff"
  if (normalized === "teacher") return "teacher"

  return "viewer"
}

export function getRoleCapabilities(role: string | null | undefined) {
  const normalizedRole = normalizeDashboardRole(role)
  const canManageAll = normalizedRole === "admin" || normalizedRole === "staff"
  const canEditCurriculumPlanning = canManageAll || normalizedRole === "teacher"
  const canEditClassSchedulePlanning = canManageAll || normalizedRole === "teacher"

  return {
    canAccessDashboard: normalizedRole !== "viewer",
    canManageAll,
    canEditCurriculumPlanning,
    canEditClassSchedulePlanning,
    canEditClassSchedule: canManageAll,
  }
}

export function shouldForcePasswordChange(
  user: unknown,
) {
  const candidate =
    user && typeof user === "object"
      ? (user as {
          mustChangePassword?: boolean
          must_change_password?: boolean
          user_metadata?: Record<string, unknown>
          raw_user_meta_data?: Record<string, unknown>
        })
      : null

  return Boolean(
    candidate?.mustChangePassword ??
      candidate?.must_change_password ??
      candidate?.user_metadata?.mustChangePassword ??
      candidate?.user_metadata?.must_change_password ??
      candidate?.raw_user_meta_data?.mustChangePassword ??
      candidate?.raw_user_meta_data?.must_change_password ??
      false,
  )
}
