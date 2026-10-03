import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

// Only the common runner's owned loopback project and nonce are accepted.
const url = new URL(process.env.TASK_LOCAL_DB_URL || 'https://invalid.invalid');
assert.equal(url.hostname, '127.0.0.1');
assert.equal(url.pathname, '/postgres');
assert.match(process.env.TASK_LOCAL_DB_NONCE || '', /^[a-f0-9]{32}$/u);
const config = await readFile('supabase/config.toml', 'utf8');
const project = config.match(/^project_id = "(tips_supabase_db_qa_[a-f0-9]{12})"/mu)?.[1];
assert.ok(project);
assert.ok(config.includes(`[db]\nport = ${url.port}\n`));
const container = `supabase_db_${project}`;
const actor = randomUUID();
const createKey = randomUUID();
const replayKey = randomUUID();
const creation = key => `public.ai_agent_user_api_v1('create',jsonb_build_object('title','downgrade fixture','body','synthetic','notifyOnDone',false,'idempotencyKey','${key}'))`;

function session() {
  const child = spawn('docker', ['exec', '-i', container, 'psql', '-XqAt', '--set', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'], {stdio:['pipe','pipe','pipe']});
  let stdout='', stderr='', ended=false;
  const complete = new Promise((resolve,reject) => {
    child.on('error',reject);
    child.on('close',code => {ended=true; resolve({code,stdout,stderr});});
  });
  child.stdout.on('data',data => {stdout+=data;});
  child.stderr.on('data',data => {stderr+=data;});
  return {child, complete, write:sql=>child.stdin.write(sql), end:sql=>child.stdin.end(sql), async line(pattern) {
    const deadline=Date.now()+20_000;
    while(Date.now()<deadline) {
      const match=stdout.match(pattern);
      if(match) return match;
      if(ended) throw new Error(`checkpoint session ended: ${stderr}`);
      await new Promise(resolve=>setTimeout(resolve,25));
    }
    throw new Error('auth concurrency checkpoint timeout');
  }};
}
async function query(sql) {
  const client=session();client.end(sql);
  const result=await client.complete;
  assert.equal(result.code,0,result.stderr);
  return result.stdout.trim();
}
async function counts() {
  return JSON.parse(await query(`select jsonb_build_object('requests',(select count(*) from dashboard_private.ai_agent_requests where requester_id='${actor}'),'credentials',(select count(*) from dashboard_private.ai_agent_credentials where created_by='${actor}'));`));
}
await query(`insert into auth.users(id,instance_id,aud,role,email) values('${actor}','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ai-race-${actor}@test.invalid');
insert into public.profiles(id,role,name) values('${actor}','staff','synthetic race fixture') on conflict(id) do update set role=excluded.role;
begin;select set_config('request.jwt.claim.sub','${actor}',true);set local role authenticated;do $$begin perform ${creation(replayKey)};end$$;commit;`);

const evidence=[];
for(const [operation,role,expression] of [
  ['create','staff',creation(createKey)],
  ['create_replay','staff',creation(replayKey)],
  ['issue','admin',`public.create_ai_agent_credential_v1('synthetic race',array['ai-agent:requests:read'],'{"queues":["employee_requests"],"actions":["read"]}',null)`],
]) {
  await query(`update public.profiles set role='${role}' where id='${actor}';`);
  const before=await counts();
  const blocker=session();const writer=session();
  try {
    blocker.write(`begin;set local statement_timeout='30s';update public.profiles set role='viewer' where id='${actor}';select 'LOCKED:'||pg_backend_pid();\n`);
    const blockerPid=Number((await blocker.line(/^LOCKED:(\d+)$/mu))[1]);
    writer.write(`begin;set local statement_timeout='25s';set local lock_timeout='20s';select 'WRITER:'||pg_backend_pid();
create function pg_temp.exercise() returns text language plpgsql as $$begin perform ${expression};return '00000';exception when others then return SQLSTATE;end$$;
select set_config('request.jwt.claim.sub','${actor}',true);set local role authenticated;select 'STATE:'||pg_temp.exercise();\n`);
    const writerPid=Number((await writer.line(/^WRITER:(\d+)$/mu))[1]);
    let waited=false;
    const deadline=Date.now()+15_000;
    while(Date.now()<deadline) {
      waited=await query(`select ${blockerPid}=any(pg_blocking_pids(${writerPid})) and exists(select 1 from pg_stat_activity where pid=${writerPid} and wait_event_type='Lock');`)==='t';
      if(waited) break;
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    assert.equal(waited,true,`${operation} writer must reach an actual database lock checkpoint`);
    // The downgrader commits only after PostgreSQL proves the writer is waiting.
    blocker.end('commit;\n');
    assert.equal((await blocker.complete).code,0);
    const sqlstate=(await writer.line(/^STATE:([A-Z0-9]{5})$/mu))[1];
    writer.end('commit;\n');
    assert.equal((await writer.complete).code,0);
    const after=await counts();
    evidence.push({operation,blockerPid,writerPid,profileLockWaitObserved:waited,downgradeCommittedBeforeWriter:true,sqlstate,before,after});
  } finally {
    if(!blocker.child.stdin.destroyed) blocker.end('rollback;\n');
    if(!writer.child.stdin.destroyed) writer.end('rollback;\n');
    await Promise.allSettled([blocker.complete,writer.complete]);
  }
}
console.log(JSON.stringify({status:evidence.every(row=>row.sqlstate==='42501')?'passed':'failed',checkpoints:evidence}));
for(const row of evidence) {
  assert.equal(row.sqlstate,'42501',`${row.operation} must recheck current role after waiting for the profile lock`);
  assert.deepEqual(row.after,row.before,`${row.operation} must add no request/credential effects`);
}
