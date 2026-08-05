import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(import.meta.dirname, "..");
const runnerPath = path.join(
  repositoryRoot,
  "scripts/run-registration-customer-solapi-local-db-qa.mjs",
);
const expectedUrl = "http://127.0.0.1:54321";
const expectedDbUrl =
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

function exactResourceManifest(projectId) {
  return [
    { kind: "container", name: `supabase_db_${projectId}`, projectId },
    { kind: "network", name: `supabase_network_${projectId}`, projectId },
    { kind: "volume", name: `supabase_db_${projectId}`, projectId },
  ];
}

async function runCli(args = [], env = {}) {
  try {
    const result = await execFileAsync(process.execPath, [runnerPath, ...args], {
      cwd: repositoryRoot,
      env: { ...process.env, ...env },
    });
    return { ...result, exitCode: 0 };
  } catch (error) {
    return {
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
      exitCode: error.code,
    };
  }
}

test("default invocation is a plan-only dry run with zero side effects", async () => {
  const result = await runCli();

  assert.equal(result.exitCode, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.mode, "dry-run");
  assert.equal(report.approvedLocalDb, false);
  assert.equal(report.url, expectedUrl);
  assert.equal(report.dbUrl, expectedDbUrl);
  assert.deepEqual(report.observed, {
    childProcesses: 0,
    dockerActions: 0,
    databaseActions: 0,
    networkRequests: 0,
    providerCalls: 0,
  });
  assert.equal(report.plan.providerCalls, 0);
  assert.equal(report.plan.syntheticRowsOnly, true);
  assert.equal(report.plan.pgTapPath, "supabase/tests/registration_customer_solapi_messages_test.sql");
  assert.deepEqual(report.plan.concurrencyProbe, [
    "two-client-claim",
    "marker-replay",
  ]);
  assert.deepEqual(report.cleanup, {
    strategy: "exact-created-resources-only",
    projectIdPrefix: "tips_registration_solapi_qa_",
    containerNamePrefix: "supabase_db_tips_registration_solapi_qa_",
    removeTemporaryWorkdir: true,
    verifyNoLeftovers: true,
  });
});

test("execution requires both explicit approval flags", async () => {
  for (const args of [["--execute"], ["--approved-local-db"]]) {
    const result = await runCli(args);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /registration_local_db_approval_required/);
    assert.equal(result.stdout, "");
  }
});

test("execution rejects non-loopback and production endpoints before a child starts", async () => {
  const cases = [
    ["--url", "https://example.supabase.co"],
    ["--url", "http://localhost.evil.example:54321"],
    ["--db-url", "postgresql://postgres:postgres@db.example.com:54322/postgres"],
    ["--db-url", "postgresql://postgres:postgres@10.0.0.4:54322/postgres"],
  ];

  for (const endpointArgs of cases) {
    const result = await runCli([
      "--execute",
      "--approved-local-db",
      ...endpointArgs,
    ]);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /registration_local_db_loopback_required/);
    assert.equal(result.stdout, "");
  }
});

test("linked, remote, production, worker, cron, and provider lanes are rejected", async () => {
  for (const forbiddenArg of ["--linked", "--remote", "--production"]) {
    const result = await runCli([forbiddenArg]);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /registration_local_db_forbidden_option/);
  }

  const guardedEnvironmentCases = [
    { SUPABASE_ACCESS_TOKEN: "synthetic-token" },
    { DATABASE_URL: expectedDbUrl },
    { SOLAPI_API_KEY: "synthetic-key" },
    { NOTIFICATION_WORKER_ENABLED: "true" },
    { CRON_SECRET: "synthetic-secret" },
  ];
  for (const guardedEnv of guardedEnvironmentCases) {
    const result = await runCli(
      ["--execute", "--approved-local-db"],
      guardedEnv,
    );
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /registration_local_db_forbidden_environment/);
    assert.equal(result.stdout, "");
  }
});

