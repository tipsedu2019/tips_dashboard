import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  CACHED_POSTGRES_FIXTURE_TEST_COMMAND,
  OFFLINE_ISOLATED_RUNNER_TEST_COMMAND,
  OFFLINE_TRANSACTIONAL_CONTRACT_TEST_COMMAND,
  POSTGRES17_BUILDER_TEST_NAME,
  POSTGRES17_FIXTURE_IMAGE,
  POSTGRES17_FIXTURE_TEST_FILES,
  POSTGRES17_FIXTURE_TEST_NAMES,
  POSTGRES17_RUNNER_TEST_NAMES,
  assertPostgresFixtureSourceInventory,
  buildPostgresFixtureTestArgs,
  fixtureTestNamePattern,
  parsePostgresFixtureTap,
  postgresFixtureChildEnvironment,
  runIsolatedPostgresFixtureTests,
  validatePostgresFixtureTestResult,
} from "../scripts/run-isolated-postgres-fixture-tests.mjs";

function passingTap(names = POSTGRES17_FIXTURE_TEST_NAMES) {
  return [
    "TAP version 13",
    ...names.flatMap((name, index) => [
      `# Subtest: ${name}`, `ok ${index + 1} - ${name}`,
      "  ---", "  duration_ms: 1.25", "  type: 'test'", "  ...",
    ]),
    `1..${names.length}`, `# tests ${names.length}`, "# suites 0", `# pass ${names.length}`,
    "# fail 0", "# cancelled 0", "# skipped 0", "# todo 0", "# duration_ms 20.5", "",
  ].join("\n");
}

function passingProcess(overrides = {}) {
  return { code: 0, signal: null, error: null, stderr: "", stdout: passingTap(), ...overrides };
}

function sourceFixtures() {
  return Object.fromEntries(POSTGRES17_FIXTURE_TEST_FILES.map((file, index) => [
    file,
    (index === 0 ? POSTGRES17_RUNNER_TEST_NAMES : [POSTGRES17_BUILDER_TEST_NAME])
      .map((name) => `test(${JSON.stringify(name)}, async () => {});`).join("\n"),
  ]));
}

function runtimeOptions(processRunner) {
  const sources = sourceFixtures();
  return {
    platform: "linux", root: "/synthetic-repository", nodeExecutable: "/synthetic-node",
    environment: { PATH: "/synthetic-bin", LANG: "secret-value", LC_ALL: "secret-value", NODE_OPTIONS: "--require=unsafe", SUPABASE_ACCESS_TOKEN: "do-not-propagate" },
    sourceReader: async (path) => sources[POSTGRES17_FIXTURE_TEST_FILES.find((file) => path.endsWith(file))],
    processRunner,
  };
}

test("fixture inventory freezes the exact nine runner names and one builder name", () => {
  assert.equal(POSTGRES17_RUNNER_TEST_NAMES.length, 9);
  assert.equal(POSTGRES17_FIXTURE_TEST_NAMES.length, 10);
  assert.equal(new Set(POSTGRES17_FIXTURE_TEST_NAMES).size, 10);
  assert.equal(POSTGRES17_FIXTURE_TEST_NAMES.at(-1), POSTGRES17_BUILDER_TEST_NAME);
  assert.equal(Object.isFrozen(POSTGRES17_FIXTURE_TEST_NAMES), true);
  assert.equal(Object.isFrozen(POSTGRES17_RUNNER_TEST_NAMES), true);
  assert.throws(() => POSTGRES17_FIXTURE_TEST_NAMES.push("unsafe"), TypeError);
});

test("fixture selectors escape regex syntax, anchor exact titles and reject ambiguous inventories", () => {
  const names = ["a.b", "c[0](x)+?", "pipe|$^\\"];
  const selector = new RegExp(fixtureTestNamePattern(names), "u");
  for (const name of names) {
    assert.equal(selector.test(name), true);
    assert.equal(selector.test(`${name} suffix`), false);
    assert.equal(selector.test(`prefix ${name}`), false);
  }
  assert.equal(selector.test("axb"), false);
  for (const names of [[], ["duplicate", "duplicate"], [""], ["newline\n"], [null], null]) {
    assert.throws(() => fixtureTestNamePattern(names), /invalid_test_name_inventory/u);
  }
});

