import { createImmediateNotificationAdapter, type ImmediateNotificationAdapterDependencies } from "./immediate-notification-adapter.ts"
import { isOperationalSubjectDestination, operationalSubjectConnections } from "./operational-subject-notification-routing.ts"
import type { NotificationRenderInput } from "../notification-workflow-adapter.ts"

export const REGISTRATION_SUBJECT_COMPLETED_EVENT = "registration.subject_registration_completed"
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const UNSAFE_TEXT = /[<>\u0000-\u001f\u007f]|https?:\/\/|@(all|everyone|here|channel)\b/iu

function completionPayload(payload: Readonly<Record<string, unknown>>) {
  if (typeof payload.task_id !== "string" || !UUID.test(payload.task_id)
    || typeof payload.track_id !== "string" || !UUID.test(payload.track_id)
    || typeof payload.student_name !== "string" || !payload.student_name.trim() || UNSAFE_TEXT.test(payload.student_name)
    || typeof payload.before_status !== "string" || !payload.before_status || payload.before_status === "registered"
    || payload.after_status !== "registered" || payload.status !== "registered"
    || !Array.isArray(payload.notification_subjects) || payload.notification_subjects.length !== 1
    || payload.notification_subjects[0] !== payload.subject) {
    throw new Error("notification_payload_schema_unsupported")
  }
  operationalSubjectConnections(REGISTRATION_SUBJECT_COMPLETED_EVENT, payload)
  return { taskId: payload.task_id, trackId: payload.track_id, name: payload.student_name.trim(), subject: String(payload.subject) }
}

export function createRegistrationSubjectCompletionNotificationAdapter(dependencies?: ImmediateNotificationAdapterDependencies) {
  const adapter = createImmediateNotificationAdapter({
    workflowKey: "registration",
    sourceTypes: ["ops_task_event"],
    linkRoot: "/admin/registration",
    linkPayloadKey: "task_id",
    linkQueryKey: "taskId",
    eventLabels: { [REGISTRATION_SUBJECT_COMPLETED_EVENT]: "등록 완료" },
    audienceProfileFields: { subject_team: [] },
    renderFields: {},
    presentationBuilder(input) {
      const facts = completionPayload(input.payload)
      if (input.eventKey !== REGISTRATION_SUBJECT_COMPLETED_EVENT || !isOperationalSubjectDestination(input)) {
        throw new Error("notification_payload_schema_unsupported")
      }
      return Object.freeze({ student_name: facts.name, subjects: facts.subject, current_status: "등록 완료" })
    },
    deepLinkBuilder(input: NotificationRenderInput) {
      const facts = completionPayload(input.payload)
      return `/admin/registration?${new URLSearchParams({ taskId: facts.taskId, trackId: facts.trackId })}`
    },
  }, dependencies)
  return Object.freeze({
    ...adapter,
    async resolveTargets(input: Parameters<typeof adapter.resolveTargets>[0]) {
      completionPayload(input.payload)
      if (input.eventKey !== REGISTRATION_SUBJECT_COMPLETED_EVENT) throw new Error("notification_payload_schema_unsupported")
      return adapter.resolveTargets(input)
    },
  })
}