test("all production Supabase, Postgres, SOLAPI, Vercel, and cron prefixes fail closed", async () => {
  const runner = await import(`file://${runnerPath}`);
  const cases = [
    { SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-role" },
    { NEXT_PUBLIC_SUPABASE_ANON_KEY: "synthetic-anon" },
    { VITE_SUPABASE_URL: expectedUrl },
    { POSTGRES_URL: expectedDbUrl },
    { SOLAPI_KAKAO_PF_ID: "synthetic-pf" },
    { SOLAPI_REGISTRATION_WAITING_TEMPLATE_ID: "synthetic-template" },
    { REGISTRATION_SOLAPI_RECIPIENT_HASH_PEPPER: "synthetic-pepper" },
    { VERCEL_TOKEN: "synthetic-vercel-token" },
    { CRON_REGISTRATION_SECRET: "synthetic-cron" },
    { APP_ENV: "production" },
  ];
  for (const environment of cases) {
    assert.throws(
      () => runner.assertRegistrationCustomerSolapiSafeEnvironment(environment),
      /registration_local_db_forbidden_environment/,
    );
  }
});

test("local child environment uses an explicit allowlist and strips provider and database state", async () => {
  const runner = await import(`file://${runnerPath}`);
  const child = runner.buildRegistrationCustomerSolapiLocalEnvironment({
    PATH: "/synthetic/bin",
    HOME: "/tmp/synthetic-home",
    TMPDIR: "/tmp",
    LANG: "ko_KR.UTF-8",
    SOLAPI_API_SECRET: "must-not-pass",
    SUPABASE_SERVICE_ROLE_KEY: "must-not-pass",
    DATABASE_URL: expectedDbUrl,
    VERCEL_TOKEN: "must-not-pass",
    UNRELATED_SECRET: "must-not-pass",
  });

  assert.deepEqual(child, {
    PATH: "/synthetic/bin",
    HOME: "/tmp/synthetic-home",
    TMPDIR: "/tmp",
    LANG: "ko_KR.UTF-8",
    SUPABASE_INTERNAL_IMAGE_REGISTRY: "",
  });
});

test("the plan pins exact commands and does not require provider credentials", async () => {
  const runner = await import(`file://${runnerPath}`);
  const plan = runner.buildRegistrationCustomerSolapiQaPlan({
    repositoryRoot,
    url: expectedUrl,
    dbUrl: expectedDbUrl,
    projectId: "tips_registration_solapi_qa_0123456789ab",
    runtimeRoot: "/tmp/tips-registration-solapi-qa-0123456789ab",
  });

  assert.equal(plan.cliVersion, "2.103.0");
  assert.match(plan.cliPath, /supabase-go$/);
  assert.deepEqual(plan.startCommand.slice(1, 3), ["db", "start"]);
  assert.deepEqual(plan.pgTapCommand.slice(-2), [
    "--db-url",
    expectedDbUrl,
  ]);
  assert.ok(
    plan.pgTapCommand.includes(
      "supabase/tests/registration_customer_solapi_messages_test.sql",
    ),
  );
  assert.deepEqual(plan.cleanupCommand.slice(1, 3), ["stop", "--workdir"]);
  assert.ok(plan.cleanupCommand.includes("--no-backup"));
  assert.equal(plan.requiredProviderEnvironment.length, 0);
  assert.equal(plan.providerCalls, 0);
  assert.deepEqual(plan.resourceManifest, [
    {
      kind: "container",
      name: "supabase_db_tips_registration_solapi_qa_0123456789ab",
      projectId: "tips_registration_solapi_qa_0123456789ab",
    },
    {
      kind: "network",
      name: "supabase_network_tips_registration_solapi_qa_0123456789ab",
      projectId: "tips_registration_solapi_qa_0123456789ab",
    },
    {
      kind: "volume",
      name: "supabase_db_tips_registration_solapi_qa_0123456789ab",
      projectId: "tips_registration_solapi_qa_0123456789ab",
    },
  ]);
});

test("failure cleanup removes only the invocation workdir and records no leftovers", async () => {
  const runner = await import(`file://${runnerPath}`);
  const runtimeRoot = await mkdtemp(
    path.join(os.tmpdir(), "tips-registration-solapi-qa-"),
  );
  const outsideSentinel = path.join(
    os.tmpdir(),
    `registration-solapi-outside-${process.pid}.txt`,
  );
  await import("node:fs/promises").then(({ writeFile }) =>
    writeFile(outsideSentinel, "keep", "utf8"),
  );

  const calls = [];
  await assert.rejects(
    runner.runRegistrationCustomerSolapiLocalDbQa(
      {
        repositoryRoot,
        url: expectedUrl,
        dbUrl: expectedDbUrl,
        projectId: "tips_registration_solapi_qa_abcdef012345",
        runtimeRoot,
      },
      {
        prepareRuntime: async () => calls.push("prepare"),
        runCommand: async (_command, label) => {
          calls.push(label);
          if (label === "pgTap") throw new Error("synthetic pgTAP failure");
          return { stdout: "", stderr: "" };
        },
        inspectResources: async () => {
          calls.push("inspect");
          return calls.filter((value) => value === "inspect").length === 2
            ? exactResourceManifest("tips_registration_solapi_qa_abcdef012345")
            : [];
        },
        removeRuntime: async (target) => {
          calls.push(`remove:${target}`);
          await rm(target, { recursive: true, force: true });
        },
      },
    ),
    /synthetic pgTAP failure/,
  );

  assert.deepEqual(calls, [
    "inspect",
    "prepare",
    "dbStart",
    "inspect",
    "pgTap",
    "cleanup",
    "inspect",
    `remove:${runtimeRoot}`,
  ]);
  assert.equal(await readFile(outsideSentinel, "utf8"), "keep");
  await rm(outsideSentinel, { force: true });
});

test("execution rejects invalid project identity and temp provenance before any dependency call", async () => {
  const runner = await import(`file://${runnerPath}`);
  for (const invalid of [
    {
      projectId: "tips_registration_solapi_qa_not-hex",
      runtimeRoot: path.join(os.tmpdir(), "tips-registration-solapi-qa-valid"),
    },
    {
      projectId: "tips_registration_solapi_qa_abcdef012345",
      runtimeRoot: path.join(repositoryRoot, "tips-registration-solapi-qa-invalid"),
    },
  ]) {
    const calls = [];
    await assert.rejects(
      runner.runRegistrationCustomerSolapiLocalDbQa(
        { repositoryRoot, url: expectedUrl, dbUrl: expectedDbUrl, ...invalid },
        {
          environment: {},
          prepareRuntime: async () => calls.push("prepare"),
          runCommand: async () => calls.push("command"),
          inspectResources: async () => calls.push("inspect"),
          removeRuntime: async () => calls.push("remove"),
        },
      ),
      /registration_local_db_(?:project_identity|runtime_provenance)_rejected/,
    );
    assert.deepEqual(calls, []);
  }
});

test("preflight refuses existing exact-run resources without touching sentinels", async () => {
  const runner = await import(`file://${runnerPath}`);
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "tips-registration-solapi-qa-"));
  const projectId = "tips_registration_solapi_qa_abcdef012345";
  const sentinel = { kind: "container", name: "unrelated-sentinel", projectId: "another-run" };
  const exact = { kind: "network", name: `supabase_network_${projectId}`, projectId };
  const calls = [];
  await assert.rejects(
    runner.runRegistrationCustomerSolapiLocalDbQa(
      { repositoryRoot, url: expectedUrl, dbUrl: expectedDbUrl, projectId, runtimeRoot },
      {
        environment: {},
        inspectResources: async () => [sentinel, exact],
        prepareRuntime: async () => calls.push("prepare"),
        runCommand: async () => calls.push("command"),
        removeResources: async () => calls.push("remove-resources"),
        removeRuntime: async () => calls.push("remove-runtime"),
      },
    ),
    /registration_local_db_preexisting_resources/,
  );
  assert.deepEqual(calls, ["remove-runtime"]);
  await rm(runtimeRoot, { recursive: true, force: true });
});

