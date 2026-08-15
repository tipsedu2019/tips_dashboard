import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const runnerPath = path.join(
  repositoryRoot,
  "scripts/run-registration-observation-local-db-qa.mjs",
);
const pinnedSupabaseGo =
  "/Users/hyunjun/.npm/_npx/aa8e5c70f9d8d161/node_modules/@supabase/cli-darwin-arm64/bin/supabase-go";
const loopbackDbUrl =
  "postgresql://postgres:postgres@127.0.0.1:61002/postgres";
const runtimePortManifest = Object.freeze({
  host: "127.0.0.1",
  apiPort: 61001,
  dbPort: 61002,
  shadowPort: 61003,
  poolerPort: 61004,
  dbUrl: loopbackDbUrl,
});
const projectId = "tips_obs_qa_0123456789ab";
const temporaryProjectPath = path.join(
  os.tmpdir(),
  "tips-registration-observation-qa-0123456789ab",
);
const focusPgTapDirectoryPath = path.join(
  temporaryProjectPath,
  "supabase/focus-tests/schema",
);
const containerName = `supabase_db_${projectId}`;
const focusSetupSql = "begin; commit;";
const focusCleanupSql = "begin; commit;";
const freshRuntimeZeroAssertionSql = [
  "begin;",
  "do $$ begin",
  "  if (select activation_version from dashboard_private.registration_observation_runtime_settings where singleton = true) <> 0 then",
  "    raise exception 'registration_observation_runtime_not_zero';",
  "  end if;",
  "end $$;",
  "commit;",
].join("\n");

function runnerEnvironment(extra = {}) {
  return {
    HOME: process.env.HOME,
    LANG: process.env.LANG,
    PATH: process.env.PATH,
    SHELL: process.env.SHELL,
    TMPDIR: process.env.TMPDIR,
    USER: process.env.USER,
    ...extra,
  };
}

function runRunner(args = [], environment = {}) {
  return spawnSync(process.execPath, [runnerPath, ...args], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: runnerEnvironment(environment),
  });
}

async function loadRunner() {
  return import(`file://${runnerPath}?test=${Date.now()}-${Math.random()}`);
}

function spawnPortLeaseChild(leaseRoot, childProjectId) {
  const childScript = `
const subject = await import(process.argv[1]);
const candidates = Array.from({ length: 16 }, (_, index) => 62001 + index);
const manifest = await subject.buildRegistrationObservationRuntimePortManifest({
  projectId: process.argv[3],
  leaseRoot: process.argv[2],
  allocateLoopbackPort: async () => candidates.shift(),
});
process.stdout.write(JSON.stringify(manifest) + "\\n");
await new Promise((resolve) => process.stdin.once("data", resolve));
await subject.releaseRegistrationObservationRuntimePortLeases(manifest);
`;
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      childScript,
      pathToFileURL(runnerPath).href,
      leaseRoot,
      childProjectId,
    ],
    {
      cwd: repositoryRoot,
      env: runnerEnvironment(),
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const manifest = new Promise((resolve, reject) => {
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      const newline = stdout.indexOf("\n");
      if (newline === -1) return;
      try {
        resolve(JSON.parse(stdout.slice(0, newline)));
      } catch (error) {
        reject(error);
      }
    });
    child.once("error", reject);
    child.once("exit", (status) => {
      if (!stdout.includes("\n")) {
        reject(new Error(`lease child exited ${status}: ${stderr}`));
      }
    });
  });
  const release = async () => {
    if (child.exitCode !== null) return;
    const completed = new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (status) => {
        if (status === 0) resolve();
        else reject(new Error(`lease child exited ${status}: ${stderr}`));
      });
    });
    child.stdin.end("release\n");
    await completed;
  };
  return { child, manifest, release };
}

function planInput() {
  return {
    repositoryRoot,
    runtimeRoot: temporaryProjectPath,
    projectId,
    focus: "schema",
    runtimePortManifest,
    migrationPaths: [
      "supabase/migrations/20260809100000_registration_observation_core_schema.sql",
    ],
    focusTestDirectoryPath: focusPgTapDirectoryPath,
    setupSql: focusSetupSql,
    cleanupSql: focusCleanupSql,
    freshAssertSql: freshRuntimeZeroAssertionSql,
  };
}

async function runWithFakeSpawn(configuration = {}) {
  const runner = await loadRunner();
  const failureNames = new Set(
    Array.isArray(configuration.failAt)
      ? configuration.failAt
      : [configuration.failAt, configuration.alsoFailAt].filter(Boolean),
  );
  const calls = [];
  const result = await runner.executeRegistrationObservationLocalDbQaPlan(
    runner.buildRegistrationObservationLocalDbQaPlan(planInput()),
    {
      runStep: async (step) => {
        calls.push(step.name);
        if (failureNames.has(step.name)) {
          throw new Error(`synthetic ${step.name} failure`);
        }
        return {
          stdout: step.name === "fresh-runtime0-assert"
            ? "registration_observation_provider_outbox_delta=0\n"
            : "",
          stderr: "",
        };
      },
      inspectResources: async () => [],
    },
  );
  return { ...result, calls };
}

test("runner is dry-run by default and rejects unknown focus", () => {
  const dryRun = runRunner([]);
  assert.equal(dryRun.status, 0, dryRun.stderr);
  assert.match(dryRun.stdout, /DRY RUN.*zero database changes/s);

  const unknown = runRunner([
    "--execute",
    "--approved-local-db",
    "--focus",
    "other",
  ]);
  assert.equal(unknown.status, 2);
  assert.match(
    unknown.stderr,
    /registration_observation_local_db_unknown_focus:other/,
  );
});

test("runner keeps every independent database reviewer gate", async () => {
  const runner = await loadRunner();
  assert.deepEqual(runner.listRegistrationObservationFocusNames(), [
    "schema",
    "booking",
    "workspace",
    "core-review",
    "feedback-access",
    "feedback-submit",
    "feedback",
    "enrollment",
    "chat-mentions",
    "google-chat",
    "solapi-contract",
    "solapi-queue",
    "solapi",
    "worker-schedule",
    "legacy-schedule",
  ]);
  assert.deepEqual(runner.getRegistrationObservationFocusContract("legacy-schedule"), {
    ceiling: "20260815035229",
    tests: [
      "supabase/tests/registration_observation_legacy_schedule_slots_test.sql",
    ],
  });
  assert.deepEqual(runner.getRegistrationObservationFocusContract("worker-schedule"), {
    ceiling: "20260812195130",
    tests: [
      "supabase/tests/notification_worker_production_schedule_test.sql",
    ],
  });
  assert.deepEqual(runner.getRegistrationObservationFocusContract("workspace"), {
    ceiling: "20260809102200",
    tests: [
      "supabase/tests/registration_observation_shared_event_filter_test.sql",
    ],
  });
  assert.deepEqual(runner.getRegistrationObservationFocusContract("core-review"), {
    ceiling: "20260809102450",
    tests: [
      "supabase/tests/registration_observation_core_review_fixes_test.sql",
      "supabase/tests/registration_observation_core_review_followup_test.sql",
    ],
  });
  assert.equal(
    runner.registrationObservationFocusCleanupSql("core-review"),
    "begin; commit;",
  );
  assert.equal(
    runner.registrationObservationFocusCleanupSql("workspace"),
    "begin; commit;",
  );
  assert.deepEqual(
    runner.getRegistrationObservationFocusContract("feedback-submit"),
    {
      ceiling: "20260809103000",
      fixture: { kind: "committed" },
      tests: [
        "supabase/tests/registration_observation_feedback_access_test.sql",
        "supabase/tests/registration_observation_feedback_submit_test.sql",
      ],
    },
  );
  assert.deepEqual(runner.getRegistrationObservationFocusContract("feedback"), {
    ceiling: "20260809103500",
    fixture: { kind: "committed" },
    tests: [
      "supabase/tests/registration_observation_feedback_access_test.sql",
      "supabase/tests/registration_observation_feedback_submit_test.sql",
      "supabase/tests/registration_observation_feedback_decisions_test.sql",
    ],
  });
});

