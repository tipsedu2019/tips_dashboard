import { createImmediateNotificationAdapter } from "./immediate-notification-adapter.ts"

export const transferNotificationAdapter = createImmediateNotificationAdapter({
  workflowKey: "transfer",
  sourceTypes: ["ops_task_event"],
  linkRoot: "/admin/transfer",
  linkPayloadKey: "task_id",
  linkQueryKey: "taskId",
  eventLabels: {
    "transfer.submitted": "제출",
    "transfer.completed": "완료",
  },
  audienceProfileFields: {
    requester_profile: ["requester_profile_id"],
    management_team: ["management_profile_ids"],
  },
  renderFields: {
    student_name: ["student_name"],
    teacher_name: ["teacher_name", "requester_name"],
    before_class: ["before_class", "from_class_name"],
    after_class: ["after_class", "to_class_name"],
    before_end_date: ["before_end_date"],
    after_start_date: ["after_start_date"],
  },
})
