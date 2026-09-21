export const STUDENT_ENROLLMENT_STATUS_OPTIONS = ["재원", "대기", "퇴원"];
export const DEFAULT_STUDENT_STATUS_FILTER = "재원";

export function normalizeStudentStatusFilter(value) {
  const status = String(value || "").trim();
  return STUDENT_ENROLLMENT_STATUS_OPTIONS.includes(status) ? status : DEFAULT_STUDENT_STATUS_FILTER;
}

function distinctIds(value) {
  return new Set(Array.isArray(value) ? value.filter((id) => id != null).map(String).map((id) => id.trim()).filter(Boolean) : []);
}

export function getStudentEnrollmentCounts(row = {}) {
  const registered = row.registeredCount ?? row.registered_count;
  const waiting = row.waitlistCount ?? row.waitlist_count;
  const classIds = distinctIds(row.class_ids || row.classIds);
  const waitlistIds = distinctIds(row.waitlist_class_ids || row.waitlistClassIds);
  for (const id of classIds) waitlistIds.delete(id);
  return {
    registeredCount: Number.isSafeInteger(registered) && registered >= 0 ? registered : classIds.size,
    waitlistCount: Number.isSafeInteger(waiting) && waiting >= 0 ? waiting : waitlistIds.size,
  };
}

export function getStudentEnrollmentStatus(row = {}) {
  const { registeredCount, waitlistCount } = getStudentEnrollmentCounts(row);
  return registeredCount > 0 ? "재원" : waitlistCount > 0 ? "대기" : "퇴원";
}
