import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

import ts from "typescript";

import { getRegistrationTransitionBlockers } from "../src/features/tasks/registration-workflow.js";
import { normalizeRegistrationLevelTestPlace } from "../src/features/tasks/registration-level-test-place.ts";

const routeUrl = new URL(
  "../src/app/api/registration/consultation-notification/route.ts",
  import.meta.url,
);
const workspaceUrl = new URL(
  "../src/features/tasks/ops-task-workspace.tsx",
  import.meta.url,
);
const notificationModelUrl = new URL(
  "../src/features/tasks/registration-consultation-notification.js",
  import.meta.url,
);
const initialPlanUrl = new URL(
  "../src/features/tasks/registration-initial-plan-control.tsx",
  import.meta.url,
);
const dashboardNotificationServiceUrl = new URL(
  "../src/features/makeup-requests/makeup-request-service.ts",
  import.meta.url,
);
const appointmentEditorUrl = new URL(
  "../src/features/tasks/registration-appointment-editor.tsx",
  import.meta.url,
);
const registrationServiceUrl = new URL(
  "../src/features/tasks/registration-track-service.ts",
  import.meta.url,
);

async function readOptionalSource(url) {
  try {
    return await readFile(url, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    throw error;
  }
}

async function importOptionalModule(url) {
  try {
    return await import(url);
  } catch (error) {
    if (error?.code === "ERR_MODULE_NOT_FOUND") return {};
    throw error;
  }
}

const routeSource = await readOptionalSource(routeUrl);
const workspaceSource = await readOptionalSource(workspaceUrl);
const initialPlanSource = await readOptionalSource(initialPlanUrl);
const dashboardNotificationServiceSource = await readOptionalSource(dashboardNotificationServiceUrl);
const notificationModel = await importOptionalModule(notificationModelUrl);

async function loadRegistrationServiceFactory() {
  const source = await readFile(registrationServiceUrl, "utf8");
  const startMarker = "// registration-track-service-factory:start";
  const endMarker = "// registration-track-service-factory:end";
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, "registration service factory source markers are required");
  const factorySource = source.slice(start + startMarker.length, end);
  const compiled = ts.transpileModule(
    `${factorySource}\nmodule.exports = { createRegistrationTrackService };`,
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    },
  ).outputText;
  const sandboxModule = { exports: {} };
  vm.runInNewContext(compiled, {
    module: sandboxModule,
    exports: sandboxModule.exports,
    crypto: { randomUUID: () => "generated-request-id" },
    normalizeRegistrationLevelTestPlace,
  });
  return sandboxModule.exports;
}

function readyRegistrationOptions() {
  return {
    probeRuntime: async () => ({ mode: "ready", version: 1 }),
    probeIntakeRuntime: async () => ({ available: true, version: 1 }),
  };
}

function registrationRpcHarness(handler) {
  const calls = [];
  return {
    calls,
    client: {
      from() {
        throw new Error("unexpected table access");
      },
      rpc(name, args) {
        calls.push([name, args]);
        return Promise.resolve(handler(name, args));
      },
    },
  };
}

test("visit notification key is scoped by appointment revision, track, and director", () => {
  assert.equal(notificationModel.getRegistrationVisitNotificationDedupeKey?.({
    appointmentId: "appointment-1",
    notificationRevision: 2,
    trackId: "english",
    directorProfileId: "director-1",
  }), "registration:visit:appointment-1:revision:2:track:english:director:director-1")
})

test("notification result partition preserves every failed target and every warning", () => {
  const partition = notificationModel.partitionRegistrationVisitNotificationResults
  assert.equal(typeof partition, "function")
  if (typeof partition !== "function") return
  const targets = [
    { appointmentId: "visit-a", notificationRevision: 1 },
    { appointmentId: "visit-b", notificationRevision: 2 },
    { appointmentId: "visit-c", notificationRevision: 3 },
  ]
  const result = partition(targets, [
    { status: "fulfilled", value: { ok: true, warning: "감사 로그 확인" } },
    { status: "fulfilled", value: { ok: false } },
    { status: "rejected", reason: new Error("network") },
  ])

  assert.deepEqual(result.failedTargets, targets.slice(1))
  assert.deepEqual(result.warnings, ["감사 로그 확인"])
})

test("notification-only retry retains only targets that still fail", async () => {
  const dispatch = notificationModel.dispatchRegistrationVisitNotificationTargets
  assert.equal(typeof dispatch, "function")
  if (typeof dispatch !== "function") return
  const targets = [
    { appointmentId: "visit-b", notificationRevision: 2 },
    { appointmentId: "visit-c", notificationRevision: 3 },
  ]
  const calls = []
  const result = await dispatch(targets, async (target) => {
    calls.push(target.appointmentId)
    if (target.appointmentId === "visit-c") throw new Error("still failing")
    return { ok: true }
  })

  assert.deepEqual(calls, ["visit-b", "visit-c"])
  assert.deepEqual(result.failedTargets, [targets[1]])
  assert.deepEqual(result.warnings, [])
})

