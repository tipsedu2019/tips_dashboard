import assert from "node:assert/strict";
import os from "node:os";
import test from "node:test";

import {
  runRegistrationObservationGoogleChatProviderZero,
} from "../scripts/run-registration-observation-google-chat-provider-zero.mjs";

function localOnlyEnvironment() {
  return {
    HOME: process.env.HOME ?? "/tmp",
    LANG: process.env.LANG ?? "C",
    PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    SHELL: process.env.SHELL ?? "/bin/zsh",
    TMPDIR: process.env.TMPDIR ?? os.tmpdir(),
    USER: process.env.USER ?? "provider-zero-lifecycle-test",
  };
}

test("provider-zero runner stages the adapter package before the real core receipt", async () => {
  // Break caught: a marker-only baseline is not evidence that the real
  // readiness, activation, heartbeat, and flag boundaries can run through the
  // production RPCs without a provider request.
  const receipt = await runRegistrationObservationGoogleChatProviderZero({
    argv: ["--execute", "--approved-local-db"],
    env: localOnlyEnvironment(),
  });

  assert.equal(receipt.orderedCallTraceExact, true);
  assert.equal(receipt.baselineMarkerMissing, true);
  assert.deepEqual(receipt.coreReadiness, {
    schemaReady: true,
    missingObjects: [],
    runtimeVersion: 0,
  });
  assert.equal(receipt.coreActivation.runtimeVersion, 1);
  assert.equal(receipt.coreActivation.replayEqual, true);
  assert.deepEqual(receipt.heartbeat.countKeys, [
    "observation_due",
    "fanout",
    "rule_reconciliation",
    "target_reconciliation",
    "deliveries",
    "reaped",
  ]);
  assert.equal(receipt.fetch, 0);
  assert.equal(receipt.http, 0);
  assert.equal(receipt.https, 0);
  assert.equal(receipt.directory, 0);
  assert.equal(receipt.provider, 0);
  assert.equal(receipt.externalAttemptAudit, 0);
  assert.deepEqual(receipt.nodeDispatch, {
    productionDispatchSeam: true,
    status: "sending",
    channelKey: "google_chat",
    connectionKey: "google_chat.management",
    mentionUserNames: ["users/987654321"],
    externalAttemptAudit: 0,
  });
  assert.equal(receipt.cleanupComplete, true);
});

test("provider-zero runner commits the scheduled and paired feedback lifecycle without a provider", async () => {
  // Break caught: core readiness and feature flags alone do not prove that the
  // enabled v2 rules can create real deliveries, freeze a first attempt, stop
  // Google Chat at the begin boundary, and atomically commit the in-app half.
  const receipt = await runRegistrationObservationGoogleChatProviderZero({
    argv: ["--execute", "--approved-local-db"],
    env: localOnlyEnvironment(),
  });

  assert.equal(receipt.orderedCallTraceExact, true);
  assert.equal(receipt.v2RuleSaveReceiptExact, true);
  assert.equal(receipt.googleChatPrepareBoundaryReached, true);
  assert.equal(receipt.googleChatDeliveryStatus, "sending");
  assert.deepEqual(receipt.scheduledMentionUserNames, ["users/123456788"]);
  assert.deepEqual(receipt.feedbackMentionUserNames, ["users/123456789"]);
  assert.deepEqual(receipt.directorReassignedMentionUserNames, [
    "users/123456789",
    "users/987654321",
  ]);
  assert.deepEqual(receipt.missingIdentityMentionUserNames, []);
  assert.equal(receipt.inAppCommitBoundaryReached, true);
  assert.equal(receipt.inAppDeliveryStatus, "sent");
  assert.equal(receipt.inAppDashboardNotificationCount, 1);
  assert.equal(receipt.inAppPushChildrenCreated, 0);
  assert.deepEqual(receipt.missingDirectorPair, {
    managementStatus: "sending",
    managementConnectionKey: "google_chat.management",
    inAppStatus: "canceled",
    inAppStatusReason: "recipient_revoked",
  });
  assert.deepEqual(receipt.inactiveDirectorPair, {
    managementStatus: "sending",
    managementConnectionKey: "google_chat.management",
    inAppStatus: "canceled",
    inAppStatusReason: "recipient_revoked",
  });
  assert.deepEqual(receipt.missingDirectorBeforeFanout, {
    managementDeliveryCount: 1,
    inAppDeliveryCount: 0,
  });
  assert.equal(receipt.customerQueueUnchanged, true);
  assert.equal(receipt.solapiMessagesUnchanged, true);
  assert.equal(receipt.fetch, 0);
  assert.equal(receipt.http, 0);
  assert.equal(receipt.https, 0);
  assert.equal(receipt.directory, 0);
  assert.equal(receipt.provider, 0);
  assert.equal(receipt.externalAttemptAudit, 0);
  assert.deepEqual(receipt.nodeDispatch, {
    productionDispatchSeam: true,
    status: "sending",
    channelKey: "google_chat",
    connectionKey: "google_chat.management",
    mentionUserNames: ["users/987654321"],
    externalAttemptAudit: 0,
  });
  assert.equal(receipt.cleanupComplete, true);
});
