import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const POSTGRES17_FIXTURE_IMAGE = "public.ecr.aws/supabase/postgres:17.6.1.159";
export const POSTGRES17_RUNNER_TEST_NAMES = Object.freeze([
  "PostgreSQL trigger capture and parity follow name order across the full BEFORE UPDATE group",
  "PostgreSQL 17 restricted catalog reader executes the fixed statement against the real migration shape",
  "PostgreSQL 17 isolated migration prerequisite creates one exact row and rejects preexisting state",
  "PostgreSQL 17 function ACL reconciliation restores exact parity and detects drift",
  "fixed catalog statement distinguishes stored generated expressions from defaults",
  "fixed catalog statement captures every public enum dependency",
  "fixed catalog statement captures the appointment calendar view fingerprint",
  "fixed catalog statement gives duplicate constraint names stable distinct identities",
  "generated parity uses pg catalog definitions and detects representative object drift",
]);
export const POSTGRES17_BUILDER_TEST_NAME = "PostgreSQL 17 transactional preflight named checkpoint preserves FK errors and rollback";
export const POSTGRES17_FIXTURE_TEST_NAMES = Object.freeze([
  ...POSTGRES17_RUNNER_TEST_NAMES,
  POSTGRES17_BUILDER_TEST_NAME,
]);
export const POSTGRES17_FIXTURE_TEST_FILES = Object.freeze([
  "tests/isolated-supabase-db-tests.test.mjs",
  "tests/supabase-transactional-preflight-builder.test.mjs",
]);

