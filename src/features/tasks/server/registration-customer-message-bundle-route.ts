import {
  REGISTRATION_CUSTOMER_MESSAGE_BUNDLE_KINDS,
  type RegistrationCustomerMessageBundleKind,
} from "../registration-customer-message-contract.ts"

export type RegistrationCustomerMessageBundleRuntime = Readonly<{
  installedVersion: number
  activeVersion: number
}>

export function isRegistrationCustomerMessageBundleKind(
  value: unknown,
): value is RegistrationCustomerMessageBundleKind {
  return typeof value === "string"
    && (REGISTRATION_CUSTOMER_MESSAGE_BUNDLE_KINDS as readonly string[]).includes(value)
}

export function assertRegistrationCustomerMessageBundleRuntime(
  runtime: RegistrationCustomerMessageBundleRuntime,
) {
  if (runtime.installedVersion !== 1 || (runtime.activeVersion !== 0 && runtime.activeVersion !== 1)) {
    throw new Error("registration_customer_message_bundle_runtime_invalid")
  }
  if (runtime.activeVersion !== 1) {
    throw new Error("registration_customer_message_bundle_runtime_inactive")
  }
}
