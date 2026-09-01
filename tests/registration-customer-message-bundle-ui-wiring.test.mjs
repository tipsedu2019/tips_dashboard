import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const appointmentEditorUrl = new URL("../src/features/tasks/registration-appointment-editor.tsx", import.meta.url)
const observationEditorUrl = new URL("../src/features/tasks/registration-observation-editor.tsx", import.meta.url)

test("reservation message buttons use only the saved single-source reservation IDs", async () => {
  const [appointmentEditor, observationEditor] = await Promise.all([
    readFile(appointmentEditorUrl, "utf8"),
    readFile(observationEditorUrl, "utf8"),
  ])

  assert.match(appointmentEditor, /kind === "level_test" \? "level_test_booking" : "visit_consultation_booking"/u)
  assert.match(appointmentEditor, /sourceId: appointment\.id,/u)
  assert.doesNotMatch(appointmentEditor, /booking_bundle/u)
  assert.match(observationEditor, /messageKind: "observation_booking", sourceId: current\.observationId/u)
  assert.match(observationEditor, /messageKind: "observation_booking",\s*sourceId: savedObservation\.observationId/u)
  assert.doesNotMatch(observationEditor, /booking_bundle/u)
})
