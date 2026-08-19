import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const appointmentEditorUrl = new URL("../src/features/tasks/registration-appointment-editor.tsx", import.meta.url)
const observationEditorUrl = new URL("../src/features/tasks/registration-observation-editor.tsx", import.meta.url)

test("reservation message buttons use the task-scoped bundle targets", async () => {
  const [appointmentEditor, observationEditor] = await Promise.all([
    readFile(appointmentEditorUrl, "utf8"),
    readFile(observationEditorUrl, "utf8"),
  ])

  assert.match(appointmentEditor, /kind === "level_test" \? "level_test_booking_bundle" : "visit_consultation_booking_bundle"/u)
  assert.match(appointmentEditor, /sourceId: taskId,/u)
  assert.match(observationEditor, /messageKind: "observation_booking_bundle", sourceId: detail\.track\.taskId/u)
})
