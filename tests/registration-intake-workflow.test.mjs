import assert from "node:assert/strict"
import test from "node:test"

import {
  createRegistrationInitialWorkflowDraft,
  getRegistrationInitialPanelState,
  getRegistrationInitialWorkflowBlockers,
  getRegistrationInitialWorkflowParticipants,
  normalizeRegistrationInitialWorkflow,
  reconcileRegistrationInitialWorkflowDraft,
  setRegistrationInitialSubjectAction,
} from "../src/features/tasks/registration-intake-workflow.ts"

test("creates and reconciles one independent plan per selected subject", () => {
  const created = createRegistrationInitialWorkflowDraft(["수학", "영어", "수학"])

  assert.deepEqual(created, {
    subjectPlans: { 영어: "inquiry", 수학: "inquiry" },
    levelTestScheduledAt: "",
    levelTestPlace: "",
    visitScheduledAt: "",
    visitPlace: "",
    directorOverrides: {},
  })

  const routed = setRegistrationInitialSubjectAction(created, "수학", "direct_phone")
  const reconciled = reconcileRegistrationInitialWorkflowDraft(routed, ["영어"])

  assert.deepEqual(reconciled.subjectPlans, { 영어: "inquiry" })
  assert.deepEqual(reconciled.directorOverrides, {})
})

test("derives ordered participants and relevant panels from subject plans", () => {
  const draft = {
    ...createRegistrationInitialWorkflowDraft(["영어", "수학"]),
    subjectPlans: { 수학: "direct_phone", 영어: "level_test" },
  }

  assert.deepEqual(getRegistrationInitialWorkflowParticipants(draft, "level_test"), ["영어"])
  assert.deepEqual(getRegistrationInitialWorkflowParticipants(draft, "direct_phone"), ["수학"])
  assert.deepEqual(getRegistrationInitialPanelState(draft), {
    levelTest: true,
    consultation: true,
  })

  const inquiryOnly = createRegistrationInitialWorkflowDraft(["영어"])
  assert.deepEqual(getRegistrationInitialPanelState(inquiryOnly), {
    levelTest: false,
    consultation: false,
  })
})

test("clears a shared appointment draft only after its last participant leaves", () => {
  const sharedLevelTest = {
    ...createRegistrationInitialWorkflowDraft(["영어", "수학"]),
    subjectPlans: { 영어: "level_test", 수학: "level_test" },
    levelTestScheduledAt: "2026-07-14T10:00",
    levelTestPlace: "본관",
  }

  const oneLevelTestParticipant = setRegistrationInitialSubjectAction(sharedLevelTest, "영어", "inquiry")
  assert.equal(oneLevelTestParticipant.levelTestScheduledAt, "2026-07-14T10:00")
  assert.equal(oneLevelTestParticipant.levelTestPlace, "본관")

  const noLevelTestParticipants = setRegistrationInitialSubjectAction(oneLevelTestParticipant, "수학", "visit")
  assert.equal(noLevelTestParticipants.levelTestScheduledAt, "")
  assert.equal(noLevelTestParticipants.levelTestPlace, "")

  const sharedVisit = {
    ...createRegistrationInitialWorkflowDraft(["영어", "수학"]),
    subjectPlans: { 영어: "visit", 수학: "visit" },
    visitScheduledAt: "2026-07-15T11:00",
    visitPlace: "상담실 1",
  }
  const oneVisitParticipant = setRegistrationInitialSubjectAction(sharedVisit, "수학", "direct_phone")
  assert.equal(oneVisitParticipant.visitScheduledAt, "2026-07-15T11:00")
  assert.equal(oneVisitParticipant.visitPlace, "상담실 1")

  const noVisitParticipants = setRegistrationInitialSubjectAction(oneVisitParticipant, "영어", "inquiry")
  assert.equal(noVisitParticipants.visitScheduledAt, "")
  assert.equal(noVisitParticipants.visitPlace, "")
})