function reject(reason) {
  // Never include child output, SQL, environment values, or an arbitrary Error message.
  throw new Error(`isolated_postgres_fixture_tests:${reason}`);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

export function fixtureTestNamePattern(names) {
  if (!Array.isArray(names) || names.length === 0 || names.some((name) => typeof name !== "string" || name.length === 0 || /[\r\n\0]/u.test(name)) || new Set(names).size !== names.length) {
    reject("invalid_test_name_inventory");
  }
  const escaped = names.map(escapeRegExp);
  return escaped.length === 1 ? `^${escaped[0]}$` : `^(?:${escaped.join("|")})$`;
}

export const OFFLINE_TRANSACTIONAL_CONTRACT_TEST_COMMAND = `node --test --test-skip-pattern='${fixtureTestNamePattern([POSTGRES17_BUILDER_TEST_NAME])}' tests/retryable-sqlstate-contract.test.mjs tests/supabase-transactional-preflight-builder.test.mjs`;
export const OFFLINE_ISOLATED_RUNNER_TEST_COMMAND = `node --test --test-skip-pattern='${fixtureTestNamePattern(POSTGRES17_RUNNER_TEST_NAMES)}' tests/isolated-supabase-db-tests.test.mjs`;
export const CACHED_POSTGRES_FIXTURE_TEST_COMMAND = "node scripts/run-isolated-postgres-fixture-tests.mjs";

export function buildPostgresFixtureTestArgs() {
  return [
    "--test", "--test-reporter=tap",
    `--test-name-pattern=${fixtureTestNamePattern(POSTGRES17_FIXTURE_TEST_NAMES)}`,
    ...POSTGRES17_FIXTURE_TEST_FILES,
  ];
}

export function postgresFixtureChildEnvironment(environment) {
  if (typeof environment?.PATH !== "string" || !environment.PATH || /[\r\n\0]/u.test(environment.PATH)) reject("invalid_path");
  return { PATH: environment.PATH, LANG: "C", LC_ALL: "C" };
}

export function assertPostgresFixtureSourceInventory(sources) {
  for (let index = 0; index < POSTGRES17_FIXTURE_TEST_FILES.length; index += 1) {
    const file = POSTGRES17_FIXTURE_TEST_FILES[index];
    const source = sources?.[file];
    if (typeof source !== "string") reject("missing_fixture_source");
    const expected = index === 0 ? POSTGRES17_RUNNER_TEST_NAMES : [POSTGRES17_BUILDER_TEST_NAME];
    for (const name of expected) {
      // Source is inspected as text, never imported or evaluated for inventory checks.
      const literal = new RegExp(`^test\\([\\t ]*(["'])${escapeRegExp(name)}\\1[\\t ]*,`, "gmu");
      if ([...source.matchAll(literal)].length !== 1) reject("fixture_source_inventory_drift");
    }
  }
}

const summaryValues = Object.freeze({ tests: 10, suites: 0, pass: 10, fail: 0, cancelled: 0, skipped: 0, todo: 0 });
const maximumTapBytes = 256 * 1024;

export function parsePostgresFixtureTap(output) {
  if (typeof output !== "string" || !output || Buffer.byteLength(output, "utf8") > maximumTapBytes || /[\0\x1b]/u.test(output)) reject("invalid_tap_output");
  const lines = output.replace(/\r\n/gu, "\n").split("\n");
  const names = [];
  const results = [];
  const summary = {};
  let headerCount = 0;
  let planCount = 0;
  let durationCount = 0;
  let diagnosticOpen = false;
  for (const line of lines) {
    if (line === "") continue;
    if (line === "TAP version 13") {
      if (headerCount !== 0 || names.length || planCount) reject("invalid_tap_header");
      headerCount += 1;
      continue;
    }
    if (/^(?:not ok\b|Bail out!)/iu.test(line)) reject("nonpassing_tap_result");
    const subtest = /^# Subtest: (.+)$/u.exec(line);
    if (subtest) {
      if (headerCount !== 1 || planCount || diagnosticOpen || names.length !== results.length || !POSTGRES17_FIXTURE_TEST_NAMES.includes(subtest[1]) || names.includes(subtest[1])) reject("fixture_tap_name_drift");
      names.push(subtest[1]);
      continue;
    }
    const result = /^ok ([1-9][0-9]*) - (.+)$/u.exec(line);
    if (result) {
      if (headerCount !== 1 || planCount || diagnosticOpen || Number(result[1]) !== results.length + 1 || names.length !== results.length + 1 || result[2] !== names.at(-1)) reject("invalid_tap_result");
      results.push(result[2]);
      continue;
    }
    if (line === "  ---") {
      if (diagnosticOpen || !results.length || names.length !== results.length || planCount) reject("invalid_tap_diagnostic");
      diagnosticOpen = true;
      continue;
    }
    if (line === "  ...") {
      if (!diagnosticOpen) reject("invalid_tap_diagnostic");
      diagnosticOpen = false;
      continue;
    }
    if (/^  (?:duration_ms: [0-9]+(?:\.[0-9]+)?|type: 'test')$/u.test(line)) {
      if (!diagnosticOpen) reject("invalid_tap_diagnostic");
      continue;
    }
    if (line === "1..10") {
      if (headerCount !== 1 || diagnosticOpen || planCount || names.length !== 10 || results.length !== 10) reject("invalid_tap_plan");
      planCount += 1;
      continue;
    }
    const metric = /^# (tests|suites|pass|fail|cancelled|skipped|todo) ([0-9]+)$/u.exec(line);
    if (metric) {
      if (planCount !== 1 || Object.hasOwn(summary, metric[1]) || Number(metric[2]) !== summaryValues[metric[1]]) reject("invalid_tap_summary");
      summary[metric[1]] = Number(metric[2]);
      continue;
    }
    if (/^# duration_ms [0-9]+(?:\.[0-9]+)?$/u.test(line)) {
      if (planCount !== 1 || Object.keys(summary).length !== 7 || durationCount) reject("invalid_tap_duration");
      durationCount += 1;
      continue;
    }
    // Reject nested/file-level tests, warnings, incomplete plans and arbitrary diagnostics.
    reject("unexpected_tap_line");
  }
  if (headerCount !== 1 || planCount !== 1 || diagnosticOpen || durationCount !== 1 || Object.keys(summary).length !== 7 || names.length !== 10 || results.length !== 10 || POSTGRES17_FIXTURE_TEST_NAMES.some((name) => !names.includes(name))) reject("incomplete_fixture_tap");
  return { ...summary, names: [...names] };
}

export function validatePostgresFixtureTestResult(result) {
  if (!result || result.error || result.code !== 0 || result.signal != null) reject("fixture_process_failed");
  if (typeof result.stderr !== "string" || result.stderr.trim() !== "") reject("fixture_process_diagnostics");
  return parsePostgresFixtureTap(result.stdout);
}

async function runBoundedProcess(command, args, options) {
  return new Promise((complete) => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env, stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    let bytes = 0;
    let failure = null;
    let forceTimer;
    const stop = (reason) => {
      if (failure) return;
      failure = reason;
      child.kill("SIGTERM");
      forceTimer = setTimeout(() => child.kill("SIGKILL"), 2_000);
      forceTimer.unref();
    };
    const timeout = setTimeout(() => stop("timeout"), options.timeoutMs);
    timeout.unref();
    const collect = (chunks) => (chunk) => {
      bytes += chunk.length;
      if (bytes > maximumTapBytes) stop("output_limit");
      else chunks.push(chunk);
    };
    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", collect(stderr));
    child.on("error", () => { failure = "spawn_error"; });
    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      clearTimeout(forceTimer);
      complete({ code, signal, error: failure, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") });
    });
  });
}

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export async function runIsolatedPostgresFixtureTests({
  platform = process.platform,
  root = repositoryRoot,
  nodeExecutable = process.execPath,
  environment = process.env,
  processRunner = runBoundedProcess,
  sourceReader = (path) => readFile(path, "utf8"),
} = {}) {
  if (platform !== "linux") reject("linux_required");
  const env = postgresFixtureChildEnvironment(environment);
  const sources = {};
  for (const file of POSTGRES17_FIXTURE_TEST_FILES) {
    try { sources[file] = await sourceReader(resolve(root, file)); }
    catch { reject("fixture_source_read_failed"); }
  }
  assertPostgresFixtureSourceInventory(sources);
  const image = await processRunner("docker", ["image", "inspect", "--format", "{{.Id}}", POSTGRES17_FIXTURE_IMAGE], { cwd: root, env, timeoutMs: 30_000 });
  if (!image || image.error || image.code !== 0 || image.signal != null || typeof image.stderr !== "string" || image.stderr.trim() || typeof image.stdout !== "string" || !/^sha256:[0-9a-f]{64}\n?$/u.test(image.stdout)) reject("cached_postgres_image_unavailable");
  const result = await processRunner(nodeExecutable, buildPostgresFixtureTestArgs(), { cwd: root, env, timeoutMs: 600_000 });
  const summary = validatePostgresFixtureTestResult(result);
  return { event: "isolated_postgres_fixture_tests_completed", image: POSTGRES17_FIXTURE_IMAGE, pullPolicy: "never", result: "PASS", ...summary };
}

async function main() {
  try {
    if (process.argv.length !== 2) reject("unexpected_arguments");
    console.log(JSON.stringify(await runIsolatedPostgresFixtureTests()));
  } catch (error) {
    const reason = /^isolated_postgres_fixture_tests:[a-z_]+$/u.test(error?.message ?? "") ? error.message : "isolated_postgres_fixture_tests:execution_failed";
    console.error(JSON.stringify({ event: "isolated_postgres_fixture_tests_failed", reason }));
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
