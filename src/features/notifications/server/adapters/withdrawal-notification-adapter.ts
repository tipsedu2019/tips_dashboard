import { createImmediateNotificationAdapter } from "./immediate-notification-adapter.ts"

export const withdrawalNotificationAdapter = createImmediateNotificationAdapter({
  workflowKey: "withdrawal",
  sourceTypes: ["ops_task_event"],
  linkRoot: "/admin/withdrawal",
  linkPayloadKey: "task_id",
  linkQueryKey: "taskId",
  eventLabels: {
    "withdrawal.submitted": "제출",
    "withdrawal.completed": "완료",
  },
  audienceProfileFields: {
    requester_profile: ["requester_profile_id"],
    management_team: ["management_profile_ids"],
  },
  renderFields: {
    student_name: ["student_name"],
    teacher_name: ["teacher_name", "requester_name"],
    class_name: ["class_name"],
    withdrawal_date: ["withdrawal_date"],
    withdrawal_round: ["withdrawal_round"],
  },
})