test("offline selectors exclude only their assigned runtime names and mandatory runtime command is fixed", () => {
  assert.equal(OFFLINE_TRANSACTIONAL_CONTRACT_TEST_COMMAND, `node --test --test-skip-pattern='${fixtureTestNamePattern([POSTGRES17_BUILDER_TEST_NAME])}' tests/retryable-sqlstate-contract.test.mjs tests/supabase-transactional-preflight-builder.test.mjs`);
  assert.equal(OFFLINE_ISOLATED_RUNNER_TEST_COMMAND, `node --test --test-skip-pattern='${fixtureTestNamePattern(POSTGRES17_RUNNER_TEST_NAMES)}' tests/isolated-supabase-db-tests.test.mjs`);
  assert.equal(CACHED_POSTGRES_FIXTURE_TEST_COMMAND, "node scripts/run-isolated-postgres-fixture-tests.mjs");
  assert.deepEqual(buildPostgresFixtureTestArgs(), [
    "--test", "--test-reporter=tap", `--test-name-pattern=${fixtureTestNamePattern(POSTGRES17_FIXTURE_TEST_NAMES)}`,
    ...POSTGRES17_FIXTURE_TEST_FILES,
  ]);
  const selector = new RegExp(fixtureTestNamePattern(POSTGRES17_RUNNER_TEST_NAMES), "u");
  assert.equal(selector.test(POSTGRES17_BUILDER_TEST_NAME), false);
  assert.equal(selector.test("ordinary offline contract"), false);
});

test("fixture environment carries only PATH and fixed locale without inherited tokens or Node options", () => {
  assert.deepEqual(postgresFixtureChildEnvironment({ PATH: "/usr/bin", HOME: "/private", NODE_OPTIONS: "--inspect", SUPABASE_ACCESS_TOKEN: "private", DOCKER_HOST: "external", LANG: "private" }), { PATH: "/usr/bin", LANG: "C", LC_ALL: "C" });
  for (const environment of [{}, { PATH: "" }, { PATH: "a\nb" }, { PATH: "a\0b" }, { PATH: 2 }]) {
    assert.throws(() => postgresFixtureChildEnvironment(environment), /invalid_path/u);
  }
});

test("fixture TAP accepts only complete ten-name success including CRLF and harmless result ordering", () => {
  const expected = { tests: 10, suites: 0, pass: 10, fail: 0, cancelled: 0, skipped: 0, todo: 0, names: [...POSTGRES17_FIXTURE_TEST_NAMES] };
  assert.deepEqual(parsePostgresFixtureTap(passingTap()), expected);
  assert.deepEqual(parsePostgresFixtureTap(passingTap().replace(/\n/gu, "\r\n")), expected);
  const reversed = [...POSTGRES17_FIXTURE_TEST_NAMES].reverse();
  assert.deepEqual(parsePostgresFixtureTap(passingTap(reversed)).names, reversed);
});

test("fixture TAP rejects zero, partial, extra, renamed, duplicate and inconsistent title results", () => {
  const full = passingTap();
  const first = POSTGRES17_FIXTURE_TEST_NAMES[0];
  const last = POSTGRES17_FIXTURE_TEST_NAMES.at(-1);
  const invalid = [
    passingTap([]), passingTap(POSTGRES17_FIXTURE_TEST_NAMES.slice(0, 9)),
    passingTap([...POSTGRES17_FIXTURE_TEST_NAMES, "extra fixture"]),
    passingTap(["renamed fixture", ...POSTGRES17_FIXTURE_TEST_NAMES.slice(1)]),
    passingTap([first, first, ...POSTGRES17_FIXTURE_TEST_NAMES.slice(2)]),
    full.replace(`ok 1 - ${first}`, `ok 1 - ${last}`),
    full.replace("ok 2 -", "ok 1 -"),
    full.replace(`# Subtest: ${first}\n`, ""),
    full.replace(`ok 1 - ${first}\n`, ""),
    full.replace(`# Subtest: ${first}`, `    # Subtest: ${first}`),
    full.replace("1..10", "1..9"),
    full.replace("1..10", "1..10\n1..10"),
  ];
  for (const output of invalid) assert.throws(() => parsePostgresFixtureTap(output), /isolated_postgres_fixture_tests:/u);
});

test("fixture TAP rejects every skip, todo, failure and cancellation even when final counters claim pass", () => {
  const full = passingTap();
  for (const altered of [
    full.replace("ok 1 -", "not ok 1 -"),
    full.replace("  ---", "# SKIP runtime unavailable\n  ---"),
    full.replace("  ---", "# TODO runtime unavailable\n  ---"),
    full.replace("# fail 0", "# fail 1"),
    full.replace("# cancelled 0", "# cancelled 1"),
    full.replace("# skipped 0", "# skipped 1"),
    full.replace("# todo 0", "# todo 1"),
    full.replace("# suites 0", "# suites 1"),
    `${full}Bail out! runtime failed\n`,
  ]) assert.throws(() => parsePostgresFixtureTap(altered), /isolated_postgres_fixture_tests:/u);
});