test("notification-only retry reconciliation preserves failures queued while retry is in flight", () => {
  const reconcile = notificationModel.reconcileRegistrationVisitNotificationRetryTargets
  assert.equal(typeof reconcile, "function")
  if (typeof reconcile !== "function") return

  const retryA = { appointmentId: "visit-a", notificationRevision: 1 }
  const queuedB = { appointmentId: "visit-b", notificationRevision: 2 }

  assert.deepEqual(
    reconcile([retryA, queuedB], [retryA], []),
    [queuedB],
    "a newly queued failure must survive when the retried target succeeds",
  )
  assert.deepEqual(
    reconcile([retryA, queuedB], [retryA], [retryA]),
    [queuedB, retryA],
    "a newly queued failure and a still-failing retried target must both remain",
  )
})

test("real appointment edits refresh notifications while same-revision retries dedupe", () => {
  const base = { appointmentId: "appointment-1", trackId: "english", directorProfileId: "director-1" }
  const key = notificationModel.getRegistrationVisitNotificationDedupeKey
  const adminKey = notificationModel.getRegistrationVisitAdminChatKey
  assert.equal(typeof key, "function")
  assert.equal(typeof adminKey, "function")
  if (typeof key !== "function" || typeof adminKey !== "function") return
  assert.equal(key({ ...base, notificationRevision: 1 }), key({ ...base, notificationRevision: 1 }))
  assert.notEqual(key({ ...base, notificationRevision: 1 }), key({ ...base, notificationRevision: 2 }))
  assert.notEqual(adminKey("appointment-1", 1), adminKey("appointment-1", 2))
})

test("visit revision participants exclude an already deselected subject from later edits", () => {
  const getParticipants = notificationModel.getRegistrationVisitRevisionParticipantTrackIds
  assert.equal(typeof getParticipants, "function")
  if (typeof getParticipants !== "function") return

  assert.deepEqual(getParticipants([
    {
      trackId: "english",
      metadata: { activeTrackIds: ["english"], canceledTrackIds: [] },
    },
  ]), ["english"])
  assert.deepEqual(getParticipants([
    {
      trackId: "english",
      metadata: { activeTrackIds: ["english"], canceledTrackIds: ["math"] },
    },
    {
      trackId: "math",
      metadata: { activeTrackIds: ["english"], canceledTrackIds: ["math"] },
    },
  ]), ["english", "math"])
})

test("adding a second subject refreshes both directors and the management summary", () => {
  const key = notificationModel.getRegistrationVisitNotificationDedupeKey
  const adminKey = notificationModel.getRegistrationVisitAdminChatKey
  const message = notificationModel.buildRegistrationVisitCanonicalMessage
  assert.equal(typeof key, "function")
  assert.equal(typeof adminKey, "function")
  assert.equal(typeof message, "function")
  if (typeof key !== "function" || typeof adminKey !== "function" || typeof message !== "function") return

  assert.notEqual(
    key({ appointmentId: "appointment-1", notificationRevision: 1, trackId: "eng", directorProfileId: "director-eng" }),
    key({ appointmentId: "appointment-1", notificationRevision: 2, trackId: "eng", directorProfileId: "director-eng" }),
  )
  assert.match(
    key({ appointmentId: "appointment-1", notificationRevision: 2, trackId: "math", directorProfileId: "director-math" }),
    /revision:2:track:math:director:director-math$/,
  )
  assert.equal(adminKey("appointment-1", 2), "registration:visit:appointment-1:revision:2:admin-chat")
  const summary = message({
    state: "updated",
    studentName: "김다미",
    scheduledAt: "2026. 7. 13. 오후 3:00",
    place: "상담실 A",
    subjectDirectorPairs: [
      { subject: "영어", directorName: "강부희" },
      { subject: "수학", directorName: "양소윤" },
    ],
  })
  assert.match(summary, /영어: 강부희/)
  assert.match(summary, /수학: 양소윤/)
})

test("canonical visit state distinguishes cancellation and old replacement", () => {
  const state = notificationModel.getRegistrationVisitChangeState
  assert.equal(typeof state, "function")
  if (typeof state !== "function") return
  assert.equal(state({ changeKind: "created" }), "scheduled")
  assert.equal(state({ changeKind: "appointment_updated" }), "updated")
  assert.equal(state({ changeKind: "appointment_canceled" }), "canceled")
  assert.equal(state({ changeKind: "appointment_replaced", isOldAppointment: true }), "replaced")
})