test("Google Chat profile mentions own an isolated pre-provider database focus", async () => {
  const runner = await loadRunner();

  assert.deepEqual(
    runner.getRegistrationObservationFocusContract("chat-mentions"),
    {
      ceiling: "20260809104500",
      tests: ["supabase/tests/dashboard_google_chat_profile_mentions_test.sql"],
    },
  );
  assert.equal(
    runner.listRegistrationObservationFocusNames().indexOf("chat-mentions")
      < runner.listRegistrationObservationFocusNames().indexOf("google-chat"),
    true,
  );
});

test("feedback owns the Task 2 committed manifest plus a director decision worker", async () => {
  // Production break caught: feedback aliases feedback-submit/noop and never
  // supplies the committed director identity used by the decision race.
  const runner = await loadRunner();
  const contract = runner.getRegistrationObservationFocusContract("feedback");
  const setupSql = runner.registrationObservationFocusSetupSql("feedback");
  const cleanupSql = runner.registrationObservationFocusCleanupSql("feedback");
  const freshSql = runner.registrationObservationSchemaFreshAssertionSql(
    "feedback",
  );

  assert.equal(contract.fixture.kind, "committed");
  assert.deepEqual(
    contract.tests.map((testPath, index) =>
      runner.registrationObservationFocusTestStagedName(index, testPath)
    ),
    [
      "001_registration_observation_feedback_access_test.sql",
      "002_registration_observation_feedback_submit_test.sql",
      "003_registration_observation_feedback_decisions_test.sql",
    ],
  );
  assert.match(setupSql, /^begin;/i);
  assert.match(setupSql, /create extension if not exists dblink;/i);
  for (const id of [
    "99200000-0000-4000-8000-000000000001",
    "99200000-0000-4000-8000-000000000003",
    "99200000-0000-4000-8000-000000000004",
    "99200000-0000-4000-8000-000000000108",
  ]) assert.match(setupSql, new RegExp(id, "i"));
  assert.match(
    setupSql,
    /director_profile_id[\s\S]*99200000-0000-4000-8000-000000000004/i,
  );
  assert.match(
    setupSql,
    /update dashboard_private\.registration_observation_runtime_settings[\s\S]*activation_version = 1/i,
  );
  assert.match(setupSql, /commit;$/i);

  const eventDelete = cleanupSql.indexOf(
    "delete from dashboard_private.registration_observation_domain_events",
  );
  const receiptDelete = cleanupSql.indexOf(
    "delete from dashboard_private.registration_observation_mutation_requests",
  );
  const observationDelete = cleanupSql.indexOf(
    "delete from public.ops_registration_observations",
  );
  const appointmentDelete = cleanupSql.indexOf(
    "delete from public.ops_registration_appointments",
  );
  const trackDelete = cleanupSql.indexOf(
    "delete from public.ops_registration_subject_tracks",
  );
  assert.ok(eventDelete >= 0 && eventDelete < receiptDelete);
  assert.ok(receiptDelete < observationDelete);
  assert.ok(observationDelete < appointmentDelete);
  assert.ok(appointmentDelete < trackDelete);
  assert.match(cleanupSql, /99200000-0000-4000-8000-000000000004/i);
  assert.match(
    cleanupSql,
    /activation_version = 0[\s\S]*updated_by = null/i,
  );

  assert.match(freshSql, /registration_observation_runtime_not_zero/i);
  assert.match(freshSql, /99200000-0000-4000-8000-000000000004/i);
  assert.match(freshSql, /registration_observation_feedback_fixture_remains/i);
  assert.match(freshSql, /registration_observation_provider_outbox_delta=0/i);
});

test("feedback committed plan keeps exact argv and failure cleanup order", async () => {
  // Production break caught: feedback runs the wrong pgTAP directory or skips
  // reverse cleanup/fresh runtime-zero after setup, test, or cleanup failure.
  const runner = await loadRunner();
  const setupSql = runner.registrationObservationFocusSetupSql("feedback");
  const cleanupSql = runner.registrationObservationFocusCleanupSql("feedback");
  const freshSql = runner.registrationObservationSchemaFreshAssertionSql(
    "feedback",
  );
  const feedbackDirectory = path.join(
    temporaryProjectPath,
    "supabase/focus-tests/feedback",
  );
  const input = {
    ...planInput(),
    focus: "feedback",
    focusTestDirectoryPath: feedbackDirectory,
    setupSql,
    cleanupSql,
    freshAssertSql: freshSql,
  };
  const plan = runner.buildRegistrationObservationLocalDbQaPlan(input);
  const psqlArgv = (sql) => [
    "docker", "exec", "-i", containerName, "psql", "-X", "-qAt",
    "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres",
    "-c", sql,
  ];
  assert.deepEqual(plan.steps[2].argv, psqlArgv(setupSql));
  assert.deepEqual(plan.steps[3].argv, [
    pinnedSupabaseGo,
    "test",
    "db",
    "--workdir",
    temporaryProjectPath,
    feedbackDirectory,
    "--db-url",
    loopbackDbUrl,
  ]);
  assert.deepEqual(plan.steps[4].argv, psqlArgv(cleanupSql));
  assert.deepEqual(plan.steps[5].argv, psqlArgv(freshSql));

  const expectedSuccess = [
    "db-start",
    "db-reset",
    "focus-fixture-setup",
    "pgtap",
    "focus-fixture-cleanup",
    "fresh-runtime0-assert",
    "db-stop",
  ];
  for (const failedStep of [
    "focus-fixture-setup",
    "pgtap",
    "focus-fixture-cleanup",
  ]) {
    const calls = [];
    const result = await runner.executeRegistrationObservationLocalDbQaPlan(
      plan,
      {
        runStep: async (step) => {
          calls.push(step.name);
          if (step.name === failedStep) {
            throw new Error(`synthetic ${failedStep} failure`);
          }
          return {
            stdout: step.name === "fresh-runtime0-assert"
              ? "registration_observation_provider_outbox_delta=0\n"
              : "",
          };
        },
        inspectResources: async () => [],
      },
    );
    assert.equal(result.status, 1);
    assert.deepEqual(
      calls,
      failedStep === "focus-fixture-setup"
        ? [
            "db-start",
            "db-reset",
            "focus-fixture-setup",
            "focus-fixture-cleanup",
            "fresh-runtime0-assert",
            "db-stop",
          ]
        : expectedSuccess,
    );
  }
});

test("feedback submit owns a committed runtime-one fixture and exact fresh cleanup", async () => {
  // Production break caught: feedback-submit remains a downstream placeholder,
  // so cross-session race workers cannot see committed rows or prove cleanup.
  const runner = await loadRunner();
  const contract = runner.getRegistrationObservationFocusContract(
    "feedback-submit",
  );
  const setupSql = runner.registrationObservationFocusSetupSql(
    "feedback-submit",
  );
  const cleanupSql = runner.registrationObservationFocusCleanupSql(
    "feedback-submit",
  );
  const freshSql = runner.registrationObservationSchemaFreshAssertionSql(
    "feedback-submit",
  );

  assert.equal(contract.fixture.kind, "committed");
  assert.match(setupSql, /^begin;/i);
  assert.match(setupSql, /create extension if not exists dblink;/i);
  assert.match(setupSql, /99200000-0000-4000-8000-000000000001/i);
  assert.match(setupSql, /99200000-0000-4000-8000-000000000108/i);
  assert.match(
    setupSql,
    /update dashboard_private\.registration_observation_runtime_settings[\s\S]*activation_version = 1/i,
  );
  assert.match(setupSql, /commit;$/i);

  const eventDelete = cleanupSql.indexOf(
    "delete from dashboard_private.registration_observation_domain_events",
  );
  const receiptDelete = cleanupSql.indexOf(
    "delete from dashboard_private.registration_observation_mutation_requests",
  );
  const observationDelete = cleanupSql.indexOf(
    "delete from public.ops_registration_observations",
  );
  const appointmentDelete = cleanupSql.indexOf(
    "delete from public.ops_registration_appointments",
  );
  const trackDelete = cleanupSql.indexOf(
    "delete from public.ops_registration_subject_tracks",
  );
  const taskDelete = cleanupSql.indexOf("delete from public.ops_tasks");
  const profileDelete = cleanupSql.indexOf("delete from public.profiles");
  assert.ok(eventDelete >= 0 && eventDelete < receiptDelete);
  assert.ok(receiptDelete < observationDelete);
  assert.ok(observationDelete < appointmentDelete);
  assert.ok(appointmentDelete < trackDelete);
  assert.ok(trackDelete < taskDelete);
  assert.ok(taskDelete < profileDelete);
  assert.match(
    cleanupSql,
    /activation_version = 0[\s\S]*updated_by = null/i,
  );
  assert.match(cleanupSql, /^begin;/i);
  assert.match(cleanupSql, /commit;$/i);

  assert.match(freshSql, /registration_observation_runtime_not_zero/i);
  assert.match(freshSql, /registration_observation_runtime_actor_not_cleared/i);
  assert.match(freshSql, /99200000-0000-4000-8000-000000000001/i);
  assert.match(freshSql, /99200000-0000-4000-8000-000000000108/i);
  assert.match(freshSql, /registration_observation_feedback_fixture_remains/i);
  assert.match(freshSql, /registration_observation_provider_outbox_delta=0/i);
});

