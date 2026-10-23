// These are the operational workflows handled by the management team.
// General tasks and English retests retain their existing, separate policies.
export function isTeacherReadOnlyTask(role: string | null | undefined, type: string) {
  return role === "teacher" && ["registration", "transfer", "withdrawal"].includes(type);
}
