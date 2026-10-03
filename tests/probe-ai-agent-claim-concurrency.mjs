import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { randomUUID, randomBytes } from 'node:crypto';

// Self-contained: the guarded common runner stages this file without helper modules.
const ownedChildren = new Set(), ownedSessions = new Set();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function boundedProcess(command, args, timeoutMs = 40_000) {
  const child = spawn(command, args, {stdio:['pipe','pipe','pipe']});
  ownedChildren.add(child);
  let stdout='', stderr='', closed=false, timedOut=false, spawnError;
  const signals=[];
  child.stdout.on('data', data => {stdout+=data;});
  child.stderr.on('data', data => {stderr+=data;});
  child.stdin.on('error', error => {if(error.code!=='EPIPE') spawnError=error;});
  let finish;
  const exited = new Promise(resolve => {finish=resolve;});
  child.on('error', error => {spawnError=error;});
  child.on('close', (code, signal) => {
    closed=true;clearTimeout(deadline);ownedChildren.delete(child);
    finish({code,signal,stdout,stderr,out:stdout,err:stderr,timedOut,signals,spawnError});
  });
  let cancellation;
  async function cancel() {
    if(cancellation) return cancellation;
    cancellation=(async()=>{
      if(closed) return;
      child.stdin.destroy();
      signals.push('SIGTERM');child.kill('SIGTERM');
      if(await Promise.race([exited.then(()=>true),delay(750).then(()=>false)])) return;
      signals.push('SIGKILL');child.kill('SIGKILL');
      if(!await Promise.race([exited.then(()=>true),delay(1500).then(()=>false)])) {
        throw new Error('owned child failed confirmed reaping after SIGKILL');
      }
    })();
    return cancellation;
  }
  const deadline=setTimeout(()=>{timedOut=true;cancel().catch(error=>{
    // Failed reaping is an explicit failing result, never a successful cleanup.
    finish({code:null,stdout,stderr,out:stdout,err:stderr,timedOut,signals,spawnError:error});
  });},timeoutMs);
  const complete=exited.then(result=>{
    if(result.timedOut||result.spawnError) throw new Error(result.spawnError?.message||'owned child host deadline exceeded');
    return result;
  });
  complete.catch(()=>{}); // Interactive sessions may fail before their checkpoint is awaited.
  return {child,complete,exited,cancel,signals,get stdout(){return stdout;},get closed(){return closed;}};
}
async function closeSessions(...clients) {
  const results=await Promise.allSettled(clients.map(client=>client.close()));
  const failed=results.find(result=>result.status==='rejected');
  if(failed) throw failed.reason;
}
async function selfTestBounds() {
  // A real child ignores TERM and has no natural completion. KILL and close are required.
  const child=boundedProcess(process.execPath,['-e',"process.on('SIGTERM',()=>{});console.log('READY');setInterval(()=>{},1000)"],1000);
  while(!child.stdout.includes('READY')&&!child.closed) await delay(10);
  await assert.rejects(child.complete,/host deadline/);
  const result=await child.exited;
  assert.deepEqual(result.signals,['SIGTERM','SIGKILL']);
  assert.equal(result.signal,'SIGKILL');assert.equal(ownedChildren.size,0);
  assert.throws(()=>process.kill(child.child.pid,0),{code:'ESRCH'});
  console.log(JSON.stringify({status:'passed',hungChildTimedOut:true,signals:result.signals,confirmedReaped:true}));
}
if(process.argv.includes('--self-test-timeout')) {await selfTestBounds();process.exit(0);}
const overallDeadline=setTimeout(async()=>{
  console.error('AI probe overall host deadline exceeded');process.exitCode=1;
  try {await closeSessions(...ownedSessions);}catch(error){console.error(error.message);}
  const results=await Promise.allSettled([...ownedChildren].map(child=>{
    // Every child here belongs to this process; never enumerate or kill foreign PIDs.
    child.kill('SIGKILL');return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('overall cleanup failed confirmed reaping')),2000);
      child.once('close',()=>{clearTimeout(timer);resolve();});
    });
  }));
  for(const result of results)if(result.status==='rejected')console.error(result.reason.message);
  process.exit(1);
},180_000);