test("feedback committed fixture cleans up after setup pgTAP and cleanup failures", async () => {
  // Production break caught: an error path leaves runtime=1 or committed
  // feedback rows behind instead of continuing cleanup/fresh/stop in order.
  const runner = await loadRunner();
  const feedbackInput = {
    ...planInput(),
    focus: "feedback-submit",
    setupSql: runner.registrationObservationFocusSetupSql("feedback-submit"),
    cleanupSql: runner.registrationObservationFocusCleanupSql(
      "feedback-submit",
    ),
    freshAssertSql: runner.registrationObservationSchemaFreshAssertionSql(
      "feedback-submit",
    ),
  };
  const plan = runner.buildRegistrationObservationLocalDbQaPlan(feedbackInput);
  const expectedSuccess = [
    "db-start",
    "db-reset",
    "focus-fixture-setup",
    "pgtap",
    "focus-fixture-cleanup",
    "fresh-runtime0-assert",
    "db-stop",
  ];
  assert.deepEqual(plan.steps.map(({ name }) => name), expectedSuccess);

  for (const failedStep of [
    "focus-fixture-setup",
    "pgtap",
    "focus-fixture-cleanup",
  ]) {
    const calls = [];
    const result = await runner.executeRegistrationObservationLocalDbQaPlan(
      plan,
      {
        runStep: async (step) => {
          calls.push(step.name);
          if (step.name === failedStep) {
            throw new Error(`synthetic ${failedStep} failure`);
          }
          return {
            stdout: step.name === "fresh-runtime0-assert"
              ? "registration_observation_provider_outbox_delta=0\n"
              : "",
          };
        },
        inspectResources: async () => [],
      },
    );
    assert.equal(result.status, 1);
    const expectedCalls = failedStep === "focus-fixture-setup"
      ? [
          "db-start",
          "db-reset",
          "focus-fixture-setup",
          "focus-fixture-cleanup",
          "fresh-runtime0-assert",
          "db-stop",
        ]
      : expectedSuccess;
    assert.deepEqual(calls, expectedCalls);
  }
});

test("enrollment owns a committed runtime-zero activation fixture and marked deactivation cleanup", async () => {
  // Production break caught: enrollment aliases a downstream placeholder,
  // pre-activates runtime, or leaves the real activation receipt/fixtures
  // behind after its cross-session single-winner rehearsal.
  const runner = await loadRunner();
  const contract = runner.getRegistrationObservationFocusContract("enrollment");
  const setupSql = runner.registrationObservationFocusSetupSql("enrollment");
  const cleanupSql = runner.registrationObservationFocusCleanupSql("enrollment");
  const freshSql = runner.registrationObservationSchemaFreshAssertionSql(
    "enrollment",
  );

  assert.deepEqual(contract, {
    ceiling: "20260809104000",
    fixture: { kind: "committed" },
    tests: ["supabase/tests/registration_observation_enrollment_test.sql"],
  });
  assert.match(setupSql, /^begin;/i);
  assert.match(setupSql, /create extension if not exists dblink;/i);
  for (const id of [
    "99300000-0000-4000-8000-000000000001",
    "99300000-0000-4000-8000-000000000106",
    "99300000-0000-4000-8000-000000000108",
    "99300000-0000-4000-8000-000000000280",
    "99300000-0000-4000-8000-000000000281",
  ]) assert.match(setupSql, new RegExp(id, "i"));
  assert.match(
    setupSql,
    /registration_observation_runtime_settings[\s\S]*activation_version = 0/i,
  );
  assert.doesNotMatch(
    setupSql,
    /set\s+activation_version\s*=\s*1/i,
  );
  assert.match(setupSql, /commit;$/i);

  const deactivate = cleanupSql.indexOf(
    "$registration_observation_runtime_deactivate_v1$",
  );
  const enrollmentReceiptDelete = cleanupSql.indexOf(
    "delete from dashboard_private.ops_registration_mutations",
  );
  const activationReceiptDelete = cleanupSql.indexOf(
    "delete from dashboard_private.registration_observation_mutation_requests",
  );
  const observationDelete = cleanupSql.indexOf(
    "delete from public.ops_registration_observations",
  );
  const appointmentDelete = cleanupSql.indexOf(
    "delete from public.ops_registration_appointments",
  );
  const trackDelete = cleanupSql.indexOf(
    "delete from public.ops_registration_subject_tracks",
  );
  assert.ok(deactivate >= 0 && deactivate < enrollmentReceiptDelete);
  assert.ok(enrollmentReceiptDelete < activationReceiptDelete);
  assert.ok(activationReceiptDelete < observationDelete);
  assert.ok(observationDelete < appointmentDelete);
  assert.ok(appointmentDelete < trackDelete);
  assert.match(cleanupSql, /v_current not in \(0, 1\)/i);
  assert.match(
    cleanupSql,
    /if v_current = 1[\s\S]*activation_version = 0[\s\S]*updated_by = null/i,
  );
  assert.match(cleanupSql, /^begin;/i);
  assert.match(cleanupSql, /commit;$/i);
  assert.match(cleanupSql, /99300000-0000-4000-8000-000000000281/i);

  assert.match(freshSql, /registration_observation_runtime_not_zero/i);
  assert.match(freshSql, /registration_observation_runtime_actor_not_cleared/i);
  assert.match(freshSql, /99300000-0000-4000-8000-000000000108/i);
  assert.match(freshSql, /99300000-0000-4000-8000-000000000281/i);
  assert.match(freshSql, /registration_observation_enrollment_fixture_remains/i);
  assert.match(freshSql, /registration_observation_provider_outbox_delta=0/i);
});

