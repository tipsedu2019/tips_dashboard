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

test("race fixture avoids braces inside SQL blocks consumed by the PostgreSQL isolation scanner", () => {
  const source = embeddedSpec();
  // PG17.6 specscanner.l ends SQL at the first closing brace, including one in
  // an SQL string literal. This is a source guard, not an executed parser test.
  const declarations = [...source.matchAll(/^(?:setup|teardown|step "[^"]+")\s*\{/gm)];
  const blocks = [...source.matchAll(/^(?:setup|teardown|step "[^"]+")\s*\{[^{}]*\}/gm)];
  assert.equal(blocks.length, declarations.length, "every SQL block must avoid interior brace literals");
  assert.match(source, /'role', 'authenticated'\)::text ELSE jsonb_build_object\(\)::text END, p_local\)/);
});

// Source-only check of the grammar subset used by this fixture, audited against
// PostgreSQL REL_17_6 src/test/isolation/{specscanner.l,specparse.y}. SQL ends at
// the first closing brace; quoted identifiers double quotes. Blocker/notices
// syntax is unused here and intentionally rejected. This is not the PG parser.
function parseRaceSpecStructure(source) {
  const tokens = [];
  const keywords = new Set(["setup", "teardown", "session", "step", "permutation", "notices"]);
  const scanner = /([ \t\r\f\n]+)|(#[^\n\r]*)|(\{[^}]*\})|("(?:[^"\n]|"")*")|([A-Za-z_][A-Za-z0-9_$]*)/y;
  let offset = 0;
  while (offset < source.length) {
    scanner.lastIndex = offset;
    const token = scanner.exec(source);
    assert.ok(token, `isolation spec invalid token at offset ${offset}`);
    offset = scanner.lastIndex;
    if (token[1] || token[2]) continue;
    if (token[3]) tokens.push({ type: "sql", value: token[3].slice(1, -1) });
    else if (token[4]) tokens.push({ type: "identifier", value: token[4].slice(1, -1).replaceAll('""', '"') });
    else tokens.push({ type: keywords.has(token[5]) ? token[5] : "identifier", value: token[5] });
  }
  tokens.push({ type: "eof" });
  let cursor = 0;
  const peek = type => tokens[cursor].type === type;
  const take = type => {
    assert.ok(peek(type), `isolation spec expected ${type}, received ${tokens[cursor].type}`);
    return tokens[cursor++].value;
  };
  const block = type => { take(type); return take("sql"); };
  const setups = [];
  while (peek("setup")) setups.push(block("setup"));
  const teardown = peek("teardown") ? block("teardown") : null;
  const sessions = [], stepNames = new Set(), sessionNames = new Set();
  while (peek("session")) {
    take("session");
    const name = take("identifier");
    assert.ok(!sessionNames.has(name), "isolation spec duplicate session");
    sessionNames.add(name);
    const setup = peek("setup") ? block("setup") : null;
    const steps = [];
    do {
      take("step");
      const step = take("identifier");
      assert.ok(!stepNames.has(step), "isolation spec duplicate step");
      stepNames.add(step);
      steps.push({ name: step, sql: take("sql") });
    } while (peek("step"));
    const cleanup = peek("teardown") ? block("teardown") : null;
    sessions.push({ name, setup, steps, teardown: cleanup });
  }
  assert.ok(sessions.length > 0, "isolation spec needs a session");
  const permutations = [];
  while (peek("permutation")) {
    take("permutation");
    const steps = [];
    do {
      const name = take("identifier");
      assert.ok(stepNames.has(name), "isolation spec unknown permutation step");
      steps.push(name);
    } while (peek("identifier"));
    permutations.push(steps);
  }
  take("eof");
  return { setups, teardown, sessions, permutations };
}

test("complete race spec follows PG17 global and session declaration ordering", () => {
  const parsed = parseRaceSpecStructure(embeddedSpec());
  assert.equal(parsed.setups.length, 1);
  assert.ok(parsed.teardown);
  assert.deepEqual(parsed.sessions.map(({ name, steps }) => [name, steps.length]), [["a", 10], ["b", 9], ["verify", 7]]);
  assert.ok(parsed.sessions.every(session => session.setup && session.teardown));
  assert.equal(parsed.permutations.length, 7);
  assert.equal(new Set(parsed.permutations.flat()).size, 26);
});

test("race grammar regression rejects misplaced cleanup and malformed declarations across the whole spec", () => {
  const source = embeddedSpec();
  const parsed = parseRaceSpecStructure(source);
  const malformed = [];
  for (const session of parsed.sessions) {
    const start = source.indexOf(`session "${session.name}"`);
    const end = start + source.slice(start).search(/\nteardown /);
    const cleanupEnd = source.indexOf("\n", end + 1);
    const cleanup = source.slice(end + 1, cleanupEnd);
    const without = source.slice(0, end + 1) + source.slice(cleanupEnd + 1);
    const firstStep = without.indexOf(`step "${session.steps[0].name}"`, start);
    malformed.push(without.slice(0, firstStep) + cleanup + "\n" + without.slice(firstStep));
  }
  malformed.push(
    source.replace("ELSE jsonb_build_object()::text END", "ELSE '{}' END"),
    source.replace('step "a_begin"', 'setup { SELECT 1; }\nstep "a_begin"'),
    source.replace('step "b_begin"', 'step "a_begin"'),
    source.replace('session "b"', 'session "a"'),
    source.replace('session "b"', 'teardown { SELECT 1; }\nsession "b"'),
    source.replace('session "b"', 'setup { SELECT 1; }\nsession "b"'),
    source.replace('session "a"', 'permutation "a_begin"\nsession "a"'),
    source.replace('step "b_commit"', 'step'),
    source.replace('permutation "a_begin"', 'permutation "missing_step"'),
    source.replace(/^permutation[^\n]+/m, 'permutation'),
    source + '\nsetup { SELECT 1; }',
    source + '\n"unterminated',
    source + '\nsetup { SELECT 1;',
    'setup { SELECT 1; }',
    'session "empty" teardown { SELECT 1; }',
  );
  for (const [index, invalid] of malformed.entries())
    assert.throws(() => parseRaceSpecStructure(invalid), /isolation spec/, `malformed structure ${index + 1}`);
  assert.equal(malformed.length, 18);
  // Optional global/session setup, teardown, and explicit permutations match
  // the official productions too; source policy still requires this race's 7.
  assert.equal(parseRaceSpecStructure('# comment\nsession "a""b" step s { SELECT 1; }').sessions[0].name, 'a"b');
});

// Source boundary checks supplement the real PG17 run; they cannot certify SQL
// execution, constraint success, or any concurrent outcome.
function assertInOrder(source, fragments) {
  let cursor = 0;
  for (const fragment of fragments) {
    const found = source.indexOf(fragment, cursor);
    assert.notEqual(found, -1, `missing or out-of-order fixture boundary: ${fragment}`);
    cursor = found + fragment.length;
  }
}

test("race seed verifies a live manager before domain writes and commits complete schedule inputs", () => {
  const source = embeddedSpec();
  const setup = source.slice(source.indexOf("setup\n{"), source.indexOf("\nteardown\n{"));
  assertInOrder(setup, ["BEGIN;", "RESET ROLE;", "current_user <> 'postgres'",
    "test.registration_guard.approved_local_db", "actor(false, false)",
    "INSERT INTO auth.users", "INSERT INTO public.profiles", "actor(true)",
    "INSERT INTO public.teacher_catalogs", "INSERT INTO public.classroom_catalogs",
    "INSERT INTO public.classes", "INSERT INTO public.ops_registration_enrollments",
    "SET CONSTRAINTS ALL IMMEDIATE", "INSERT INTO registration_guard_race_fixture.baseline",
    "actor(false)", "COMMIT;"]);
  const helper = setup.slice(setup.indexOf("CREATE FUNCTION registration_guard_race_fixture.actor"),
    setup.indexOf("REVOKE ALL ON FUNCTION registration_guard_race_fixture.actor"));
  assert.match(helper, /SECURITY INVOKER SET search_path = ''/);
  for (const key of ["request.jwt.claim.sub", "request.jwt.claim.role", "request.jwt.claims"])
    assert.ok(helper.includes(`set_config('${key}'`));
  assert.match(helper, /auth\.uid\(\)\) IS DISTINCT FROM registration_guard_race_fixture\.sid\(1\)/);
  assert.match(helper, /auth\.role\(\)\) IS DISTINCT FROM 'authenticated'/);
  assert.match(helper, /registration_actor_is_active_manager_v1\(\(SELECT auth\.uid\(\)\)\)/);
  assert.match(helper, /auth\.uid\(\)\) IS NOT NULL OR \(SELECT auth\.role\(\)\) IS NOT NULL/);
  assert.match(helper, /registration_guard_race_fixture_actor_invalid' USING ERRCODE = '42501'/);
  assert.match(helper, /registration_guard_race_fixture_actor_not_cleared' USING ERRCODE = '42501'/);
  const seedClass = setup.slice(setup.indexOf("INSERT INTO public.classes"), setup.indexOf("INSERT INTO public.ops_tasks"));
  assert.match(seedClass, /extract\(dow FROM current_date \+ 7\)/);
  assert.match(seedClass, /'sessionKey', to_char\(current_date \+ 7, 'YYYY-MM-DD'\) \|\| ':1'/);
  assert.match(seedClass, /'startTime', '18:00', 'endTime', '20:00'/);
  assert.match(seedClass, /'teacherCatalogId', registration_guard_race_fixture\.sid\(31\)/);
  assert.match(seedClass, /'classroomCatalogId', registration_guard_race_fixture\.sid\(32\)/);
  assert.doesNotMatch(source, /DISABLE TRIGGER|session_replication_role|GRANT[^;]+ON (?:public|dashboard_private)\./i);
});

test("race writers enter authenticated transactions while verification retains its private read role", () => {
  const source = embeddedSpec();
  for (const [name, next] of [["a", "b"], ["b", "verify"]]) {
    const session = source.slice(source.indexOf(`session "${name}"`), source.indexOf(`session "${next}"`));
    const begin = session.slice(session.indexOf(`step "${name}_begin"`), session.indexOf(`step "${name}_save_one"`));
    assertInOrder(session, ["setup", "RESET ROLE;", "actor(false, false)",
      `SET application_name = 'registration_guard_race_${name}'`]);
    assertInOrder(begin, ["BEGIN;", "SET LOCAL statement_timeout = '30s'", "actor(true)",
      "SET LOCAL ROLE authenticated", "current_user <> 'authenticated'",
      "auth.role()) IS DISTINCT FROM 'authenticated'", "auth.uid()) IS DISTINCT FROM registration_guard_race_fixture.sid(1)",
      "registration_guard_race_writer_context_invalid' USING ERRCODE = '42501'"]);
    assert.match(session, /teardown \{ ROLLBACK; RESET ROLE; SELECT registration_guard_race_fixture\.actor\(false, false\); \}/);
  }
  const verify = source.slice(source.indexOf('session "verify"'), source.indexOf("\npermutation "));
  assertInOrder(verify, ["setup", "RESET ROLE;", "actor(false, false)", "current_user <> 'postgres'",
    "registration_guard_race_verifier_role_invalid", "teardown", "RESET ROLE;", "actor(false, false)"]);
  assert.doesNotMatch(verify, /SET (?:LOCAL )?ROLE authenticated|actor\(true\)/);
  assert.equal([...verify.matchAll(/SELECT registration_guard_race_fixture\.assert_case\([1-7]\)/g)].length, 7);
});

test("race teardown keeps its actor through deferred cleanup and then removes scoped accounts and resources", () => {
  const source = embeddedSpec();
  const teardown = source.slice(source.indexOf("\nteardown\n{"), source.indexOf('\nsession "a"'));
  assertInOrder(teardown, ["BEGIN;", "RESET ROLE;", "actor(true)", "DELETE FROM public.ops_tasks",
    "DELETE FROM public.classes", "DELETE FROM public.teacher_catalogs", "DELETE FROM public.classroom_catalogs",
    "SET CONSTRAINTS ALL IMMEDIATE", "actor(false)", "DELETE FROM public.profiles", "DELETE FROM auth.users",
    "registration_guard_race_fixture_cleanup_incomplete' USING ERRCODE = '23514'",
    "DROP SCHEMA registration_guard_race_fixture CASCADE", "COMMIT;"]);
  for (const table of ["ops_tasks", "ops_registration_enrollments", "ops_registration_subject_tracks",
    "ops_registration_details", "classes", "teacher_catalogs", "classroom_catalogs", "profiles"])
    assert.ok(teardown.includes(`EXISTS(SELECT 1 FROM public.${table}`), `missing cleanup check for ${table}`);
  assert.match(teardown, /EXISTS\(SELECT 1 FROM dashboard_private\.ops_registration_mutations WHERE actor_id = registration_guard_race_fixture\.sid\(1\)\)/);
  assert.match(teardown, /EXISTS\(SELECT 1 FROM auth\.users WHERE id = registration_guard_race_fixture\.sid\(1\)\)/);
  assert.equal([...teardown.matchAll(/DELETE FROM [\w.]+\s+WHERE/g)].length, 6);
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
