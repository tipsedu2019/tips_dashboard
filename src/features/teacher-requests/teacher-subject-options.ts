type TeacherCatalog = { name: string; subjects: string[]; isVisible: boolean }
const token = (value: string) => value.trim().replace(/\s+/g, "").replace(/(과목|팀)$/g, "")

// Scoped class facets include teachers outside the current 15 class rows and
// teachers without catalog entries. Catalog metadata adds matching unassigned staff.
export function teacherSubjectNames(catalog: unknown, subject: string, classTeacherNames: string[]): string[] {
  const teachers = (catalog as { teachers?: unknown })?.teachers
  if (!Array.isArray(teachers) || teachers.length > 200 || !teachers.every(item => item &&
    typeof item.name === "string" && typeof item.isVisible === "boolean" && Array.isArray(item.subjects) && item.subjects.every((value: unknown) => typeof value === "string"))) {
    throw new Error("teacher_subject_catalog_invalid")
  }
  const selected = token(subject)
  if (!selected) return []
  return [...new Set([
    ...(teachers as TeacherCatalog[]).filter(item => item.isVisible && item.subjects.some(value => value.split(/[,，/]+/).some(part => token(part) === selected))).map(item => item.name.trim()),
    ...classTeacherNames.map(name => name.trim()),
  ].filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko"))
}
