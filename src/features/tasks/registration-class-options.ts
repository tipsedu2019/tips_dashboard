import { ACADEMIC_SUBJECTS } from "../../lib/academic-subject-registry.ts"

export type RegistrationClassChoice = { id: string; label: string; grade?: string }
export const UNASSIGNED_CLASS_GRADE = "__unassigned_grade__"
const grades: readonly string[] = ACADEMIC_SUBJECTS[0].grades
const collator = new Intl.Collator("ko", { numeric: true, sensitivity: "base" })

// Class grade is stored as text; preserve unfamiliar values rather than infer from names.
export function registrationClassGrades(grade = ""): string[] {
  return [...new Set(grade.split(/[,/·+\s]+/).map((value) => value.trim()).filter(Boolean))]
}

function compareGrades(left: string, right: string) {
  const rank = (grade: string) => grades.includes(grade) ? grades.indexOf(grade) : grades.length
  return rank(left) - rank(right) || collator.compare(left, right)
}

export function registrationClassGradeOptions(classes: readonly RegistrationClassChoice[]) {
  const values = [...new Set(classes.flatMap((item) => registrationClassGrades(item.grade)))].sort(compareGrades)
  if (classes.some((item) => !registrationClassGrades(item.grade).length)) values.push(UNASSIGNED_CLASS_GRADE)
  return values
}

export function registrationClassOptions(classes: readonly RegistrationClassChoice[], grade = "") {
  return classes.filter((item) => {
    const values = registrationClassGrades(item.grade)
    return !grade || (grade === UNASSIGNED_CLASS_GRADE ? !values.length : values.includes(grade))
  }).sort((left, right) => {
    const firstGrade = (item: RegistrationClassChoice) => registrationClassGrades(item.grade).sort(compareGrades)[0] || "\uffff"
    return (grade ? 0 : compareGrades(firstGrade(left), firstGrade(right)))
      || collator.compare(left.label, right.label) || collator.compare(left.id, right.id)
  })
}

export function registrationDefaultTextbookIds(
  classItem: { textbookIds: readonly string[]; textbookUsage?: Record<string, { startDate?: string; endDate?: string }> },
  textbooks: readonly { id: string; status?: string }[],
  today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(new Date()),
) {
  const activeIds = new Set(textbooks.filter((book) => !["inactive", "미사용"].includes(book.status?.trim().toLowerCase() || "")).map((book) => book.id))
  return [...new Set(classItem.textbookIds)].filter((id) => {
    const usage = classItem.textbookUsage?.[id]
    return activeIds.has(id) && (!usage?.startDate || usage.startDate <= today) && (!usage?.endDate || usage.endDate >= today)
  })
}
