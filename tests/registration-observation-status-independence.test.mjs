import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const trackEditorUrl = new URL(
  "../src/features/tasks/registration-track-editor.tsx",
  import.meta.url,
)
const observationEditorUrl = new URL(
  "../src/features/tasks/registration-observation-editor.tsx",
  import.meta.url,
)
const migrationUrl = new URL(
  "../supabase/migrations/20260901110300_registration_observation_status_independence.sql",
  import.meta.url,
)

test("opening and editing observation data never changes the manual status property", async () => {
  const [trackEditor, observationEditor] = await Promise.all([
    readFile(trackEditorUrl, "utf8"),
    readFile(observationEditorUrl, "utf8"),
  ])

  assert.doesNotMatch(trackEditor, /canStartRegistrationObservation/u)
  assert.doesNotMatch(trackEditor, /enterRegistrationObservation\(/u)
  assert.doesNotMatch(trackEditor, /changeObservationWorkflowStatus/u)
  assert.doesNotMatch(trackEditor, /청강 예약 필요를 선택/u)
  assert.doesNotMatch(observationEditor, /async function enter\(/u)
  assert.doesNotMatch(observationEditor, /actions\.enterRegistrationObservation/u)
})

test("observation booking availability derives from booking facts, not workflow status", async () => {
  const source = await readFile(observationEditorUrl, "utf8")

  assert.match(
    source,
    /const canBook = !deepLinkedAttempt[\s\S]*?current\.status === "scheduled"/u,
  )
  assert.doesNotMatch(source, /const canBook = workflowStatus/u)
  assert.doesNotMatch(source, /const readOnly = workflowStatus/u)
  assert.match(source, /청강할 반을 선택하세요/u)
  assert.match(source, /청강 예약 저장/u)
})

test("the observation workspace is available to an authorized writer even before an attempt exists", async () => {
  const source = await readFile(trackEditorUrl, "utf8")

  assert.match(
    source,
    /canLoadRegistrationObservationWorkspace\(\{[\s\S]*?runtimeAvailable:[\s\S]*?observationSummaryVisible: true/u,
  )
  assert.match(source, /canManageActiveObservation && observationWorkspaceAvailable/u)
})

test("the legacy withdrawal RPC cannot mutate the manual status property", async () => {
  const source = await readFile(migrationUrl, "utf8")

  assert.match(source, /registration_observation_withdraw_retired/u)
  assert.match(source, /errcode = '55000'/u)
  assert.match(
    source,
    /revoke all on function public\.withdraw_registration_observation_v1\([\s\S]*?from public, anon, authenticated, service_role/u,
  )
  assert.doesNotMatch(
    source,
    /grant execute on function public\.withdraw_registration_observation_v1/u,
  )
})
