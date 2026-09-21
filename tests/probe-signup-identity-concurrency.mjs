import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

// Only run against the nonce-scoped disposable database created by the isolated runner.
const url = new URL(process.env.TASK_LOCAL_DB_URL || "https://invalid.invalid");
assert.equal(url.hostname, "127.0.0.1");
assert.match(process.env.TASK_LOCAL_DB_NONCE || "", /^[a-f0-9]{32}$/);
const config = await readFile("supabase/config.toml", "utf8");
const project = config.match(/^project_id = "(tips_supabase_db_qa_[a-f0-9]+)"/m)?.[1];
assert.ok(project);
assert.ok(config.includes(`[db]\nport = ${url.port}\n`));
const container = `supabase_db_${project}`;
const id = n => `a9800000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sessions = [];

function session(sql, hold = false) {
  const child = spawn("docker", ["exec", "-i", container, "psql", "-XqAt", "--set", "ON_ERROR_STOP=1",
    "--set", "VERBOSITY=verbose", "-U", "postgres", "-d", "postgres"], { stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  child.stdout.on("data", chunk => { stdout += chunk; });
  child.stderr.on("data", chunk => { stderr += chunk; });
  const done = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", code => resolve({ code, stdout, stderr }));
  });
  if (hold) child.stdin.write(sql);
  else child.stdin.end(sql);
  const result = { child, done, output: () => stdout };
  sessions.push(result);
  return result;
}
async function query(sql) {
  const result = await session(sql).done;
  assert.equal(result.code, 0, result.stderr);
  return result.stdout.trim();
}
async function until(check, label) {
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(30);
  }
  throw new Error(`checkpoint timed out: ${label}`);
}
async function signupRace(seed, rollback) {
  const name = `signup-ownership-${seed}`;
  await query(`insert into public.teacher_catalogs(id,name,account_email,dashboard_role,is_visible)
    values('${id(seed)}','__same_name_${seed}__','reserved-${seed}@example.invalid','teacher',false);`);
  const before = await query(`select to_jsonb(t) from public.teacher_catalogs t where id='${id(seed)}';`);
  const insert = (actor, app) => `begin; set local statement_timeout='15s'; set local application_name='${app}';
    insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data)
    values('${id(actor)}','authenticated','authenticated','signup-race-${actor}@example.invalid','{}','{"name":"__same_name_${seed}__"}');
    \\echo SIGNUP_DONE
`;
  const first = session(insert(seed + 1, `${name}-a`), true);
  await until(() => first.output().includes('SIGNUP_DONE'), 'first signup has finished within its transaction');
  const second = session(insert(seed + 2, `${name}-b`) + 'commit;\n');
  await until(async () => second.output().includes('SIGNUP_DONE')
    || await query(`select count(*) from pg_stat_activity where application_name='${name}-b';`) === '1',
    'competing signup has reached the database');
  first.child.stdin.end(rollback ? 'rollback;\n' : 'commit;\n');
  const results = await Promise.all([first.done, second.done]);
  for (const result of results) assert.equal(result.code, 0, result.stderr);
  assert.equal(await query(`select to_jsonb(t) from public.teacher_catalogs t where id='${id(seed)}';`), before,
    'concurrent display-name signups must not claim the reserved catalog');
  const links = JSON.parse(await query(`select jsonb_agg(jsonb_build_object('profile',p.id,'teacher',p.teacher_catalog_id,'owner',t.profile_id))
    from public.profiles p join public.teacher_catalogs t on t.id=p.teacher_catalog_id where p.id in ('${id(seed + 1)}','${id(seed + 2)}');`));
  assert.equal(links.length, rollback ? 1 : 2);
  for (const link of links) {
    assert.equal(link.profile, link.owner);
    assert.notEqual(link.teacher, id(seed));
  }
  assert.equal(new Set(links.map(link => link.teacher)).size, links.length);
}
try {
  const before = await query('select jsonb_build_array((select count(*) from dashboard_private.notification_events),(select count(*) from dashboard_private.notification_deliveries));');
  await signupRace(100, false);
  await signupRace(200, true);
  assert.equal(await query('select jsonb_build_array((select count(*) from dashboard_private.notification_events),(select count(*) from dashboard_private.notification_deliveries));'), before);
  console.log(JSON.stringify({ status: 'passed', scenarios: 2, sharedCatalogClaims: 0, providerCalls: 0 }));
} finally {
  for (const item of sessions) if (!item.child.stdin.writableEnded) item.child.stdin.end('rollback;\n');
  await Promise.all(sessions.map(item => item.done));
}
