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
const id = n => `a9400000-0000-4000-8000-${String(n).padStart(12, "0")}`;
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
function count(n, expected, counted, memo = "실사") {
  return `select public.create_textbook_stock_count_v1('${id(n)}','${id(800)}',null,${expected},${counted},'2026-09-08',12000.5,'${memo}');\n`;
}
function remove(kind, recordId) {
  return `select public.delete_textbook_inventory_history_v1('${kind}','${recordId}');\n`;
}
function dto(stdout) { return JSON.parse(stdout.split("\n").find(line => line.startsWith("{"))); }
async function balance() { return Number(await query(`select sum(quantity) from public.textbook_stock_moves where textbook_id='${id(800)}';`)); }
let sequence = 0;
async function race(firstSql, secondSql, { rollback = false, secondActor = 901, error = null } = {}) {
  const name = `textbook-count-race-${++sequence}`;
  const first = session(auth(901, `${name}-a`) + firstSql + "\\echo COUNT_LOCK_HELD\n", true);
  await until(() => first.output().includes("COUNT_LOCK_HELD"), "first writer holds the transaction");
  const second = session(auth(secondActor, `${name}-b`) + secondSql + "commit;\n");
  await until(async () => (await query(`select count(*) from pg_stat_activity where application_name='${name}-b' and wait_event_type='Lock';`)) === "1", "competing request waits on the transaction");
  first.child.stdin.end(rollback ? "rollback;\n" : "commit;\n");
  const [a, b] = await Promise.all([first.done, second.done]);
  assert.equal(a.code, 0, a.stderr);
  if (error) { assert.notEqual(b.code, 0); assert.match(b.stderr, new RegExp(error)); }
  else assert.equal(b.code, 0, b.stderr);
  return [dto(a.stdout), error ? null : dto(b.stdout)];
}
try {
  const sendsBefore = await query("select jsonb_build_array((select count(*) from dashboard_private.notification_events),(select count(*) from dashboard_private.notification_deliveries));");
  await query(`
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data) values
('${id(901)}','authenticated','authenticated','count-race-admin@example.invalid','{}','{}'),
('${id(902)}','authenticated','authenticated','count-race-staff@example.invalid','{}','{}');
update public.profiles set role=case id when '${id(901)}' then 'admin' else 'staff' end where id in('${id(901)}','${id(902)}');
insert into public.textbooks(id,name,title,subject,school_level,grade_level,school_levels,grade_levels,sub_subject)
values('${id(800)}','__count_race__','__count_race__','english','middle','m2',array['middle'],array['m2'],'독해');
insert into public.textbook_stock_moves(textbook_id,move_type,quantity) values('${id(800)}','opening',10);
`);
  const [first, replay] = await race(count(1,10,7),count(1,10,7));
  assert.deepEqual(first,replay);
  assert.equal(await balance(),7);
  assert.equal(await query(`select count(*) from public.textbook_stock_counts where id='${id(1)}';`),"1");
  assert.equal(await query(`select count(*) from public.textbook_stock_moves where id='${first.adjustment_move_id}';`),"1");
  await race(count(2,7,5),count(2,7,5),{rollback:true});
  assert.equal(await balance(),5);
  await race(count(3,5,3),count(4,5,3),{error:"23514: textbook_count_balance_changed"});
  assert.equal(await balance(),3);
  assert.equal(await query(`select count(*) from public.textbook_stock_count_requests where request_id='${id(4)}';`),"0");
  await race(remove("count",id(3)),count(3,3,3),{error:"23514: textbook_count_request_deleted"});
  assert.equal(await balance(),5);
  const [, deleted] = await race(count(5,5,2),remove("count",id(5)));
  assert.equal(deleted.deleted,true);
  assert.equal(await balance(),5);
  const [, missing] = await race(remove("count",id(2)),remove("count",id(2)));
  assert.equal(missing.deleted,false);
  assert.equal(await balance(),7);
  const pair = dto(await query(auth(901,"count-prime-pair")+count(6,7,4)+"commit;"));
  const [, deletedPair] = await race(remove("count",id(6)),remove("move",pair.adjustment_move_id),{rollback:true});
  assert.equal(deletedPair.deleted,true);
  assert.equal(await balance(),7);
  await race(count(7,7,6),count(7,7,6),{secondActor:902,error:"42501: textbook_count_forbidden"});
  assert.equal(await balance(),6);

  // An ordinary concurrent ledger movement must remain additive, not overwritten.
  const held = session(auth(901,"count-additive")+count(8,6,4)+"\\echo COUNT_ADDITIVE_HELD\n",true);
  await until(()=>held.output().includes("COUNT_ADDITIVE_HELD"),"count is pending commit");
  await query(auth(902,"count-concurrent-receipt")+`insert into public.textbook_stock_moves(textbook_id,move_type,quantity) values('${id(800)}','purchase_receipt',2); commit;`);
  held.child.stdin.end("commit;\n");
  const committed = await held.done;
  assert.equal(committed.code,0,committed.stderr);
  assert.equal(await balance(),6);
  assert.equal(await query("select jsonb_build_array((select count(*) from dashboard_private.notification_events),(select count(*) from dashboard_private.notification_deliveries));"),sendsBefore);
  console.log(JSON.stringify({status:"passed",scenarios:9,duplicateCountRows:0,orphanAdjustments:0,staleSqlstate:"23514",crossActorSqlstate:"42501",providerCalls:0}));
} finally {
  for (const item of sessions) if (!item.child.stdin.writableEnded) item.child.stdin.end("rollback;\n");
  await Promise.all(sessions.map(item => item.done));
}
