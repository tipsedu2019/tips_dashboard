import type {
  NotificationChannelKey,
  NotificationConnectionKey,
  NotificationDestinationTeam,
  NotificationEditableChannelKey,
  NotificationWorkflowKey,
} from "../../notification-control-plane-types.ts"
import type { NotificationRenderContext } from "../notification-workflow-adapter.ts"

export type NotificationPresentationInput = Readonly<{
  workflowKey: NotificationWorkflowKey
  eventKey: string
  ruleVariantKey: string
  payloadSchemaVersion: number
  payload: Readonly<Record<string, unknown>>
  audienceKey: string
  channelKey: NotificationChannelKey
  contractIdentity: Readonly<{
    workflowKey: NotificationWorkflowKey
    eventKey: string
    audienceKey: string
    channelKey: NotificationEditableChannelKey
    ruleVariantKey: string
  }>
  requestedContextKeys: ReadonlyArray<string>
  connectionKey: NotificationConnectionKey | null
  destinationTeam: NotificationDestinationTeam | null
  scheduledFor: string
}>

export type NotificationPresentationBuilder =
  (input: NotificationPresentationInput) => NotificationRenderContext