test("cleanup, inspection, fallback, and workdir removal failures are aggregated independently", async () => {
  const runner = await import(`file://${runnerPath}`);
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "tips-registration-solapi-qa-"));
  const projectId = "tips_registration_solapi_qa_abcdef012345";
  const leftover = { kind: "network", name: `supabase_network_${projectId}`, projectId };
  const calls = [];
  let inspections = 0;
  await assert.rejects(
    runner.runRegistrationCustomerSolapiLocalDbQa(
      { repositoryRoot, url: expectedUrl, dbUrl: expectedDbUrl, projectId, runtimeRoot },
      {
        environment: {},
        prepareRuntime: async () => calls.push("prepare"),
        runCommand: async (_command, label) => {
          calls.push(label);
          if (label === "cleanup") throw new Error("synthetic cleanup failure");
          return { stdout: "", stderr: "" };
        },
        runConcurrencyProbe: async () => ({ ownerCount: 1 }),
        inspectResources: async () => {
          inspections += 1;
          calls.push(`inspect:${inspections}`);
          if (inspections === 1) return [];
          if (inspections === 2) return exactResourceManifest(projectId);
          if (inspections === 3) return [leftover];
          throw new Error("synthetic reinspection failure");
        },
        removeResources: async (resources) => {
          calls.push(`fallback:${resources.map(({ name }) => name).join(",")}`);
          throw new Error("synthetic fallback failure");
        },
        removeRuntime: async () => {
          calls.push("remove-runtime");
          throw new Error("synthetic remove failure");
        },
      },
    ),
    (error) => {
      assert.match(error.message, /synthetic cleanup failure/);
      assert.match(error.message, /synthetic fallback failure/);
      assert.match(error.message, /synthetic reinspection failure/);
      assert.match(error.message, /synthetic remove failure/);
      assert.match(error.message, new RegExp(leftover.name));
      return true;
    },
  );
  assert.deepEqual(calls, [
    "inspect:1",
    "prepare",
    "dbStart",
    "inspect:2",
    "pgTap",
    "cleanup",
    "inspect:3",
    `fallback:${leftover.name}`,
    "inspect:4",
    "remove-runtime",
  ]);
  await rm(runtimeRoot, { recursive: true, force: true });
});

test("an inspection exception still attempts cleanup and workdir removal", async () => {
  const runner = await import(`file://${runnerPath}`);
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "tips-registration-solapi-qa-"));
  const calls = [];
  await assert.rejects(
    runner.runRegistrationCustomerSolapiLocalDbQa(
      {
        repositoryRoot,
        url: expectedUrl,
        dbUrl: expectedDbUrl,
        projectId: "tips_registration_solapi_qa_abcdef012345",
        runtimeRoot,
      },
      {
        environment: {},
        inspectResources: async () => {
          calls.push("inspect");
          if (calls.filter((value) => value === "inspect").length === 1) return [];
          throw new Error("synthetic inspect failure");
        },
        prepareRuntime: async () => calls.push("prepare"),
        runCommand: async (_command, label) => calls.push(label),
        runConcurrencyProbe: async () => calls.push("probe"),
        removeRuntime: async () => calls.push("remove-runtime"),
      },
    ),
    /synthetic inspect failure/,
  );
  assert.deepEqual(calls, [
    "inspect",
    "prepare",
    "dbStart",
    "inspect",
    "cleanup",
    "inspect",
    "remove-runtime",
  ]);
  await rm(runtimeRoot, { recursive: true, force: true });
});
