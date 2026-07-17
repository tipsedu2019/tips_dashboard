import { createImmediateNotificationAdapter } from "./immediate-notification-adapter.ts"

export const wordRetestsNotificationAdapter = createImmediateNotificationAdapter({
  workflowKey: "word_retests",
  sourceTypes: ["ops_task_event", "ops_task_comment"],
  linkRoot: "/admin/word-retests",
  linkPayloadKey: "task_id",
  linkQueryKey: "taskId",
  workflowLabel: "영어 단어 재시험",
  eventLabels: {
    "word_retest.created": "재시험 생성",
    "word_retest.assigned": "배정",
    "word_retest.schedule_changed": "본시험일 변경",
    "word_retest.started": "시작",
    "word_retest.result_reported": "결과 보고",
    "word_retest.absent_reported": "미응시 보고",
    "word_retest.revision_requested": "수정 요청",
    "word_retest.retry_created": "재시험 재생성",
    "word_retest.completed": "완료",
    "word_retest.canceled": "취소",
  },
  audienceProfileFields: {
    requesting_teacher: ["requesting_teacher_profile_id"],
    assigned_assistant: ["assigned_assistant_profile_id"],
    secondary_assignee: ["secondary_assignee_profile_id", "secondary_assignee_profile_ids"],
    management_team: ["management_profile_ids"],
  },
  renderFields: {},
})
