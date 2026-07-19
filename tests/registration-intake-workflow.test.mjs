import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import test from "node:test"

import {
  assertRegistrationCreateAttemptPersistenceMode,
  createRegistrationCreateAttempt,
  createRegistrationInitialWorkflowDraft,
  getRegistrationInitialPanelState,
  getRegistrationInitialWorkflowBlockers,
  getRegistrationInitialWorkflowParticipants,
  markRegistrationLegacyCreateStarted,
  normalizeRegistrationInitialWorkflow,
  probeRegistrationInitialPersistence,
  reconcileRegistrationInitialWorkflowCapabilities,
  reconcileRegistrationInitialWorkflowDraft,
  resolveRegistrationInitialPersistenceMode,
  setRegistrationInitialSubjectAction,
  toRegistrationScheduledAtIso,
} from "../src/features/tasks/registration-intake-workflow.ts"

test("ready-atomic capability preserves all four initial routes", () => {
  const allowed = ["inquiry", "direct_phone", "level_test", "visit"]

  for (const action of allowed) {
    const draft = {
      ...createRegistrationInitialWorkflowDraft(["영어"]),
      subjectPlans: { 영어: action },
      levelTestScheduledAt: action === "level_test" ? "2026-07-20T10:00" : "",
      levelTestPlace: action === "level_test" ? "본관" : "",
      visitScheduledAt: action === "visit" ? "2026-07-21T11:00" : "",
      visitPlace: action === "visit" ? "상담실 1" : "",
      directorOverrides: action === "direct_phone" || action === "visit"
        ? { 영어: "director-english" }
        : {},
    }

    assert.deepEqual(
      reconcileRegistrationInitialWorkflowCapabilities(draft, allowed),
      draft,
      action,
    )
  }
})

test("inquiry-only capability removes stale routes, appointments, and director overrides", () => {
  const staleDrafts = [
    {
      ...createRegistrationInitialWorkflowDraft(["영어", "수학"]),
      subjectPlans: { 영어: "direct_phone", 수학: "inquiry" },
      directorOverrides: { 영어: "director-english" },
    },
    {
      ...createRegistrationInitialWorkflowDraft(["영어", "수학"]),
      subjectPlans: { 영어: "level_test", 수학: "inquiry" },
      levelTestScheduledAt: "2026-07-20T10:00",
      levelTestPlace: "본관",
    },
    {
      ...createRegistrationInitialWorkflowDraft(["영어", "수학"]),
      subjectPlans: { 영어: "visit", 수학: "inquiry" },
      visitScheduledAt: "2026-07-21T11:00",
      visitPlace: "상담실 1",
      directorOverrides: { 영어: "director-english" },
    },
  ]

  for (const draft of staleDrafts) {
    const reconciled = reconcileRegistrationInitialWorkflowCapabilities(draft, ["inquiry"])
    assert.deepEqual(reconciled, {
      subjectPlans: { 영어: "inquiry", 수학: "inquiry" },
      levelTestScheduledAt: "",
      levelTestPlace: "",
      visitScheduledAt: "",
      visitPlace: "",
      directorOverrides: {},
    })
    assert.deepEqual(normalizeRegistrationInitialWorkflow(reconciled, ["영어", "수학"]), {
      subjectPlans: { 영어: "inquiry", 수학: "inquiry" },
      levelTestAppointment: null,
      visitAppointment: null,
      directorOverrides: {},
    })
  }
})

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

test("subject action transitions retain director overrides only for consultation work", () => {
  const draft = {
    ...createRegistrationInitialWorkflowDraft(["영어", "수학"]),
    subjectPlans: { 영어: "direct_phone", 수학: "visit" },
    directorOverrides: { 영어: "director-eng", 수학: "director-math" },
  }

  const levelTest = setRegistrationInitialSubjectAction(draft, "영어", "level_test")
  assert.deepEqual(levelTest.directorOverrides, { 수학: "director-math" })

  const inquiry = setRegistrationInitialSubjectAction(levelTest, "수학", "inquiry")
  assert.deepEqual(inquiry.directorOverrides, {})
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
  assert.deepEqual(retained.directorOverrides, {})

  const removed = reconcileRegistrationInitialWorkflowDraft(draft, ["수학"])
  assert.equal(removed.levelTestScheduledAt, "")
  assert.equal(removed.levelTestPlace, "")
  assert.deepEqual(removed.directorOverrides, {})
})

test("normalizes ordered payload membership, places, and explicit director overrides", () => {
  const draft = {
    ...createRegistrationInitialWorkflowDraft(["영어", "수학"]),
    subjectPlans: { 수학: "visit", 영어: "level_test" },
    levelTestScheduledAt: "2026-07-14T10:00",
    levelTestPlace: "  본관  ",
    visitScheduledAt: "2026-07-15T11:00",
    visitPlace: "  상담실 1  ",
    directorOverrides: { 수학: "  director-math  ", 영어: " should-be-filtered " },
    levelTestAppointment: { subjects: ["수학"] },
    visitAppointment: { subjects: ["영어"] },
  }

  assert.deepEqual(normalizeRegistrationInitialWorkflow(draft, ["수학", "영어"]), {
    subjectPlans: { 영어: "level_test", 수학: "visit" },
    levelTestAppointment: {
      scheduledAt: "2026-07-14T01:00:00.000Z",
      place: "본관",
      subjects: ["영어"],
    },
    visitAppointment: {
      scheduledAt: "2026-07-15T02:00:00.000Z",
      place: "상담실 1",
      subjects: ["수학"],
    },
    directorOverrides: { 수학: "director-math" },
  })
})

