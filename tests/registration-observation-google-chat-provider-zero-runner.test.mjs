import assert from "node:assert/strict";
import { createHash, randomBytes as nodeRandomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  PINNED_SUPABASE_GO,
  PINNED_SUPABASE_VERSION,
  assertProviderZeroEnvironment,
  createOwnedProviderZeroProject,
  installProviderZeroTransportTraps,
  parseProviderZeroArguments,
  registrationObservationProviderZeroHistoryFixtureSql,
  registrationObservationProviderZeroPrerequisiteSql,
  runRegistrationObservationGoogleChatProviderZero,
} from "../scripts/run-registration-observation-google-chat-provider-zero.mjs";

const require = createRequire(import.meta.url);
const http = require("node:http");
const https = require("node:https");

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const packageJsonPath = path.join(repositoryRoot, "package.json");
const frozenCommonRunnerPath = path.join(
  repositoryRoot,
  "scripts/run-registration-observation-local-db-qa.mjs",
);
const forwardPgTapPath = "supabase/tests/notification_adapters_forward_install_test.sql";
const pendingSchedulePgTapPath = "supabase/tests/notification_delivery_pending_schedule_test.sql";
const baselineReceiptFixture = "registration_observation_provider_zero_baseline_marker_missing";
const coreReceiptFixture = JSON.stringify({
  coreReadiness: { schemaReady: true, missingObjects: [], runtimeVersion: 0 },
  coreActivation: { previousVersion: 0, runtimeVersion: 1, replayEqual: true },
  heartbeat: {
    workerId: "notification-worker-route-v1",
    phase: "succeeded",
    countKeys: [
      "observation_due",
      "fanout",
      "rule_reconciliation",
      "target_reconciliation",
      "deliveries",
      "reaped",
    ],
    allZero: true,
  },
  sharedFlags: {
    notification_control_plane_settings_ui_enabled: { enabled: true, revision: "2" },
    notification_control_plane_dispatch_registration_enabled: { enabled: true, revision: "2" },
  },
  externalAttemptAudit: 0,
});
const lifecycleReceiptFixture = JSON.stringify({
  v2RuleSaveReceiptExact: true,
  googleChatPrepareBoundaryReached: true,
  googleChatDeliveryStatus: "sending",
  scheduledMentionUserNames: ["users/123456788"],
  feedbackMentionUserNames: ["users/123456789"],
  directorReassignedMentionUserNames: ["users/123456789", "users/987654321"],
  missingIdentityMentionUserNames: [],
  inAppCommitBoundaryReached: true,
  inAppDeliveryStatus: "sent",
  inAppDashboardNotificationCount: 1,
  inAppPushChildrenCreated: 0,
  missingDirectorPair: {
    managementStatus: "sending",
    managementConnectionKey: "google_chat.management",
    inAppStatus: "canceled",
    inAppStatusReason: "recipient_revoked",
  },
  inactiveDirectorPair: {
    managementStatus: "sending",
    managementConnectionKey: "google_chat.management",
    inAppStatus: "canceled",
    inAppStatusReason: "recipient_revoked",
  },
  missingDirectorBeforeFanout: {
    managementDeliveryCount: 1,
    inAppDeliveryCount: 0,
  },
  customerQueueUnchanged: true,
  solapiMessagesUnchanged: true,
  externalAttemptAudit: 0,
  nodeDispatchClaim: {
    delivery_id: "95200000-0000-4000-8000-000000000117",
    claim_token: "95200000-0000-4000-8000-000000000118",
  },
});
const nodeDispatchReceiptFixture = Object.freeze({
  productionDispatchSeam: true,
  status: "sending",
  channelKey: "google_chat",
  connectionKey: "google_chat.management",
  mentionUserNames: ["users/987654321"],
  externalAttemptAudit: 0,
});

async function forwardMigrationPath() {
  const migrationDirectory = path.join(repositoryRoot, "supabase", "migrations");
  const entries = (await readdir(migrationDirectory))
    .filter((entry) => /^[0-9]{14}_notification_adapters_forward_install\.sql$/u.test(entry))
    .sort();
  assert.equal(entries.length, 1, "forward migration fixture must be singular");
  return path.join(migrationDirectory, entries[0]);
}

