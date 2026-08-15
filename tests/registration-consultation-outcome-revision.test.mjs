import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import { getRegistrationConsultationOutcomeSaveState } from "../src/features/tasks/registration-track-model.js"

test("five consultation outcomes are editable with conditional waiting requirements", () => {
  for (const outcome of ["undecided", "waiting", "observation", "enrollment", "not_registered"]) {
    const state = getRegistrationConsultationOutcomeSaveState({
      savedOutcome: "",
      draftOutcome: outcome,
      savedNote: "",
      draftNote: "",
      waitingKind: outcome === "waiting" ? "next_term_opening" : "",
      classId: "",
      canEdit: true,
    })
    assert.equal(state.canSave, true, outcome)
  }
  assert.deepEqual(getRegistrationConsultationOutcomeSaveState({
    draftOutcome: "waiting", canEdit: true,
  }).blockers, ["대기 유형"])
  assert.deepEqual(getRegistrationConsultationOutcomeSaveState({
    draftOutcome: "waiting", waitingKind: "current_class", canEdit: true,
  }).blockers, ["대기 반"])
})

test("completed consultation note-only correction remains dirty for its owner", () => {
  const state = getRegistrationConsultationOutcomeSaveState({
    savedOutcome: "enrollment",
    draftOutcome: "enrollment",
    savedNote: "기존",
    draftNote: "수정",
    canEdit: true,
  })
  assert.equal(state.dirty, true)
  assert.equal(state.canSave, true)
})

test("consultation revision migration and editor expose the five-result contract", async () => {
  const migration = await readFile(new URL("../supabase/migrations/20260815122000_registration_consultation_outcome_revision.sql", import.meta.url), "utf8")
  const editor = await readFile(new URL("../src/features/tasks/registration-application-track-actions.tsx", import.meta.url), "utf8")
  assert.match(migration, /outcome in \('undecided', 'waiting', 'observation', 'enrollment', 'not_registered'\)/i)
  assert.match(migration, /save_registration_consultation_result_v2/i)
  assert.match(migration, /registration_observation_transition_requires_action/i)
  assert.match(migration, /apply_student_class_roster_mode[\s\S]*registration_waiting_promoted/i)
  const options = editor.slice(editor.indexOf("const CONSULTATION_OUTCOME_OPTIONS"), editor.indexOf("] as const", editor.indexOf("const CONSULTATION_OUTCOME_OPTIONS")))
  assert.deepEqual([...options.matchAll(/label: "(미정|대기|청강|등록|미등록)"/g)].map((match) => match[1]), ["미정", "대기", "청강", "등록", "미등록"])
})
