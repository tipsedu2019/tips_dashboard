import { buildTransferNotificationPresentation } from "../presentation/transfer-notification-presentation.ts"
import { createImmediateNotificationAdapter } from "./immediate-notification-adapter.ts"
import { buildOpsTransitionNotificationDeepLink } from "./ops-transition-notification-deep-link.ts"

const LEGACY_CONTEXT_KEYS_BY_EVENT: Readonly<Record<string, ReadonlyArray<string>>> = Object.freeze({
  "transfer.submitted": Object.freeze([
    "student_name", "teacher_name", "before_class", "after_class",
  ]),
  "transfer.completed": Object.freeze([
    "student_name", "before_end_date", "after_start_date",
  ]),
})

function buildTransferAdapterPresentation(
  input: Parameters<typeof buildTransferNotificationPresentation>[0],
) {
  const isHistoricalSeedPayload = input.requestedContextKeys.length === 0
    && !Object.prototype.hasOwnProperty.call(input.payload, "task_status")
  if (!isHistoricalSeedPayload) return buildTransferNotificationPresentation(input)
  return buildTransferNotificationPresentation({
    ...input,
    requestedContextKeys: LEGACY_CONTEXT_KEYS_BY_EVENT[input.eventKey] ?? input.requestedContextKeys,
  })
}

export const transferNotificationAdapter = createImmediateNotificationAdapter({
  workflowKey: "transfer",
  sourceTypes: ["ops_task_event"],
  linkRoot: "/admin/transfer",
  linkPayloadKey: "task_id",
  linkQueryKey: "taskId",
  deepLinkBuilder: (input) => buildOpsTransitionNotificationDeepLink({
    workflowKey: "transfer",
    taskId: input.payload.task_id,
    status: input.payload.status,
  }),
  eventLabels: {
    "transfer.submitted": "제출",
    "transfer.completed": "완료",
  },
  audienceProfileFields: {
    requester_profile: ["requester_profile_id"],
    management_team: ["management_profile_ids"],
  },
  renderFields: {},
  presentationBuilder: buildTransferAdapterPresentation,
})