test("enrollment committed plan keeps exact argv and cleanup order on every failure", async () => {
  // Production break caught: pgTAP runs before the committed fixture or a
  // setup/test/cleanup error skips deactivation, fresh runtime-zero proof, or
  // the final isolated database stop.
  const runner = await loadRunner();
  const setupSql = runner.registrationObservationFocusSetupSql("enrollment");
  const cleanupSql = runner.registrationObservationFocusCleanupSql("enrollment");
  const freshSql = runner.registrationObservationSchemaFreshAssertionSql(
    "enrollment",
  );
  const enrollmentDirectory = path.join(
    temporaryProjectPath,
    "supabase/focus-tests/enrollment",
  );
  const input = {
    ...planInput(),
    focus: "enrollment",
    focusTestDirectoryPath: enrollmentDirectory,
    setupSql,
    cleanupSql,
    freshAssertSql: freshSql,
  };
  const plan = runner.buildRegistrationObservationLocalDbQaPlan(input);
  const psqlArgv = (sql) => [
    "docker", "exec", "-i", containerName, "psql", "-X", "-qAt",
    "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres",
    "-c", sql,
  ];
  assert.deepEqual(plan.steps[2].argv, psqlArgv(setupSql));
  assert.deepEqual(plan.steps[3].argv, [
    pinnedSupabaseGo,
    "test",
    "db",
    "--workdir",
    temporaryProjectPath,
    enrollmentDirectory,
    "--db-url",
    loopbackDbUrl,
  ]);
  assert.deepEqual(plan.steps[4].argv, psqlArgv(cleanupSql));
  assert.deepEqual(plan.steps[5].argv, psqlArgv(freshSql));

  const expectedSuccess = [
    "db-start",
    "db-reset",
    "focus-fixture-setup",
    "pgtap",
    "focus-fixture-cleanup",
    "fresh-runtime0-assert",
    "db-stop",
  ];
  assert.deepEqual(plan.steps.map(({ name }) => name), expectedSuccess);
  for (const failedStep of [
    "focus-fixture-setup",
    "pgtap",
    "focus-fixture-cleanup",
  ]) {
    const calls = [];
    const result = await runner.executeRegistrationObservationLocalDbQaPlan(
      plan,
      {
        runStep: async (step) => {
          calls.push(step.name);
          if (step.name === failedStep) {
            throw new Error(`synthetic ${failedStep} failure`);
          }
          return {
            stdout: step.name === "fresh-runtime0-assert"
              ? "registration_observation_provider_outbox_delta=0\n"
              : "",
          };
        },
        inspectResources: async () => [],
      },
    );
    assert.equal(result.status, 1);
    assert.deepEqual(
      calls,
      failedStep === "focus-fixture-setup"
        ? [
            "db-start",
            "db-reset",
            "focus-fixture-setup",
            "focus-fixture-cleanup",
            "fresh-runtime0-assert",
            "db-stop",
          ]
        : expectedSuccess,
    );
  }
});

test("booking focus owns a committed runtime-one concurrency fixture and exact reverse cleanup", async () => {
  const runner = await loadRunner();
  const setupSql = runner.registrationObservationFocusSetupSql("booking");
  const cleanupSql = runner.registrationObservationFocusCleanupSql("booking");
  const freshSql = runner.registrationObservationSchemaFreshAssertionSql(
    "booking",
  );

  assert.match(setupSql, /^begin;/i);
  assert.match(setupSql, /create extension if not exists dblink;/i);
  assert.match(setupSql, /registration_observation_local_qa_provider_baselines/i);
  assert.match(setupSql, /99000000-0000-4000-8000-000000000001/i);
  assert.match(setupSql, /99000000-0000-4000-8000-000000000106/i);
  assert.match(setupSql, /99000000-0000-4000-8000-000000000116/i);
  assert.match(setupSql, /99000000-0000-4000-8000-000000000117/i);
  assert.match(setupSql, /99000000-0000-4000-8000-000000000118/i);
  assert.match(
    setupSql,
    /update dashboard_private\.registration_observation_runtime_settings[\s\S]*activation_version = 1/i,
  );
  assert.match(setupSql, /commit;$/i);

  const eventDelete = cleanupSql.indexOf(
    "delete from dashboard_private.registration_observation_domain_events",
  );
  const receiptDelete = cleanupSql.indexOf(
    "delete from dashboard_private.registration_observation_mutation_requests",
  );
  const observationDelete = cleanupSql.indexOf(
    "delete from public.ops_registration_observations",
  );
  const appointmentDelete = cleanupSql.indexOf(
    "delete from public.ops_registration_appointments",
  );
  const trackDelete = cleanupSql.indexOf(
    "delete from public.ops_registration_subject_tracks",
  );
  const taskDelete = cleanupSql.indexOf("delete from public.ops_tasks");
  const scheduleAuditContext = cleanupSql.indexOf(
    "with_continuous_class_schedule_audit_context_v1",
  );
  const sessionDelete = cleanupSql.indexOf(
    "delete from public.class_lesson_sessions",
  );
  const auditDelete = cleanupSql.indexOf(
    "delete from public.dashboard_audit_logs",
  );
  const classTriggerDisable = cleanupSql.indexOf(
    "alter table public.classes disable trigger dashboard_audit_classes",
  );
  const classDelete = cleanupSql.indexOf("delete from public.classes");
  const classTriggerEnable = cleanupSql.indexOf(
    "alter table public.classes enable trigger dashboard_audit_classes",
  );
  const profileDelete = cleanupSql.indexOf("delete from public.profiles");
  assert.ok(eventDelete >= 0 && eventDelete < receiptDelete);
  assert.ok(receiptDelete < observationDelete);
  assert.ok(observationDelete < appointmentDelete);
  assert.ok(appointmentDelete < trackDelete);
  assert.ok(trackDelete < taskDelete);
  assert.ok(taskDelete < scheduleAuditContext);
  assert.ok(scheduleAuditContext < sessionDelete);
  assert.ok(sessionDelete < auditDelete);
  assert.ok(auditDelete < classTriggerDisable);
  assert.ok(classTriggerDisable < classDelete);
  assert.ok(classDelete < classTriggerEnable);
  assert.ok(classTriggerEnable < profileDelete);
  assert.ok(taskDelete < profileDelete);
  assert.match(
    cleanupSql,
    /activation_version = 0[\s\S]*updated_by = null/i,
  );
  assert.match(cleanupSql, /^begin;/i);
  assert.match(cleanupSql, /commit;$/i);

  assert.match(freshSql, /registration_observation_runtime_not_zero/i);
  assert.match(freshSql, /registration_observation_runtime_actor_not_cleared/i);
  assert.match(freshSql, /99000000-0000-4000-8000-000000000106/i);
  assert.match(freshSql, /99000000-0000-4000-8000-000000000118/i);
  assert.match(freshSql, /public\.dashboard_audit_logs/i);
  assert.match(freshSql, /registration_observation_booking_fixture_remains/i);
});

test("booking committed fixture setup remains before pgTAP on success and every failure path", async () => {
  const runner = await loadRunner();
  const bookingInput = {
    ...planInput(),
    focus: "booking",
    preFixtureTestDirectoryPath: path.join(
      temporaryProjectPath,
      "supabase/focus-tests/booking-schema",
    ),
    setupSql: runner.registrationObservationFocusSetupSql("booking"),
    cleanupSql: runner.registrationObservationFocusCleanupSql("booking"),
    freshAssertSql: runner.registrationObservationSchemaFreshAssertionSql(
      "booking",
    ),
  };
  const plan = runner.buildRegistrationObservationLocalDbQaPlan(bookingInput);
  assert.deepEqual(plan.steps.map(({ name }) => name), [
    "db-start",
    "db-reset",
    "schema-pgtap",
    "focus-fixture-setup",
    "pgtap",
    "focus-fixture-cleanup",
    "fresh-runtime0-assert",
    "db-stop",
  ]);

  for (const failedStep of [
    "schema-pgtap",
    "focus-fixture-setup",
    "pgtap",
  ]) {
    const calls = [];
    const result = await runner.executeRegistrationObservationLocalDbQaPlan(
      plan,
      {
        runStep: async (step) => {
          calls.push(step.name);
          if (step.name === failedStep) throw new Error(`synthetic ${failedStep}`);
          return {
            stdout: step.name === "fresh-runtime0-assert"
              ? "registration_observation_provider_outbox_delta=0\n"
              : "",
          };
        },
        inspectResources: async () => [],
      },
    );
    assert.equal(result.status, 1);
    const expectedCalls = {
      "schema-pgtap": [
        "db-start",
        "db-reset",
        "schema-pgtap",
        "db-stop",
      ],
      "focus-fixture-setup": [
        "db-start",
        "db-reset",
        "schema-pgtap",
        "focus-fixture-setup",
        "focus-fixture-cleanup",
        "fresh-runtime0-assert",
        "db-stop",
      ],
      pgtap: [
        "db-start",
        "db-reset",
        "schema-pgtap",
        "focus-fixture-setup",
        "pgtap",
        "focus-fixture-cleanup",
        "fresh-runtime0-assert",
        "db-stop",
      ],
    };
    assert.deepEqual(calls, expectedCalls[failedStep]);
  }
});