test("reconciliation clears an appointment only when selection removes its last participant", () => {
  const draft = {
    ...createRegistrationInitialWorkflowDraft(["영어", "수학"]),
    subjectPlans: { 영어: "level_test", 수학: "inquiry" },
    levelTestScheduledAt: "2026-07-14T10:00",
    levelTestPlace: "본관",
    directorOverrides: { 영어: "director-eng", 수학: "director-math" },
  }

  const retained = reconcileRegistrationInitialWorkflowDraft(draft, ["영어"])
  assert.equal(retained.levelTestScheduledAt, "2026-07-14T10:00")
  assert.equal(retained.levelTestPlace, "본관")
  assert.deepEqual(retained.directorOverrides, { 영어: "director-eng" })

  const removed = reconcileRegistrationInitialWorkflowDraft(draft, ["수학"])
  assert.equal(removed.levelTestScheduledAt, "")
  assert.equal(removed.levelTestPlace, "")
  assert.deepEqual(removed.directorOverrides, { 수학: "director-math" })
})

test("normalizes ordered payload membership, places, and explicit director overrides", () => {
  const draft = {
    ...createRegistrationInitialWorkflowDraft(["영어", "수학"]),
    subjectPlans: { 수학: "visit", 영어: "level_test" },
    levelTestScheduledAt: "2026-07-14T10:00",
    levelTestPlace: "  본관  ",
    visitScheduledAt: "2026-07-15T11:00",
    visitPlace: "  상담실 1  ",
    directorOverrides: { 수학: "  director-math  ", 영어: "   " },
    levelTestAppointment: { subjects: ["수학"] },
    visitAppointment: { subjects: ["영어"] },
  }

  assert.deepEqual(normalizeRegistrationInitialWorkflow(draft, ["수학", "영어"]), {
    subjectPlans: { 영어: "level_test", 수학: "visit" },
    levelTestAppointment: {
      scheduledAt: "2026-07-14T10:00",
      place: "본관",
      subjects: ["영어"],
    },
    visitAppointment: {
      scheduledAt: "2026-07-15T11:00",
      place: "상담실 1",
      subjects: ["수학"],
    },
    directorOverrides: { 수학: "director-math" },
  })
})

test("normalization rejects missing, extraneous, or invalid subject plans", () => {
  const base = createRegistrationInitialWorkflowDraft(["영어", "수학"])

  assert.throws(
    () => normalizeRegistrationInitialWorkflow({ ...base, subjectPlans: { 영어: "inquiry" } }, ["영어", "수학"]),
    /registration_initial_subject_plan_invalid/,
  )
  assert.throws(
    () => normalizeRegistrationInitialWorkflow(base, ["영어"]),
    /registration_initial_subject_plan_invalid/,
  )
  assert.throws(
    () => normalizeRegistrationInitialWorkflow({ ...base, subjectPlans: { 영어: "unknown", 수학: "inquiry" } }, ["영어", "수학"]),
    /registration_initial_subject_plan_invalid/,
  )
})

test("reports plan, appointment, and subject-specific director blockers", () => {
  const missingPlan = {
    ...createRegistrationInitialWorkflowDraft(["영어", "수학"]),
    subjectPlans: { 영어: "level_test", 수학: "visit", 과학: "inquiry" },
  }

  assert.deepEqual(
    getRegistrationInitialWorkflowBlockers(missingPlan, ["수학", "영어"], { 수학: "   " }),
    [
      "과목별 다음 업무",
      "레벨테스트 예약일시",
      "레벨테스트 장소",
      "수학 상담 책임자",
      "방문상담 예약일시",
      "방문상담실",
    ],
  )

  const ready = {
    ...missingPlan,
    subjectPlans: { 영어: "direct_phone", 수학: "visit" },
    visitScheduledAt: "2026-07-15T11:00",
    visitPlace: " 상담실 1 ",
    directorOverrides: { 수학: " director-math " },
  }
  assert.deepEqual(
    getRegistrationInitialWorkflowBlockers(ready, ["영어", "수학"], { 영어: " director-eng " }),
    [],
  )
})
