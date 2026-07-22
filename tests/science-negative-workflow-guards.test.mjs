import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { subjectSupports } from "../src/lib/academic-subject-registry.ts"

const taskWorkspaceSource = readFileSync("src/features/tasks/ops-task-workspace.tsx", "utf8")
const approvalWorkspaceSource = readFileSync("src/features/approvals/approval-workspace.tsx", "utf8")

test("science has no word-retest or monthly-approval capability", () => {
  assert.equal(subjectSupports("과학", "word_retest"), false)
  assert.equal(subjectSupports("science", "word_retest"), false)
  assert.equal(subjectSupports("과학", "monthly_approval"), false)
  assert.equal(subjectSupports("science", "monthly_approval"), false)
})

test("word-retest class and teacher options never fall back to science resources", () => {
  assert.match(
    taskWorkspaceSource,
    /function isWordRetestClassOption[\s\S]*subjectSupports\(canonicalSubject, "word_retest"\)/,
  )
  assert.match(
    taskWorkspaceSource,
    /const baseClasses = classes\.filter\(isWordRetestClassOption\)/,
  )
  assert.match(
    taskWorkspaceSource,
    /const selectedClass = baseClasses\.find\(\(classItem\) => classItem\.id === selectedClassId\)/,
  )
  assert.doesNotMatch(taskWorkspaceSource, /englishClasses\.length > 0 \? englishClasses : classes/)
  assert.match(
    taskWorkspaceSource,
    /const baseTeachers = teachers\.filter\(isWordRetestTeacherOption\)/,
  )
  assert.doesNotMatch(taskWorkspaceSource, /englishTeachers\.length > 0 \? englishTeachers : teachers/)
})

test("word-retest textbooks reject canonical subjects without the capability", () => {
  assert.match(
    taskWorkspaceSource,
    /function isWordRetestTextbookOption[\s\S]*canonicalSubject[\s\S]*subjectSupports\(canonicalSubject, "word_retest"\)/,
  )
})

test("monthly approval templates remain English and math only", () => {
  assert.match(approvalWorkspaceSource, /english_monthly/)
  assert.match(approvalWorkspaceSource, /math_monthly/)
  assert.doesNotMatch(approvalWorkspaceSource, /science_monthly|과학 월간 보고서|subject:\s*"science"/)
})
