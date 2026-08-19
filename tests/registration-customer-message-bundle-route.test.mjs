import assert from "node:assert/strict"
import test from "node:test"

import {
  assertRegistrationCustomerMessageBundleRuntime,
  isRegistrationCustomerMessageBundleKind,
} from "../src/features/tasks/server/registration-customer-message-bundle-route.ts"

test("bundle route accepts only the six bundle kinds and runtime 1", () => {
  assert.equal(isRegistrationCustomerMessageBundleKind("level_test_booking_bundle"), true)
  assert.equal(isRegistrationCustomerMessageBundleKind("level_test_booking"), false)
  assert.equal(assertRegistrationCustomerMessageBundleRuntime({ installedVersion: 1, activeVersion: 1 }), undefined)
  assert.throws(
    () => assertRegistrationCustomerMessageBundleRuntime({ installedVersion: 1, activeVersion: 0 }),
    /registration_customer_message_bundle_runtime_inactive/u,
  )
  assert.throws(
    () => assertRegistrationCustomerMessageBundleRuntime({ installedVersion: 2, activeVersion: 1 }),
    /registration_customer_message_bundle_runtime_invalid/u,
  )
})
