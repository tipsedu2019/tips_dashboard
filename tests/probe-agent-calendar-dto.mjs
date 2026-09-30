import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {StringDecoder} from 'node:string_decoder';
import {calendarWorkspace,compileCalendarChange} from '../src/features/agent-api/server/calendar-compiler.mjs';
const url=new URL(process.env.TASK_LOCAL_DB_URL||'https://invalid.invalid');assert.equal(url.hostname,'127.0.0.1');
const config=await readFile('supabase/config.toml','utf8');const project=config.match(/^project_id = "([a-z0-9_]+)"/m)?.[1];assert.ok(project);assert.ok(config.includes(`[db]\nport = ${url.port}\n`));
const child=spawn('docker',['exec','-i',`supabase_db_${project}`,'psql','-XqAt','--set','ON_ERROR_STOP=1','-U','postgres','-d','postgres'],{stdio:['pipe','pipe','pipe']});
const decoder=new StringDecoder('utf8');let buffer='',pending;const errors=[];child.stderr.on('data',chunk=>errors.push(chunk));
child.stdout.on('data',chunk=>{buffer+=decoder.write(chunk);for(;;){const at=buffer.indexOf('\n');if(at<0)break;const line=buffer.slice(0,at);buffer=buffer.slice(at+1);if(line.startsWith('CALENDAR_DTO:')){const resolve=pending?.resolve;pending=undefined;resolve?.(JSON.parse(line.slice(13)));}}});
const exited=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>{pending?.reject(new Error(Buffer.concat(errors).toString('utf8')));resolve(code);});});
const literal=value=>"'"+JSON.stringify(value).replaceAll("'","''")+"'::jsonb";
const query=sql=>new Promise((resolve,reject)=>{assert.ok(!pending);pending={resolve,reject};child.stdin.write(sql+'\n');});
const frame=expression=>`select 'CALENDAR_DTO:'||(${expression})::text;`;
const fixture=await readFile('supabase/tests/agent_management_calendar_test.sql','utf8');const end=fixture.indexOf("select is(pg_temp.classes('health')");assert.ok(end>0);
const bootstrap=fixture.slice(0,end).replace('begin;','begin; create extension if not exists pgtap with schema extensions; set local search_path=public,extensions;');
try {
 const seed=await query(bootstrap+frame("jsonb_build_object('token',(select v->>'token' from ev where k='all'))"));
 const id=n=>`ac300000-0000-4000-8000-${String(n).padStart(12,'0')}`;
 const hash=createHash('sha256').update(seed.token).digest('hex');
 const rpc=async(action,input={})=>{
   const envelope=await query(frame(`public.agent_calendar_api_v1('${hash}','${action}',${literal(input)})`));
   assert.ok(!envelope.error,JSON.stringify(envelope.error));return envelope.data;
 };
 const schoolInput={schoolId:id(1),schoolYear:2099};
 const read=async()=>calendarWorkspace(await rpc('context',schoolInput));
 const beforeContext=await rpc('context',schoolInput);
 const before=calendarWorkspace(beforeContext);
 const source={url:'https://school.example/calendar',title:'Synthetic official calendar',authority:'official_school',checkedAt:new Date().toISOString(),schoolIdentityEvidence:'Synthetic High identity verified'};
 const input={schoolId:id(1),schoolYear:2099,expectedVersion:before.version,reason:'Real compiler/SQL probe',events:[{id:id(2),title:'Midterm moved',start:'2099-10-02',end:'2099-10-05',type:'시험기간',grade:'고1',source},{title:'Vacation',start:'2100-02-20',end:'2100-02-22',type:'방학·휴일·기타',grade:'all',source}]};
 const command=compileCalendarChange(beforeContext,input);
 const preview=await rpc('preview',{...schoolInput,expectedVersion:before.version,command});
 assert.equal((await read()).verificationHash,before.verificationHash,'preview must not write');
 const body={previewToken:preview.previewToken,sourceReference:'https://calendar.example.test/request'},key=id(100);
 const saved=await rpc('commit',{...body,requestKey:key});
 assert.equal(saved.state,'applied');assert.equal(calendarWorkspace(saved.calendarContext).verificationHash,calendarWorkspace(preview.afterContext).verificationHash);
 const receipt=await rpc('operation',{requestKey:key});assert.equal(calendarWorkspace(receipt.calendarContext).verificationHash,calendarWorkspace(saved.calendarContext).verificationHash);
 const fresh=await read();assert.equal(fresh.verificationHash,calendarWorkspace(saved.calendarContext).verificationHash);assert.equal(fresh.events.find(x=>x.title==='Vacation').end,'2100-02-22');
 assert.ok((await rpc('commit',{...body,requestKey:key})).replayed);
 const publicReceipt=result=>{const {calendarContext,...fields}=result;return {...fields,calendar:calendarWorkspace(calendarContext)};};
 const healthResult=await query(frame(`public.agent_api_v1('${hash}','health','{}')`));
 const consumer=spawnSync('python3',['tests/probe-muse-calendar-consumer.py'],{encoding:'utf8',input:JSON.stringify({
   input,body,health:healthResult.data,preview:{previewToken:preview.previewToken,expiresAt:preview.expiresAt,before:calendarWorkspace(preview.beforeContext),after:calendarWorkspace(preview.afterContext),diff:preview.diff},
   saved:publicReceipt(saved),receipt:publicReceipt(receipt),fresh,unknown:await rpc('operation',{requestKey:id(999)})
 })});
 assert.equal(consumer.status,0,consumer.stderr);console.log(consumer.stdout.trim());
 const persisted=await query('reset role;\n'+frame("jsonb_build_object('note',(select note from public.academic_events where id=pg_temp.cid(2)),'content',(select content from public.academic_events where id=pg_temp.cid(2)),'operationCount',(select count(*) from dashboard_private.agent_calendar_operations),'sources',(select count(*) from dashboard_private.agent_calendar_sources))"));
 assert.match(persisted.note,/KEEP_NOTE/);assert.equal(persisted.content,'KEEP_CONTENT');assert.equal(persisted.operationCount,1);assert.equal(persisted.sources,2);assert.doesNotMatch(JSON.stringify(fresh),/KEEP_NOTE|KEEP_CONTENT/);
 console.log(JSON.stringify({status:'passed',realCompilerToFinalSql:true,previewReceiptFreshHashesMatch:true,partialUpdatePreservesNotes:true,provenancePersists:true,sameKeyReplay:true}));
} finally {child.stdin.end('rollback;\n\\q\n');assert.equal(await exited,0,Buffer.concat(errors).toString('utf8'));}
