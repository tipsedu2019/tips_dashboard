import assert from "node:assert/strict"
import test from "node:test"

import {
  createRegistrationCreateAttempt,
  createRegistrationInitialWorkflowDraft,
  getRegistrationInitialPanelState,
  getRegistrationInitialWorkflowBlockers,
  getRegistrationInitialWorkflowParticipants,
  normalizeRegistrationInitialWorkflow,
  probeRegistrationInitialPersistence,
  reconcileRegistrationInitialWorkflowDraft,
  resolveRegistrationInitialPersistenceMode,
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

test("direct phone normalization creates no appointments or legacy scheduling fields", () => {
  const draft = {
    ...createRegistrationInitialWorkflowDraft(["영어"]),
    subjectPlans: { 영어: "direct_phone" },
    directorOverrides: { 영어: "director-english" },
  }

  const payload = normalizeRegistrationInitialWorkflow(draft, ["영어"])

  assert.equal(payload.levelTestAppointment, null)
  assert.equal(payload.visitAppointment, null)
  assert.equal("phoneConsultationAt" in payload, false)
  assert.equal("levelTestMaterialLink" in payload, false)
})

test("resolves every confirmed two-runtime persistence matrix path without guessing", () => {
  const intakeReady = { available: true, version: 1 }
  const intakeMissing = { available: false, version: 0 }

  assert.equal(resolveRegistrationInitialPersistenceMode({ mode: "maintenance", version: 0 }, intakeReady), "blocked_maintenance")
  assert.equal(resolveRegistrationInitialPersistenceMode({ mode: "ready", version: 1 }, intakeReady), "ready_atomic")
  assert.equal(resolveRegistrationInitialPersistenceMode({ mode: "ready", version: 1 }, intakeMissing), "canonical_inquiry")
  assert.equal(resolveRegistrationInitialPersistenceMode({ mode: "legacy", version: 0 }, intakeMissing), "legacy_inquiry")
  assert.equal(resolveRegistrationInitialPersistenceMode({ mode: "legacy", version: 0 }, intakeReady), "blocked_mismatch")
  assert.equal(resolveRegistrationInitialPersistenceMode({ mode: "ready", version: 1 }, { available: true, version: 2 }), "blocked_mismatch")
  assert.equal(resolveRegistrationInitialPersistenceMode({ mode: "ready", version: 1 }, { available: false, version: 1 }), "blocked_mismatch")
})

test("probe rejection and timeout are indeterminate and select no writer", async () => {
  const rejected = new Error("permission denied")
  const rejectedResult = await probeRegistrationInitialPersistence({
    probeSubjectRuntime: async () => { throw rejected },
    probeIntakeRuntime: async () => ({ available: true, version: 1 }),
    timeoutMs: 20,
  })
  assert.equal(rejectedResult.mode, "blocked_indeterminate")
  assert.strictEqual(rejectedResult.error, rejected)

  const timeoutResult = await probeRegistrationInitialPersistence({
    probeSubjectRuntime: () => new Promise(() => {}),
    probeIntakeRuntime: async () => ({ available: true, version: 1 }),
    timeoutMs: 5,
  })
  assert.equal(timeoutResult.mode, "blocked_indeterminate")
  assert.match(String(timeoutResult.error), /registration_runtime_probe_timeout/)
})

test("one logical registration retry freezes its full attempt envelope", () => {
  const normalizedInitialWorkflow = normalizeRegistrationInitialWorkflow({
    ...createRegistrationInitialWorkflowDraft(["영어", "수학"]),
    subjectPlans: { 영어: "direct_phone", 수학: "visit" },
    visitScheduledAt: "2026-07-20T10:00",
    visitPlace: "상담실 1",
    directorOverrides: { 영어: "director-english", 수학: "director-math" },
  }, ["영어", "수학"])
  const common = {
    studentName: " 김다미 ", schoolGrade: "고1", schoolName: "중앙고",
    parentPhone: "01012345678", studentPhone: "", campus: "본관",
    inquiryAt: "", subjects: ["수학", "영어"], requestNote: " 방문 요청 ", priority: "high",
  }
  let requestSequence = 0
  let inquirySequence = 0
  const first = createRegistrationCreateAttempt(null, common, normalizedInitialWorkflow, {
    createRequestKey: () => `request-${++requestSequence}`,
    createInquiryAt: () => `2026-07-16T0${++inquirySequence}:00:00Z`,
  })
  const retry = createRegistrationCreateAttempt(first, { ...common }, structuredClone(normalizedInitialWorkflow), {
    createRequestKey: () => `request-${++requestSequence}`,
    createInquiryAt: () => `2026-07-16T0${++inquirySequence}:00:00Z`,
  })

  assert.strictEqual(retry, first)
  assert.equal(retry.requestKey, "request-1")
  assert.equal(retry.inquiryAt, "2026-07-16T01:00:00Z")
  assert.deepEqual(retry.normalizedInitialWorkflow, normalizedInitialWorkflow)

  for (const changed of [
    { common: { ...common, studentName: "김다미2" }, workflow: normalizedInitialWorkflow },
    { common, workflow: { ...normalizedInitialWorkflow, subjectPlans: { 영어: "inquiry", 수학: "visit" } } },
    { common, workflow: { ...normalizedInitialWorkflow, visitAppointment: { ...normalizedInitialWorkflow.visitAppointment, scheduledAt: "2026-07-21T10:00" } } },
    { common, workflow: { ...normalizedInitialWorkflow, visitAppointment: { ...normalizedInitialWorkflow.visitAppointment, place: "상담실 2" } } },
    { common, workflow: { ...normalizedInitialWorkflow, directorOverrides: { ...normalizedInitialWorkflow.directorOverrides, 수학: "director-math-2" } } },
  ]) {
    const rotated = createRegistrationCreateAttempt(first, changed.common, changed.workflow, {
      createRequestKey: () => `request-${++requestSequence}`,
      createInquiryAt: () => `2026-07-16T0${++inquirySequence}:00:00Z`,
    })
    assert.notEqual(rotated.requestKey, first.requestKey)
    assert.notEqual(rotated.inquiryAt, first.inquiryAt)
    assert.notEqual(rotated.fingerprint, first.fingerprint)
  }
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
