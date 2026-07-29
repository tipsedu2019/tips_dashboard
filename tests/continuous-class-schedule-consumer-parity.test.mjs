import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import { buildDashboardMetrics } from "../src/features/dashboard/metrics.js"

test("dashboard conflict reader uses normalized lesson sessions including two sessions on one date", () => {
  const metrics = buildDashboardMetrics({
    classes: [{
      id: "class-1", name: "영어 A", subject: "영어", status: "수강",
      scheduleStorageMode: "normalized",
      lessonSessions: [
        { id: "session-1", date: "2026-08-03", scheduleState: "active" },
        { id: "session-2", date: "2026-08-03", scheduleState: "makeup" },
      ],
      studentIds: ["student-1"],
    }],
    students: [{ id: "student-1", name: "학생", school: "학교", grade: "고1" }],
    academicSchools: [],
    academicEventExamDetails: [],
    academicEvents: [],
    academicExamDays: [{ school: "학교", grade: "고1", examDate: "2026-08-03", subject: "영어" }],
  })

  assert.equal(metrics.examConflicts[0]?.conflicts[0]?.sessionDate, "2026-08-03")
})

test("public classes payload keeps the compatibility schedule JSON and never reads normalized sessions", async () => {
  const source = await readFile(new URL("../src/server/public-classes-payload.js", import.meta.url), "utf8")
  assert.match(source, /schedulePlan: row\.schedule_plan/)
  assert.doesNotMatch(source, /class_lesson_sessions|lessonSessions/)
})
