export const DEFAULT_LOGIN_EMAIL_DOMAIN = "tipsedu.co.kr";

export function normalizeLoginIdentifier(
  value,
  defaultDomain = DEFAULT_LOGIN_EMAIL_DOMAIN,
) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return "";
  }

  return normalized.includes("@")
    ? normalized
    : `${normalized}@${defaultDomain}`;
}

export function normalizeDashboardRole(role) {
  const normalized = String(role || "").trim().toLowerCase();

  if (normalized === "admin") {
    return "admin";
  }
  if (normalized === "staff") {
    return "staff";
  }
  if (normalized === "teacher") {
    return "teacher";
  }

  return "viewer";
}

export function getRoleCapabilities(role) {
  const normalizedRole = normalizeDashboardRole(role);
  const canManageAll =
    normalizedRole === "admin" || normalizedRole === "staff";
  const canEditCurriculumPlanning =
    canManageAll || normalizedRole === "teacher";

  return {
    canAccessDashboard: normalizedRole !== "viewer",
    canManageAll,
    canEditCurriculumPlanning,
    canEditClassSchedule: canManageAll,
  };
}

export function shouldForcePasswordChange(user) {
  return Boolean(
    user?.mustChangePassword ??
      user?.must_change_password ??
      user?.user_metadata?.mustChangePassword ??
      user?.user_metadata?.must_change_password ??
      user?.raw_user_meta_data?.mustChangePassword ??
      user?.raw_user_meta_data?.must_change_password ??
      false,
  );
}
