// Builtins-only capture: disposable DB producers, synthetic fixtures, rollback.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
const url=new URL(process.env.TASK_LOCAL_DB_URL || 'https://invalid.invalid');
assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/postgres');assert.match(process.env.TASK_LOCAL_DB_NONCE || '',/^[a-f0-9]{32}$/);
const config=await readFile('supabase/config.toml','utf8');const project=config.match(/^project_id = "(tips_supabase_db_qa_[a-f0-9]{12})"/m)?.[1];assert.ok(project);assert.ok(config.includes(`[db]\nport = ${url.port}\n`));
const issuer=randomUUID(),owner=randomUUID(),credential=randomUUID(),expiredRequest=randomUUID();
const credentialHash=createHash('sha256').update('tips_agent_'+randomBytes(32).toString('hex')).digest('hex');
const nonceHash=createHash('sha256').update(randomBytes(32).toString('hex')).digest('hex');
const payloadHash=createHash('sha256').update('{}').digest('hex');
const key=()=>randomUUID();
const captured=name=>`(select data from captures where name='${name}')`;
const rid=name=>`${captured(name)}->>'id'`;
const cap=(name,kind,operation,input)=>`select pg_temp.capture('${name}','${kind}','${operation}',${typeof input==='string'?input:`'${JSON.stringify(input)}'::jsonb`});select 'AI_HTTP_STEP:${name}';`;
const claim=(name,version,generation)=>`jsonb_build_object('id',${rid(name)},'version','${version}','idempotencyKey','${key()}','claimTokenHash','${nonceHash}'${generation?`,'claimGeneration','${generation}'`:''})`;
const role=kind=>kind==='bot'?'set local role service_role;':`select set_config('request.jwt.claim.sub','${kind==='admin'?issuer:owner}',true);set local role authenticated;`;
let sql=`begin;set local statement_timeout='60s';
create temp table old_counts as select jsonb_build_object('events',(select count(*) from dashboard_private.notification_events),'deliveries',(select count(*) from dashboard_private.notification_deliveries)) as value;
insert into auth.users(id,instance_id,aud,role,email) values('${issuer}','00000000-0000-0000-0000-000000000000','authenticated','authenticated','http-issuer@test.invalid'),('${owner}','00000000-0000-0000-0000-000000000000','authenticated','authenticated','http-owner@test.invalid');
insert into public.profiles(id,role,name) values('${issuer}','admin','synthetic admin'),('${owner}','staff','synthetic owner') on conflict(id) do update set role=excluded.role;
insert into dashboard_private.ai_agent_credentials(id,created_by,label,token_hash,scopes,expires_at) values('${credential}','${issuer}','synthetic parity','${credentialHash}',array['ai-agent:requests:read','ai-agent:requests:claim','ai-agent:requests:update'],clock_timestamp()+interval '1 day');
insert into dashboard_private.ai_agent_credential_grants(credential_id,queues,actions,expires_at) values('${credential}',array['employee_requests'],array['read','claim','renew','progress','question','done'],clock_timestamp()+interval '1 day');
create temp table captures(name text primary key,kind text,operation text,data jsonb);grant all on captures to authenticated,service_role;
create function pg_temp.capture(n text,k text,op text,i jsonb) returns void language plpgsql as $$declare v jsonb;begin
 if k='bot' then v:=public.ai_agent_bot_api_v1('${credentialHash}',op,i);elsif k='policy' then v:=public.ai_agent_space_policy_api_v1(op,i);else v:=public.ai_agent_user_api_v1(op,i);end if;
 insert into captures values(n,k,op,v);end$$;
${role('user')}${cap('created','user','create',{title:'synthetic HTTP producer',body:'synthetic body',idempotencyKey:key(),notifyOnDone:false})}
${cap('employeeList','user','list',{page:1,pageSize:10,scope:'own'})}reset role;
${role('bot')}${cap('botList','bot','list',{status:'pending',limit:50})}
${cap('claimed','bot','claim',claim('created','1'))}
${cap('renewed','bot','renew',claim('created','2','1'))}
${cap('progress','bot','progress',claim('created','2','1')+`||jsonb_build_object('text','synthetic progress')`)}
`;
const questionInput=claim('created','3','1')+`||jsonb_build_object('text','synthetic question')`;
sql+=`${cap('question','bot','question',questionInput)}${cap('endedQuestionReplay','bot','question',questionInput)}reset role;
${role('user')}${cap('answer','user','append_message',`jsonb_build_object('id',${rid('created')},'version','4','idempotencyKey','${key()}','kind','answer','questionId',${captured('question')}->'message'->>'id','text','synthetic answer')`)}reset role;
${role('bot')}${cap('reclaimed','bot','claim',claim('created','5'))}reset role;
create function pg_temp.synthetic_permission(uuid,text,text) returns boolean language sql as $$select true$$;
insert into dashboard_private.ai_agent_action_registry(kind,permission_function,enabled) values('synthetic_http','pg_temp.synthetic_permission(uuid,text,text)'::regprocedure,true);
insert into dashboard_private.ai_agent_domain_action_grants(credential_id,kind,target,payload_hash,expires_at) values('${credential}','synthetic_http','synthetic/item','${payloadHash}',clock_timestamp()+interval '1 day');
${role('bot')}${cap('registered','bot','register_action',`jsonb_build_object('id',${rid('created')},'idempotencyKey','${key()}','claimTokenHash','${nonceHash}','claimGeneration','3','actionKey','${key()}','stepKey','synthetic-step','kind','synthetic_http','target','synthetic/item','payload','{}'::jsonb,'payloadHash','${payloadHash}')`)}
${cap('started','bot','start_action',`jsonb_build_object('id',${rid('created')},'actionId',${rid('registered')},'revision','1','idempotencyKey','${key()}','claimTokenHash','${nonceHash}','claimGeneration','3','target','synthetic/item','payloadHash','${payloadHash}')`)}reset role;
${role('user')}${cap('cancelled','user','cancel',`jsonb_build_object('id',${rid('created')},'version','6','idempotencyKey','${key()}')`)}reset role;
${role('bot')}${cap('lateResult','bot','record_action',`jsonb_build_object('id',${rid('created')},'actionId',${rid('registered')},'revision','2','idempotencyKey','${key()}','state','succeeded','target','synthetic/item','payloadHash','${payloadHash}','evidence',jsonb_build_object('resourceName','synthetic/item'))`)}
${cap('incident','bot','record_action',`jsonb_build_object('id',${rid('created')},'actionId',${rid('registered')},'revision','3','idempotencyKey','${key()}','state','failed','target','synthetic/item','payloadHash','${payloadHash}','evidence',jsonb_build_object('code','synthetic_contradiction'))`)}reset role;
${role('admin')}${cap('reconciled','user','reconcile_action',`jsonb_build_object('id',${rid('created')},'actionId',${rid('registered')},'revision','4','idempotencyKey','${key()}','state','succeeded','reason','synthetic concrete inspection','confirmed',true,'evidence',jsonb_build_object('type','manual_observation','target','synthetic/item','payloadHash','${payloadHash}','resourceName','synthetic/item','observedAt',clock_timestamp(),'observation','synthetic observed value'))`)}
reset role;
insert into dashboard_private.ai_agent_request_actions(request_id,credential_id,action_key,step_key,kind,target,payload,payload_hash,generation,state) select (${rid('created')})::uuid,'${credential}',gen_random_uuid(),'synthetic-page-'||n,'synthetic_http','synthetic/page/'||n,'{}','${payloadHash}',3,'succeeded' from generate_series(1,59)n;
insert into dashboard_private.ai_agent_action_events(action_id,seq,kind,actor_kind,actor_id,evidence) select (${rid('registered')})::uuid,n,case when n=56 then 'reconciled_manual_observation' else 'result' end,'user','${issuer}',jsonb_build_object('observation','synthetic durable observation','outcome','succeeded') from generate_series(6,56)n;
${role('admin')}${cap('actions','user','actions',`jsonb_build_object('id',${rid('created')},'limit',50)`)}
${cap('actionsLast','user','actions',`jsonb_build_object('id',${rid('created')},'limit',50,'cursor',${captured('actions')}->>'nextCursor')`)}
${cap('actionEvents','user','action_events',`jsonb_build_object('id',${rid('created')},'actionId',${rid('registered')},'limit',50)`)}
${cap('actionEventsLast','user','action_events',`jsonb_build_object('id',${rid('created')},'actionId',${rid('registered')},'limit',50,'cursor',${captured('actionEvents')}->>'nextCursor')`)}reset role;
${role('user')}${cap('completionCreated','user','create',{title:'synthetic completion',body:'synthetic body',idempotencyKey:key(),notifyOnDone:false})}reset role;
update dashboard_private.ai_agent_requests set notify_on_done=true,notification_space='space_1' where id=(${rid('completionCreated')})::uuid;
${role('bot')}${cap('completionClaim','bot','claim',claim('completionCreated','1'))}
`;
const doneInput=claim('completionCreated','2','1')+`||jsonb_build_object('result','synthetic completed')`;
sql+=`${cap('done','bot','done',doneInput)}${cap('endedDoneReplay','bot','done',doneInput)}reset role;
update dashboard_private.ai_agent_credentials set scopes=array['ai-agent:requests:claim','ai-agent:requests:update'] where id='${credential}';
${role('bot')}${cap('minimalEndedDoneReplay','bot','done',doneInput)}reset role;
update dashboard_private.ai_agent_credentials set scopes=array['ai-agent:requests:read','ai-agent:requests:claim','ai-agent:requests:update'] where id='${credential}';
${role('user')}${cap('notification','user','activity',`jsonb_build_object('id',${rid('completionCreated')})`)}reset role;
insert into dashboard_private.ai_agent_request_messages(request_id,message_seq,kind,text,author_kind,author_id,question_id) select (${rid('created')})::uuid,n,case when n=56 then 'answer' else 'comment' end,'synthetic history '||n,'user','${owner}',case when n=56 then (${captured('question')}->'message'->>'id')::uuid end from generate_series(4,56)n;
${role('user')}${cap('historyFirst','user','activity',`jsonb_build_object('id',${rid('created')},'limit',50)`)}${cap('historyLast','user','activity',`jsonb_build_object('id',${rid('created')},'afterMessageSeq','50','limit',50)`)}reset role;
insert into dashboard_private.ai_agent_requests(id,requester_id,title,body,status,version,claim_generation) values('${expiredRequest}','${owner}','synthetic expired resume','synthetic','processing',9007199254740993,9007199254740993);
${role('admin')}${cap('resumed','user','resume',`jsonb_build_object('id','${expiredRequest}','version','9007199254740993','idempotencyKey','${key()}','reason','synthetic expired review','confirmed',true)`)}reset role;
${role('user')}${cap('catalogEmployee','policy','catalog',{})}reset role;
${role('admin')}${cap('catalogAdmin','policy','catalog',{})}${cap('policyMissing','policy','get',{userId:owner})}${cap('policySet','policy','set',{userId:owner,revision:'0',spaceKeys:['space_1'],idempotencyKey:key()})}${cap('policyGet','policy','get',{userId:owner})}reset role;
select 'AI_HTTP_CAPTURE:'||jsonb_build_object('provenance',jsonb_build_object('kind','actual_disposable_db_gateway','synthetic',true,'providerCalls',0,'rolledBack',true),'oldNotificationCounts',jsonb_build_object('before',(select value from old_counts),'after',jsonb_build_object('events',(select count(*) from dashboard_private.notification_events),'deliveries',(select count(*) from dashboard_private.notification_deliveries))),'captures',(select jsonb_agg(to_jsonb(c) order by name) from captures c))::text;
rollback;
`;
const child=spawn('docker',['exec','-i',`supabase_db_${project}`,'psql','-XqAt','--set','ON_ERROR_STOP=1','--set','VERBOSITY=verbose','-U','postgres','-d','postgres'],{stdio:['pipe','pipe','pipe']});
let stdout='',diagnostic='';child.stdout.on('data',v=>stdout+=v);child.stderr.on('data',v=>{const match=String(v).match(/ERROR:\s+([A-Z0-9]{5}): ([^\n]+)/);if(match)diagnostic=match[1]+':'+match[2].replace(/[a-f0-9]{64}/g,'[redacted]').replace(/tips_agent_[^\s]+/g,'[redacted]');});child.stdin.end(sql);
const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve)});
assert.equal(code,0,'synthetic HTTP producer capture failed after '+stdout.split('\n').filter(line=>line.startsWith('AI_HTTP_STEP:')).at(-1)+' '+diagnostic);
const capture=stdout.split('\n').find(line=>line.startsWith('AI_HTTP_CAPTURE:'));assert.ok(capture,'producer capture absent');
const parsed=JSON.parse(capture.slice('AI_HTTP_CAPTURE:'.length));assert.equal(parsed.captures.length,34);assert.deepEqual(parsed.oldNotificationCounts.before,parsed.oldNotificationCounts.after);
assert.equal(parsed.captures.find(row=>row.name==='historyLast').data.messages.at(-1).seq,'56');
assert.deepEqual(Object.keys(parsed.captures.find(row=>row.name==='minimalEndedDoneReplay').data.request).sort(),['id','status','version']);
assert.ok(!capture.includes(credentialHash));assert.ok(!capture.includes(nonceHash));
console.log(capture);
