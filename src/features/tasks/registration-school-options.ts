import type { OpsSchoolOption } from "./ops-task-service"

export type RegistrationSchoolLevel = "elementary" | "middle" | "high"
export type RegistrationSchoolChoice = {
  value: string
  label: string
  legacy: boolean
}

const CATEGORY_ALIASES: Record<string, RegistrationSchoolLevel> = {
  elementary: "elementary", elem: "elementary", primary: "elementary", 초등: "elementary",
  middle: "middle", mid: "middle", secondary: "middle", 중등: "middle",
  high: "high", highschool: "high", 고등: "high",
}

export function normalizeRegistrationSchoolLevel(value: unknown): RegistrationSchoolLevel | null {
  return CATEGORY_ALIASES[String(value || "").trim().toLowerCase()] || null
}

export function getRegistrationSchoolLevelFromGrade(value: string): RegistrationSchoolLevel | null {
  const grade = String(value || "").replace(/\s+/g, "")
  if (/^초[1-6]$/.test(grade)) return "elementary"
  if (/^중[1-3]$/.test(grade)) return "middle"
  if (/^고[1-3]$/.test(grade)) return "high"
  return null
}

export function getRegistrationSchoolChoices(input: {
  schools: readonly OpsSchoolOption[]
  grade: string
  currentSchoolName?: string
}): RegistrationSchoolChoice[] {
  const level = getRegistrationSchoolLevelFromGrade(input.grade)
  const current = String(input.currentSchoolName || "").trim()
  if (!level) return current ? [{ value: current, label: `기존 입력 · ${current}`, legacy: true }] : []
  const choices = input.schools
    .map((school) => ({ ...school, name: school.name.trim(), level: normalizeRegistrationSchoolLevel(school.category) }))
    .filter((school) => school.name && school.level === level)
    .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, "ko"))
    .filter((school, index, rows) => rows.findIndex((candidate) => candidate.name === school.name) === index)
    .map((school) => ({ value: school.name, label: school.name, legacy: false }))
  return current && !choices.some((choice) => choice.value === current)
    ? [...choices, { value: current, label: `기존 입력 · ${current}`, legacy: true }]
    : choices
}
