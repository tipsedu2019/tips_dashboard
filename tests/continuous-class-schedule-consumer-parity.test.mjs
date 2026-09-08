import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import { buildDashboardMetrics } from "../src/features/dashboard/metrics.js"
import { buildPublicClassesPayload } from "../src/server/public-classes-payload.js"
import { createPublicClassesApiResponder } from "../src/server/public-classes-api.js"
import { progressForSession, sessionDisplay, sessionState } from "../src/components/public/classes/helpers.ts"

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

test("public API preserves materialized calendar and progress without private planner data or normalized-session reads", async () => {
  const privateCanary = "PRIVATE_STUDENT_AND_STAFF_DATA"
  const rows = {
    classes: [{
      id: "class-1", name: "공개 영어", subject: "영어", status: "수강",
      teacher: "정규 선생님", room: "1강의실", schedule: "월 17:00-18:00",
      student_ids: [privateCanary], waitlist_ids: [privateCanary], textbook_ids: ["book-1"],
      lessonSessions: [{ id: privateCanary, date: "2030-01-01" }],
      schedule_plan: {
        version: 2, history: [{ memo: privateCanary }],
        sessionStates: { "2026-09-07": { memo: privateCanary } },
        billingPeriods: [{
          id: "period-1", label: "9월", startDate: "2026-09-01", endDate: "2026-09-30",
          totalSessions: 99, memo: privateCanary,
        }],
        textbooks: [{ textbookId: "book-1", alias: "공개 교재", teacherNote: privateCanary }],
        sessions: [
          { id: "regular", date: "2026-09-07", scheduleState: "active", sessionNumber: 1, billingId: "period-1", memo: privateCanary },
          {
            id: "makeup", sessionKey: "materialized-makeup-key", date: "2026-09-07",
            state: "makeup", sessionNumber: 2, billing_id: "period-1", billing_label: "9월",
            originalDate: "2026-09-05", makeupDate: "2026-09-07",
            startTime: "19:00", endTime: "20:00", teacherName: "보강 선생님", classroomName: "2강의실",
            publicNote: "보강 안내", teacherNote: privateCanary, studentIds: [privateCanary],
            textbookEntries: [{
              textbookId: "book-1", plan: { start: "5", end: "10", memo: privateCanary },
              actual: { start: "5", end: "9", publicNote: "공개 진도", teacherNote: privateCanary },
            }],
          },
          { id: "cancelled", date: "2026-09-14", state: "cancelled", billing_id: "period-1", publicNote: "휴강 안내", memo: privateCanary },
        ],
      },
    }],
    textbooks: [{ id: "book-1", title: "공개 교재", lessons: [{ id: "lesson-1", title: "공개 단원", teacherNote: privateCanary }] }],
    progress_logs: [
      { id: "progress-regular", class_id: "class-1", textbook_id: "book-1", session_id: "regular", status: "done", range_label: "1~4쪽", teacher_note: privateCanary },
      { id: "progress-makeup", class_id: "class-1", textbook_id: "book-1", session_id: "materialized-makeup-key", status: "done", range_label: "5~9쪽", public_note: "공개 진도", teacher_note: privateCanary },
    ],
  }
  const before = structuredClone(rows)
  const queries = []
  const supabaseClient = {
    from(table) {
      assert.ok(Object.hasOwn(rows, table), `unexpected public source: ${table}`)
      const query = { table }
      queries.push(query)
      return {
        select(columns) { query.columns = columns; return this },
        abortSignal(signal) { query.signal = signal; return this },
        retry(enabled) { query.retry = enabled; return Promise.resolve({ data: rows[table], error: null }) },
      }
    },
  }
  const built = await buildPublicClassesPayload({ env: {}, supabaseClient })
  assert.equal(built.source, "supabase")
  assert.deepEqual(queries.map((query) => query.table), ["classes", "textbooks", "progress_logs"])
  assert.ok(queries.every((query) => query.signal instanceof AbortSignal && query.retry === false))
  assert.ok(queries[0].columns.split(",").includes("schedule_plan"))
  assert.ok(!queries[0].columns.includes("lesson_sessions"))
  assert.ok(!JSON.stringify(built).includes(privateCanary), "the builder itself must redact private planner data")

  const response = await createPublicClassesApiResponder(async () => built)()
  assert.equal(response.status, 200)
  assert.ok(!response.body.includes(privateCanary), "cached/API normalization must preserve the privacy boundary")
  assert.doesNotMatch(response.body, /"(?:schedule_plan|lessonSessions|student_ids|studentIds|waitlist_ids|history|sessionStates|memo|teacherNote|teacher_note)"/)
  const payload = JSON.parse(response.body)
  const item = payload.classes[0]
  const [regular, makeup, cancelled] = item.schedulePlan.sessions
  assert.deepEqual(item.schedulePlan.sessions.map((session) => [session.id, session.date]), [
    ["regular", "2026-09-07"], ["makeup", "2026-09-07"], ["cancelled", "2026-09-14"],
  ])
  assert.equal(item.enrolledCount, 1)
  assert.equal(item.waitlistCount, 1)
  assert.equal(item.schedulePlan.billingPeriods[0].sessionCount, 2, "only recorded active and makeup sessions count")
  assert.deepEqual(sessionDisplay(item, regular), { time: "17:00–18:00", regularFallback: true, teacher: "정규 선생님", room: "1강의실" })
  assert.deepEqual(sessionDisplay(item, makeup), { time: "19:00–20:00", regularFallback: false, teacher: "보강 선생님", room: "2강의실" })
  assert.deepEqual(sessionState(makeup), { label: "보강", cancelled: false })
  assert.deepEqual(sessionState(cancelled), { label: "휴강", cancelled: true })
  assert.equal(makeup.originalDate, "2026-09-05")
  assert.equal(makeup.makeupDate, "2026-09-07")
  assert.equal(makeup.publicNote, "보강 안내")
  assert.equal(cancelled.publicNote, "휴강 안내")
  assert.equal(makeup.textbookEntries[0].plan.end, "10")
  assert.equal(makeup.textbookEntries[0].actual.end, "9")
  assert.equal(payload.textbooks[0].lessons[0].title, "공개 단원")
  assert.equal(progressForSession(payload.progressLogs, regular, item.schedulePlan.sessions).get("book-1").rangeLabel, "1~4쪽")
  assert.equal(progressForSession(payload.progressLogs, makeup, item.schedulePlan.sessions).get("book-1").rangeLabel, "5~9쪽")
  assert.deepEqual(rows, before, "public projection must not mutate the internal planner source")
})

test("academic active modes no longer share a table fan-out loader", async () => {
  const source = await readFile(
    new URL("../src/features/academic/use-academic-workspace-data.ts", import.meta.url),
    "utf8",
  )
  assert.match(source, /createAcademicReadService/)
  assert.match(source, /AcademicWorkspaceRequest/)
  assert.doesNotMatch(source, /\.from\(|select\("\*"\)|readTable\(/)
  assert.doesNotMatch(source, /Promise\.all\(/)
})