async function pendingScheduleMigrationPath() {
  const migrationDirectory = path.join(repositoryRoot, "supabase", "migrations");
  const entries = (await readdir(migrationDirectory))
    .filter((entry) => /^[0-9]{14}_notification_delivery_pending_schedule_fix\.sql$/u.test(entry))
    .sort();
  assert.equal(entries.length, 1, "pending-delivery migration fixture must be singular");
  return path.join(migrationDirectory, entries[0]);
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function returnedTemplateSource(source, functionName) {
  const start = source.indexOf(`export function ${functionName}() {`);
  assert.notEqual(start, -1, `frozen ${functionName} fixture must exist`);
  const returnStart = source.indexOf("  return `", start);
  const returnEnd = source.indexOf("`;\n}", returnStart);
  assert.notEqual(returnStart, -1, `frozen ${functionName} return must exist`);
  assert.notEqual(returnEnd, -1, `frozen ${functionName} template must close`);
  return source.slice(returnStart + "  return ".length, returnEnd + 1);
}

function safeEnvironment(extra = {}) {
  return {
    HOME: process.env.HOME ?? "/tmp",
    LANG: process.env.LANG ?? "en_US.UTF-8",
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    SHELL: process.env.SHELL ?? "/bin/zsh",
    TMPDIR: process.env.TMPDIR ?? os.tmpdir(),
    USER: process.env.USER ?? "provider-zero-test",
    ...extra,
  };
}

function projectIdFromCommand(args) {
  const index = args.indexOf("--project-id");
  return index === -1 ? null : args[index + 1] ?? null;
}

function sequentialPorts(firstPort) {
  let nextPort = firstPort;
  return async () => {
    const allocated = nextPort;
    nextPort += 1;
    return allocated;
  };
}

async function createRecordedRun({
  coreReceipt = coreReceiptFixture,
  lifecycleReceipt = lifecycleReceiptFixture,
} = {}) {
  const calls = [];
  let runtimeRoot;
  const makeTempRoot = async () => {
    runtimeRoot = await mkdtemp(
      path.join(os.tmpdir(), "tips-registration-observation-provider-zero-test-"),
    );
    return runtimeRoot;
  };
  const spawnImpl = async (executable, args, options = {}) => {
    calls.push({ executable, args: [...args], options });
    if (executable === PINNED_SUPABASE_GO && args[0] === "--version") {
      return { stdout: `${PINNED_SUPABASE_VERSION}\n`, stderr: "" };
    }
    if (executable === "docker" && args[0] === "ps") {
      return { stdout: "", stderr: "" };
    }
    if (executable === "docker" && args[0] === "network") {
      return { stdout: "", stderr: "" };
    }
    if (executable === "docker" && args[0] === "volume") {
      return { stdout: "", stderr: "" };
    }
    if (executable === "docker" && args[0] === "context" && args[1] === "inspect") {
      return {
        stdout: JSON.stringify([
          { Endpoints: { docker: { Host: "unix:///var/run/docker.sock" } } },
        ]),
        stderr: "",
      };
    }
    if (executable === "docker" && args[0] === "exec") {
      const sql = args.at(-1);
      if (sql.includes(baselineReceiptFixture)) {
        return {
          stdout: sql.includes("set_notification_runtime_flag_v1")
            && sql.includes("notification_control_plane_dispatch_registration_enabled")
            && sql.includes("notification_runtime_not_ready")
            ? `${baselineReceiptFixture}\n`
            : "",
          stderr: "",
        };
      }
      return {
        stdout: sql.includes("registration_observation_provider_zero_lifecycle_receipt")
          ? `${lifecycleReceipt}\n`
          : sql.includes("registration_observation_provider_zero_core_receipt")
            ? `${coreReceipt}\n`
            : "",
        stderr: "",
      };
    }
    return { stdout: "", stderr: "" };
  };
  return {
    calls,
    makeTempRoot,
    spawnImpl,
    randomBytes: () => Buffer.from("0123456789ab", "hex"),
    async runProductionDispatch() {
      return nodeDispatchReceiptFixture;
    },
    async cleanup() {
      if (runtimeRoot) await rm(runtimeRoot, { recursive: true, force: true });
    },
  };
}

test("requires the real production dispatch seam before accepting provider-zero evidence", async () => {
  // Break caught: SQL-only refresh/final-prepare receipts must not stand in for
  // the exported TypeScript worker preparation path required by the lifecycle
  // contract.
  const recorded = await createRecordedRun();
  let receivedClaim = null;
  try {
    const receipt = await runRegistrationObservationGoogleChatProviderZero({
      argv: ["--execute", "--approved-local-db"],
      env: safeEnvironment(),
      repositoryRoot,
      makeTempRoot: recorded.makeTempRoot,
      spawnImpl: recorded.spawnImpl,
      randomBytes: recorded.randomBytes,
      allocateLoopbackPort: sequentialPorts(55000),
      inspectResources: async () => [],
      runProductionDispatch: async (_project, claim) => {
        receivedClaim = claim;
        return nodeDispatchReceiptFixture;
      },
    });
    assert.deepEqual(receivedClaim, JSON.parse(lifecycleReceiptFixture).nodeDispatchClaim);
    assert.deepEqual(receipt.nodeDispatch, nodeDispatchReceiptFixture);
  } finally {
    await recorded.cleanup();
  }
});

test("derives the local fanout target generation from the materialized observation payload", async () => {
  // Break caught: a hard-coded target generation lets the SQL-only fixture
  // reach prepare while the exported worker correctly cancels the same delivery
  // as recipient_revoked against the current notification revision.
  const runnerSource = await readFile(
    path.join(repositoryRoot, "scripts", "run-registration-observation-google-chat-provider-zero.mjs"),
    "utf8",
  );
  assert.match(
    runnerSource,
    /v_target_generation bigint;[\s\S]*v_target_generation := \(v_event\.payload ->> 'appointment_notification_revision'\)::bigint;/u,
  );
  assert.match(
    runnerSource,
    /\(v_rule_snapshot ->> 'rule_revision'\)::bigint,\n    v_target_generation,\n    dashboard_private\.notification_target_set_hash_v1/u,
  );
});

test("rejects unapproved provider-zero invocation before allocating a local project", async () => {
  // Break caught: removing the explicit two-flag approval lets a CLI invocation
  // create disposable Docker resources without the user's local-db consent.
  let makeTempRootCalls = 0;
  let spawnCalls = 0;
  await assert.rejects(
    runRegistrationObservationGoogleChatProviderZero({
      argv: [],
      env: safeEnvironment(),
      makeTempRoot: async () => {
        makeTempRootCalls += 1;
        return "/tmp/should-not-exist";
      },
      spawnImpl: async () => {
        spawnCalls += 1;
        return { stdout: "", stderr: "" };
      },
    }),
    /registration_observation_google_chat_provider_zero_execute_required/,
  );
  assert.equal(makeTempRootCalls, 0);
  assert.equal(spawnCalls, 0);
  assert.deepEqual(
    parseProviderZeroArguments(["--execute", "--approved-local-db"]),
    { execute: true, approvedLocalDb: true },
  );
});

test("exposes only the approved local lifecycle command", async () => {
  // Break caught: without this narrow package command, an operator can mistake
  // the common local-db runner for the provider-zero lifecycle proof.
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  assert.equal(
    packageJson.scripts?.["verify:registration-observation:google-chat"],
    "node --experimental-strip-types scripts/run-registration-observation-google-chat-provider-zero.mjs --execute --approved-local-db",
  );
});

test("rejects provider secrets and strips all non-local child environment values", async () => {
  // Break caught: inheriting an ambient provider or Supabase credential could
  // redirect a supposedly local proof to a real external system.
  assert.throws(
    () => assertProviderZeroEnvironment(safeEnvironment({ GOOGLE_CHAT_WEBHOOK_URL: "forbidden" })),
    /provider_zero_secret_environment_forbidden/,
  );
  assert.deepEqual(
    assertProviderZeroEnvironment(safeEnvironment({ CI: "true", CUSTOM_TOKEN: "ignored" })),
    {
      HOME: safeEnvironment().HOME,
      LANG: safeEnvironment().LANG,
      PATH: safeEnvironment().PATH,
      SHELL: safeEnvironment().SHELL,
      TMPDIR: safeEnvironment().TMPDIR,
      USER: safeEnvironment().USER,
    },
  );
});

test("rejects a notification worker secret before allocating or spawning the provider-zero lifecycle", async () => {
  // Break caught: omitting NOTIFICATION_WORKER_SECRET from the entry boundary
  // lets a credential-bearing process begin the supposedly provider-zero run.
  let makeTempRootCalls = 0;
  let spawnCalls = 0;
  await assert.rejects(
    runRegistrationObservationGoogleChatProviderZero({
      argv: ["--execute", "--approved-local-db"],
      env: safeEnvironment({ NOTIFICATION_WORKER_SECRET: "forbidden" }),
      makeTempRoot: async () => {
        makeTempRootCalls += 1;
        return "/tmp/should-not-exist";
      },
      spawnImpl: async () => {
        spawnCalls += 1;
        return { stdout: "", stderr: "" };
      },
    }),
    /provider_zero_secret_environment_forbidden/,
  );
  assert.equal(makeTempRootCalls, 0);
  assert.equal(spawnCalls, 0);
});

test("owns byte-identical prerequisite and history fixtures without importing the frozen runner", async () => {
  // Break caught: changing either independently-owned fixture byte can make the
  // baseline schema differ from the established local-db proof.
  const frozenSource = await readFile(frozenCommonRunnerPath, "utf8");
  const prerequisiteTemplate = returnedTemplateSource(
    frozenSource,
    "registrationObservationLocalQaPrerequisiteSql",
  );
  const historyTemplate = returnedTemplateSource(
    frozenSource,
    "registrationObservationLocalQaHistoryFixtureSql",
  );

  assert.equal(
    sha256(registrationObservationProviderZeroPrerequisiteSql()),
    sha256(prerequisiteTemplate.slice(1, -1)),
  );
  assert.equal(
    sha256(registrationObservationProviderZeroHistoryFixtureSql()),
    sha256(historyTemplate.slice(1, -1)),
  );
});

test("executes only owned loopback commands and reports the staged lifecycle receipt", async () => {
  // Break caught: applying the forward package outside the owned project, or
  // accepting a marker-only receipt, would fabricate the provider-zero proof.
  const recorded = await createRecordedRun();
  try {
    const receipt = await runRegistrationObservationGoogleChatProviderZero({
      argv: ["--execute", "--approved-local-db"],
      env: safeEnvironment(),
      repositoryRoot,
      makeTempRoot: recorded.makeTempRoot,
      spawnImpl: recorded.spawnImpl,
      randomBytes: recorded.randomBytes,
      allocateLoopbackPort: sequentialPorts(55100),
      inspectResources: async () => [],
      runProductionDispatch: recorded.runProductionDispatch,
    });

    assert.equal(receipt.baselineMarkerMissing, true);
    assert.equal(receipt.orderedCallTraceExact, true);
    assert.deepEqual(receipt.coreReadiness, { schemaReady: true, missingObjects: [], runtimeVersion: 0 });
    assert.deepEqual(receipt.coreActivation, { previousVersion: 0, runtimeVersion: 1, replayEqual: true });
    assert.equal(receipt.v2RuleSaveReceiptExact, true);
    assert.equal(receipt.googleChatDeliveryStatus, "sending");
    assert.deepEqual(receipt.directorReassignedMentionUserNames, [
      "users/123456789",
      "users/987654321",
    ]);
    assert.deepEqual(receipt.missingIdentityMentionUserNames, []);
    assert.equal(receipt.inAppDeliveryStatus, "sent");
    assert.equal(receipt.inAppDashboardNotificationCount, 1);
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
    assert.equal(receipt.fetch, 0);
    assert.equal(receipt.http, 0);
    assert.equal(receipt.https, 0);
    assert.equal(receipt.provider, 0);
    assert.equal(receipt.directory, 0);
    assert.equal(receipt.externalAttemptAudit, 0);
    assert.equal(receipt.cleanupComplete, true);

    const projectCommands = recorded.calls.filter(({ executable }) =>
      executable === PINNED_SUPABASE_GO,
    );
    assert.ok(projectCommands.length >= 4);
    for (const call of projectCommands) {
      assert.equal(call.executable, PINNED_SUPABASE_GO);
      assert.equal(call.options.env.GOOGLE_CHAT_WEBHOOK_URL, undefined);
      assert.equal(call.options.env.SUPABASE_URL, undefined);
      assert.equal(call.options.env.SOLAPI_API_KEY, undefined);
    }
    const workdirs = projectCommands
      .flatMap(({ args }) => args.flatMap((argument, index) =>
        argument === "--workdir" ? [args[index + 1]] : [],
      ));
    assert.ok(workdirs.length > 0);
    assert.equal(new Set(workdirs).size, 1);
    assert.match(workdirs[0], /tips-registration-observation-provider-zero-/u);
    const projectIds = recorded.calls
      .map(({ args }) => projectIdFromCommand(args))
      .filter(Boolean);
    assert.ok(projectIds.length > 0);
    assert.equal(new Set(projectIds).size, 1);
    assert.match(projectIds[0], /^tips_obs_provider_zero_[a-f0-9]{12}$/u);
    const dbUrls = recorded.calls
      .flatMap(({ args }) => args.flatMap((argument, index) =>
        argument === "--db-url" ? [args[index + 1]] : [],
      ));
    assert.ok(dbUrls.length > 0);
    assert.equal(new Set(dbUrls).size, 1);
    assert.match(dbUrls[0], /^postgresql:\/\/postgres:postgres@127\.0\.0\.1:[0-9]+\/postgres$/u);
  } finally {
    await recorded.cleanup();
  }
});

test("rejects a lifecycle receipt that records an external attempt", async () => {
  // Break caught: returning raw SQL JSON without a closed evidence gate can
  // report a provider-zero success even when the lifecycle crossed its stop.
  const lifecycleReceipt = {
    ...JSON.parse(lifecycleReceiptFixture),
    externalAttemptAudit: 1,
  };
  const recorded = await createRecordedRun({
    lifecycleReceipt: JSON.stringify(lifecycleReceipt),
  });
  try {
    await assert.rejects(
      runRegistrationObservationGoogleChatProviderZero({
        argv: ["--execute", "--approved-local-db"],
        env: safeEnvironment(),
        repositoryRoot,
        makeTempRoot: recorded.makeTempRoot,
        spawnImpl: recorded.spawnImpl,
        randomBytes: recorded.randomBytes,
        allocateLoopbackPort: sequentialPorts(55200),
        inspectResources: async () => [],
        runProductionDispatch: recorded.runProductionDispatch,
      }),
      /registration_observation_google_chat_provider_zero_evidence_invalid/,
    );
  } finally {
    await recorded.cleanup();
  }
});

test("resets the disposable database between every focused pgTAP suite and the core receipt", async () => {
  // Break caught: carrying committed pgTAP worker or adapter state into the
  // receipt would fabricate initial revisions and dependency readiness.
  const recorded = await createRecordedRun();
  try {
    await runRegistrationObservationGoogleChatProviderZero({
      argv: ["--execute", "--approved-local-db"],
      env: safeEnvironment(),
      repositoryRoot,
      makeTempRoot: recorded.makeTempRoot,
      spawnImpl: recorded.spawnImpl,
      randomBytes: recorded.randomBytes,
      allocateLoopbackPort: sequentialPorts(55300),
      inspectResources: async () => [],
      runProductionDispatch: recorded.runProductionDispatch,
    });
    const lifecycle = recorded.calls
      .filter(({ executable }) => executable === PINNED_SUPABASE_GO)
      .map(({ args }) => args.slice(0, 2).join(" "));
    assert.deepEqual(lifecycle, [
      "--version",
      "db start",
      "db reset",
      "test db",
      "db reset",
      "db reset",
      "test db",
      "db reset",
      "test db",
      "db reset",
      "stop --workdir",
    ]);
  } finally {
    await recorded.cleanup();
  }
});

test("stages exactly the generated forward migration after the baseline and runs only its focused pgTAP", async () => {
  // Break caught: applying a future active migration before the baseline, or
  // accepting an arbitrary test path, would fabricate the forward-install proof.
  const recorded = await createRecordedRun();
  let project;
  try {
    project = await createOwnedProviderZeroProject({
      repositoryRoot,
      env: safeEnvironment(),
      makeTempRoot: recorded.makeTempRoot,
      spawnImpl: recorded.spawnImpl,
      randomBytes: recorded.randomBytes,
      allocateLoopbackPort: sequentialPorts(55400),
      inspectResources: async () => [],
    });
    const migrationPath = await forwardMigrationPath();
    await project.applyMigrationsThrough("20260809105000");
    await project.applyForwardMigration(migrationPath, forwardPgTapPath);
    await project.runPgTap(forwardPgTapPath);

    const stagedMigration = path.join(
      project.runtimeRoot,
      "supabase",
      "migrations",
      path.basename(migrationPath),
    );
    assert.equal(await readFile(stagedMigration, "utf8"), await readFile(migrationPath, "utf8"));
    assert.equal(
      await readFile(
        path.join(
          project.runtimeRoot,
          "supabase",
          "focus-tests",
          "notification-adapters-forward-install",
          "001_notification_adapters_forward_install_test.sql",
        ),
        "utf8",
      ),
      await readFile(path.join(repositoryRoot, forwardPgTapPath), "utf8"),
    );
    const testCall = recorded.calls.find(
      ({ executable, args }) => executable === PINNED_SUPABASE_GO && args[0] === "test" && args[1] === "db",
    );
    assert.ok(testCall, "forward pgTAP must run through the owned Supabase CLI project");
    assert.ok(
      testCall.args.some((argument) =>
        /focus-tests\/notification-adapters-forward-install$/u.test(argument),
      ),
      "forward pgTAP command must target only its staged focused directory",
    );
  } finally {
    if (project) await project.cleanupOwnedResources();
    await recorded.cleanup();
  }
});

test("stages the pending-delivery constraint fix after the adapter package and runs its focused pgTAP", async () => {
  // Break caught: omitting the additive delivery fix leaves the provider-zero
  // lifecycle on the known pending/retry constraint violation after activation.
  const recorded = await createRecordedRun();
  let project;
  try {
    project = await createOwnedProviderZeroProject({
      repositoryRoot,
      env: safeEnvironment(),
      makeTempRoot: recorded.makeTempRoot,
      spawnImpl: recorded.spawnImpl,
      randomBytes: recorded.randomBytes,
      allocateLoopbackPort: sequentialPorts(55500),
      inspectResources: async () => [],
    });
    const adapterMigration = await forwardMigrationPath();
    const pendingScheduleMigration = await pendingScheduleMigrationPath();
    await project.applyMigrationsThrough("20260809105000");
    await project.applyForwardMigration(adapterMigration, forwardPgTapPath);
    await project.runPgTap(forwardPgTapPath);
    await project.applyForwardMigration(
      pendingScheduleMigration,
      pendingSchedulePgTapPath,
    );
    await project.runPgTap(pendingSchedulePgTapPath);

    const stagedMigration = path.join(
      project.runtimeRoot,
      "supabase",
      "migrations",
      path.basename(pendingScheduleMigration),
    );
    assert.equal(
      await readFile(stagedMigration, "utf8"),
      await readFile(pendingScheduleMigration, "utf8"),
    );
    const testCalls = recorded.calls.filter(
      ({ executable, args }) => executable === PINNED_SUPABASE_GO && args[0] === "test" && args[1] === "db",
    );
    assert.equal(testCalls.length, 2);
    assert.ok(
      testCalls[1].args.some((argument) =>
        /focus-tests\/notification-delivery-pending-schedule$/u.test(argument),
      ),
      "pending-delivery pgTAP command must target only its staged focused directory",
    );
  } finally {
    if (project) await project.cleanupOwnedResources();
    await recorded.cleanup();
  }
});

test("creates a manifest-owned project with cleanup hooks instead of sharing common-runner state", async () => {
  // Break caught: an accidental runtime import or shared resource lets one
  // baseline test stop/remove another local verification project.
  const recorded = await createRecordedRun();
  try {
    const project = await createOwnedProviderZeroProject({
      repositoryRoot,
      env: safeEnvironment(),
      makeTempRoot: recorded.makeTempRoot,
      spawnImpl: recorded.spawnImpl,
      randomBytes: nodeRandomBytes,
      allocateLoopbackPort: sequentialPorts(55200),
      inspectResources: async () => [],
    });
    const manifest = JSON.parse(await readFile(project.manifestPath, "utf8"));
    assert.equal(manifest.projectId, project.projectId);
    assert.equal(manifest.host, "127.0.0.1");
    assert.equal(manifest.dbUrl, project.dbUrl);
    assert.equal(manifest.migrationCeiling, "20260809105000");
    assert.deepEqual(manifest.resources, [
      `supabase_db_${project.projectId}`,
      `supabase_network_${project.projectId}`,
      `supabase_db_${project.projectId}`,
    ]);
    await project.cleanupOwnedResources();
  } finally {
    await recorded.cleanup();
  }
});

test("uses its default loopback allocator when no test override is supplied", async () => {
  // Break caught: a default-parameter name collision prevents the real CLI
  // entrypoint from reaching its local-only project setup at all.
  const recorded = await createRecordedRun();
  try {
    const project = await createOwnedProviderZeroProject({
      repositoryRoot,
      env: safeEnvironment(),
      makeTempRoot: recorded.makeTempRoot,
      spawnImpl: recorded.spawnImpl,
      randomBytes: recorded.randomBytes,
      inspectResources: async () => [],
    });
    assert.equal(project.ports.host, "127.0.0.1");
    assert.equal(new Set([
      project.ports.apiPort,
      project.ports.dbPort,
      project.ports.shadowPort,
      project.ports.poolerPort,
    ]).size, 4);
    await project.cleanupOwnedResources();
  } finally {
    await recorded.cleanup();
  }
});

test("removes its owned temp root when the pinned CLI preflight rejects", async () => {
  // Break caught: a failed version gate before project construction must not
  // leak the manifest root that would later be mistaken for another run.
  let runtimeRoot;
  const makeTempRoot = async () => {
    runtimeRoot = await mkdtemp(
      path.join(os.tmpdir(), "tips-registration-observation-provider-zero-test-"),
    );
    return runtimeRoot;
  };
  await assert.rejects(
    createOwnedProviderZeroProject({
      repositoryRoot,
      env: safeEnvironment(),
      makeTempRoot,
      randomBytes: () => Buffer.from("0123456789ab", "hex"),
      spawnImpl: async () => ({ stdout: "0.0.0\n", stderr: "" }),
    }),
    /registration_observation_google_chat_provider_zero_cli_version_mismatch:0\.0\.0/,
  );
  assert.equal(existsSync(runtimeRoot), false);
});

test("cleans manifest-owned resources when db start fails after partial creation", async () => {
  // Break caught: marking the project as started only after db start returns
  // skips stop/inventory if the CLI creates Docker resources before failing.
  const calls = [];
  let inventoryCalls = 0;
  const runtimeRoot = await mkdtemp(
    path.join(os.tmpdir(), "tips-registration-observation-provider-zero-test-"),
  );
  let project;
  try {
    project = await createOwnedProviderZeroProject({
      repositoryRoot,
      env: safeEnvironment(),
      makeTempRoot: async () => runtimeRoot,
      spawnImpl: async (executable, args, options = {}) => {
        calls.push({ executable, args: [...args], options });
        if (executable === PINNED_SUPABASE_GO && args[0] === "--version") {
          return { stdout: `${PINNED_SUPABASE_VERSION}\n`, stderr: "" };
        }
        if (executable === "docker" && args[0] === "context" && args[1] === "inspect") {
          return {
            stdout: JSON.stringify([
              { Endpoints: { docker: { Host: "unix:///var/run/docker.sock" } } },
            ]),
            stderr: "",
          };
        }
        if (executable === PINNED_SUPABASE_GO && args[0] === "db" && args[1] === "start") {
          throw new Error("provider_zero_db_start_partial_failure");
        }
        return { stdout: "", stderr: "" };
      },
      randomBytes: () => Buffer.from("fedcba987654", "hex"),
      allocateLoopbackPort: sequentialPorts(55600),
      inspectResources: async () => {
        inventoryCalls += 1;
        return [];
      },
    });
    await assert.rejects(
      project.applyMigrationsThrough("20260809105000"),
      /provider_zero_db_start_partial_failure/,
    );
    await project.cleanupOwnedResources();
    assert.equal(
      calls.filter(({ executable, args }) =>
        executable === PINNED_SUPABASE_GO && args[0] === "stop",
      ).length,
      1,
    );
    assert.equal(inventoryCalls, 2);
  } finally {
    if (project) await project.cleanupOwnedResources().catch(() => undefined);
    await rm(runtimeRoot, { recursive: true, force: true });
  }
});

test("rejects a remote Docker context before starting an owned provider-zero database", async () => {
  // Break caught: relying on Docker's ambient context can run the local-only
  // harness against a remote daemon before its loopback project exists.
  const calls = [];
  const runtimeRoot = await mkdtemp(
    path.join(os.tmpdir(), "tips-registration-observation-provider-zero-test-"),
  );
  let project;
  try {
    project = await createOwnedProviderZeroProject({
      repositoryRoot,
      env: safeEnvironment(),
      makeTempRoot: async () => runtimeRoot,
      spawnImpl: async (executable, args, options = {}) => {
        calls.push({ executable, args: [...args], options });
        if (executable === PINNED_SUPABASE_GO && args[0] === "--version") {
          return { stdout: `${PINNED_SUPABASE_VERSION}\n`, stderr: "" };
        }
        if (executable === "docker" && args[0] === "context" && args[1] === "inspect") {
          return {
            stdout: JSON.stringify([
              { Endpoints: { docker: { Host: "tcp://docker.example.invalid:2376" } } },
            ]),
            stderr: "",
          };
        }
        return { stdout: "", stderr: "" };
      },
      randomBytes: () => Buffer.from("1234567890ab", "hex"),
      allocateLoopbackPort: sequentialPorts(55700),
      inspectResources: async () => [],
    });
    await assert.rejects(
      project.applyMigrationsThrough("20260809105000"),
      /registration_observation_google_chat_provider_zero_docker_context_rejected/,
    );
    assert.equal(
      calls.filter(({ executable, args }) =>
        executable === PINNED_SUPABASE_GO && args[0] === "db" && args[1] === "start",
      ).length,
      0,
    );
  } finally {
    if (project) await project.cleanupOwnedResources().catch(() => undefined);
    await rm(runtimeRoot, { recursive: true, force: true });
  }
});

test("blocks every non-owned Node transport before a provider-zero lifecycle starts", async () => {
  // Break caught: leaving http/https unpatched lets a future adapter bypass the
  // fetch trap and make a provider request during a supposedly no-send proof.
  const traps = installProviderZeroTransportTraps(() => null);
  try {
    await assert.rejects(
      globalThis.fetch("https://provider.example.invalid/send"),
      /registration_observation_provider_zero_external_fetch_forbidden/,
    );
    assert.throws(
      () => http.get("http://provider.example.invalid/send"),
      /registration_observation_provider_zero_external_http_forbidden/,
    );
    assert.throws(
      () => https.get("https://provider.example.invalid/send"),
      /registration_observation_provider_zero_external_https_forbidden/,
    );
    const esmHttp = await import("node:http");
    const esmHttps = await import("node:https");
    assert.throws(
      () => esmHttp.get("http://provider.example.invalid/send"),
      /registration_observation_provider_zero_external_http_forbidden/,
    );
    assert.throws(
      () => esmHttps.get("https://provider.example.invalid/send"),
      /registration_observation_provider_zero_external_https_forbidden/,
    );
    assert.deepEqual(traps.counters, {
      fetch: 1,
      http: 2,
      https: 2,
      provider: 0,
      directory: 0,
      externalAttempt: 0,
    });
  } finally {
    traps.restore();
  }
});
