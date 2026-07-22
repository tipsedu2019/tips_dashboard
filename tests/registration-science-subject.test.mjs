import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
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

test("new science selection is grade-order independent while capability grades stay enforced", () => {
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
  assert.equal(beforeGrade.disabledReasonBySubject.과학, undefined)

  const middle = intakeWorkflow.getRegistrationSubjectPickerAvailability({
    capabilities: scienceCapabilities,
    grade: "중3",
    selectedSubjects: [],
  })
  assert.deepEqual(middle.options, ["영어", "수학", "과학"])
  assert.equal(
    middle.disabledReasonBySubject.과학,
    "과학은(는) 현재 선택한 학년에서 신규 등록할 수 없습니다.",
  )

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

test("an empty grade keeps the selected science plan and director override", () => {
  const draft = {
    ...intakeWorkflow.createRegistrationInitialWorkflowDraft(["영어", "과학"]),
    subjectPlans: { 영어: "inquiry", 과학: "visit" },
    visitScheduledAt: "2026-07-30T14:00",
    visitPlace: "상담실",
    directorOverrides: { 과학: "science-director" },
  }
  const result = intakeWorkflow.reconcileRegistrationSubjectsForGrade({
    capabilities: scienceCapabilities,
    grade: "",
    subjects: ["영어", "과학"],
    draft,
  })

  assert.deepEqual(result.subjects, ["영어", "과학"])
  assert.deepEqual(result.removedSubjects, [])
  assert.equal(result.removalReason, "")
  assert.equal(result.draft.subjectPlans.과학, "visit")
  assert.equal(result.draft.directorOverrides.과학, "science-director")
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
  assert.equal(result.removalReason, "과학은(는) 현재 선택한 학년에서 신규 등록할 수 없습니다.")
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

test("science director forward migration assigns the unique active 김법균 science-team profile", async () => {
  let migration = ""
  try {
    migration = await readFile(
      new URL("../supabase/migrations/20260722142020_registration_science_director_and_case_delete.sql", import.meta.url),
      "utf8",
    )
  } catch {
    // The first RED run intentionally reaches this assertion before the migration exists.
  }

  assert.ok(migration, "science director forward migration must exist")
  assert.match(migration, /김법균/)
  assert.match(migration, /pg_catalog\.count\(\*\)[\s\S]*?<> 1/)
  assert.match(migration, /'과학팀' = any\(teacher\.subjects\)/)
  assert.match(migration, /update public\.academic_subject_settings[\s\S]*?default_director_profile_id = v_science_director_profile_id[\s\S]*?subject = '과학'/)
})

test("atomic inquiry SQL packet covers both grade directions, conflicts, replay, capability, and reminders", async () => {
  const [migration, pgTap] = await Promise.all([
    readFile(
      new URL("../supabase/migrations/20260722142108_registration_case_inquiry_atomic_save.sql", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../supabase/tests/registration_case_inquiry_atomic_save_test.sql", import.meta.url),
      "utf8",
    ),
  ])

  for (const contract of [
    "middle-english-to-high-english-science",
    "high-science-to-middle-english",
    "removal-block-rollback",
    "stale-common-revision",
    "stale-expected-subjects",
    "idempotent-replay",
    "mismatched-key-reuse",
    "disabled-existing-science-common-edit",
    "disabled-new-science-rejection",
    "post-subject-write-common-validation-rollback",
    "reminder-rematerialization",
  ]) {
    assert.match(pgTap, new RegExp(contract), `missing SQL fixture contract: ${contract}`)
  }

  assert.match(pgTap.trim(), /^begin;[\s\S]*rollback;$/i)
  assert.match(pgTap, /select no_plan\(\)/)
  assert.ok(
    (pgTap.match(/public\.save_registration_case_inquiry_v1\(/g) || []).length >= 10,
    "runtime packet must exercise the real public RPC",
  )
  assert.match(pgTap, /throws_ok\([\s\S]*?registration_subject_removal_blocked/)
  assert.match(pgTap, /throws_ok\([\s\S]*?registration_common_revision_conflict/)
  assert.match(pgTap, /throws_ok\([\s\S]*?registration_subjects_conflict/)
  assert.match(pgTap, /throws_ok\([\s\S]*?idempotency_key_reused/)
  assert.match(pgTap, /throws_ok\([\s\S]*?registration_subject_disabled/)
  assert.match(pgTap, /throws_ok\([\s\S]*?registration_parent_phone_invalid/)
  assert.match(
    pgTap,
    /registration_subjects_synced[\s\S]*?post-subject-write-common-validation-rollback/,
  )
  assert.match(pgTap, /ops_registration_mutations[\s\S]*?mutation_type = 'save_inquiry'/)
  assert.match(pgTap, /notification_revision[\s\S]*?reminder-rematerialization/)
  assert.match(
    pgTap,
    /update dashboard_private\.notification_rules[\s\S]*?enabled = true[\s\S]*?materialize_registration_appointment_reminders_v1/,
  )
  assert.match(
    pgTap,
    /appointment\.notification_revision[\s\S]*?= 1[\s\S]*?reminder-prior-materialization/,
  )
  assert.match(
    pgTap,
    /'pending'[\s\S]*?0,\s*5,\s*null[\s\S]*?from registration_inquiry_reminder_fixture/,
  )
  assert.match(pgTap, /jsonb_array_length\([\s\S]*?notificationJobs[\s\S]*?\) > 0/)
  assert.match(pgTap, /notification_events[\s\S]*?source_revision = 2/)
  assert.match(pgTap, /notification_event_fanout_jobs[\s\S]*?source_revision = 2/)
  assert.match(pgTap, /status = 'canceled'[\s\S]*?status_reason = 'source_revision_changed'/)
  assert.match(
    pgTap,
    /attempt_count = 0[\s\S]*?last_attempt_started_at is null[\s\S]*?provider_message_id is null/,
  )
  assert.match(
    pgTap,
    /source_revision = 2[\s\S]*?select pg_catalog\.count\(\*\)[\s\S]*?0::bigint[\s\S]*?provider-delivery-zero/,
  )
  assert.match(pgTap, /common_revision[\s\S]*?school_grade[\s\S]*?ops_registration_subject_tracks/)

  assert.match(migration, /into v_added_subjects[\s\S]*?from pg_catalog\.unnest\(v_subjects\)/)
  assert.doesNotMatch(
    migration,
    /foreach v_subject in array v_subjects\s+loop\s+perform dashboard_private\.assert_registration_subject_enabled/i,
  )
})
