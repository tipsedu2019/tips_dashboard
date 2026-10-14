import assert from "node:assert/strict"
import { access, readFile } from "node:fs/promises"
import test from "node:test"

const root = new URL("../", import.meta.url)
const pageUrl = new URL(
  "src/app/admin/registration/observations/[observationId]/feedback/page.tsx",
  root,
)
const teacherFeedbackUrl = new URL(
  "src/features/tasks/registration-observation-teacher-feedback.tsx",
  root,
)
const workspaceUrl = new URL("src/features/tasks/ops-task-workspace.tsx", root)
const trackEditorUrl = new URL("src/features/tasks/registration-track-editor.tsx", root)
const feedbackPanelUrl = new URL(
  "src/features/tasks/registration-observation-feedback-panel.tsx",
  root,
)

test("retired teacher feedback deep link route is removed", async () => {
  await assert.rejects(access(pageUrl))
})

test("teacher feedback form implementation is removed", async () => {
  await assert.rejects(access(teacherFeedbackUrl))
})

test("ops tasks no longer recognize or link the retired feedback marker", async () => {
  const source = await readFile(workspaceUrl, "utf8")

  assert.doesNotMatch(source, /registrationObservationFeedbackId/)
  assert.doesNotMatch(source, /isRegistrationObservationFeedbackTask/)
  assert.doesNotMatch(source, /registration_observation_feedback:/)
  assert.doesNotMatch(source, /observations\/\$\{observationId\}\/feedback/)
  assert.doesNotMatch(source, /피드백 작성/)
})

test("registration workspace retains historical facts without teacher, attendance, or director write UI", async () => {
  const [trackEditor, feedbackPanel] = await Promise.all([
    readFile(trackEditorUrl, "utf8"),
    readFile(feedbackPanelUrl, "utf8"),
  ])

  assert.doesNotMatch(trackEditor, /submitRegistrationObservationFeedback/)
  assert.doesNotMatch(trackEditor, /correctRegistrationObservationFeedback/)
  assert.doesNotMatch(trackEditor, /canRecordAttendance=|canDecide=|recordRegistrationObservationAttendance|decideRegistrationObservation/)
  assert.match(trackEditor, /<RegistrationObservationFeedbackPanel/)
  assert.match(trackEditor, /loadRegistrationObservationFeedback/)
  assert.doesNotMatch(feedbackPanel, /submitRegistrationObservationFeedback/)
  assert.doesNotMatch(feedbackPanel, /correctRegistrationObservationFeedback/)
  assert.doesNotMatch(feedbackPanel, /canEditFeedback/)
  assert.doesNotMatch(feedbackPanel, /recordRegistrationObservationAttendance|decideRegistrationObservation|canRecordAttendance|canDecide/)
  assert.doesNotMatch(feedbackPanel, /Google Chat|<Button|<RegistrationSelect|<Textarea/)
  assert.match(feedbackPanel, /기존 청강 이력/)
  assert.match(feedbackPanel, /detail\.feedbackReason/)
  assert.match(feedbackPanel, /detail\.attendance/)
  assert.match(feedbackPanel, /detail\.decisionKind/)
})
