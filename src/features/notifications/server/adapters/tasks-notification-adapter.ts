import { createImmediateNotificationAdapter } from "./immediate-notification-adapter.ts"

export const tasksNotificationAdapter = createImmediateNotificationAdapter({
  workflowKey: "tasks",
  sourceTypes: ["ops_task_event", "ops_task_comment"],
  linkRoot: "/admin/tasks",
  linkPayloadKey: "task_id",
  linkQueryKey: "taskId",
  workflowLabel: "할 일",
  eventLabels: {
    "task.created": "할 일 생성",
    "task.assignee_changed": "담당 변경",
    "task.due_changed": "일정 변경",
    "task.status_changed": "상태 변경",
    "task.completed": "완료",
    "task.canceled": "취소",
    "task.reopened": "재개",
    "task.comment_added": "댓글",
  },
  audienceProfileFields: {
    requester_profile: ["requester_profile_id"],
    primary_assignee: ["primary_assignee_profile_id"],
    secondary_assignee: ["secondary_assignee_profile_id", "secondary_assignee_profile_ids"],
    management_team: ["management_profile_ids"],
  },
  renderFields: {},
})
