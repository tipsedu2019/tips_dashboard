export const DEFAULT_LOGIN_EMAIL_DOMAIN = "gmail.com";

export type DashboardRole = "admin" | "staff" | "teacher" | "assistant" | "viewer";

export function normalizeLoginLocalPart(value: string) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!normalized) {
    return "";
  }

  const digits = normalized.replace(/\D/g, "");
  const isPhoneLike = /^[\d\s()+-]+$/.test(normalized);

  if (isPhoneLike && digits.length >= 8) {
    return digits;
  }

  return normalized;
}

export function normalizeLoginIdentifier(
  value: string,
  defaultDomain = DEFAULT_LOGIN_EMAIL_DOMAIN,
) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!normalized) {
    return "";
  }

  if (normalized.includes("@")) {
    const atIndex = normalized.lastIndexOf("@");
    const localPart = normalized.slice(0, atIndex);
    const domainPart = normalized.slice(atIndex + 1) || defaultDomain;
    return `${normalizeLoginLocalPart(localPart)}@${domainPart}`;
  }

  return `${normalizeLoginLocalPart(normalized)}@${defaultDomain}`;
}

export function normalizeDashboardRole(
  role: string | null | undefined,
): DashboardRole {
  const normalized = String(role || "")
    .trim()
    .toLowerCase();

  if (normalized === "admin") return "admin";
  if (normalized === "staff") return "staff";
  if (normalized === "teacher") return "teacher";
  if (normalized === "assistant") return "assistant";

  return "viewer";
}

export function getRoleCapabilities(role: string | null | undefined) {
  const normalizedRole = normalizeDashboardRole(role);
  const canManageAll = normalizedRole === "admin" || normalizedRole === "staff";
  const canUseAssistantOperations = normalizedRole === "assistant";
  const canReadOperations = canManageAll || normalizedRole === "teacher";
  const canEditCurriculumPlanning = canManageAll;
  const canEditClassSchedulePlanning = canManageAll;

  return {
    canAccessDashboard: true,
    canUseAiAgentRequests: ["admin", "staff", "teacher"].includes(normalizedRole),
    canViewAllAiAgentRequests: normalizedRole === "admin",
    canManageAll,
    canReadOperations,
    canEditCurriculumPlanning,
    canEditClassSchedulePlanning,
    canEditClassSchedule: canManageAll,
    canUseAssistantOperations,
    defaultAdminPath: canUseAssistantOperations ? "/admin/word-retests" : "/admin/dashboard",
  };
}

// Keep the teacher's read-only operational workspace separate from management.
// Server readers and producers enforce the corresponding data/action boundary.
export function canTeacherAccessPath(pathname: string) {
  const path = pathname.replace(/\/+$/, "") || "/";
  return ![
    "/admin/students", "/admin/classes", "/admin/textbooks",
    "/admin/public-content", "/admin/recruiting", "/admin/statistics",
    "/admin/settings", "/admin/schools", "/admin/teachers", "/admin/classrooms",
  ].some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

export function shouldForcePasswordChange(user: unknown) {
  const candidate =
    user && typeof user === "object"
      ? (user as {
          mustChangePassword?: boolean;
          must_change_password?: boolean;
          user_metadata?: Record<string, unknown>;
          raw_user_meta_data?: Record<string, unknown>;
        })
      : null;

  return Boolean(
    candidate?.mustChangePassword ??
    candidate?.must_change_password ??
    candidate?.user_metadata?.mustChangePassword ??
    candidate?.user_metadata?.must_change_password ??
    candidate?.raw_user_meta_data?.mustChangePassword ??
    candidate?.raw_user_meta_data?.must_change_password ??
    false,
  );
}
