import { buildWithdrawalNotificationPresentation } from "../presentation/withdrawal-notification-presentation.ts"
import { createImmediateNotificationAdapter } from "./immediate-notification-adapter.ts"
import { buildOpsTransitionNotificationDeepLink } from "./ops-transition-notification-deep-link.ts"

const LEGACY_CONTEXT_KEYS_BY_EVENT: Readonly<Record<string, ReadonlyArray<string>>> = Object.freeze({
  "withdrawal.submitted": Object.freeze([
    "student_name", "teacher_name", "class_name",
  ]),
  "withdrawal.completed": Object.freeze([
    "student_name", "withdrawal_date", "withdrawal_round",
  ]),
})

function buildWithdrawalAdapterPresentation(
  input: Parameters<typeof buildWithdrawalNotificationPresentation>[0],
) {
  const isHistoricalSeedPayload = input.requestedContextKeys.length === 0
    && !Object.prototype.hasOwnProperty.call(input.payload, "task_status")
  if (!isHistoricalSeedPayload) return buildWithdrawalNotificationPresentation(input)
  return buildWithdrawalNotificationPresentation({
    ...input,
    requestedContextKeys: LEGACY_CONTEXT_KEYS_BY_EVENT[input.eventKey] ?? input.requestedContextKeys,
  })
}

export const withdrawalNotificationAdapter = createImmediateNotificationAdapter({
  workflowKey: "withdrawal",
  sourceTypes: ["ops_task_event"],
  linkRoot: "/admin/withdrawal",
  linkPayloadKey: "task_id",
  linkQueryKey: "taskId",
  deepLinkBuilder: (input) => buildOpsTransitionNotificationDeepLink({
    workflowKey: "withdrawal",
    taskId: input.payload.task_id,
    status: input.payload.status,
  }),
  eventLabels: {
    "withdrawal.submitted": "제출",
    "withdrawal.completed": "완료",
  },
  audienceProfileFields: {
    requester_profile: ["requester_profile_id"],
    management_team: ["management_profile_ids"],
  },
  renderFields: {},
  presentationBuilder: buildWithdrawalAdapterPresentation,
})
