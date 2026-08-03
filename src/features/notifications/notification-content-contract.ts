import type {
  NotificationContentContract,
  NotificationContentContractIdentity,
  NotificationFieldPresenceRule,
  NotificationTemplateVariableDto,
} from "./notification-control-plane-types.ts"

export function notificationContentIdentityKey(identity: NotificationContentContractIdentity) {
  return [
    identity.workflowKey,
    identity.eventKey,
    identity.audienceKey,
    identity.channelKey,
    identity.ruleVariantKey,
  ].join("|")
}

function freezeVariables(variables: ReadonlyArray<NotificationTemplateVariableDto>) {
  return Object.freeze(variables.map((variable) => Object.freeze({ ...variable })))
}

function freezeFieldPresence(
  fieldPresence: Readonly<Record<string, NotificationFieldPresenceRule>>,
) {
  return Object.freeze(Object.fromEntries(
    Object.entries(fieldPresence).map(([key, value]) => [key, Object.freeze({ ...value })]),
  ))
}

export function freezeNotificationContentContract(
  contract: NotificationContentContract,
): NotificationContentContract {
  return Object.freeze({
    ...contract,
    availableVariables: freezeVariables(contract.availableVariables),
    requiredTokens: Object.freeze([...contract.requiredTokens]),
    optionalLineTokens: Object.freeze([...contract.optionalLineTokens]),
    mustHaveFacts: Object.freeze([...contract.mustHaveFacts]),
    supportedPayloadVersions: Object.freeze([...contract.supportedPayloadVersions]),
    destinationPolicy: Object.freeze({
      allowedConnectionKeys: Object.freeze([...contract.destinationPolicy.allowedConnectionKeys]),
      subjectScoped: contract.destinationPolicy.subjectScoped,
    }),
    freeTextVisibility: Object.freeze({ ...contract.freeTextVisibility }),
    freeTextPriority: Object.freeze([...contract.freeTextPriority]),
    fieldPresence: freezeFieldPresence(contract.fieldPresence),
  })
}
