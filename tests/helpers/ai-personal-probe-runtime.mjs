import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createAiAgentProbeRuntime} from '../../scripts/lib/ai-agent-probe-runtime.mjs';
export function parsePersonalTap(stdout) {
 const lines=stdout.split(/\r?\n/u),plans=lines.map(l=>/^1\.\.([1-9][0-9]*)$/u.exec(l)).filter(Boolean),results=lines.map(l=>/^ok ([1-9][0-9]*)(?:\s|$)/u.exec(l)).filter(Boolean);
 assert.equal(plans.length,1,'one complete TAP plan');assert.equal(results.length,Number(plans[0][1]));
 assert.ok(results.every((v,i)=>Number(v[1])===i+1));assert.ok(!lines.some(l=>/^(?:not ok\b|Bail out!)/iu.test(l)||/#\s*(?:SKIP|TODO)\b/iu.test(l)),'no failed/skipped/TODO TAP');
 return {tests:results.length,pass:results.length,fail:0,skipped:0,todo:0,outputSha256:createHash('sha256').update(stdout).digest('hex')};
}
export async function personalProbeRuntime() {
 const url=new URL(process.env.TASK_LOCAL_DB_URL||'https://invalid.invalid');
 assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/postgres');assert.match(process.env.TASK_LOCAL_DB_NONCE||'',/^[a-f0-9]{32}$/u);
 const config=await readFile('supabase/config.toml','utf8'),project=config.match(/^project_id = "(tips_supabase_db_qa_[a-f0-9]{12})"/mu)?.[1];
 assert.ok(project);assert.ok(config.includes(`[db]\nport = ${url.port}\n`));
 const core=createAiAgentProbeRuntime({assert,spawn,randomUUID});core.configureContainer(`supabase_db_${project}`);core.startDeadline();
 return {...core,requireComplete(result){assert.equal(result.code,0,'owned personal SQL session failed');assert.equal(result.signal,null);},
  async waitForLock(writer,blocker) {
   assert.ok([writer,blocker].every(n=>Number.isSafeInteger(n)&&n>0)&&writer!==blocker);
   const deadline=Date.now()+15000;
   while(Date.now()<deadline){if(await core.query(`select ${blocker}=any(pg_blocking_pids(${writer})) and exists(select 1 from pg_stat_activity where pid=${writer} and wait_event_type='Lock');`)==='t')return true;await new Promise(r=>setTimeout(r,25));}
   throw Error('personal_lock_wait_unobserved');
  },async finish(){await core.finishRuntime();return{ownedChildrenReaped:true,ownedPostgresSessionsAbsent:true};}};
}
