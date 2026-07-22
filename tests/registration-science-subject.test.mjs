import assert from "node:assert/strict"
import test from "node:test"

import { parseRegistrationSubjects } from "../src/features/tasks/registration-workflow.js"
import * as intakeWorkflow from "../src/features/tasks/registration-intake-workflow.ts"

const scienceCapabilities = [
  {
    subject: "영어",
    isActive: true,
    registrationCreateEnabled: true,
    gradeLevels: ["중3", "고1", "고2", "고3"],
    sortOrder: 10,
    defaultDirectorProfileId: null,
  },
  {
    subject: "수학",
    isActive: true,
    registrationCreateEnabled: true,
    gradeLevels: ["중3", "고1", "고2", "고3"],
    sortOrder: 20,
    defaultDirectorProfileId: null,
  },
  {
    subject: "과학",
    isActive: true,
    registrationCreateEnabled: true,
    gradeLevels: ["고1", "고2", "고3"],
    sortOrder: 30,
    defaultDirectorProfileId: "81000000-0000-4000-8000-000000000099",
  },
]

test("science subjects use registry order and keep an independent initial plan", () => {
  assert.deepEqual(parseRegistrationSubjects("과학, 영어, 수학"), ["영어", "수학", "과학"])
  assert.deepEqual(intakeWorkflow.createRegistrationInitialWorkflowDraft(["과학"]), {
    subjectPlans: { 과학: "inquiry" },
    levelTestScheduledAt: "",
    levelTestPlace: "",
    visitScheduledAt: "",
    visitPlace: "",
    directorOverrides: {},
  })
})

test("science-only and every mixed selection preserve ordered participants", () => {
  const combinations = [
    [["과학"], ["과학"]],
    [["과학", "영어"], ["영어", "과학"]],
    [["과학", "수학"], ["수학", "과학"]],
    [["과학", "수학", "영어"], ["영어", "수학", "과학"]],
  ]

  for (const [selected, expected] of combinations) {
    const draft = intakeWorkflow.createRegistrationInitialWorkflowDraft(selected)
    for (const subject of expected) {
      draft.subjectPlans[subject] = "direct_phone"
    }
    assert.deepEqual(
      intakeWorkflow.getRegistrationInitialWorkflowParticipants(draft, "direct_phone"),
      expected,
    )
  }
})

test("new science selection is high-school only while an existing science track stays visible", () => {
  assert.equal(typeof intakeWorkflow.getRegistrationSubjectPickerAvailability, "function")
  const high = intakeWorkflow.getRegistrationSubjectPickerAvailability({
    capabilities: scienceCapabilities,
    grade: "고1",
    selectedSubjects: [],
  })
  assert.deepEqual(high.options, ["영어", "수학", "과학"])
  assert.equal(high.disabledReasonBySubject.과학, undefined)

  const beforeGrade = intakeWorkflow.getRegistrationSubjectPickerAvailability({
    capabilities: scienceCapabilities,
    grade: "",
    selectedSubjects: [],
  })
  assert.equal(beforeGrade.disabledReasonBySubject.영어, undefined)
  assert.equal(beforeGrade.disabledReasonBySubject.수학, undefined)
  assert.match(beforeGrade.disabledReasonBySubject.과학, /학년/)

  const middle = intakeWorkflow.getRegistrationSubjectPickerAvailability({
    capabilities: scienceCapabilities,
    grade: "중3",
    selectedSubjects: [],
  })
  assert.deepEqual(middle.options, ["영어", "수학", "과학"])
  assert.match(middle.disabledReasonBySubject.과학, /고등|학년/)

  const compatibility = scienceCapabilities.map((row) => row.subject === "과학"
    ? { ...row, isActive: false, registrationCreateEnabled: false, defaultDirectorProfileId: null }
    : row)
  assert.deepEqual(intakeWorkflow.getRegistrationSubjectPickerAvailability({
    capabilities: compatibility,
    grade: "고1",
    selectedSubjects: [],
  }).options, ["영어", "수학"])
  assert.deepEqual(intakeWorkflow.getRegistrationSubjectPickerAvailability({
    capabilities: compatibility,
    grade: "고1",
    selectedSubjects: ["과학"],
  }).options, ["영어", "수학", "과학"])
})

test("downgrading the create grade immediately removes science plan and override", () => {
  const draft = {
    ...intakeWorkflow.createRegistrationInitialWorkflowDraft(["영어", "과학"]),
    subjectPlans: { 영어: "inquiry", 과학: "visit" },
    visitScheduledAt: "2026-07-30T14:00",
    visitPlace: "상담실",
    directorOverrides: { 과학: "science-director" },
  }
  assert.equal(typeof intakeWorkflow.reconcileRegistrationSubjectsForGrade, "function")
  const result = intakeWorkflow.reconcileRegistrationSubjectsForGrade({
    capabilities: scienceCapabilities,
    grade: "중3",
    subjects: ["영어", "과학"],
    draft,
  })

  assert.deepEqual(result.subjects, ["영어"])
  assert.deepEqual(result.removedSubjects, ["과학"])
  assert.match(result.removalReason, /과학.*고등|고등.*과학/)
  assert.deepEqual(result.draft, {
    subjectPlans: { 영어: "inquiry" },
    levelTestScheduledAt: "",
    levelTestPlace: "",
    visitScheduledAt: "",
    visitPlace: "",
    directorOverrides: {},
  })
})

test("science does not require a level-test appointment when its plan is inquiry", () => {
  const draft = intakeWorkflow.createRegistrationInitialWorkflowDraft(["과학"])
  assert.deepEqual(intakeWorkflow.normalizeRegistrationInitialWorkflow(draft, ["과학"]), {
    subjectPlans: { 과학: "inquiry" },
    levelTestAppointment: null,
    visitAppointment: null,
    directorOverrides: {},
  })
})