test("fixture TAP rejects absent, duplicated, conflicting and truncated summary evidence", () => {
  const full = passingTap();
  for (const altered of [
    full.replace("# tests 10\n", ""), full.replace("# tests 10", "# tests 0"),
    full.replace("# pass 10", "# pass 9"),
    full.replace("# pass 10", "# pass 10\n# pass 10"),
    full.replace("# pass 10", "# pass 10\n# pass 0"),
    full.replace("# duration_ms 20.5", ""),
    full.replace("# duration_ms 20.5", "# duration_ms 20.5\n# duration_ms 20.5"),
    full.replace("TAP version 13\n", ""), `${full}TAP version 13\n`,
    full.replace("  ...\n", ""),
  ]) assert.throws(() => parsePostgresFixtureTap(altered), /isolated_postgres_fixture_tests:/u);
});

test("fixture TAP refuses arbitrary diagnostics, escape sequences and oversized output without echoing it", () => {
  for (const output of [null, "", `secret-token\n${passingTap()}`, `${passingTap()}# warning: secret-token\n`, `${passingTap()}\x1b[31m`, `${passingTap()}\0`, "x".repeat(256 * 1024 + 1)]) {
    assert.throws(() => parsePostgresFixtureTap(output), (error) => /^isolated_postgres_fixture_tests:[a-z_]+$/u.test(error.message) && !error.message.includes("secret-token"));
  }
});

test("fixture process validation refuses exit failures, signals, errors and stderr despite a passing transcript", () => {
  assert.equal(validatePostgresFixtureTestResult(passingProcess()).pass, 10);
  for (const result of [
    null, passingProcess({ code: 1 }), passingProcess({ code: null }), passingProcess({ code: undefined }),
    passingProcess({ signal: "SIGTERM" }), passingProcess({ error: new Error("secret-token") }),
    passingProcess({ stderr: "warning secret-token" }), passingProcess({ stderr: undefined }),
  ]) assert.throws(() => validatePostgresFixtureTestResult(result), (error) => /^isolated_postgres_fixture_tests:[a-z_]+$/u.test(error.message) && !error.message.includes("secret-token"));
});