test("notification route accepts appointmentId and reloads the canonical visit plan on the server", () => {
  assert.match(routeSource, /body\.appointmentId/)
  assert.match(routeSource, /get_registration_visit_legacy_dispatch_plan_v1/)
  assert.match(routeSource, /p_appointment_id: appointmentId/)
  assert.match(routeSource, /notificationRevision/)
  assert.match(routeSource, /recipientRevision/)
  assert.doesNotMatch(routeSource, /body\.message/)
})

test("notification route delegates cross-task, director, and revision validation to the fixed-purpose RPC", () => {
  assert.match(routeSource, /get_registration_visit_legacy_dispatch_plan_v1/)
  assert.match(routeSource, /registration_visit_legacy_dispatch_plan_invalid/)
  assert.doesNotMatch(routeSource, /\.from\("ops_registration_appointments"\)/)
  assert.doesNotMatch(routeSource, /\.from\("ops_registration_consultations"\)/)
  assert.doesNotMatch(routeSource, /\.from\("ops_registration_subject_tracks"\)/)
})

test("route response carries the server-owned revision, changed tracks, and warning", () => {
  assert.match(routeSource, /ok: failed === 0/)
  assert.match(routeSource, /appointmentId/)
  assert.match(routeSource, /notificationRevision/)
  assert.match(routeSource, /notifiedTrackIds/)
  assert.match(routeSource, /warning/)
})

test("visit cancellation and replacement dispatch only canonical revision targets", async () => {
  const source = await readFile(new URL("../src/features/tasks/registration-appointment-editor.tsx", import.meta.url), "utf8")
  assert.match(source, /notificationTargets/)
  assert.match(source, /cancelRegistrationAppointment/)
  assert.match(source, /sendRegistrationVisitNotificationTarget/)
})

