export type OpsTransitionNotificationWorkflowKey = "transfer" | "withdrawal"
export type OpsTransitionNotificationFlow = "applicant" | "operations" | "closed"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const FLOW_BY_STATUS: Readonly<Record<string, OpsTransitionNotificationFlow>> = {
  requested: "applicant",
  confirmed: "operations",
  in_progress: "operations",
  on_hold: "operations",
  review_requested: "operations",
  done: "closed",
  canceled: "closed",
}

export function buildOpsTransitionNotificationDeepLink(input: Readonly<{
  workflowKey: OpsTransitionNotificationWorkflowKey
  taskId: unknown
  status: unknown
}>): string {
  const taskId = typeof input.taskId === "string" ? input.taskId : ""
  const status = typeof input.status === "string" ? input.status : ""
  const flow = FLOW_BY_STATUS[status]
  if (
    (input.workflowKey !== "transfer" && input.workflowKey !== "withdrawal") ||
    !UUID_PATTERN.test(taskId) ||
    !flow
  ) {
    throw new Error("notification_payload_schema_unsupported")
  }
  const query = new URLSearchParams()
  query.set("flow", flow)
  query.set("taskId", taskId)
  return `/admin/${input.workflowKey}?${query.toString()}`
}
