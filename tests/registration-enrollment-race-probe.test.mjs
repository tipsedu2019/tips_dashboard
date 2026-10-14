import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { RACE_CASES, SPEC_SHA256, embeddedSpec, runRaceProbe, validateIsolatedContext,
  validateIsolationOutput } from "./probe-registration-enrollment-guarded-save-concurrency.mjs";

const execFileAsync = promisify(execFile);
const probeUrl = new URL("./probe-registration-enrollment-guarded-save-concurrency.mjs", import.meta.url);
const environment = { PATH: "/synthetic/path", TASK_LOCAL_DB_URL: "postgresql://postgres:synthetic@127.0.0.1:54329/postgres",
  TASK_LOCAL_DB_NONCE: "a".repeat(32) };
const cwd = "/tmp/tips-supabase-db-qa-registration-guard-local-20261013";
const config = 'project_id = "tips_supabase_db_qa_abcdefabcdef"\n[db]\nport = 54329\nmajor_version = 17\n[studio]\nenabled = false\n';

// These small strings test the parser only. They are neither captured database
// output nor a PostgreSQL expected-output artifact, and never certify a race.
function syntheticProtocolFrames() {
  const permutations = [...embeddedSpec().matchAll(/^permutation\s+(.+)$/gm)]
    .map(match => [...match[1].matchAll(/"([^"]+)"/g)].map(step => step[1]).join(" "));
  return "Parsed test spec with 3 sessions\n" + RACE_CASES.map(([wait, verify], index) =>
    `starting permutation: ${permutations[index]}\nstep ${wait}: synthetic parser fixture <waiting ...>\nstep ${wait}: <... completed>\nstep ${verify}: SELECT registration_guard_race_fixture.assert_case(${index + 1});\n(1 row)\n`).join("");
}

test("portable race probe embeds the exact standalone spec and seven paired wait/verify cases", async () => {
  const source = await readFile(new URL("../supabase/tests/registration_enrollment_guarded_save_race.spec", import.meta.url), "utf8");
  assert.equal(embeddedSpec(), source);
  assert.match(SPEC_SHA256, /^[a-f0-9]{64}$/);
  assert.equal(RACE_CASES.length, 7);
  assert.equal([...source.matchAll(/^permutation /gm)].length, 7);
  assert.equal([...source.matchAll(/^session /gm)].length, 3);
  assert.match(source, /permutation[^\n]*a_hold_director_track[^\n]*b_save_after_director[^\n]*a_assign_after_guard_task/);
});

test("race probe plan does not read connection config or spawn a process", async () => {
  const forbidden = async () => { assert.fail("plan must perform no SQL or process work"); };
  const noEnvironment = await runRaceProbe({ environment: {}, readConfig: forbidden, execute: forbidden });
  const explicit = await runRaceProbe({ argv: ["--plan"], environment, readConfig: forbidden, execute: forbidden });
  assert.deepEqual(explicit, noEnvironment);
  assert.equal(explicit.status, "plan");
  assert.equal(explicit.sqlExecuted, false);
  assert.equal(explicit.sessions, 3);
  assert.equal(explicit.permutations, 7);
});

test("actual CLI plan ignores present invalid database context and never enters the runner", async () => {
  const result = await execFileAsync(process.execPath, [fileURLToPath(probeUrl), "--plan"], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: { PATH: "/no-isolationtester-on-this-path", TASK_LOCAL_DB_URL: "postgresql://postgres:synthetic@remote.invalid/postgres",
      TASK_LOCAL_DB_NONCE: "invalid" },
  });
  assert.equal(JSON.parse(result.stdout).status, "plan");
  assert.equal(JSON.parse(result.stdout).sqlExecuted, false);
  assert.equal(result.stderr, "");
  assert.doesNotMatch(result.stdout, /remote\.invalid|postgresql|synthetic/);
});

test("race probe rejects external service targets mismatched owned config and missing nonce before subprocess", async () => {
  assert.deepEqual(validateIsolatedContext({ environment, cwd, config }), {
    projectId: "tips_supabase_db_qa_abcdefabcdef", port: 54329, databaseMajorVersion: 17 });
  for (const input of [
    { environment: { ...environment, TASK_LOCAL_DB_URL: environment.TASK_LOCAL_DB_URL.replace("127.0.0.1", "remote.invalid") }, cwd, config },
    { environment: { ...environment, TASK_LOCAL_DB_URL: `${environment.TASK_LOCAL_DB_URL}?host=remote.invalid` }, cwd, config },
    { environment: { ...environment, TASK_LOCAL_DB_NONCE: "" }, cwd, config },
    { environment, cwd: "/workspace/tips_dashboard", config },
    { environment, cwd, config: config.replace("port = 54329", "port = 54330") },
    { environment, cwd, config: config.replace("major_version = 17", "major_version = 15") },
  ]) assert.throws(() => validateIsolatedContext(input), /registration_guard_race_/);
  let spawns = 0;
  await assert.rejects(runRaceProbe({ environment: { ...environment, TASK_LOCAL_DB_URL: "postgresql://remote.invalid/postgres" },
    cwd, readConfig: async () => config, execute: async () => { spawns += 1; } }), /registration_guard_race_loopback_required/);
  assert.equal(spawns, 0);
});

test("race parser rejects zero-exit SQL errors missing waits incomplete verification and teardown failures", () => {
  const stdout = syntheticProtocolFrames();
  assert.equal(validateIsolationOutput({ code: 0, stdout, stderr: "" }).permutations, 7,
    "this assertion exercises synthetic parser frames only");
  for (const output of [
    { code: 1, stdout, stderr: "" },
    { code: 0, stdout: `${stdout}\nERROR: synthetic failed SQL assertion\n`, stderr: "" },
    { code: 0, stdout, stderr: "teardown failed: synthetic failure" },
    { code: 0, stdout: stdout.replace("<waiting ...>", ""), stderr: "" },
    { code: 0, stdout: stdout.replace("step verify_cross_track:", "step omitted:"), stderr: "" },
    { code: 0, stdout: stdout.replace("starting permutation:", "omitted permutation:"), stderr: "" },
    { code: 0, stdout: stdout.replace("3 sessions", "2 sessions"), stderr: "" },
    { code: 0, stdout: stdout.replace("step verify_director_fk:", "step omitted:"), stderr: "" },
  ]) assert.throws(() => validateIsolationOutput(output), /registration_guard_race_/);
});

test("runner-context mock invocation supplies exact spec and strips ambient PostgreSQL settings", async () => {
  const calls = [];
  const result = await runRaceProbe({ environment: { ...environment, PGHOST: "remote.invalid", PGOPTIONS: "malicious", DATABASE_URL: "private" },
    cwd, readConfig: async () => config, execute: async (command, args, options) => {
      calls.push({ command, args, options });
      return args[0] === "-V" ? { code: 0, stdout: "isolationtester (PostgreSQL) 17.6\n", stderr: "" }
        : { code: 0, stdout: syntheticProtocolFrames(), stderr: "" };
    } });
  assert.equal(result.permutations, 7, "mock protocol validation is not executed database evidence");
  assert.equal(calls.length, 2);
  assert.equal(calls[1].options.input, embeddedSpec());
  assert.equal(calls[1].options.environment.PGOPTIONS, "-c test.registration_guard.approved_local_db=on");
  assert.equal(calls[1].options.environment.PGHOST, undefined);
  assert.equal(calls[1].options.environment.DATABASE_URL, undefined);
});