test("source inventory refuses deleted, moved, renamed, skipped or duplicate literal runtime cases", () => {
  assert.doesNotThrow(() => assertPostgresFixtureSourceInventory(sourceFixtures()));
  const file = POSTGRES17_FIXTURE_TEST_FILES[0];
  for (const mutate of [
    (sources) => { delete sources[file]; },
    (sources) => { sources[file] = sources[file].replace(POSTGRES17_RUNNER_TEST_NAMES[0], "renamed"); },
    (sources) => { sources[file] = sources[file].replace(/^test\(/u, "test.skip("); },
    (sources) => { sources[file] += `\ntest(${JSON.stringify(POSTGRES17_RUNNER_TEST_NAMES[0])}, () => {});`; },
    (sources) => { [sources[file], sources[POSTGRES17_FIXTURE_TEST_FILES[1]]] = [sources[POSTGRES17_FIXTURE_TEST_FILES[1]], sources[file]]; },
  ]) {
    const sources = sourceFixtures();
    mutate(sources);
    assert.throws(() => assertPostgresFixtureSourceInventory(sources), /isolated_postgres_fixture_tests:/u);
  }
});

test("the current repository retains every required literal runtime title in its assigned file", async () => {
  const sources = Object.fromEntries(await Promise.all(POSTGRES17_FIXTURE_TEST_FILES.map(async (file) => [file, await readFile(new URL(`../${file}`, import.meta.url), "utf8")])));
  assert.doesNotThrow(() => assertPostgresFixtureSourceInventory(sources));
});

test("cached fixture runtime requires Linux and rejects source drift before starting any process", async () => {
  let calls = 0;
  const options = runtimeOptions(async () => { calls += 1; return passingProcess(); });
  await assert.rejects(runIsolatedPostgresFixtureTests({ ...options, platform: "darwin" }), /linux_required/u);
  await assert.rejects(runIsolatedPostgresFixtureTests({ ...options, sourceReader: async () => "test('renamed', () => {});" }), /fixture_source_inventory_drift/u);
  await assert.rejects(runIsolatedPostgresFixtureTests({ ...options, sourceReader: async () => { throw new Error("secret-token"); } }), /fixture_source_read_failed/u);
  assert.equal(calls, 0);
});

test("cached fixture runtime never launches tests when the exact cached image cannot be verified", async () => {
  for (const image of [
    { code: 1, signal: null, error: null, stdout: "", stderr: "missing" },
    { code: 0, signal: null, error: null, stdout: "different-image", stderr: "" },
    { code: 0, signal: "SIGTERM", error: null, stdout: `sha256:${"a".repeat(64)}\n`, stderr: "" },
    { code: 0, signal: null, error: "timeout", stdout: `sha256:${"a".repeat(64)}\n`, stderr: "" },
    { code: 0, signal: null, error: null, stdout: `sha256:${"a".repeat(64)}\n`, stderr: "warning" },
  ]) {
    const calls = [];
    const options = runtimeOptions(async (command, args) => { calls.push({ command, args }); return image; });
    await assert.rejects(runIsolatedPostgresFixtureTests(options), /cached_postgres_image_unavailable/u);
    assert.deepEqual(calls, [{ command: "docker", args: ["image", "inspect", "--format", "{{.Id}}", POSTGRES17_FIXTURE_IMAGE] }]);
  }
});

test("cached fixture runtime binds exact image, clean environment and ten selected tests before returning bounded success", async () => {
  const calls = [];
  const options = runtimeOptions(async (command, args, options) => {
    calls.push({ command, args, options });
    return command === "docker" ? { code: 0, signal: null, error: null, stdout: `sha256:${"a".repeat(64)}\n`, stderr: "" } : passingProcess();
  });
  const receipt = await runIsolatedPostgresFixtureTests(options);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].command, "/synthetic-node");
  assert.deepEqual(calls[1].args, buildPostgresFixtureTestArgs());
  for (const call of calls) assert.deepEqual(call.options.env, { PATH: "/synthetic-bin", LANG: "C", LC_ALL: "C" });
  assert.equal(calls[0].options.timeoutMs, 30_000);
  assert.equal(calls[1].options.timeoutMs, 600_000);
  assert.equal(receipt.result, "PASS");
  assert.equal(receipt.image, POSTGRES17_FIXTURE_IMAGE);
  assert.equal(receipt.pullPolicy, "never");
  assert.equal(receipt.tests, 10);
  assert.deepEqual(receipt.names, [...POSTGRES17_FIXTURE_TEST_NAMES]);
  assert.equal(JSON.stringify(receipt).includes("do-not-propagate"), false);
});

test("actual Node TAP selection executes ten synthetic titles across both files and omits unmatched cases", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "tips-postgres-fixture-tap-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const files = [join(directory, "runner.test.mjs"), join(directory, "builder.test.mjs")];
  await Promise.all(files.map((file, index) => writeFile(file, [
    'import test from "node:test";',
    ...(index === 0 ? POSTGRES17_RUNNER_TEST_NAMES : [POSTGRES17_BUILDER_TEST_NAME]).map((name) => `test(${JSON.stringify(name)}, () => {});`),
    'test("unmatched offline contract", () => { throw new Error("must not run"); });',
  ].join("\n"))));
  const result = spawnSync(process.execPath, [...buildPostgresFixtureTestArgs().slice(0, 3), ...files], { encoding: "utf8", timeout: 30_000, env: postgresFixtureChildEnvironment(process.env) });
  const summary = validatePostgresFixtureTestResult({ code: result.status, signal: result.signal, error: result.error, stdout: result.stdout, stderr: result.stderr });
  assert.equal(summary.tests, 10);
  assert.equal(summary.pass, 10);
  assert.equal(summary.skipped, 0);
  assert.deepEqual(new Set(summary.names), new Set(POSTGRES17_FIXTURE_TEST_NAMES));
});

test("fixture CLI rejects unexpected arguments without invoking Docker or exposing caller diagnostics", () => {
  const result = spawnSync(process.execPath, [new URL("../scripts/run-isolated-postgres-fixture-tests.mjs", import.meta.url).pathname, "--skip"], { encoding: "utf8", timeout: 30_000, env: postgresFixtureChildEnvironment(process.env) });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.deepEqual(JSON.parse(result.stderr), { event: "isolated_postgres_fixture_tests_failed", reason: "isolated_postgres_fixture_tests:unexpected_arguments" });
});
