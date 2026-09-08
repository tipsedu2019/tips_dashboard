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
const id = n => `a9200000-0000-4000-8000-${String(n).padStart(12, "0")}`;
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
function auth(actor, name) {
  return `begin; set local statement_timeout='15s'; set local application_name='${name}';
set local role authenticated; select set_config('request.jwt.claim.sub','${id(actor)}',true);\n`;
}
function transition(line, target) {
  return `select public.transition_textbook_sale_line_v1('${id(line)}','${target}');\n`;
}
function dto(stdout) {
  return JSON.parse(stdout.split("\n").find(line => line.startsWith("{")));
}
async function race({ line, firstTarget = "issued", secondTarget = "issued", rollback = false, legacy = false, expectedError = null }) {
  const name = `textbook-sale-race-${line}`;
  const first = session(auth(901, `${name}-a`) + transition(line, firstTarget) + "\\echo SALE_LOCK_HELD\n", true);
  await until(() => first.output().includes("SALE_LOCK_HELD"), "first transition holds the sale row");
  const secondSql = legacy
    ? `insert into public.textbook_stock_moves(textbook_id,sale_line_id,move_type,quantity) values('${id(800)}','${id(line)}','sale_issue',-2);\n`
    : transition(line, secondTarget);
  const second = session(auth(902, `${name}-b`) + secondSql + "commit;\n");
  await until(async () => (await query(`select count(*) from pg_stat_activity where application_name='${name}-b' and wait_event_type='Lock';`)) === "1", "competing writer waits on the transaction");
  first.child.stdin.end(rollback ? "rollback;\n" : "commit;\n");
  const [a, b] = await Promise.all([first.done, second.done]);
  assert.equal(a.code, 0, a.stderr);
  if (expectedError) {
    assert.notEqual(b.code, 0);
    assert.match(b.stderr, new RegExp(expectedError));
  } else {
    assert.equal(b.code, 0, b.stderr);
    assert.equal(dto(b.stdout).id, id(line));
    assert.equal(dto(b.stdout).status, secondTarget);
    if (!rollback && firstTarget === secondTarget) assert.deepEqual(dto(a.stdout), dto(b.stdout));
  }
}

try {
  const sendsBefore = await query("select jsonb_build_array((select count(*) from dashboard_private.notification_events),(select count(*) from dashboard_private.notification_deliveries));");
  await query(`
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data) values
('${id(901)}','authenticated','authenticated','sale-race-admin@example.invalid','{}','{}'),
('${id(902)}','authenticated','authenticated','sale-race-staff@example.invalid','{}','{}');
update public.profiles set role=case id when '${id(901)}' then 'admin' else 'staff' end where id in('${id(901)}','${id(902)}');
insert into public.textbooks(id,name,title,subject,school_level,grade_level,school_levels,grade_levels,sub_subject)
values('${id(800)}','__sale_race__','__sale_race__','english','middle','m2',array['middle'],array['m2'],'독해');
insert into public.textbook_sales(id,charge_month) values('${id(700)}','2099-09');
insert into public.textbook_sale_lines(id,sale_id,textbook_id,charge_month,quantity,unit_price)
select ('a9200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'${id(700)}','${id(800)}','2099-09',2,12000.5 from generate_series(1,4)n;
`);
  await race({ line: 1 });
  assert.equal(await query(`select count(*)||':'||sum(quantity)||':'||min(created_by::text) from public.textbook_stock_moves where sale_line_id='${id(1)}';`), `1:-2:${id(901)}`);
  await race({ line: 1, firstTarget: "returned", secondTarget: "returned" });
  assert.equal(await query(`select count(*)||':'||sum(quantity)||':'||sum(amount) from public.textbook_stock_moves where sale_line_id='${id(1)}';`), "2:0:0.0");
  await race({ line: 2, rollback: true });
  assert.equal(await query(`select count(*)||':'||sum(quantity)||':'||min(created_by::text) from public.textbook_stock_moves where sale_line_id='${id(2)}';`), `1:-2:${id(902)}`);
  await query(auth(901, "sale-prime-return-race") + transition(3, "issued") + "commit;");
  await race({ line: 3, firstTarget: "returned", secondTarget: "issued", expectedError: "23514: textbook_sale_state_conflict" });
  assert.equal(await query(`select status from public.textbook_sale_lines where id='${id(3)}';`), "returned");
  assert.equal(await query(`select sum(quantity) from public.textbook_stock_moves where sale_line_id='${id(3)}';`), "0");
  await race({ line: 4, legacy: true, expectedError: "23505:" });
  assert.equal(await query(`select count(*) from public.textbook_stock_moves where sale_line_id='${id(4)}';`), "1");
  assert.equal(await query("select jsonb_build_array((select count(*) from dashboard_private.notification_events),(select count(*) from dashboard_private.notification_deliveries));"), sendsBefore);
  console.log(JSON.stringify({ status: "passed", scenarios: 5, issueMoves: 1, returnMoves: 1, staleSqlstate: "23514", duplicateSqlstate: "23505", providerCalls: 0 }));
} finally {
  for (const item of sessions) if (!item.child.stdin.writableEnded) item.child.stdin.end("rollback;\n");
  await Promise.all(sessions.map(item => item.done));
}