test("visit notification helper sends only the authoritative appointment id", async () => {
  const send = notificationModel.sendRegistrationVisitNotificationTarget
  assert.equal(typeof send, "function")
  if (typeof send !== "function") return
  const previousFetch = globalThis.fetch
  const requests = []
  globalThis.fetch = async (url, init) => {
    requests.push({ url, init })
    return new Response(JSON.stringify({ ok: true, appointmentId: "appointment-1", notificationRevision: 2, notifiedTrackIds: ["eng"] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  }
  try {
    const result = await send({ appointmentId: "appointment-1", notificationRevision: 2 }, "session-token")
    assert.equal(result.appointmentId, "appointment-1")
    assert.deepEqual(JSON.parse(requests[0].init.body), { appointmentId: "appointment-1" })
    assert.equal(requests[0].init.headers.Authorization, "Bearer session-token")
  } finally {
    globalThis.fetch = previousFetch
  }
})

test("visit notification helper exposes mocked failures for explicit retry", async () => {
  const send = notificationModel.sendRegistrationVisitNotificationTarget
  assert.equal(typeof send, "function")
  if (typeof send !== "function") return
  const previousFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: false, error: "mock webhook unavailable" }), {
    status: 503,
    headers: { "Content-Type": "application/json" },
  })
  try {
    await assert.rejects(
      send({ appointmentId: "appointment-1", notificationRevision: 2 }, "session-token"),
      /mock webhook unavailable/,
    )
  } finally {
    globalThis.fetch = previousFetch
  }
})

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `missing start marker: ${startMarker}`);
  assert.ok(end > start, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test("consultation reservation requires a profile-linked responsible counselor", () => {
  const withoutLinkedCounselor = getRegistrationTransitionBlockers({
    type: "registration",
    secondaryAssigneeId: "",
    registration: {
      counselor: "정보영",
      phoneConsultationAt: "2026-07-12T10:00:00+09:00",
    },
  }, "2. 상담 예약");

  const withLinkedCounselor = getRegistrationTransitionBlockers({
    type: "registration",
    secondaryAssigneeId: "profile-principal-1",
    registration: {
      counselor: "정보영",
      phoneConsultationAt: "2026-07-12T10:00:00+09:00",
    },
  }, "2. 상담 예약");

  assert.ok(withoutLinkedCounselor.includes("상담 책임자"));
  assert.equal(withLinkedCounselor.includes("상담 책임자"), false);
});

test("consultation notification route permits only authenticated admin or staff operators", () => {
  assert.match(routeSource, /getAuthenticatedContext\(request\)/);
  assert.match(routeSource, /role === "admin"/);
  assert.match(routeSource, /role === "staff"/);
  assert.match(routeSource, /status: 401/);
  assert.match(routeSource, /status: 403/);
});

test("consultation notification route fails closed before materialization or Google Chat during migration", () => {
  assert.match(routeSource, /registration_subject_tracks_runtime_version/);
  assert.match(routeSource, /registration_notification_handoffs_runtime_version/);
  assert.match(routeSource, /REGISTRATION_MIGRATION_IN_PROGRESS/);
  assert.match(routeSource, /runtimeState\.mode !== "ready"/);
  const postSource = routeSource.slice(routeSource.indexOf("export async function POST"));
  const readinessIndex = postSource.indexOf("await probeRegistrationNotificationRuntime");
  const firstMaterialization = postSource.indexOf("get_registration_visit_legacy_dispatch_plan_v1");
  assert.ok(readinessIndex >= 0);
  assert.ok(firstMaterialization > readinessIndex);
});

test("consultation notification route reads business data only through fixed-purpose server RPCs", () => {
  assert.match(routeSource, /\.from\("profiles"\)/);
  assert.match(routeSource, /get_registration_visit_legacy_dispatch_plan_v1/);
  assert.match(routeSource, /commit_registration_visit_legacy_in_app_v1/);
  assert.match(routeSource, /materialize_registration_visit_legacy_google_chat_v1/);
  assert.doesNotMatch(routeSource, /\.from\("ops_tasks"\)/);
  assert.doesNotMatch(routeSource, /\.from\("ops_task_events"\)/);
});

test("consultation notification route atomically commits the counselor inbox through common ownership", () => {
  assert.match(routeSource, /commit_registration_visit_legacy_in_app_v1/);
  assert.doesNotMatch(routeSource, /materialize_registration_visit_legacy_in_app_v1/);
  assert.doesNotMatch(routeSource, /commit_legacy_notification_in_app_projection_v1/);
  assert.match(routeSource, /deterministicRequestId/);
  assert.doesNotMatch(routeSource, /\.from\("dashboard_notifications"\)/);
  assert.equal(
    notificationModel.getRegistrationVisitTrackHref?.("task-1", "track-1"),
    "/admin/registration?taskId=task-1&trackId=track-1",
  );
});

test("consultation notification route uses server-rendered delivery content for admin Google Chat", () => {
  assert.match(routeSource, /materialize_registration_visit_legacy_google_chat_v1/);
  assert.match(routeSource, /begin_registration_visit_legacy_google_chat_v1/);
  assert.match(routeSource, /finalize_registration_visit_legacy_google_chat_v1/);
  assert.match(routeSource, /\.from\("google_chat_webhook_settings"\)/);
  assert.match(routeSource, /\.eq\("channel", "admin"\)/);
  assert.match(routeSource, /rendered_title: item\.renderedTitle/);
  assert.match(routeSource, /rendered_body: item\.renderedBody/);
  assert.doesNotMatch(routeSource, /body\.(?:title|message|target|href|recipient)/);
});

test("consultation notification route accepts only appointmentId and does not forward arbitrary client text", () => {
  assert.match(routeSource, /const appointmentId = text\(body\.appointmentId\)/);

  const clientBodyFields = [
    ...routeSource.matchAll(/\bbody(?:\?\.)?\.([A-Za-z_][A-Za-z0-9_]*)/g),
  ].map((match) => match[1]);

  assert.deepEqual([...new Set(clientBodyFields)], ["appointmentId"]);
  assert.doesNotMatch(routeSource, /JSON\.stringify\(body\)/);
});

test("canonical task links come only from the server dispatch plan", () => {
  assert.match(routeSource, /href: text\(raw\.href\)/);
  assert.match(routeSource, /item\.href\.startsWith\("\/admin\/registration"\)/);
  assert.doesNotMatch(routeSource, /body\.href/);
  assert.doesNotMatch(routeSource, /new URL\([^)]*request\.url/);
});

test("canonical visit identity includes place while create dispatches only server targets", () => {

  const message = notificationModel.buildRegistrationVisitCanonicalMessage?.({
    state: "updated",
    studentName: "김다미",
    scheduledAt: "2026. 7. 12. 오후 3:00",
    place: "상담실 A",
    subjectDirectorPairs: [{ subject: "영어", directorName: "강부희" }],
  });
  assert.match(message || "", /상담실 A/);
  assert.match(message || "", /영어: 강부희/);
  assert.match(workspaceSource, /sendRegistrationVisitNotificationTarget\(target/);
  assert.match(workspaceSource, /dispatchRegistrationVisitNotificationTargets/);
  assert.match(notificationModel.partitionRegistrationVisitNotificationResults?.toString() || "", /getConsultationNotificationWarning\(result\.value\)/);
  assert.match(notificationModel.partitionRegistrationVisitNotificationResults?.toString() || "", /result\.value\?\.ok === false/);
  assert.match(workspaceSource, /savedWithNotificationDeliveryFailure/);
  assert.match(workspaceSource, /savedWithNotificationAuditWarning/);
  assert.match(workspaceSource, /방문상담 알림 전달은 접수됐습니다\. 감사 이력을 확인하세요\./);
  assert.match(workspaceSource, /방문상담 알림은 전송하지 못했습니다\. 업무는 정상 저장되었습니다\./);
  assert.doesNotMatch(workspaceSource, /notifyRegistrationConsultationReservation/);
});

test("admin Google Chat acquires shared ownership before provider work", () => {
  const materializeIndex = routeSource.indexOf("materialize_registration_visit_legacy_google_chat_v1");
  const beginIndex = routeSource.indexOf("begin_registration_visit_legacy_google_chat_v1");
  const providerIndex = routeSource.indexOf("await provider.send");
  assert.ok(materializeIndex >= 0);
  assert.ok(beginIndex > materializeIndex);
  assert.ok(providerIndex > beginIndex);
  assert.match(routeSource, /if \(!begun\.acquired\) \{[\s\S]*return "deduped"/);
});

test("admin Google Chat interruption replay validates its begin request and closes delivery_unknown", () => {
  const requestIndex = routeSource.indexOf("const requestId = deterministicRequestId(");
  const replayIndex = routeSource.indexOf("isInterruptedDispatchReplay(begun, requestId)");
  const providerIndex = routeSource.indexOf("await provider.send");

  assert.ok(requestIndex >= 0 && replayIndex > requestIndex);
  assert.ok(providerIndex > replayIndex);
  assert.match(routeSource, /text\(value\.request_id\) === expectedRequestId/);
  assert.match(routeSource, /UUID\.test\(text\(value\.claim_id\)\)/);
  assert.match(routeSource, /\^\\d\+\$/);
  assert.match(routeSource, /UUID\.test\(text\(value\.dispatch_token\)\)/);
  assert.match(
    routeSource,
    /if \(isInterruptedDispatchReplay\(begun, requestId\)\)[\s\S]*finalizeGoogleChat\([\s\S]*"delivery_unknown"[\s\S]*"legacy_dispatch_recovered_after_interruption"[\s\S]*return "delivery_unknown"/,
  );
  assert.doesNotMatch(routeSource, /if \(!begun\.acquired\) return "deduped"/);
});

test("admin Google Chat finalizes sent, failed, and unknown through the shared ledger", () => {
  assert.match(routeSource, /async function finalizeGoogleChat/);
  assert.match(routeSource, /finalize_registration_visit_legacy_google_chat_v1/);
  assert.match(routeSource, /"sent" \| "failed" \| "delivery_unknown"/);
  assert.doesNotMatch(routeSource, /\.delete\(\)[\s\S]{0,180}dashboard_notifications/);
});

test("admin Google Chat reads the trusted connection and bounds provider time", () => {
  assert.match(routeSource, /readLegacyGoogleChatWebhookUrl/);
  assert.match(routeSource, /GOOGLE_CHAT_WEBHOOK_ADMIN/);
  assert.match(routeSource, /AbortSignal\.timeout\(10_000\)/);
  assert.match(routeSource, /createGoogleChatProvider/);
});

test("post-send audit state is finalized inside the fixed-purpose RPC", () => {
  assert.match(routeSource, /finalize_registration_visit_legacy_google_chat_v1/);
  assert.doesNotMatch(routeSource, /\.from\("ops_task_events"\)/);
  assert.doesNotMatch(routeSource, /\.from\("dashboard_notifications"\)/);
});

test("network and timeout ambiguity finalize delivery_unknown without blind retry", () => {
  const providerIndex = routeSource.indexOf("await provider.send");
  const catchIndex = routeSource.indexOf("} catch (error) {", providerIndex);
  const unknownIndex = routeSource.indexOf('"delivery_unknown"', catchIndex);
  assert.ok(providerIndex >= 0 && catchIndex > providerIndex && unknownIndex > catchIndex);
  assert.match(routeSource, /자동 재전송하지 않았습니다/);
});

test("definite provider failure is surfaced for explicit failed-target retry", () => {
  assert.match(routeSource, /result\.status === "delivery_unknown"/);
  assert.match(routeSource, /: "failed"/);
  assert.match(routeSource, /if \(failed > 0\)[\s\S]{0,120}status: 502/);
});

test("claim conflict state decisions are conservative at runtime", () => {
  const decide = notificationModel.getAdminChatClaimConflictDecision;
  assert.equal(typeof decide, "function");
  if (typeof decide !== "function") return;

  assert.deepEqual(decide("sent"), { ok: true, status: 200, error: "" });
  for (const status of ["sending", "delivery_unknown", "", "unexpected"]) {
    const result = decide(status);
    assert.equal(result.ok, false, status);
    assert.equal(result.status, 409, status);
    assert.ok(result.error, status);
  }
});

test("delivery failure policies distinguish definite from ambiguous outcomes at runtime", () => {
  const policy = notificationModel.getAdminChatDeliveryFailurePolicy;
  assert.equal(typeof policy, "function");
  if (typeof policy !== "function") return;

  assert.deepEqual(policy("pre_send"), { releaseClaim: true, claimStatus: "" });
  assert.deepEqual(policy("http_non_ok"), { releaseClaim: true, claimStatus: "" });
  assert.deepEqual(policy("network"), { releaseClaim: false, claimStatus: "delivery_unknown" });
  assert.deepEqual(policy("timeout"), { releaseClaim: false, claimStatus: "delivery_unknown" });
  assert.deepEqual(policy("unexpected"), { releaseClaim: false, claimStatus: "delivery_unknown" });
});

test("internal admin-chat claims are filtered by the server-owned inbox RPC boundary", () => {
  const inboxReaderSource = dashboardNotificationServiceSource.slice(
    dashboardNotificationServiceSource.indexOf("export async function loadDashboardNotifications"),
  );
  assert.match(inboxReaderSource, /get_dashboard_notification_inbox_v1/);
  assert.match(inboxReaderSource, /get_dashboard_notification_unread_count_v1/);
  assert.match(inboxReaderSource, /mark_dashboard_notification_read_v1/);
  assert.doesNotMatch(inboxReaderSource, /REGISTRATION_ADMIN_CHAT_CLAIM_TYPE/);
  assert.doesNotMatch(inboxReaderSource, /\.from\("dashboard_notifications"\)/);
});

test("successful route warnings are returned to the client at runtime", () => {
  const readWarning = notificationModel.getConsultationNotificationWarning;
  assert.equal(typeof readWarning, "function");
  if (typeof readWarning !== "function") return;

  assert.equal(readWarning({ ok: true, warning: "Google Chat 감사 이력을 확인하세요." }), "Google Chat 감사 이력을 확인하세요.");
  assert.equal(readWarning({ ok: true }), "");
  assert.equal(readWarning({ ok: false, warning: "ignored" }), "");

  assert.match(routeSource, /warning: deliveryUnknown > 0/);
  assert.match(routeSource, /자동 재전송하지 않았습니다/);
});

test("registration no longer has a generic browser Google Chat sender", () => {
  assert.doesNotMatch(workspaceSource, /async function notifyRegistrationWorkflow/);
  assert.match(workspaceSource, /loadRegistrationLegacyNotificationSourceIds/);
  assert.match(workspaceSource, /dispatchLegacyOpsTaskSources/);
});

test("initial-plan counselor selectors preserve per-subject defaults and explicit choices", () => {
  assert.match(initialPlanSource, /resolvedDirectorIds\[subject\]/);
  assert.match(initialPlanSource, /draft\.directorOverrides\[subject\] \|\| resolvedDirectorId/);
  assert.match(initialPlanSource, /directorOptionsBySubject\[subject\]/);
});

test("direct pipeline transitions keep the saved state when canonical reload fails", () => {
  const transitionBlock = sourceBlock(
    workspaceSource,
    "const changeRegistrationPipeline = async",
    "const undoStatusChange",
  );

  assert.match(transitionBlock, /fallbackNotificationTask = buildLocalTaskFromInput/);
  assert.match(transitionBlock, /try \{[\s\S]*await loadOpsTaskById\(task\.id\)[\s\S]*\} catch/);
  assert.match(transitionBlock, /refreshWarning/);
  assert.doesNotMatch(transitionBlock, /consultation-notification/);
  assert.doesNotMatch(transitionBlock, /notifyRegistrationConsultationReservation/);
});

test("appointment mutations retain only opaque common notification job references", async () => {
  const { createRegistrationTrackService } = await loadRegistrationServiceFactory();
  const harness = registrationRpcHarness((name) => {
    assert.equal(name, "save_registration_shared_appointment");
    return {
      data: {
        appointment_id: "appointment-1",
        notification_revision: 7,
        notification_targets: [],
        requires_director_assignment_track_ids: [],
        notification_jobs: [
          { job_kind: "fanout", job_id: "job-fanout", private_payload: "must-not-leak" },
          { job_kind: "target_reconciliation", job_id: "job-target", cursor: "must-not-leak" },
        ],
      },
      error: null,
    };
  });
  const service = createRegistrationTrackService(harness.client, readyRegistrationOptions());

  const result = await service.saveRegistrationSharedAppointment({
    appointmentId: "appointment-1",
    taskId: "task-1",
    kind: "level_test",
    scheduledAt: "2026-07-20T06:00:00.000Z",
    place: "본관",
    trackIds: ["track-1"],
    replaceRemaining: false,
    expectedNotificationRevision: 6,
    requestKey: "save-request",
  });

  assert.deepEqual(Array.from(result.notificationJobs, (job) => ({ ...job })), [
    { jobKind: "fanout", jobId: "job-fanout" },
    { jobKind: "target_reconciliation", jobId: "job-target" },
  ]);
  assert.equal(JSON.stringify(result).includes("private_payload"), false);
  assert.equal(JSON.stringify(result).includes("cursor"), false);
});

test("reminder preview maps only the approved snake-case future-round fields", async () => {
  const { createRegistrationTrackService } = await loadRegistrationServiceFactory();
  const harness = registrationRpcHarness((name) => {
    assert.equal(name, "preview_registration_appointment_reminders_v1");
    return {
      data: [{
        rule_id: "rule-1",
        rule_revision: "9007199254740993",
        variant_key: "previous_day_at",
        scheduled_for: "2026-07-19T05:00:00.000Z",
        audience_key: "management_team",
        channel_key: "in_app",
        title_template: "must-not-leak",
        recipient_profile_id: "must-not-leak",
      }],
      error: null,
    };
  });
  const service = createRegistrationTrackService(harness.client, readyRegistrationOptions());

  const result = await service.previewRegistrationAppointmentReminders({
    kind: "level_test",
    scheduledAt: "2026-07-20T06:00:00.000Z",
    trackIds: ["track-1"],
  });

  assert.deepEqual(Array.from(result, (round) => ({ ...round })), [{
    ruleId: "rule-1",
    ruleRevision: "9007199254740993",
    variantKey: "previous_day_at",
    scheduledFor: "2026-07-19T05:00:00.000Z",
    audienceKey: "management_team",
    channelKey: "in_app",
  }]);
  assert.deepEqual({ ...harness.calls[0][1] }, {
    p_kind: "level_test",
    p_scheduled_at: "2026-07-20T06:00:00.000Z",
    p_track_ids: ["track-1"],
  });
});

test("notification job status uses the exact common getter and strips every unsafe field", async () => {
  const { createRegistrationTrackService } = await loadRegistrationServiceFactory();
  const harness = registrationRpcHarness((name) => {
    assert.equal(name, "get_notification_orchestration_job_status_v1");
    return {
      data: {
        job_kind: "fanout",
        job_id: "job-1",
        workflow_key: "registration",
        status: "failed",
        attempt_count: 3,
        next_attempt_at: null,
        last_error_code: "provider_timeout",
        created_at: "2026-07-17T01:00:00.000Z",
        completed_at: null,
        source_event_id: "must-not-leak",
        payload: { secret: true },
      },
      error: null,
    };
  });
  const service = createRegistrationTrackService(harness.client, readyRegistrationOptions());

  const result = await service.getRegistrationNotificationJobStatus({
    jobKind: "fanout",
    jobId: "job-1",
  });

  assert.deepEqual({ ...result }, {
    jobKind: "fanout",
    jobId: "job-1",
    workflowKey: "registration",
    status: "failed",
    attemptCount: 3,
    nextAttemptAt: null,
    lastErrorCode: "provider_timeout",
    createdAt: "2026-07-17T01:00:00.000Z",
    completedAt: null,
  });
  assert.deepEqual({ ...harness.calls[0][1] }, {
    p_job_kind: "fanout",
    p_job_id: "job-1",
  });
  assert.equal(JSON.stringify(result).includes("source_event_id"), false);
  assert.equal(JSON.stringify(result).includes("payload"), false);
});

test("failed notification retry keeps one request id and calls only the exact common retry RPC", async () => {
  const { createRegistrationTrackService } = await loadRegistrationServiceFactory();
  const harness = registrationRpcHarness((name) => {
    assert.equal(name, "retry_notification_orchestration_job_v1");
    return {
      data: {
        job_kind: "target_reconciliation",
        job_id: "job-target",
        workflow_key: "registration",
        status: "pending",
        attempt_count: 4,
        next_attempt_at: null,
        last_error_code: null,
        created_at: "2026-07-17T01:00:00.000Z",
        completed_at: null,
      },
      error: null,
    };
  });
  const service = createRegistrationTrackService(harness.client, readyRegistrationOptions());
  const input = {
    jobKind: "target_reconciliation",
    jobId: "job-target",
    expectedAttemptCount: 3,
    requestId: "stable-retry-request",
  };

  await service.retryRegistrationNotificationJob(input);
  await service.retryRegistrationNotificationJob(input);

  assert.deepEqual(harness.calls.map(([name]) => name), [
    "retry_notification_orchestration_job_v1",
    "retry_notification_orchestration_job_v1",
  ]);
  for (const [, args] of harness.calls) {
    assert.deepEqual({ ...args }, {
      p_job_kind: "target_reconciliation",
      p_job_id: "job-target",
      p_expected_attempt_count: 3,
      p_request_id: "stable-retry-request",
    });
  }
  assert.equal(harness.calls.some(([name]) => [
    "save_registration_shared_appointment",
    "cancel_registration_appointment",
  ].includes(name)), false);
});

test("notification job status rejects another workflow and unknown states", async () => {
  const { createRegistrationTrackService } = await loadRegistrationServiceFactory();
  for (const row of [
    { workflow_key: "withdrawal", status: "failed" },
    { workflow_key: "registration", status: "paused" },
  ]) {
    const harness = registrationRpcHarness(() => ({
      data: {
        job_kind: "fanout",
        job_id: "job-invalid",
        attempt_count: 0,
        next_attempt_at: null,
        last_error_code: null,
        created_at: "2026-07-17T01:00:00.000Z",
        completed_at: null,
        ...row,
      },
      error: null,
    }));
    const service = createRegistrationTrackService(harness.client, readyRegistrationOptions());
    await assert.rejects(
      service.getRegistrationNotificationJobStatus({ jobKind: "fanout", jobId: "job-invalid" }),
      /registration_notification_job_(workflow_mismatch|status_invalid)/,
    );
  }
});

test("appointment editor preserves conflict drafts, removes invented cancellation reasons, and keeps common ownership", async () => {
  const source = await readFile(appointmentEditorUrl, "utf8");
  const conflictBlock = sourceBlock(source, "async function handleRevisionConflict", "async function compareLatestAppointment");

  assert.match(source, /최신 예약 비교/);
  assert.match(source, /다시 적용/);
  assert.match(source, /계속 편집/);
  assert.doesNotMatch(conflictBlock, /resetAuthoritativeDraft/);
  assert.doesNotMatch(conflictBlock, /submissionKeys\.clear/);
  assert.match(source, /persistedAppointmentSubmissionKeys/);
  assert.match(source, /conflictServerSnapshotKey[\s\S]*notificationRevision:\s*appointment\.notificationRevision/);
  assert.match(source, /latestConflictServerKey[\s\S]*setConflict\(\{[\s\S]*server:\s*\{ \.\.\.appointment \}/);
  assert.match(source, /submissionKeys\.clear\("registration-appointment", normalizedDraft\)/);
  assert.doesNotMatch(source, /cancelReason/);
  assert.doesNotMatch(source, /예약 취소 사유/);
  assert.match(source, /reason:\s*""/);
  assert.match(source, /buildRegistrationAppointmentConfirmation/);
  assert.doesNotMatch(source, /NotificationControlPanel/);
});

test("appointment processing UI is fail-closed and retry never replays save or cancel", async () => {
  const source = await readFile(appointmentEditorUrl, "utf8");
  const retryBlock = sourceBlock(source, "async function retryRegistrationNotificationJobStatus", "async function reloadAfterCommittedMutation");

  assert.match(source, /isRegistrationNotificationProcessingReady/);
  assert.match(source, /getRegistrationNotificationProcessingReadiness\(notificationToken\)/);
  assert.match(source, /effectiveProcessingReadiness/);
  assert.match(source, /예약 저장됨 · 알림 재계산 중/);
  assert.match(source, /알림 재계산 완료/);
  assert.match(source, /알림 재계산 실패 · 다시 시도/);
  assert.match(retryBlock, /retryRegistrationNotificationJob/);
  assert.doesNotMatch(retryBlock, /saveRegistrationSharedAppointment/);
  assert.doesNotMatch(retryBlock, /cancelRegistrationAppointment/);
  assert.doesNotMatch(source, /예약 저장과 알림 처리는 완료되었습니다/);
  assert.match(source, /notificationProcessingCompleted[\s\S]*예약 저장과 알림 재계산은 완료되었습니다/);
  assert.match(source, /notificationProcessingPhase === "succeeded"[\s\S]*알림 재계산 상태는 아직 확인되지 않았습니다/);
});

test("processing readiness is loaded from the fixed authenticated operations view", async () => {
  const source = await readFile(registrationServiceUrl, "utf8");
  assert.match(source, /\/api\/notifications\/operations\?view=registration-processing-readiness/);
  assert.match(source, /cache:\s*"no-store"/);
  assert.match(source, /Authorization:\s*`Bearer \$\{token\}`/);
  assert.match(source, /registrationRuntimeMarker:\s*"registration_appointment_reminders_runtime_version"/);
  assert.match(source, /adaptersRuntimeMarker:\s*"notification_workflow_adapters_runtime_version"/);
});
