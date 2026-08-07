import type {
  RegistrationCustomerMessageAdminClient,
  RegistrationCustomerMessageKind,
  RegistrationCustomerMessageReadiness,
} from "./registration-customer-message-contract.ts"

export type RegistrationCustomerMessageRolloutAction =
  | Readonly<{
      action: "prepare_verification"
      messageKind: RegistrationCustomerMessageKind
      verificationTaskId: string
    }>
  | Readonly<{
      action: "record_receipt_and_live"
      messageKind: RegistrationCustomerMessageKind
      messageId: string
      receivedAt: string
    }>
  | Readonly<{
      action: "set_off"
      messageKind: RegistrationCustomerMessageKind
    }>

export async function runRegistrationCustomerMessageRolloutAction(
  client: RegistrationCustomerMessageAdminClient,
  input: RegistrationCustomerMessageRolloutAction,
  createRequestKey: () => string = () => crypto.randomUUID(),
): Promise<RegistrationCustomerMessageReadiness> {
  if (input.action === "prepare_verification") {
    await client.preflightTemplate(input.messageKind)
    return client.setActivation({
      messageKind: input.messageKind,
      mode: "verification",
      verificationTaskId: input.verificationTaskId,
      requestKey: createRequestKey(),
    })
  }

  if (input.action === "record_receipt_and_live") {
    await client.recordLiveTestReceipt({
      messageKind: input.messageKind,
      messageId: input.messageId,
      receivedAt: input.receivedAt,
      requestKey: createRequestKey(),
    })
    return client.setActivation({
      messageKind: input.messageKind,
      mode: "live",
      requestKey: createRequestKey(),
    })
  }

  return client.setActivation({
    messageKind: input.messageKind,
    mode: "off",
    requestKey: createRequestKey(),
  })
}
