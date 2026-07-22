export const ACADEMIC_SUBJECTS = [
  {
    key: "english",
    value: "영어",
    team: "영어팀",
    sortOrder: 10,
    grades: ["초1", "초2", "초3", "초4", "초5", "초6", "중1", "중2", "중3", "고1", "고2", "고3"],
    capabilities: ["registration", "level_test", "classes", "textbooks", "academic_exam", "subject_chat", "word_retest", "monthly_approval"],
  },
  {
    key: "math",
    value: "수학",
    team: "수학팀",
    sortOrder: 20,
    grades: ["초1", "초2", "초3", "초4", "초5", "초6", "중1", "중2", "중3", "고1", "고2", "고3"],
    capabilities: ["registration", "level_test", "classes", "textbooks", "academic_exam", "subject_chat", "monthly_approval"],
  },
  {
    key: "science",
    value: "과학",
    team: "과학팀",
    sortOrder: 30,
    grades: ["고1", "고2", "고3"],
    capabilities: ["registration", "level_test", "classes", "textbooks", "academic_exam", "subject_chat"],
  },
] as const

export type AcademicSubjectKey = typeof ACADEMIC_SUBJECTS[number]["key"]
export type AcademicSubjectValue = typeof ACADEMIC_SUBJECTS[number]["value"]
export type AcademicSubjectCapability = typeof ACADEMIC_SUBJECTS[number]["capabilities"][number]

export const ACADEMIC_SUBJECT_VALUES = Object.freeze(
  ACADEMIC_SUBJECTS.map(({ value }) => value),
) as readonly AcademicSubjectValue[]

const ACADEMIC_SUBJECT_ALIASES = {
  english: "영어",
  영어: "영어",
  math: "수학",
  수학: "수학",
  science: "과학",
  과학: "과학",
} as const satisfies Readonly<Record<string, AcademicSubjectValue>>

const ACADEMIC_SUBJECT_KEYS_BY_VALUE = Object.fromEntries(
  ACADEMIC_SUBJECTS.map(({ key, value }) => [value, key]),
) as Record<AcademicSubjectValue, AcademicSubjectKey>

function normalizedSubjectAlias(input: unknown) {
  return typeof input === "string" ? input.trim().toLowerCase() : ""
}

export function parseAcademicSubject(input: unknown): AcademicSubjectValue | null {
  const alias = normalizedSubjectAlias(input)
  return ACADEMIC_SUBJECT_ALIASES[alias as keyof typeof ACADEMIC_SUBJECT_ALIASES] ?? null
}

export function parseAcademicSubjectKey(input: unknown): AcademicSubjectKey | null {
  const subject = parseAcademicSubject(input)
  return subject ? ACADEMIC_SUBJECT_KEYS_BY_VALUE[subject] : null
}

export function sortAcademicSubjects(values: readonly unknown[] = []): AcademicSubjectValue[] {
  const selected = new Set(values.map(parseAcademicSubject).filter((value) => value !== null))
  return ACADEMIC_SUBJECT_VALUES.filter((value) => selected.has(value))
}

export function serializeAcademicSubjects(values: readonly unknown[] = []): string {
  return sortAcademicSubjects(values).join(", ")
}

export function isScienceGrade(input: unknown): boolean {
  const grade = typeof input === "string" ? input.trim() : ""
  const science = ACADEMIC_SUBJECTS.find(({ key }) => key === "science")
  return science?.grades.some((value) => value === grade) ?? false
}

export function subjectSupports(subjectInput: unknown, capabilityInput: unknown): boolean {
  const subject = parseAcademicSubject(subjectInput)
  const capability = typeof capabilityInput === "string" ? capabilityInput.trim() : ""
  const registration = ACADEMIC_SUBJECTS.find(({ value }) => value === subject)
  return registration?.capabilities.some((value) => value === capability) ?? false
}
