import {
  createImmediateNotificationAdapter,
  type ImmediateNotificationAdapterDependencies,
} from "./immediate-notification-adapter.ts"

const approvalsNotificationAdapterConfig = Object.freeze({
  workflowKey: "approvals",
  sourceTypes: ["approval_event", "approval_comment"],
  linkRoot: "/admin/approvals",
  linkPayloadKey: "approval_id",
  linkQueryKey: "approvalId",
  workflowLabel: "전자결재",
  eventLabels: {
    "approval.created": "생성",
    "approval.submitted": "제출",
    "approval.review_started": "검토 시작",
    "approval.approver_changed": "결재자 변경",
    "approval.approved": "승인",
    "approval.returned": "반려",
    "approval.canceled": "취소",
    "approval.resubmitted": "재상신",
    "approval.comment_added": "댓글",
  },
  audienceProfileFields: {
    requester_profile: ["requester_profile_id"],
    approver_profile: ["approver_profile_id"],
    management_team: ["management_profile_ids"],
  },
  renderFields: {},
})

export function createApprovalsNotificationAdapter(
  dependencies?: ImmediateNotificationAdapterDependencies,
) {
  return createImmediateNotificationAdapter(
    approvalsNotificationAdapterConfig,
    dependencies,
  )
}

export const approvalsNotificationAdapter = createApprovalsNotificationAdapter()
