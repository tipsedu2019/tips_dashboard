import assert from "node:assert/strict"
import test from "node:test"

const workflowStatusUrl = new URL(
  "../src/features/tasks/registration-workflow-status.js",
  import.meta.url,
)

async function loadWorkflowStatus() {
  return import(workflowStatusUrl)
}

test("registration workflow exposes observation statuses and the nine-view order", async () => {
  const {
    REGISTRATION_WORKFLOW_STATUSES,
    REGISTRATION_OBSERVATION_TRACK_WORKFLOW_STATUSES,
    REGISTRATION_WORKFLOW_STATUS_LABELS,
    REGISTRATION_WORKFLOW_VIEWS,
    getRegistrationWorkflowViewKey,
  } = await loadWorkflowStatus()

  assert.deepEqual(REGISTRATION_WORKFLOW_STATUSES, [
    "inquiry",
    "level_test_requested",
    "consultation_requested",
    "consultation_completed",
    "waiting_current_class",
    "waiting_new_class",
    "waiting_next_opening",
    "enrollment_requested",
    "payment_in_progress",
    "registered",
    "not_registered",
    "inquiry_only",
  ])
  assert.deepEqual(REGISTRATION_OBSERVATION_TRACK_WORKFLOW_STATUSES, [
    ...REGISTRATION_WORKFLOW_STATUSES.slice(0, 7),
    "observation_requested",
    "observation_feedback_pending",
    "observation_completed",
    ...REGISTRATION_WORKFLOW_STATUSES.slice(7),
  ])
  assert.equal(REGISTRATION_WORKFLOW_STATUS_LABELS.inquiry, "등록 문의")
  assert.equal(REGISTRATION_WORKFLOW_STATUS_LABELS.payment_in_progress, "입학 진행 중")
  assert.equal(REGISTRATION_WORKFLOW_STATUS_LABELS.waiting_next_opening, "다음 개강 알림 요청")
  assert.deepEqual(REGISTRATION_WORKFLOW_VIEWS, [
    ["inquiry", "문의"],
    ["level_test", "레벨테스트 신청"],
    ["consultation_requested", "상담 신청"],
    ["consultation_completed", "상담 완료"],
    ["waiting", "대기 신청"],
    ["observation", "청강 신청"],
    ["enrollment", "등록 신청"],
    ["payment", "입학 진행"],
    ["completed", "완료"],
  ])
  assert.equal(getRegistrationWorkflowViewKey("waiting_next_opening"), "waiting")
  assert.equal(getRegistrationWorkflowViewKey("observation_requested"), "observation")
  assert.equal(getRegistrationWorkflowViewKey("observation_feedback_pending"), "observation")
  assert.equal(getRegistrationWorkflowViewKey("observation_completed"), "observation")
  assert.equal(getRegistrationWorkflowViewKey("not_registered"), "completed")
  assert.equal(getRegistrationWorkflowViewKey("unexpected"), "inquiry")
})

test("legacy technical tracks map deterministically without inventing consultation completion", async () => {
  const { getRegistrationWorkflowStatusFromLegacyTrack } = await loadWorkflowStatus()

  assert.equal(getRegistrationWorkflowStatusFromLegacyTrack({ status: "migration_review" }), "inquiry")
  assert.equal(getRegistrationWorkflowStatusFromLegacyTrack({ status: "level_test_in_progress" }), "level_test_requested")
  assert.equal(getRegistrationWorkflowStatusFromLegacyTrack({ status: "consultation_waiting" }), "consultation_requested")
  assert.equal(getRegistrationWorkflowStatusFromLegacyTrack({ status: "waiting", waitingKind: "current_class" }), "waiting_current_class")
  assert.equal(getRegistrationWorkflowStatusFromLegacyTrack({ status: "waiting", waitingKind: "current_term_opening" }), "waiting_new_class")
  assert.equal(getRegistrationWorkflowStatusFromLegacyTrack({ status: "waiting", waitingKind: "next_term_opening" }), "waiting_next_opening")
  assert.equal(getRegistrationWorkflowStatusFromLegacyTrack({ status: "waiting", waitingKind: "" }), "waiting_new_class")
  assert.notEqual(getRegistrationWorkflowStatusFromLegacyTrack({ status: "consultation_waiting" }), "consultation_completed")
})

test("workflow status choices follow operations and assigned-director ownership", async () => {
  const { getRegistrationWorkflowStatusOptions } = await loadWorkflowStatus()

  assert.deepEqual(
    getRegistrationWorkflowStatusOptions({
      viewerRole: "staff",
      viewerId: "staff-1",
      directorProfileId: "director-1",
    }).map(({ value }) => value),
    [
      "inquiry",
      "level_test_requested",
      "consultation_requested",
      "payment_in_progress",
      "registered",
      "inquiry_only",
    ],
  )
  assert.deepEqual(
    getRegistrationWorkflowStatusOptions({
      viewerRole: "teacher",
      viewerId: "director-1",
      directorProfileId: "director-1",
    }).map(({ value }) => value),
    [
      "consultation_completed",
      "waiting_current_class",
      "waiting_new_class",
      "waiting_next_opening",
      "enrollment_requested",
      "not_registered",
    ],
  )
  assert.deepEqual(
    getRegistrationWorkflowStatusOptions({
      viewerRole: "teacher",
      viewerId: "teacher-2",
      directorProfileId: "director-1",
    }),
    [],
  )
  assert.deepEqual(
    getRegistrationWorkflowStatusOptions({ viewerRole: "admin" }).map(({ value }) => value),
    [
      "inquiry",
      "level_test_requested",
      "consultation_requested",
      "consultation_completed",
      "waiting_current_class",
      "waiting_new_class",
      "waiting_next_opening",
      "enrollment_requested",
      "payment_in_progress",
      "registered",
      "not_registered",
      "inquiry_only",
    ],
  )
})

test("generic workflow choices never accept observation source or target states", async () => {
  const {
    getRegistrationInlineWorkflowStatusOptions,
    getRegistrationWorkflowStatusOptions,
    isRegistrationObservationWorkflowStatus,
  } = await loadWorkflowStatus()

  for (const viewerRole of ["admin", "staff"]) {
    assert.equal(
      getRegistrationWorkflowStatusOptions({ viewerRole })
        .some(({ value }) => value.startsWith("observation_")),
      false,
    )
  }
  assert.deepEqual(getRegistrationInlineWorkflowStatusOptions({
    currentStatus: "observation_requested",
    viewerRole: "admin",
  }), [])
  assert.equal(isRegistrationObservationWorkflowStatus("observation_completed"), true)
  assert.equal(isRegistrationObservationWorkflowStatus("enrollment_requested"), false)
})

test("inline status choices always retain the current value and expose only the viewer's allowed changes", async () => {
  const { getRegistrationInlineWorkflowStatusOptions } = await loadWorkflowStatus()

  assert.deepEqual(
    getRegistrationInlineWorkflowStatusOptions({
      currentStatus: "enrollment_requested",
      viewerRole: "staff",
      viewerId: "staff-1",
      directorProfileId: "director-1",
    }).map(({ value }) => value),
    [
      "enrollment_requested",
      "inquiry",
      "level_test_requested",
      "consultation_requested",
      "payment_in_progress",
      "registered",
      "inquiry_only",
    ],
  )

  assert.deepEqual(
    getRegistrationInlineWorkflowStatusOptions({
      currentStatus: "consultation_requested",
      viewerRole: "teacher",
      viewerId: "teacher-2",
      directorProfileId: "director-1",
    }).map(({ value }) => value),
    ["consultation_requested"],
  )
})
