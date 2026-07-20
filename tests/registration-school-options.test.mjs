import assert from "node:assert/strict"
import test from "node:test"

const schoolOptions = await import("../src/features/tasks/registration-school-options.ts")

test("official registration grades map to one configured school level", () => {
  for (const grade of ["초1", "초2", "초3", "초4", "초5", "초6"]) {
    assert.equal(schoolOptions.getRegistrationSchoolLevelFromGrade(grade), "elementary")
  }
  for (const grade of ["중1", "중2", "중3"]) {
    assert.equal(schoolOptions.getRegistrationSchoolLevelFromGrade(grade), "middle")
  }
  for (const grade of ["고1", "고2", "고3"]) {
    assert.equal(schoolOptions.getRegistrationSchoolLevelFromGrade(grade), "high")
  }
  assert.equal(schoolOptions.getRegistrationSchoolLevelFromGrade("고 2"), "high")
  assert.equal(schoolOptions.getRegistrationSchoolLevelFromGrade(""), null)
  assert.equal(schoolOptions.getRegistrationSchoolLevelFromGrade("중4"), null)
})

test("every configured school-category alias normalizes to its canonical level", () => {
  for (const alias of ["elementary", "elem", "primary", "초등"]) {
    assert.equal(schoolOptions.normalizeRegistrationSchoolLevel(alias), "elementary")
  }
  for (const alias of ["middle", "mid", "secondary", "중등"]) {
    assert.equal(schoolOptions.normalizeRegistrationSchoolLevel(alias), "middle")
  }
  for (const alias of ["high", "highschool", "고등"]) {
    assert.equal(schoolOptions.normalizeRegistrationSchoolLevel(alias), "high")
  }
})

test("school choices are grade-scoped, sorted, and preserve only the current legacy value", () => {
  const schools = [
    { id: "h2", name: "한빛고", category: "highschool", sortOrder: 2 },
    { id: "m1", name: "가람중", category: "중등", sortOrder: 1 },
    { id: "h1", name: "가람고", category: "high", sortOrder: 1 },
    { id: "blank", name: "  ", category: "high", sortOrder: 0 },
  ]
  assert.deepEqual(
    schoolOptions.getRegistrationSchoolChoices({ schools, grade: "고1", currentSchoolName: "삭제된고" }),
    [
      { value: "가람고", label: "가람고", legacy: false },
      { value: "한빛고", label: "한빛고", legacy: false },
      { value: "삭제된고", label: "기존 입력 · 삭제된고", legacy: true },
    ],
  )
})

test("elementary 기타 remains an available choice for 초1", () => {
  assert.deepEqual(
    schoolOptions.getRegistrationSchoolChoices({
      schools: [{ id: "other", name: "기타", category: "elementary", sortOrder: 1 }],
      grade: "초1",
    }),
    [{ value: "기타", label: "기타", legacy: false }],
  )
})
