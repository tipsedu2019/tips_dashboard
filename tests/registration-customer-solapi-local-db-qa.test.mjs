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
});

test("failure cleanup removes only the invocation workdir and records no leftovers", async () => {
  const runner = await import(`file://${runnerPath}`);
  const runtimeRoot = await mkdtemp(
    path.join(os.tmpdir(), "registration-solapi-runner-test-"),
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
        inspectResources: async () => [],
        removeRuntime: async (target) => {
          calls.push(`remove:${target}`);
          await rm(target, { recursive: true, force: true });
        },
      },
    ),
    /synthetic pgTAP failure/,
  );

  assert.deepEqual(calls, [
    "prepare",
    "dbStart",
    "pgTap",
    "cleanup",
    `remove:${runtimeRoot}`,
  ]);
  assert.equal(await readFile(outsideSentinel, "utf8"), "keep");
  await rm(outsideSentinel, { force: true });
});
