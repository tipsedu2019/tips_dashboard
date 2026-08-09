import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const runnerPath = path.join(
  repositoryRoot,
  "scripts/run-registration-observation-local-db-qa.mjs",
);
const pinnedSupabaseGo =
  "/Users/hyunjun/.npm/_npx/aa8e5c70f9d8d161/node_modules/@supabase/cli-darwin-arm64/bin/supabase-go";
const loopbackDbUrl =
  "postgresql://postgres:postgres@127.0.0.1:56322/postgres";
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

function planInput() {
  return {
    repositoryRoot,
    runtimeRoot: temporaryProjectPath,
    projectId,
    focus: "schema",
    dbUrl: loopbackDbUrl,
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
    "feedback-access",
    "feedback-submit",
    "feedback",
    "enrollment",
    "google-chat",
    "solapi-contract",
    "solapi-queue",
    "solapi",
  ]);
  assert.deepEqual(
    runner.getRegistrationObservationFocusContract("feedback-submit"),
    {
      ceiling: "20260809103000",
      tests: [
        "supabase/tests/registration_observation_feedback_access_test.sql",
        "supabase/tests/registration_observation_feedback_submit_test.sql",
      ],
    },
  );
  assert.deepEqual(runner.getRegistrationObservationFocusContract("feedback"), {
    ceiling: "20260809103500",
    tests: [
      "supabase/tests/registration_observation_feedback_access_test.sql",
      "supabase/tests/registration_observation_feedback_submit_test.sql",
      "supabase/tests/registration_observation_feedback_decisions_test.sql",
    ],
  });
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

test("downstream focus fails explicitly until its files exist", () => {
  const result = runRunner([
    "--execute",
    "--approved-local-db",
    "--focus",
    "feedback",
  ]);
  assert.equal(result.status, 2);
  assert.match(
    result.stderr,
    /registration_observation_local_db_focus_unavailable:feedback/,
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
    /registration_observation_local_db_loopback_required/,
  );

  const runner = await loadRunner();
  assert.throws(
    () => runner.assertRegistrationObservationSafeEnvironment({
      SOLAPI_API_KEY: "must-not-pass",
    }),
    /registration_observation_local_db_forbidden_environment/,
  );
});
