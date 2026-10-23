// These are the operational workflows handled by the management team.
// General tasks and English retests retain their existing, separate policies.
export function isTeacherReadOnlyTask(role: string | null | undefined, type: string) {
  return role === "teacher" && ["registration", "transfer", "withdrawal"].includes(type);
}

// Common information that teachers may search, sort, and display in operations.
export const OPERATIONAL_COMMON_COLUMNS = {
  withdrawal: ["status", "subject", "teacher", "className", "student", "withdrawalDate", "withdrawalSession", "action"],
  transfer: ["status", "subject", "fromTeacher", "fromClassName", "student", "fromClassEndDate", "fromClassEndSession", "toTeacher", "toClassName", "toClassStartDate", "toClassStartSession", "action"],
} as const
export function isOperationalCommonColumn(type: "withdrawal" | "transfer", column: string | null | undefined) {
  return column == null || (OPERATIONAL_COMMON_COLUMNS[type] as readonly string[]).includes(column)
}

export function sanitizeOperationalCommonControls<T extends { filterColumn: string | null; sortColumn: string | null; sortDirection: "asc" | "desc" | null }>(type: "withdrawal" | "transfer", value: T, commonRead: boolean): T {
  if (!commonRead) return value
  const sortColumn = isOperationalCommonColumn(type, value.sortColumn) ? value.sortColumn : null
  return { ...value, filterColumn: isOperationalCommonColumn(type, value.filterColumn) ? value.filterColumn : "student", sortColumn, sortDirection: sortColumn ? value.sortDirection : null }
}