test("isolated reset installs only the pre-history schema required by repository migrations", async () => {
  const runner = await loadRunner();
  const sql = runner.registrationObservationLocalQaPrerequisiteSql();
  for (const relation of [
    "public.profiles",
    "public.classes",
    "public.students",
    "public.textbooks",
    "public.progress_logs",
    "public.academic_events",
    "public.academic_schools",
    "public.academic_curriculum_profiles",
  ]) {
    assert.match(
      sql,
      new RegExp(`create table ${relation.replaceAll(".", "\\.")}\\b`, "i"),
    );
  }
  assert.match(
    sql,
    /create table public\.classes\b[\s\S]*?start_date date[\s\S]*?end_date date/i,
  );
  assert.doesNotMatch(
    sql,
    /ops_registration_subject_tracks|ops_registration_appointments|registration_observation|solapi|google_chat/i,
  );
});

test("isolated reset supplies the one deterministic actor required by migration history", async () => {
  const runner = await loadRunner();
  const sql = runner.registrationObservationLocalQaHistoryFixtureSql();
  assert.match(sql, /insert into auth\.users/i);
  assert.match(sql, /96000000-0000-4000-8000-000000000001/);
  assert.match(sql, /김법균/);
  assert.match(sql, /teacher_team[^\n]+과학팀/);
  assert.doesNotMatch(
    sql,
    /ops_registration_observations|solapi|google_chat|notification_deliveries/i,
  );
});

test("schema fresh assertion proves every exact pgTAP fixture row rolled back", async () => {
  const runner = await loadRunner();
  const sql = runner.registrationObservationSchemaFreshAssertionSql("schema");
  for (const relation of [
    "auth.users",
    "public.profiles",
    "public.teacher_catalogs",
    "public.classroom_catalogs",
    "public.classes",
    "public.class_lesson_sessions",
    "public.ops_tasks",
    "public.ops_registration_subject_tracks",
    "public.ops_registration_appointments",
    "public.ops_registration_observations",
    "dashboard_private.registration_observation_mutation_requests",
    "dashboard_private.registration_observation_domain_events",
  ]) {
    assert.match(sql, new RegExp(relation.replaceAll(".", "\\."), "i"));
  }
  assert.match(sql, /97000000-0000-4000-8000-000000000110/);
  assert.match(sql, /97000000-0000-4000-8000-000000000112/);
  assert.match(sql, /97000000-0000-4000-8000-000000000113/);
  for (const relation of [
    "dashboard_private.registration_observation_domain_events",
    "public.ops_registration_customer_messages",
    "dashboard_private.registration_customer_reminder_jobs",
    "dashboard_private.registration_customer_solapi_template_receipts",
    "dashboard_private.notification_events",
    "dashboard_private.notification_event_fanout_jobs",
    "dashboard_private.notification_deliveries",
    "dashboard_private.notification_audit_logs",
  ]) {
    assert.match(sql, new RegExp(relation.replaceAll(".", "\\."), "i"));
  }
  assert.match(sql, /registration_observation_provider_outbox_delta=0/);
  assert.match(sql, /registration_observation_local_qa_provider_baselines/i);
});

test("focus manifests prove provider and outbox presence plus exact zero delta", async () => {
  const runner = await loadRunner();
  const presence = (focus) => Object.fromEntries(
    runner.getRegistrationObservationProviderOutboxManifest(focus)
      .filter((entry) => [
        "observation-domain-events",
        "observation-chat-jobs",
        "observation-solapi-event-consumptions",
      ].includes(entry.key))
      .map((entry) => [entry.key, entry.expected]),
  );

  assert.deepEqual(presence("schema"), {
    "observation-domain-events": "present",
    "observation-chat-jobs": "absent",
    "observation-solapi-event-consumptions": "absent",
  });
  assert.deepEqual(presence("chat-mentions"), {
    "observation-domain-events": "present",
    "observation-chat-jobs": "absent",
    "observation-solapi-event-consumptions": "absent",
  });
  assert.deepEqual(presence("google-chat"), {
    "observation-domain-events": "present",
    "observation-chat-jobs": "present",
    "observation-solapi-event-consumptions": "absent",
  });
  assert.deepEqual(presence("solapi-queue"), {
    "observation-domain-events": "present",
    "observation-chat-jobs": "present",
    "observation-solapi-event-consumptions": "present",
  });

  const setupSql = runner.registrationObservationProviderOutboxBaselineSetupSql(
    "schema",
  );
  assert.match(setupSql, /^begin;/i);
  assert.match(setupSql, /create table dashboard_private\.registration_observation_local_qa_provider_baselines/i);
  assert.match(setupSql, /to_regclass\('dashboard_private\.registration_observation_chat_jobs'\) is not null/i);
  assert.match(setupSql, /insert into dashboard_private\.registration_observation_local_qa_provider_baselines/i);
  assert.match(setupSql, /commit;$/i);
});

