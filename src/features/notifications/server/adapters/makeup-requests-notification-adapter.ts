import { buildMakeupNotificationPresentation } from "../presentation/makeup-notification-presentation.ts"
import { createImmediateNotificationAdapter } from "./immediate-notification-adapter.ts"

const LEGACY_MAKEUP_CONTEXT_KEYS = Object.freeze([
  "process", "status", "class_name", "subject", "teacher_name", "reason", "cancel_date",
  "makeup_at", "makeup_room_spaced", "makeup_room", "requester_name", "submitted_at",
  "revision_requested_at", "revision_reason", "approved_at", "approval_note", "rejected_at",
  "rejected_reason", "canceled_at", "canceled_note", "approver_name", "fallback_title", "fallback_body",
])

function buildMakeupAdapterPresentation(
  input: Parameters<typeof buildMakeupNotificationPresentation>[0],
) {
  if (input.requestedContextKeys.length > 0) return buildMakeupNotificationPresentation(input)
  return buildMakeupNotificationPresentation({
    ...input,
    requestedContextKeys: LEGACY_MAKEUP_CONTEXT_KEYS,
  })
}

export const makeupRequestsNotificationAdapter = createImmediateNotificationAdapter({
  workflowKey: "makeup_requests",
  sourceTypes: ["makeup_request_event"],
  linkRoot: "/admin/makeup-requests",
  linkPayloadKey: "makeup_request_id",
  linkQueryKey: "request",
  eventLabels: {
    "makeup.submitted": "신청 제출",
    "makeup.refund_requested": "환불 신청",
    "makeup.approved": "결재 승인",
    "makeup.refund_completed": "환불 완료",
    "makeup.approval_canceled": "승인 취소",
    "makeup.revision_requested": "보완 요청",
    "makeup.rejected": "반려",
  },
  audienceProfileFields: {
    requester_profile: ["requester_profile_id"],
    approver_profile: ["approver_profile_id"],
    management_team: ["management_profile_ids"],
    executive_team: ["executive_profile_ids"],
    subject_team: ["subject_profile_ids"],
  },
  renderFields: {},
  presentationBuilder: buildMakeupAdapterPresentation,
})