test("naive appointment values are converted from Asia/Seoul to exact instants independent of host timezone", () => {
  assert.equal(toRegistrationScheduledAtIso("2026-07-14T10:00"), "2026-07-14T01:00:00.000Z")
  assert.equal(toRegistrationScheduledAtIso("2026-07-14T10:00:30"), "2026-07-14T01:00:30.000Z")
  assert.equal(toRegistrationScheduledAtIso("2026-07-14T01:00:00Z"), "2026-07-14T01:00:00.000Z")
  assert.throws(() => toRegistrationScheduledAtIso("2026-02-30T10:00"), /registration_initial_appointment_datetime_invalid/)

  const moduleUrl = new URL("../src/features/tasks/registration-intake-workflow.ts", import.meta.url).href
  const script = `import { toRegistrationScheduledAtIso } from ${JSON.stringify(moduleUrl)}; process.stdout.write(toRegistrationScheduledAtIso("2026-07-14T10:00"));`
  for (const timezone of ["UTC", "America/Los_Angeles", "Asia/Seoul"]) {
    const child = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script], {
      env: { ...process.env, TZ: timezone },
      encoding: "utf8",
    })
    assert.equal(child.status, 0, child.stderr)
    assert.equal(child.stdout, "2026-07-14T01:00:00.000Z")
  }
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
    persistenceMode: "ready_atomic",
    createRequestKey: () => `request-${++requestSequence}`,
    createInquiryAt: () => `2026-07-16T0${++inquirySequence}:00:00Z`,
  })
  const retry = createRegistrationCreateAttempt(first, { ...common }, structuredClone(normalizedInitialWorkflow), {
    persistenceMode: "ready_atomic",
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
      persistenceMode: "ready_atomic",
      createRequestKey: () => `request-${++requestSequence}`,
      createInquiryAt: () => `2026-07-16T0${++inquirySequence}:00:00Z`,
    })
    assert.notEqual(rotated.requestKey, first.requestKey)
    assert.notEqual(rotated.inquiryAt, first.inquiryAt)
    assert.notEqual(rotated.fingerprint, first.fingerprint)
  }
})

test("one logical retry freezes its writer and fails closed when the runtime mode changes", () => {
  const workflow = normalizeRegistrationInitialWorkflow({
    ...createRegistrationInitialWorkflowDraft(["영어"]),
    subjectPlans: { 영어: "inquiry" },
  }, ["영어"])
  const common = {
    studentName: "김다미", schoolGrade: "고1", schoolName: "중앙고",
    parentPhone: "01012345678", studentPhone: "", campus: "본관",
    inquiryAt: "", subjects: ["영어"], requestNote: "", priority: "normal",
  }
  let sequence = 0
  const first = createRegistrationCreateAttempt(null, common, workflow, {
    persistenceMode: "canonical_inquiry",
    createRequestKey: () => `request-${++sequence}`,
    createInquiryAt: () => "2026-07-16T01:00:00Z",
  })
  const retry = createRegistrationCreateAttempt(first, common, structuredClone(workflow), {
    persistenceMode: "canonical_inquiry",
    createRequestKey: () => `request-${++sequence}`,
    createInquiryAt: () => "2026-07-16T02:00:00Z",
  })

  assert.strictEqual(retry, first)
  assert.equal(retry.persistenceMode, "canonical_inquiry")
  assert.equal(retry.writer, "canonical")
  assert.equal(retry.requestKey, "request-1")
  assert.equal(retry.inquiryAt, "2026-07-16T01:00:00Z")
  assert.deepEqual(retry.normalizedInitialWorkflow, workflow)
  assert.throws(
    () => assertRegistrationCreateAttemptPersistenceMode(retry, "legacy_inquiry"),
    /registration_persistence_mode_changed/,
  )
  assert.throws(
    () => createRegistrationCreateAttempt(first, common, workflow, {
      persistenceMode: "ready_atomic",
      createRequestKey: () => `request-${++sequence}`,
      createInquiryAt: () => "2026-07-16T03:00:00Z",
    }),
    /registration_persistence_mode_changed/,
  )
})

test("an ambiguous legacy create can never issue a second insert for the same attempt", () => {
  const workflow = normalizeRegistrationInitialWorkflow(
    createRegistrationInitialWorkflowDraft(["영어"]),
    ["영어"],
  )
  const common = {
    studentName: "김다미", schoolGrade: "고1", schoolName: "",
    parentPhone: "01012345678", studentPhone: "", campus: "본관",
    inquiryAt: "", subjects: ["영어"], requestNote: "", priority: "normal",
  }
  const first = createRegistrationCreateAttempt(null, common, workflow, {
    persistenceMode: "legacy_inquiry",
    createRequestKey: () => "legacy-request",
    createInquiryAt: () => "2026-07-16T01:00:00Z",
  })
  const started = markRegistrationLegacyCreateStarted(first)
  const retained = createRegistrationCreateAttempt(started, common, structuredClone(workflow), {
    persistenceMode: "legacy_inquiry",
    createRequestKey: () => "must-not-rotate",
    createInquiryAt: () => "must-not-rotate",
  })

  assert.strictEqual(retained, started)
  assert.equal(retained.writer, "legacy")
  assert.equal(retained.legacyCreateStarted, true)
  assert.throws(
    () => markRegistrationLegacyCreateStarted(retained),
    /registration_legacy_create_outcome_unknown/,
  )
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
