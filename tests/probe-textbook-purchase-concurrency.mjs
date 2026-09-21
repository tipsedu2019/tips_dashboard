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
const id = n => `a9700000-0000-4000-8000-${String(n).padStart(12, "0")}`;
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
function receive(line) {
  return `select public.update_textbook_purchase_lifecycle_v1('${id(line)}','${id(line + 100)}','receive',
  '{"statement_number":"race"}',jsonb_build_object('textbook_id','${id(800)}','requested_quantity',10,'ordered_quantity',10,'received_quantity',10,'unit_cost',1000.5,'copy_scope','student'));\n`;
}
function returning(line) { return `select public.return_textbook_purchase_line_v1('${id(line)}','반품');\n`; }
async function race(line, { rollback = false, legacy = false, stale = false } = {}) {
  const name = `purchase-race-${line}`;
  const first = session(auth(901, `${name}-a`) + returning(line) + "\\echo RETURN_LOCK_HELD\n", true);
  await until(() => first.output().includes("RETURN_LOCK_HELD"), "return transaction owns purchase lock");
  const sql = legacy
    ? `insert into public.textbook_stock_moves(textbook_id,purchase_order_line_id,move_type,quantity) values('${id(800)}','${id(line)}','return_out',-10);\n`
    : stale ? receive(line) : returning(line);
  const second = session(auth(902, `${name}-b`) + sql + "commit;\n");
  await until(async () => (await query(`select count(*) from pg_stat_activity where application_name='${name}-b' and wait_event_type='Lock';`)) === "1", "competing request waits on committed state");
  first.child.stdin.end(rollback ? "rollback;\n" : "commit;\n");
  const [a, b] = await Promise.all([first.done, second.done]);
  assert.equal(a.code, 0, a.stderr);
  if (legacy || stale) {
    assert.notEqual(b.code, 0);
    assert.match(b.stderr, legacy ? /23505:/ : /23514: textbook_purchase_state_conflict/);
  } else {
    assert.equal(b.code, 0, b.stderr);
    const dto = JSON.parse(b.stdout.split("\n").find(line => line.startsWith("{")));
    assert.equal(dto.purchaseOrderLineId, id(line));
    assert.equal(dto.purchaseOrderId, id(line + 100));
  }
  const result = JSON.parse(await query(`select jsonb_build_object('count',count(*),'quantity',sum(quantity),'amount',sum(amount)) from public.textbook_stock_moves where purchase_order_line_id='${id(line)}';`));
  assert.deepEqual(result, { count: 2, quantity: 0, amount: 0 });
  assert.equal(await query(`select created_by from public.textbook_stock_moves where purchase_order_line_id='${id(line)}' and move_type='return_out';`), id(rollback ? 902 : 901));
  assert.equal(await query(`select status from public.textbook_purchase_orders where id='${id(line + 100)}';`), 'returned');
}
try {
  const sendsBefore = await query("select jsonb_build_array((select count(*) from dashboard_private.notification_events),(select count(*) from dashboard_private.notification_deliveries));");
  await query(`
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data) values
('${id(901)}','authenticated','authenticated','purchase-race-admin@example.invalid','{}','{}'),
('${id(902)}','authenticated','authenticated','purchase-race-staff@example.invalid','{}','{}');
update public.profiles set role=case id when '${id(901)}' then 'admin' else 'staff' end where id in('${id(901)}','${id(902)}');
insert into public.textbooks(id,name,title,subject,school_level,grade_level,school_levels,grade_levels,sub_subject)
values('${id(800)}','__purchase_race__','__purchase_race__','english','middle','m2',array['middle'],array['m2'],'독해');
insert into public.textbook_purchase_orders(id,status)
select ('a9700000-0000-4000-8000-'||lpad((n+100)::text,12,'0'))::uuid,'ordered' from generate_series(1,4)n;
insert into public.textbook_purchase_order_lines(id,purchase_order_id,textbook_id,ordered_quantity)
select ('a9700000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('a9700000-0000-4000-8000-'||lpad((n+100)::text,12,'0'))::uuid,'${id(800)}',10 from generate_series(1,4)n;
`);
  for (let line = 1; line <= 4; line++) await query(auth(901, `purchase-setup-${line}`) + receive(line) + "commit;\n");
  await race(1);
  await race(2, { rollback: true });
  await race(3, { stale: true });
  await race(4, { legacy: true });
  assert.equal(await query("select jsonb_build_array((select count(*) from dashboard_private.notification_events),(select count(*) from dashboard_private.notification_deliveries));"), sendsBefore);
  console.log(JSON.stringify({ status: "passed", scenarios: 4, returnMovesPerLine: 1, staleSqlstate: "23514", duplicateSqlstate: "23505", providerCalls: 0 }));
} finally {
  for (const item of sessions) if (!item.child.stdin.writableEnded) item.child.stdin.end("rollback;\n");
  await Promise.all(sessions.map(item => item.done));
}