try {
const url = new URL(process.env.TASK_LOCAL_DB_URL || 'https://invalid.invalid');
assert.equal(url.hostname, '127.0.0.1');
assert.equal(url.pathname, '/postgres');
assert.match(process.env.TASK_LOCAL_DB_NONCE || '', /^[a-f0-9]{32}$/u);
const config = await readFile('supabase/config.toml', 'utf8');
const project = config.match(/^project_id = "(tips_supabase_db_qa_[a-f0-9]{12})"/mu)?.[1];
assert.ok(project);
assert.ok(config.includes(`[db]\nport = ${url.port}\n`));
const container = `supabase_db_${project}`;
const issuer = randomUUID(), owner = randomUUID(), administrator = randomUUID();
const credentials = [randomUUID(), randomUUID()];
const hashes = [randomBytes(32).toString('hex'), randomBytes(32).toString('hex')];
const claimHash = randomBytes(32).toString('hex');


function session(timeoutMs = 40_000) {
  const tag=`ai_probe_${randomUUID()}`;
  const processChild=boundedProcess('docker',['exec','-i','-e',`PGAPPNAME=${tag}`,'-e','PGOPTIONS=-c statement_timeout=40000 -c idle_in_transaction_session_timeout=40000',container,'psql','-XqAt','--set','ON_ERROR_STOP=1','--set','VERBOSITY=verbose','-U','postgres','-d','postgres'],timeoutMs);
  const {child,complete}=processChild;
  let closePromise;
  const client={child,complete,
    write:sql=>child.stdin.write(sql),
    end:sql=>{if(!child.stdin.destroyed&&!child.stdin.writableEnded)child.stdin.end(sql);},
    async line(pattern){
      const deadline=Date.now()+20_000;
      while(Date.now()<deadline){
        const match=processChild.stdout.match(pattern);if(match)return match;
        if(processChild.closed){await complete;throw new Error('checkpoint child ended');}
        await delay(25);
      }
      throw new Error('AI probe checkpoint host deadline exceeded');
    },
    close(){
      if(closePromise)return closePromise;
      closePromise=(async()=>{
        client.end('rollback;\n');
        const clean=await Promise.race([processChild.exited.then(()=>true),delay(1500).then(()=>false)]);
        if(!clean)await processChild.cancel();
        // Docker client cancellation alone does not prove that its PostgreSQL session ended.
        // Terminate and verify only this exact randomly named session in this owned DB.
        if(!clean||(await processChild.exited).timedOut){
          const sql=`select pg_terminate_backend(pid) from pg_stat_activity where application_name='${tag}';select count(*) from pg_stat_activity where application_name='${tag}';`;
          let remaining;
          for(let n=0;n<3;n++){
            const control=boundedProcess('docker',['exec','-i',container,'psql','-XqAt','--set','ON_ERROR_STOP=1','-U','postgres','-d','postgres'],3000);
            control.child.stdin.end(sql);const result=await control.complete;
            assert.equal(result.code,0,'owned session cancellation control failed');
            remaining=result.stdout.trim().split('\n').at(-1);if(remaining==='0')break;
            await delay(50);
          }
          assert.equal(remaining,'0','owned PostgreSQL session was not confirmed terminated');
        }
        ownedSessions.delete(client);
        await complete;
        if(!clean)throw new Error('session required forced cancellation during cleanup');
      })();
      return closePromise;
    }
  };
  ownedSessions.add(client);return client;
}
async function query(sql){const client=session(10_000);try{client.end(sql);const result=await client.complete;assert.equal(result.code,0,result.stderr.replace(/tips_agent_[a-f0-9]+/g,'[fixture-key]'));return result.stdout.trim();}finally{await client.close();}}

const bot=(index,op,id,input)=>`public.ai_agent_bot_api_v1('${hashes[index]}','${op}','${JSON.stringify({id,...input})}'::jsonb)`;
const user=(op,id,input)=>`public.ai_agent_user_api_v1('${op}','${JSON.stringify({id,...input})}'::jsonb)`;
const claimInput=()=>({version:'1',idempotencyKey:randomUUID(),claimTokenHash:claimHash});
const doneInput=()=>({version:'2',idempotencyKey:randomUUID(),claimTokenHash:claimHash,claimGeneration:'1',result:'Synthetic completion'});
const cancelInput=version=>({version,idempotencyKey:randomUUID()});
const oldCounts=async()=>JSON.parse(await query("select jsonb_build_object('events',(select count(*) from dashboard_private.notification_events),'deliveries',(select count(*) from dashboard_private.notification_deliveries));"));
const requestCounts=async id=>JSON.parse(await query(`select jsonb_build_object('status',r.status,'version',r.version::text,'openQuestionId',r.open_question_id,'liveClaims',(select count(*) from dashboard_private.ai_agent_request_claims c where c.request_id=r.id and c.lease_expires_at>clock_timestamp()),'claimEvents',(select count(*) from dashboard_private.ai_agent_request_events e where e.request_id=r.id and e.kind='claimed'),'answers',(select count(*) from dashboard_private.ai_agent_request_messages m where m.request_id=r.id and m.kind='answer'),'doneEvents',(select count(*) from dashboard_private.ai_agent_request_events e where e.request_id=r.id and e.kind='done')) from dashboard_private.ai_agent_requests r where r.id='${id}';`));
async function fixture(){const id=randomUUID();await query(`insert into dashboard_private.ai_agent_requests(id,requester_id,title,body) values('${id}','${owner}','synthetic race','synthetic');`);return id;}
const asBot=sql=>`set local role service_role;${sql}`;
const asUser=(actor,sql)=>`select set_config('request.jwt.claim.sub','${actor}',true);set local role authenticated;${sql}`;
const evidence=[];
async function race(name,id,firstSql,secondSql,expectedCode,expectedDomain){
  const first=session(),second=session();
  try{
    first.write(`begin;set local statement_timeout='30s';set local lock_timeout='20s';${firstSql};select 'LOCKED:'||pg_backend_pid();\n`);
    const blockerPid=Number((await first.line(/^LOCKED:(\d+)$/mu))[1]);
    second.write(`begin;set local statement_timeout='25s';set local lock_timeout='20s';select 'WRITER:'||pg_backend_pid();create function pg_temp.exercise() returns jsonb language plpgsql as $$declare result jsonb;begin ${secondSql.expression};return jsonb_build_object('sqlstate','00000','result',result);exception when others then return jsonb_build_object('sqlstate',SQLSTATE,'code',SQLERRM);end$$;${secondSql.role};select 'OUTCOME:'||pg_temp.exercise()::text;\n`);
    const writerPid=Number((await second.line(/^WRITER:(\d+)$/mu))[1]);
    let waited=false;const deadline=Date.now()+15_000;
    while(Date.now()<deadline){waited=await query(`select ${blockerPid}=any(pg_blocking_pids(${writerPid})) and exists(select 1 from pg_stat_activity where pid=${writerPid} and wait_event_type='Lock');`)==='t';if(waited)break;await new Promise(resolve=>setTimeout(resolve,50));}
    assert.equal(waited,true,`${name}: second writer must wait behind the held first transaction`);
    first.end('commit;\n');assert.equal((await first.complete).code,0);
    const loser=JSON.parse((await second.line(/^OUTCOME:(.*)$/mu))[1]);
    second.end('commit;\n');assert.equal((await second.complete).code,0);
    assert.equal(loser.sqlstate,expectedCode,`${name}: exact SQLSTATE`);assert.equal(loser.code,expectedDomain,`${name}: exact domain code`);
    const counts=await requestCounts(id);evidence.push({name,blockerPid,writerPid,lockWaitObserved:waited,firstCommittedBeforeSecond:true,loserSqlstate:loser.sqlstate,loserCode:loser.code,counts});return counts;
  }finally{await first.close();await second.close();}
}
try{
  await query(`insert into auth.users(id,instance_id,aud,role,email) values ${[issuer,owner,administrator].map(id=>`('${id}','00000000-0000-0000-0000-000000000000','authenticated','authenticated','race-${id}@test.invalid')`).join(',')};insert into public.profiles(id,role,name) values('${issuer}','admin','synthetic issuer'),('${owner}','staff','synthetic requester'),('${administrator}','admin','synthetic alternate admin') on conflict(id) do update set role=excluded.role;
  insert into dashboard_private.ai_agent_credentials(id,created_by,label,token_hash,scopes,expires_at) values ${credentials.map((id,index)=>`('${id}','${issuer}','synthetic race','${hashes[index]}',array['ai-agent:requests:read','ai-agent:requests:claim','ai-agent:requests:update','chat:outbox:read','chat:send'],clock_timestamp()+interval '1 day')`).join(',')};insert into dashboard_private.ai_agent_credential_grants(credential_id,queues,actions,expires_at) select id,array['employee_requests'],array['read','claim','renew','progress','question','done'],clock_timestamp()+interval '1 day' from dashboard_private.ai_agent_credentials where id in('${credentials[0]}','${credentials[1]}');`);
  const before=await oldCounts();
  const claimId=await fixture();
  const counts=await race('two claimers produce one live claim',claimId,asBot(`select ${bot(0,'claim',claimId,claimInput())}`),{role:'set local role service_role',expression:`result:=${bot(1,'claim',claimId,claimInput())}`},'55000','ai_agent_conflict');
  const liveClaims=counts.liveClaims,claimEvents=counts.claimEvents,successfulClaimers=counts.status==='processing'&&counts.claimEvents===1?1:0;
  assert.equal(liveClaims,1);assert.equal(claimEvents,1);assert.equal(successfulClaimers,1);
  for(const answerFirst of [true,false]){
    const id=await fixture();
    const claimed=JSON.parse(await query(`begin;${asBot(`select ${bot(0,'claim',id,claimInput())}`)};commit;`));
    assert.equal(claimed.claim.generation,'1');
    const question=JSON.parse(await query(`begin;${asBot(`select ${bot(0,'question',id,{version:'2',idempotencyKey:randomUUID(),claimTokenHash:claimHash,claimGeneration:'1',text:'Synthetic question'})}`)};commit;`));
    const answerExpr=user('append_message',id,{version:'3',idempotencyKey:randomUUID(),kind:'answer',questionId:question.message.id,text:'Synthetic answer'});
    const cancelExpr=user('cancel',id,cancelInput('3'));
    const firstExpr=answerFirst?asUser(owner,`select ${answerExpr}`):asUser(administrator,`select ${cancelExpr}`);
    const second={role:answerFirst?asUser(administrator,''):asUser(owner,''),expression:`result:=${answerFirst?cancelExpr:answerExpr}`};
    const row=await race(`answer/cancel ${answerFirst?'answer':'cancel'} first commit wins`,id,firstExpr,second,'55000',answerFirst?'ai_agent_stale_version':'ai_agent_terminal');
    assert.equal(row.status,answerFirst?'pending':'cancelled');assert.equal(row.answers,answerFirst?1:0);assert.equal(row.openQuestionId,null);assert.equal(row.liveClaims,0);
  }
  for(const doneFirst of [true,false]){
    const id=await fixture();await query(`begin;${asBot(`select ${bot(0,'claim',id,claimInput())}`)};commit;`);
    const doneExpr=bot(0,'done',id,doneInput()),cancelExpr=user('cancel',id,cancelInput('2'));
    const row=await race(`done/cancel ${doneFirst?'done':'cancel'} first commit wins`,id,doneFirst?asBot(`select ${doneExpr}`):asUser(owner,`select ${cancelExpr}`),{role:doneFirst?asUser(owner,''):'set local role service_role',expression:`result:=${doneFirst?cancelExpr:doneExpr}`},'55000','ai_agent_terminal');
    assert.equal(row.status,doneFirst?'done':'cancelled');assert.equal(row.doneEvents,doneFirst?1:0);assert.equal(row.liveClaims,0);
  }
  // Current issuer authority is decided after a real waited profile lock.
  const issuerId=await fixture();
  await race('issuer downgrade before waiting claim',issuerId,`update public.profiles set role='viewer' where id='${issuer}';select id from dashboard_private.ai_agent_requests where id='${issuerId}' for update`,{role:'set local role service_role',expression:`result:=${bot(0,'claim',issuerId,claimInput())}`},'42501','ai_agent_forbidden');
  assert.equal((await requestCounts(issuerId)).status,'pending');
  await query(`update public.profiles set role='admin' where id='${issuer}';`);
  const grantId=await fixture();
  await race('grant revocation before waiting claim',grantId,`update dashboard_private.ai_agent_credential_grants set revoked_at=clock_timestamp() where credential_id='${credentials[0]}';select id from dashboard_private.ai_agent_requests where id='${grantId}' for update`,{role:'set local role service_role',expression:`result:=${bot(0,'claim',grantId,claimInput())}`},'42501','ai_agent_grant_forbidden');
  await query(`update dashboard_private.ai_agent_credential_grants set revoked_at=null where credential_id='${credentials[0]}';`);
  const revokeId=await fixture();
  await race('credential revoke waits in compatible order',revokeId,asBot(`select ${bot(0,'claim',revokeId,claimInput())}`),{role:asUser(issuer,''),expression:`perform public.ai_agent_credential_api_v1('revoke',jsonb_build_object('id','${credentials[0]}','idempotencyKey','${randomUUID()}'));result:='{}'::jsonb`},'00000',undefined);
  // The transport never runs here. Synthetic configuration/grants exist only
  // inside the runner's disposable project and are destroyed by its clean stop.
  await query(`update dashboard_private.ai_agent_credentials set revoked_at=null where id='${credentials[0]}';update dashboard_private.ai_agent_credential_grants set revoked_at=null where credential_id='${credentials[0]}';
  update dashboard_private.chat_space_configuration set configured=true,public_origin='https://dashboard.test.invalid',resource_name='spaces/probe_fixture' where space_key='space_1';
  insert into dashboard_private.chat_user_space_permissions(user_id,space_keys,configured_by) values('${owner}',array['space_1'],'${issuer}');
  insert into dashboard_private.chat_credential_space_grants(credential_id,space_keys,purposes,expires_at) values('${credentials[0]}',array['space_1'],array['ai_completion'],clock_timestamp()+interval '1 day'),('${credentials[1]}',array['space_1'],array['ai_completion'],clock_timestamp()+interval '1 day');`);
  const dispatchId=await fixture();
  await query(`update dashboard_private.ai_agent_requests set notify_on_done=true,notification_space='space_1' where id='${dispatchId}';begin;${asBot(`select ${bot(0,'claim',dispatchId,claimInput())};select ${bot(0,'done',dispatchId,doneInput())}`)};commit;`);
  const intentId=await query(`select id from dashboard_private.chat_delivery_outbox where request_id='${dispatchId}';`);
  const prepare=index=>`public.ai_agent_chat_api_v1('${hashes[index]}','prepare_attempt','${JSON.stringify({id:intentId,revision:'1',idempotencyKey:randomUUID()})}'::jsonb)`;
  await race('two outbox workers create one durable dispatch',dispatchId,asBot(`select ${prepare(0)}`),{role:'set local role service_role',expression:`result:=${prepare(1)}`},'55000','ai_agent_conflict');
  const dispatch=JSON.parse(await query(`select jsonb_build_object('state',o.state,'startedAttempts',(select count(*) from dashboard_private.chat_delivery_attempts a where a.outbox_id=o.id and a.kind='started'),'attemptCount',o.attempt_count) from dashboard_private.chat_delivery_outbox o where o.id='${intentId}';`));
  assert.equal(dispatch.state,'sending');assert.equal(dispatch.startedAttempts,1);assert.equal(dispatch.attemptCount,1);
  const after=await oldCounts();assert.deepEqual(after,before);
  const oldNotificationCountBefore=before.events+before.deliveries,oldNotificationCountAfter=after.events+after.deliveries;
  assert.equal(oldNotificationCountAfter,oldNotificationCountBefore);
  console.log(JSON.stringify({status:'passed',successfulClaimers,dispatch,oldNotificationCountBefore,oldNotificationCountAfter,checkpoints:evidence}));
}finally{await closeSessions(...ownedSessions);}

} finally {
  clearTimeout(overallDeadline);
  await closeSessions(...ownedSessions);
  assert.equal(ownedChildren.size,0,'all owned child processes must be reaped');
}
