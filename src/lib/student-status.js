export const ACTIVE_STUDENT_STATUS = "재원";
export const WITHDRAWN_STUDENT_STATUS = "퇴원";

export const STUDENT_STATUS_OPTIONS = [
  ACTIVE_STUDENT_STATUS,
  WITHDRAWN_STUDENT_STATUS,
];

export function normalizeStudentStatus(value) {
  const status = String(value || "").trim();
  const lowerStatus = status.toLowerCase();

  if (
    status === WITHDRAWN_STUDENT_STATUS ||
    status.includes("퇴원") ||
    lowerStatus === "withdrawn" ||
    lowerStatus === "inactive" ||
    lowerStatus === "left"
  ) {
    return WITHDRAWN_STUDENT_STATUS;
  }

  return ACTIVE_STUDENT_STATUS;
}
