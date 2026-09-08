import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

// This probe can only run inside the isolated runner's nonce-scoped local DB.
const url = new URL(process.env.TASK_LOCAL_DB_URL || "https://invalid.invalid");
assert.equal(url.hostname, "127.0.0.1");
assert.match(process.env.TASK_LOCAL_DB_NONCE || "", /^[a-f0-9]{32}$/);
const config = await readFile("supabase/config.toml", "utf8");
const project = config.match(/^project_id = "(tips_supabase_db_qa_[a-f0-9]+)"/m)?.[1];
assert.ok(project);
assert.equal(config.match(/^port = (\d+)$/m)?.[1] === url.port, false, "the API port is not the DB port");
assert.ok(config.includes(`[db]\nport = ${url.port}\n`));
const container = `supabase_db_${project}`;
const task = "99610000-0000-4000-8000-000000000101";
const admin = "99610000-0000-4000-8000-000000000001";
const staff = "99610000-0000-4000-8000-000000000002";

function session(sql, hold = false) {
  const child = spawn("docker", ["exec", "-i", container, "psql", "-XqAt",
    "--set", "ON_ERROR_STOP=1", "--set", "VERBOSITY=verbose", "-U", "postgres", "-d", "postgres"],
  { stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  child.stdout.on("data", chunk => { stdout += chunk; });
  child.stderr.on("data", chunk => { stderr += chunk; });
  const done = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", code => resolve({ code, stdout, stderr }));
  });
  if (hold) child.stdin.write(sql);
  else child.stdin.end(sql);
  return { child, done, output: () => stdout };
}

async function query(sql) {
  const result = await session(sql).done;
  assert.equal(result.code, 0, result.stderr);
  return result.stdout.trim();
}

async function until(check, label) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(50);
  }
  throw new Error(`checkpoint timed out: ${label}`);
}

function writeSql(actor, requested, expected, key, name) {
  return `begin;
set local statement_timeout = '25s';
set local application_name = '${name}';
set local role authenticated;
select set_config('request.jwt.claim.sub', '${actor}', true);
select public.sync_registration_case_subjects_v2('${task}', array[${requested.map(v => `'${v}'`).join(",")}],
  array[${expected.map(v => `'${v}'`).join(",")}], '${key}');\n`;
}

function response(output) {
  return JSON.parse(output.split("\n").find(line => line.startsWith("{")));
}

const held = [];
try {
  await query(`
insert into auth.users(id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
values ('${admin}', 'authenticated', 'authenticated', 'q06-concurrent-admin@example.invalid', '{}', '{}'),
  ('${staff}', 'authenticated', 'authenticated', 'q06-concurrent-staff@example.invalid', '{}', '{}');
update public.profiles set role = case when id = '${admin}' then 'admin' else 'staff' end
where id in ('${admin}', '${staff}');
insert into public.ops_tasks(id, title, type, status, requested_by, student_name, subject, campus, priority)
values ('${task}', '등록: 과목 동시성', 'registration', 'in_progress', '${admin}', '격리 동시성', '영어', '본관', 'normal');
insert into public.ops_registration_details(task_id, common_revision) values ('${task}', 1);
insert into public.ops_registration_subject_tracks(task_id, subject, pipeline_status, workflow_status, workflow_revision, migration_review_required)
values ('${task}', '영어', 'inquiry', 'inquiry', 1, false);
`);
  const first = session(writeSql(admin, ["영어", "수학"], ["영어"], "race-a", "q06-subject-a") + "\\echo Q06_HELD\n", true);
  held.push(first);
  await until(() => first.output().includes("Q06_HELD"), "first subject save holds the locks");
  const second = session(writeSql(staff, ["영어", "과학"], ["영어"], "race-b", "q06-subject-b") + "commit;\n");
  await until(async () => (await query("select count(*) from pg_stat_activity where application_name = 'q06-subject-b' and wait_event_type = 'Lock';")) === "1", "second manager waits on the first transaction");
  first.child.stdin.end("commit;\n");
  assert.equal((await first.done).code, 0);
  const loser = await second.done;
  assert.notEqual(loser.code, 0);
  assert.match(loser.stderr, /23514: registration_subjects_conflict/);
  assert.equal(await query(`select string_agg(subject, ',' order by dashboard_private.registration_subject_sort_order(subject))
    from public.ops_registration_subject_tracks where task_id = '${task}' and archived_at is null;`), "영어,수학");

  const replayFirst = session(writeSql(admin, ["영어", "수학", "과학"], ["영어", "수학"], "replay-a", "q06-replay-a") + "\\echo Q06_HELD\n", true);
  held.push(replayFirst);
  await until(() => replayFirst.output().includes("Q06_HELD"), "first repeated request holds the locks");
  const replaySecond = session(writeSql(admin, ["영어", "수학", "과학"], ["영어", "수학"], "replay-a", "q06-replay-b") + "commit;\n");
  await until(async () => (await query("select count(*) from pg_stat_activity where application_name = 'q06-replay-b' and wait_event_type = 'Lock';")) === "1", "same request waits for its receipt");
  replayFirst.child.stdin.end("commit;\n");
  const [original, replay] = await Promise.all([replayFirst.done, replaySecond.done]);
  assert.equal(original.code, 0, original.stderr);
  assert.equal(replay.code, 0, replay.stderr);
  assert.deepEqual(response(original.stdout), response(replay.stdout));
  assert.equal(await query(`select count(*) from dashboard_private.ops_registration_mutations
    where actor_id = '${admin}' and request_key = 'replay-a';`), "1");
  assert.equal(await query(`select count(*) from public.ops_registration_subject_tracks where task_id = '${task}';`), "3");
  console.log(JSON.stringify({ status: "passed", scenarios: 2, staleSqlstate: "23514", concurrentReplayReceipts: 1, providerCalls: 0 }));
} finally {
  for (const item of held) {
    if (!item.child.stdin.writableEnded) item.child.stdin.end("rollback;\n");
  }
  await Promise.all(held.map(item => item.done));
  // The isolated runner destroys this nonce-scoped DB, including its fixture.
}