test("SOLAPI contract focus dry-runs its current committed migration and pgTAP contract", () => {
  const result = runRunner([
    "--focus",
    "solapi-contract",
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /DRY RUN.*zero database changes/s);
  assert.match(result.stdout, /20260809106000/);
  assert.match(
    result.stdout,
    /registration_observation_solapi_contract_test\.sql/,
  );
});

test("schema focus advances only when the reviewed reads migration exists", async () => {
  const runner = await loadRunner();
  assert.equal(
    runner.resolveRegistrationObservationSchemaFocusTerminal([
      "supabase/migrations/20260809100000_registration_observation_core_schema.sql",
    ]),
    "20260809100000",
  );
  assert.equal(
    runner.resolveRegistrationObservationSchemaFocusTerminal([
      "supabase/migrations/20260809100000_registration_observation_core_schema.sql",
      "supabase/migrations/20260809101000_registration_observation_reads.sql",
      "supabase/migrations/20260809102000_registration_observation_booking.sql",
    ]),
    "20260809101000",
  );
});

test("runner plans the exact start-reset-fixture-test-cleanup-assert-stop lifecycle", async () => {
  const runner = await loadRunner();
  const plan = runner.buildRegistrationObservationLocalDbQaPlan(planInput());
  assert.deepEqual(
    plan.steps.map((step) => step.name),
    [
      "db-start",
      "db-reset",
      "focus-fixture-setup",
      "pgtap",
      "focus-fixture-cleanup",
      "fresh-runtime0-assert",
      "db-stop",
    ],
  );
  assert.deepEqual(plan.steps[0].argv, [
    pinnedSupabaseGo,
    "db",
    "start",
    "--workdir",
    temporaryProjectPath,
  ]);
  assert.deepEqual(plan.steps[1].argv, [
    pinnedSupabaseGo,
    "db",
    "reset",
    "--local",
    "--no-seed",
    "--workdir",
    temporaryProjectPath,
  ]);
  const psqlArgv = (sql) => [
    "docker",
    "exec",
    "-i",
    containerName,
    "psql",
    "-X",
    "-qAt",
    "-v",
    "ON_ERROR_STOP=1",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-c",
    sql,
  ];
  assert.deepEqual(plan.steps[2].argv, psqlArgv(focusSetupSql));
  assert.deepEqual(plan.steps[3].argv, [
    pinnedSupabaseGo,
    "test",
    "db",
    "--workdir",
    temporaryProjectPath,
    focusPgTapDirectoryPath,
    "--db-url",
    loopbackDbUrl,
  ]);
  assert.deepEqual(plan.steps[4].argv, psqlArgv(focusCleanupSql));
  assert.deepEqual(
    plan.steps[5].argv,
    psqlArgv(freshRuntimeZeroAssertionSql),
  );
  assert.deepEqual(plan.steps[6].argv, [
    pinnedSupabaseGo,
    "stop",
    "--workdir",
    temporaryProjectPath,
    "--project-id",
    projectId,
    "--no-backup",
    "--yes",
  ]);
});

test("one validated loopback port manifest owns config and pgTAP DB routing", async () => {
  const runner = await loadRunner();
  const allocated = [61001, 61002, 61003, 61004];
  const hosts = [];
  const acquired = [];
  const released = [];
  const manifest = await runner.buildRegistrationObservationRuntimePortManifest({
    projectId,
    allocateLoopbackPort: async (host) => {
      hosts.push(host);
      return allocated.shift();
    },
    acquirePortLease: async (claim) => {
      acquired.push(claim);
      return claim;
    },
    releasePortLease: async (claim) => {
      released.push(claim);
    },
  });

  assert.deepEqual(manifest, runtimePortManifest);
  assert.deepEqual(hosts, Array(4).fill("127.0.0.1"));
  assert.deepEqual(acquired.map(({ port }) => port), [
    61001,
    61002,
    61003,
    61004,
  ]);
  assert.equal(Object.isFrozen(manifest), true);

  const config = runner.registrationObservationLocalConfigToml(
    projectId,
    manifest,
  );
  assert.match(config, /\[api\][\s\S]*port = 61001/);
  assert.match(config, /\[db\][\s\S]*port = 61002/);
  assert.match(config, /shadow_port = 61003/);
  assert.match(config, /\[db\.pooler\][\s\S]*port = 61004/);
  assert.doesNotMatch(config, /56320|56321|56322|56329/);

  const plan = runner.buildRegistrationObservationLocalDbQaPlan(planInput());
  assert.equal(plan.dbUrl, manifest.dbUrl);
  assert.equal(plan.runtimePortManifest, runtimePortManifest);
  await runner.releaseRegistrationObservationRuntimePortLeases(manifest);
  assert.deepEqual(released.map(({ port }) => port), [
    61004,
    61003,
    61002,
    61001,
  ]);
});

test("concurrent runtime manifests hold disjoint atomic leases in one shared root", async () => {
  const runner = await loadRunner();
  const leaseRoot = await mkdtemp(
    path.join(os.tmpdir(), "tips-registration-observation-port-leases-test-"),
  );
  let first;
  let second;
  let ports = [];
  const children = [
    spawnPortLeaseChild(leaseRoot, "tips_obs_qa_aaaaaaaaaaaa"),
    spawnPortLeaseChild(leaseRoot, "tips_obs_qa_bbbbbbbbbbbb"),
  ];
  try {
    [first, second] = await Promise.all(
      children.map(({ manifest }) => manifest),
    );
    ports = [
      first.apiPort,
      first.dbPort,
      first.shadowPort,
      first.poolerPort,
      second.apiPort,
      second.dbPort,
      second.shadowPort,
      second.poolerPort,
    ];
    assert.equal(new Set(ports).size, 8);
    assert.notEqual(first.dbUrl, second.dbUrl);
    assert.equal(
      ports.every((port) =>
        existsSync(path.join(leaseRoot, `${port}.lease`))
      ),
      true,
    );
  } finally {
    const releases = await Promise.allSettled(
      children.map(({ release }) => release()),
    );
    for (const [index, release] of releases.entries()) {
      if (release.status === "rejected") {
        children[index].child.kill();
      }
    }
    assert.equal(
      releases.every(({ status }) => status === "fulfilled"),
      true,
      releases
        .filter(({ status }) => status === "rejected")
        .map(({ reason }) => reason?.message ?? String(reason))
        .join("\n"),
    );
    assert.equal(
      ports.every((port) =>
        !existsSync(path.join(leaseRoot, `${port}.lease`))
      ),
      true,
    );
    await rm(leaseRoot, { recursive: true, force: true });
  }

  assert.throws(
    () => runner.assertRegistrationObservationRuntimePortManifest({
      ...first,
      host: "db.example.com",
      dbUrl: `postgresql://postgres:postgres@db.example.com:${first.dbPort}/postgres`,
    }),
    /registration_observation_local_db_runtime_port_manifest_refused/,
  );
  assert.throws(
    () => runner.assertRegistrationObservationRuntimePortManifest({
      ...first,
      poolerPort: first.dbPort,
    }),
    /registration_observation_local_db_runtime_port_manifest_refused/,
  );

  let duplicateCalls = 0;
  const duplicateClaims = [];
  const duplicateReleases = [];
  await assert.rejects(
    runner.buildRegistrationObservationRuntimePortManifest({
      projectId,
      allocateLoopbackPort: async () => {
        duplicateCalls += 1;
        return 65000;
      },
      acquirePortLease: async (claim) => {
        duplicateClaims.push(claim);
        return claim;
      },
      releasePortLease: async (claim) => {
        duplicateReleases.push(claim);
      },
    }),
    /registration_observation_local_db_runtime_port_manifest_refused/,
  );
  assert.equal(duplicateCalls, 32);
  assert.equal(duplicateClaims.length, 1);
  assert.equal(duplicateReleases.length, 1);
});

test("dead owner stays fail-closed while partial acquisition rolls back", async () => {
  const runner = await loadRunner();
  const leaseRoot = await mkdtemp(
    path.join(os.tmpdir(), "tips-registration-observation-port-leases-test-"),
  );
  const stalePort = 65100;
  const stalePath = path.join(leaseRoot, `${stalePort}.lease`);
  await writeFile(
    stalePath,
    JSON.stringify({
      version: 1,
      projectId: "tips_obs_qa_cccccccccccc",
      pid: 999999,
      port: stalePort,
      createdAtMs: 1,
    }),
    { mode: 0o600 },
  );
  let manifest;
  try {
    const allocated = [stalePort, 65101, 65102, 65103, 65104];
    manifest = await runner.buildRegistrationObservationRuntimePortManifest({
      projectId,
      leaseRoot,
      allocateLoopbackPort: async () => allocated.shift(),
      now: () => 100_000,
    });
    const owner = JSON.parse(await readFile(stalePath, "utf8"));
    assert.equal(owner.projectId, "tips_obs_qa_cccccccccccc");
    assert.equal(owner.pid, 999999);
    assert.equal(
      [
        manifest.apiPort,
        manifest.dbPort,
        manifest.shadowPort,
        manifest.poolerPort,
      ].includes(stalePort),
      false,
    );
  } finally {
    if (manifest) {
      await runner.releaseRegistrationObservationRuntimePortLeases(manifest);
    }
    await rm(leaseRoot, { recursive: true, force: true });
  }

  const acquired = [];
  const released = [];
  let nextPort = 65200;
  await assert.rejects(
    runner.buildRegistrationObservationRuntimePortManifest({
      projectId,
      allocateLoopbackPort: async () => ++nextPort,
      acquirePortLease: async (claim) => {
        acquired.push(claim);
        if (acquired.length === 2) {
          throw new Error("synthetic partial lease acquisition failure");
        }
        return claim;
      },
      releasePortLease: async (claim) => {
        released.push(claim);
      },
    }),
    /registration_observation_local_db_runtime_port_manifest_refused/,
  );
  assert.deepEqual(acquired.map(({ port }) => port), [65201, 65202]);
  assert.deepEqual(released.map(({ port }) => port), [65201]);

  const partialRoot = await mkdtemp(
    path.join(os.tmpdir(), "tips-registration-observation-port-leases-test-"),
  );
  try {
    await assert.rejects(
      runner.buildRegistrationObservationRuntimePortManifest({
        projectId,
        leaseRoot: partialRoot,
        allocateLoopbackPort: async () => 65250,
        now: () => {
          throw new Error("synthetic owner payload failure");
        },
      }),
      /registration_observation_local_db_runtime_port_manifest_refused/,
    );
    assert.equal(
      existsSync(path.join(partialRoot, "65250.lease")),
      false,
    );
  } finally {
    await rm(partialRoot, { recursive: true, force: true });
  }
});

test("runner cleanup order is fail-safe and never retries pgTAP", async () => {
  const afterSetupFailure = await runWithFakeSpawn({
    failAt: "focus-fixture-setup",
  });
  assert.deepEqual(afterSetupFailure.calls, [
    "db-start",
    "db-reset",
    "focus-fixture-setup",
    "focus-fixture-cleanup",
    "fresh-runtime0-assert",
    "db-stop",
  ]);

  const afterPgTapFailure = await runWithFakeSpawn({
    failAt: "pgtap",
    alsoFailAt: "focus-fixture-cleanup",
  });
  assert.deepEqual(afterPgTapFailure.calls, [
    "db-start",
    "db-reset",
    "focus-fixture-setup",
    "pgtap",
    "focus-fixture-cleanup",
    "fresh-runtime0-assert",
    "db-stop",
  ]);
  assert.equal(
    afterPgTapFailure.calls.filter((name) => name === "pgtap").length,
    1,
  );
  assert.equal(afterPgTapFailure.primaryError.step, "pgtap");
  assert.deepEqual(
    afterPgTapFailure.cleanupErrors.map((error) => error.step),
    ["focus-fixture-cleanup"],
  );
  assert.equal(afterPgTapFailure.status, 1);
});

test("start and reset failures cannot reach fixture setup or pgTAP", async () => {
  assert.deepEqual((await runWithFakeSpawn({ failAt: "db-start" })).calls, [
    "db-start",
    "db-stop",
  ]);
  assert.deepEqual((await runWithFakeSpawn({ failAt: "db-reset" })).calls, [
    "db-start",
    "db-reset",
    "db-stop",
  ]);
});

test("cleanup, fresh assertion, and stop errors are ordered without hiding the primary error", async () => {
  const result = await runWithFakeSpawn({
    failAt: [
      "pgtap",
      "focus-fixture-cleanup",
      "fresh-runtime0-assert",
      "db-stop",
    ],
  });
  assert.equal(result.primaryError.step, "pgtap");
  assert.deepEqual(
    result.cleanupErrors.map((error) => error.step),
    ["focus-fixture-cleanup", "fresh-runtime0-assert", "db-stop"],
  );
  assert.equal(result.calls.filter((name) => name === "db-stop").length, 1);
  assert.equal(result.status, 1);
});

test("execution rejects remote flags, provider state, and non-loopback URLs", async () => {
  for (const forbidden of ["--linked", "--remote", "--production"]) {
    const result = runRunner([forbidden]);
    assert.equal(result.status, 2);
    assert.match(
      result.stderr,
      /registration_observation_local_db_forbidden_option/,
    );
  }

  const remote = runRunner([
    "--execute",
    "--approved-local-db",
    "--focus",
    "schema",
    "--db-url",
    "postgresql://postgres:postgres@db.example.com:5432/postgres",
  ]);
  assert.equal(remote.status, 2);
  assert.match(
    remote.stderr,
    /registration_observation_local_db_custom_db_url_forbidden/,
  );

  const customLoopback = runRunner([
    "--db-url",
    "postgresql://postgres:postgres@127.0.0.1:65432/postgres",
  ]);
  assert.equal(customLoopback.status, 2);
  assert.match(
    customLoopback.stderr,
    /registration_observation_local_db_custom_db_url_forbidden/,
  );

  const runner = await loadRunner();
  assert.throws(
    () => runner.assertRegistrationObservationSafeEnvironment({
      SOLAPI_API_KEY: "must-not-pass",
    }),
    /registration_observation_local_db_forbidden_environment/,
  );
});

test("outer lifecycle preserves a runtime primary across ordered removal and rm failures", async () => {
  const runner = await loadRunner();
  let runtimeRoot;
  let nextPort = 63000;
  const events = [];
  let inspectionCount = 0;
  const result = await runner.executeRegistrationObservationLocalDbQaLifecycle(
    { repositoryRoot, focus: "schema" },
    {
      createRuntimeRoot: async () => {
        runtimeRoot = await mkdtemp(
          path.join(os.tmpdir(), "tips-registration-observation-qa-"),
        );
        return runtimeRoot;
      },
      randomBytes: () => Buffer.from("0123456789ab", "hex"),
      allocateLoopbackPort: async () => {
        nextPort += 1;
        return nextPort;
      },
      assertSafeEnvironment: () => {},
      assertPinnedCliVersion: () => {},
      inspectResources: async (actualProjectId) => {
        inspectionCount += 1;
        const step = [
          "resource-preflight",
          "emergency-resource-inspection",
          "emergency-resource-reinspection",
        ][inspectionCount - 1];
        events.push(step);
        if (inspectionCount === 1 || inspectionCount === 3) return [];
        return [{
          kind: "container",
          name: `supabase_db_${actualProjectId}`,
          projectId: actualProjectId,
        }];
      },
      prepareRuntime: async () => {
        events.push("runtime-prepare");
        throw new Error("synthetic runtime prepare failure");
      },
      removeResources: async () => {
        events.push("emergency-resource-removal");
        throw new Error("synthetic emergency removal failure");
      },
      removeRuntimeRoot: async () => {
        events.push("runtime-root-removal");
        throw new Error("synthetic runtime rm failure");
      },
      fallbackRemoveRuntimeRoot: async (target) => {
        events.push("runtime-root-removal-fallback");
        await rm(target, { recursive: true, force: true });
      },
    },
  );

  assert.equal(result.status, 1);
  assert.equal(result.primaryError.step, "runtime-prepare");
  assert.equal(
    result.primaryError.error.message,
    "synthetic runtime prepare failure",
  );
  assert.deepEqual(
    result.cleanupErrors.map(({ step }) => step),
    ["emergency-resource-removal", "runtime-root-removal"],
  );
  assert.deepEqual(
    result.cleanupEvidence
      .filter(({ status }) => status === "failed")
      .map(({ step }) => step),
    ["emergency-resource-removal", "runtime-root-removal"],
  );
  assert.deepEqual(events, [
    "resource-preflight",
    "runtime-prepare",
    "emergency-resource-inspection",
    "emergency-resource-removal",
    "emergency-resource-reinspection",
    "runtime-root-removal",
    "runtime-root-removal-fallback",
  ]);
  assert.equal(existsSync(runtimeRoot), false);
});

test("outer lifecycle records emergency inspection before rm without replacing preflight error", async () => {
  const runner = await loadRunner();
  let runtimeRoot;
  let nextPort = 64000;
  let inspectionCount = 0;
  const events = [];
  const result = await runner.executeRegistrationObservationLocalDbQaLifecycle(
    { repositoryRoot, focus: "schema" },
    {
      createRuntimeRoot: async () => {
        runtimeRoot = await mkdtemp(
          path.join(os.tmpdir(), "tips-registration-observation-qa-"),
        );
        return runtimeRoot;
      },
      randomBytes: () => Buffer.from("0123456789ab", "hex"),
      allocateLoopbackPort: async () => {
        nextPort += 1;
        return nextPort;
      },
      assertSafeEnvironment: () => {},
      assertPinnedCliVersion: () => {},
      inspectResources: async () => {
        inspectionCount += 1;
        events.push(
          inspectionCount === 1
            ? "resource-preflight"
            : "emergency-resource-inspection",
        );
        throw new Error(
          inspectionCount === 1
            ? "synthetic preflight inspection failure"
            : "synthetic emergency inspection failure",
        );
      },
      removeResources: async () => {
        throw new Error("preflight resources must never be removed");
      },
      removeRuntimeRoot: async () => {
        events.push("runtime-root-removal");
        throw new Error("synthetic runtime rm failure");
      },
      fallbackRemoveRuntimeRoot: async (target) => {
        events.push("runtime-root-removal-fallback");
        await rm(target, { recursive: true, force: true });
      },
    },
  );

  assert.equal(result.status, 1);
  assert.equal(result.primaryError.step, "resource-preflight");
  assert.equal(
    result.primaryError.error.message,
    "synthetic preflight inspection failure",
  );
  assert.deepEqual(
    result.cleanupErrors.map(({ step }) => step),
    ["emergency-resource-inspection", "runtime-root-removal"],
  );
  assert.deepEqual(
    result.cleanupEvidence
      .filter(({ status }) => status === "failed")
      .map(({ step }) => step),
    ["emergency-resource-inspection", "runtime-root-removal"],
  );
  assert.deepEqual(events, [
    "resource-preflight",
    "emergency-resource-inspection",
    "runtime-root-removal",
    "runtime-root-removal-fallback",
  ]);
  assert.equal(existsSync(runtimeRoot), false);
});

test("port allocation failure after root creation is fail-closed and removes the root", async () => {
  const runner = await loadRunner();
  let runtimeRoot;
  const result = await runner.executeRegistrationObservationLocalDbQaLifecycle(
    { repositoryRoot, focus: "schema" },
    {
      createRuntimeRoot: async () => {
        runtimeRoot = await mkdtemp(
          path.join(os.tmpdir(), "tips-registration-observation-qa-"),
        );
        return runtimeRoot;
      },
      randomBytes: () => Buffer.from("0123456789ab", "hex"),
      allocateLoopbackPort: async () => {
        throw new Error("synthetic port allocator failure");
      },
      inspectResources: async () => [],
    },
  );

  assert.equal(result.status, 1);
  assert.equal(result.primaryError.step, "runtime-port-allocation");
  assert.match(
    result.primaryError.error.message,
    /registration_observation_local_db_runtime_port_manifest_refused/,
  );
  assert.deepEqual(result.cleanupErrors, []);
  assert.equal(existsSync(runtimeRoot), false);
});

test("outer finalizer releases every held port lease after an execution failure", async () => {
  const runner = await loadRunner();
  let runtimeRoot;
  let nextPort = 65300;
  const acquired = [];
  const released = [];
  const result = await runner.executeRegistrationObservationLocalDbQaLifecycle(
    { repositoryRoot, focus: "schema" },
    {
      createRuntimeRoot: async () => {
        runtimeRoot = await mkdtemp(
          path.join(os.tmpdir(), "tips-registration-observation-qa-"),
        );
        return runtimeRoot;
      },
      randomBytes: () => Buffer.from("0123456789ab", "hex"),
      allocateLoopbackPort: async () => ++nextPort,
      acquirePortLease: async (claim) => {
        acquired.push(claim);
        return claim;
      },
      releasePortLease: async (claim) => {
        released.push(claim);
      },
      assertSafeEnvironment: () => {},
      assertPinnedCliVersion: () => {},
      inspectResources: async () => [],
      prepareRuntime: async () => {
        throw new Error("synthetic post-lease execution failure");
      },
    },
  );

  assert.equal(result.status, 1);
  assert.equal(result.primaryError.step, "runtime-prepare");
  assert.deepEqual(acquired.map(({ port }) => port), [
    65301,
    65302,
    65303,
    65304,
  ]);
  assert.deepEqual(released.map(({ port }) => port), [
    65304,
    65303,
    65302,
    65301,
  ]);
  assert.equal(
    result.cleanupEvidence.some(({ step, status }) =>
      step === "runtime-port-lease-release" && status === "passed"
    ),
    true,
  );
  assert.equal(existsSync(runtimeRoot), false);
});

test("outer finalizer retries a failed partial-acquire rollback without hiding primary", async () => {
  const runner = await loadRunner();
  let runtimeRoot;
  let nextPort = 65400;
  let acquireCalls = 0;
  let releaseCalls = 0;
  const result = await runner.executeRegistrationObservationLocalDbQaLifecycle(
    { repositoryRoot, focus: "schema" },
    {
      createRuntimeRoot: async () => {
        runtimeRoot = await mkdtemp(
          path.join(os.tmpdir(), "tips-registration-observation-qa-"),
        );
        return runtimeRoot;
      },
      randomBytes: () => Buffer.from("0123456789ab", "hex"),
      allocateLoopbackPort: async () => ++nextPort,
      acquirePortLease: async (claim) => {
        acquireCalls += 1;
        if (acquireCalls === 2) {
          throw new Error("synthetic partial acquisition failure");
        }
        return claim;
      },
      releasePortLease: async () => {
        releaseCalls += 1;
        if (releaseCalls === 1) {
          throw new Error("synthetic initial rollback failure");
        }
      },
      inspectResources: async () => [],
    },
  );

  assert.equal(result.status, 1);
  assert.equal(result.primaryError.step, "runtime-port-allocation");
  assert.equal(releaseCalls, 2);
  assert.deepEqual(
    result.cleanupErrors.map(({ step }) => step),
    ["runtime-port-lease-rollback"],
  );
  assert.equal(
    result.cleanupEvidence.some(({ step, status }) =>
      step === "runtime-port-lease-release" && status === "passed"
    ),
    true,
  );
  assert.equal(existsSync(runtimeRoot), false);
});

test("owner-write rollback preserves its first cleanup failure after claim release succeeds", async () => {
  const runner = await loadRunner();
  let runtimeRoot;
  let nextPort = 65420;
  let releaseCalls = 0;
  const outstandingClaims = new Set();
  const originalCleanupError = new Error(
    "synthetic owner-write unlink failure",
  );
  const result = await runner.executeRegistrationObservationLocalDbQaLifecycle(
    { repositoryRoot, focus: "schema" },
    {
      createRuntimeRoot: async () => {
        runtimeRoot = await mkdtemp(
          path.join(os.tmpdir(), "tips-registration-observation-qa-"),
        );
        return runtimeRoot;
      },
      randomBytes: () => Buffer.from("0123456789ab", "hex"),
      allocateLoopbackPort: async () => ++nextPort,
      acquirePortLease: async ({ port, projectId: actualProjectId }) => {
        const claim = Object.freeze({
          leasePath: path.join(os.tmpdir(), `${actualProjectId}-${port}.lease`),
          partialOwner: true,
          port,
          projectId: actualProjectId,
          pid: process.pid,
        });
        outstandingClaims.add(claim);
        const error = new Error("synthetic owner-write failure");
        error.cleanupError = originalCleanupError;
        error.portLeaseCleanupClaim = claim;
        throw error;
      },
      releasePortLease: async (claim) => {
        releaseCalls += 1;
        outstandingClaims.delete(claim);
      },
      inspectResources: async () => [],
    },
  );

  assert.equal(result.status, 1);
  assert.equal(result.primaryError.step, "runtime-port-allocation");
  assert.equal(
    result.primaryError.error.cause.message,
    "synthetic owner-write failure",
  );
  assert.equal(releaseCalls, 1);
  assert.equal(outstandingClaims.size, 0);
  assert.deepEqual(
    result.cleanupErrors.map(({ step, error }) => ({ step, error })),
    [{ step: "runtime-port-lease-rollback", error: originalCleanupError }],
  );
  assert.deepEqual(
    result.cleanupEvidence
      .map(({ step, status, error }) => ({ step, status, error })),
    [
      {
        step: "runtime-port-lease-rollback",
        status: "failed",
        error: originalCleanupError,
      },
      {
        step: "emergency-resource-inspection",
        status: "passed",
        error: undefined,
      },
      {
        step: "runtime-root-removal",
        status: "passed",
        error: undefined,
      },
    ],
  );
  assert.equal(existsSync(runtimeRoot), false);
});

test("preexisting project resources fail closed without being removed", async () => {
  const runner = await loadRunner();
  let runtimeRoot;
  let nextPort = 65000;
  let removeCalls = 0;
  let inspectCalls = 0;
  const result = await runner.executeRegistrationObservationLocalDbQaLifecycle(
    { repositoryRoot, focus: "schema" },
    {
      createRuntimeRoot: async () => {
        runtimeRoot = await mkdtemp(
          path.join(os.tmpdir(), "tips-registration-observation-qa-"),
        );
        return runtimeRoot;
      },
      randomBytes: () => Buffer.from("0123456789ab", "hex"),
      allocateLoopbackPort: async () => ++nextPort,
      assertSafeEnvironment: () => {},
      assertPinnedCliVersion: () => {},
      inspectResources: async (actualProjectId) => {
        inspectCalls += 1;
        return [{
          kind: "container",
          name: `supabase_db_${actualProjectId}`,
          projectId: actualProjectId,
        }];
      },
      removeResources: async () => {
        removeCalls += 1;
      },
    },
  );

  assert.equal(result.status, 1);
  assert.equal(result.primaryError.step, "resource-preflight");
  assert.equal(inspectCalls, 2);
  assert.equal(removeCalls, 0);
  assert.deepEqual(result.cleanupErrors, []);
  assert.deepEqual(
    result.cleanupEvidence.map(({ step, status }) => ({ step, status })),
    [
      { step: "emergency-resource-inspection", status: "passed" },
      {
        step: "emergency-resource-removal",
        status: "skipped-preflight-not-passed",
      },
      { step: "runtime-root-removal", status: "passed" },
      { step: "runtime-port-lease-release", status: "passed" },
    ],
  );
  assert.equal(existsSync(runtimeRoot), false);
});
