import test from 'node:test';
import assert from 'node:assert/strict';
import {extractAiCapture} from '../../scripts/lib/ai-producer-receipt.mjs';
test('capture protocol preserves JSON bytes and rejects missing, duplicate, unknown and malformed captures',()=>{
 const raw=' {"value": "한\\n글", "synthetic":true} ';
 assert.equal(extractAiCapture('step\nAI_HTTP_CAPTURE:'+raw+'\n','http').toString(),raw);
 for(const output of ['', 'AI_HTTP_CAPTURE:{}\nAI_HTTP_CAPTURE:{}\n','AI_UNKNOWN_CAPTURE:{}\nAI_HTTP_CAPTURE:{}\n','AI_HTTP_CAPTURE:{\n'])assert.throws(()=>extractAiCapture(output,'http'));
});

import {AI_PRODUCERS,AI_SQL_TESTS,AI_PROBES,AI_CREDENTIAL_PREFIX,ACCEPTED_AI_MIGRATIONS,CURRENT_AI_MIGRATIONS,CURRENT_WITHDRAWAL_MIGRATIONS,THREAD_REPLY_MIGRATION,snapshotAiSource,validateAiReceipt,suppressAiCaptures,beginAiCapturePhase} from '../../scripts/lib/ai-producer-receipt.mjs';
import {createHash,randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {writeFile,readFile,rm,mkdir,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseIsolatedDbArguments,runIsolatedSupabaseDbTests} from '../../scripts/run-isolated-supabase-db-tests.mjs';
const hash=v=>createHash('sha256').update(v).digest('hex');
const isolatedWorkflows=['supabase-db-push.yml','supabase-sql-review.yml'];
const legacyOccupancyTest='supabase/tests/makeup_legacy_approval_occupancy_test.sql';
async function workflowInventory(name){
 const source=await readFile(new URL('../../.github/workflows/'+name,import.meta.url),'utf8');
 return {
  tests:[...source.matchAll(/--test (supabase\/tests\/\S+\.sql)/gu)].map(match=>match[1]),
  probes:[...source.matchAll(/--probe (tests\/\S+\.mjs)/gu)].map(match=>match[1]),
 };
}
function parityArguments({tests,probes}){
 return ['--review-head','--lint','--require-final','--execute','--authorized',
  '--request-id','ai-parity-inventory-regression','--postdeploy-contract',
  '--transactional-preflight','--verify-local-ledger','--ai-producer-parity',
  ...tests.flatMap(path=>['--test',path]),...probes.flatMap(path=>['--probe',path])];
}
test('both isolated workflows retain the exact full parity inventory including legacy approval occupancy',async()=>{
 assert.equal(AI_SQL_TESTS.length,95);
 assert.equal(AI_PROBES.length,20);
 assert.equal(AI_SQL_TESTS.filter(path=>path===legacyOccupancyTest).length,1);
 assert.equal(AI_SQL_TESTS[AI_SQL_TESTS.indexOf('supabase/tests/makeup_approval_collision_candidates_test.sql')+1],legacyOccupancyTest);
 for(const name of isolatedWorkflows){
  const parsed=parseIsolatedDbArguments(parityArguments(await workflowInventory(name)));
  assert.deepEqual(parsed.tests,AI_SQL_TESTS,name+' SQL inventory');
  assert.deepEqual(parsed.probes,AI_PROBES,name+' probe inventory');
 }
});
test('full parity guard rejects missing, duplicate and reordered workflow selectors before process launch',async()=>{
 let launched=0;
 const executeProcess=async()=>{launched++;throw new Error('process launch forbidden in inventory regression');};
 for(const name of isolatedWorkflows){
  const inventory=await workflowInventory(name);
  const swapFirst=list=>[list[1],list[0],...list.slice(2)];
  for(const [label,changed] of [
   ['missing legacy occupancy',{...inventory,tests:inventory.tests.filter(path=>path!==legacyOccupancyTest)}],
   ['duplicate SQL',{...inventory,tests:[...inventory.tests,legacyOccupancyTest]}],
   ['reordered SQL',{...inventory,tests:swapFirst(inventory.tests)}],
   ['missing probe',{...inventory,probes:inventory.probes.slice(1)}],
   ['duplicate probe',{...inventory,probes:[...inventory.probes,inventory.probes[0]]}],
   ['reordered probes',{...inventory,probes:swapFirst(inventory.probes)}],
  ]){
   await assert.rejects(runIsolatedSupabaseDbTests({argv:parityArguments(changed),executeProcess}),
    /isolated_ai_parity_full_run_required/,name+' '+label);
   assert.equal(launched,0,name+' '+label+' must stop before process launch');
  }
 }
});
test('independent attestation rejects stale run/source, migration, closure, inventory and raw payload drift',async()=>{
 const source=await snapshotAiSource(),raw=Buffer.from(' {"test":"negative protocol only"} '),now=Date.now();
 const expected={runId:randomBytes(16).toString('hex'),nonce:randomBytes(32).toString('hex'),startedAt:now-1,captureStartedAt:now-1};
 const receipt={version:1,...expected,finishedAt:now,before:source,after:source,migrations:CURRENT_AI_MIGRATIONS,credentialPrefix:{...AI_CREDENTIAL_PREFIX,committed:true},sqlTests:AI_SQL_TESTS,probes:AI_PROBES,captures:Object.fromEntries(Object.entries(AI_PRODUCERS).map(([name,p])=>[name,{producer:p.path,file:p.file,sourceSha256:source.closure.find(v=>v.path===p.path).sha256,sha256:hash(raw),bytes:raw.length}]))};
 assert.equal(validateAiReceipt(receipt,{expected,source,raw,identity:'http',now}),true);
 for(const mutate of [
  r=>r.runId='0'.repeat(32),r=>r.nonce='0'.repeat(64),r=>r.startedAt=now-900_001,r=>r.captureStartedAt=now-2,r=>r.finishedAt=now+1,
  r=>r.before.sourceHead='0'.repeat(40),r=>r.after.closure.pop(),r=>r.after.closure[0].sha256='0'.repeat(64),
  r=>r.migrations=structuredClone(ACCEPTED_AI_MIGRATIONS),r=>r.migrations[0].sha256='0'.repeat(64),r=>r.migrations[6].sha256='0'.repeat(64),
  r=>[r.migrations[0],r.migrations[1]]=[r.migrations[1],r.migrations[0]],r=>r.migrations.pop(),r=>r.migrations.push(r.migrations[0]),
  r=>r.sqlTests.pop(),r=>r.sqlTests[0]=r.sqlTests[1],r=>r.probes[0]='tests/unknown.mjs',
  r=>delete r.credentialPrefix,r=>r.credentialPrefix.committed=false,r=>r.credentialPrefix.migration=CURRENT_AI_MIGRATIONS[5].fileName,
  r=>delete r.captures.chat,r=>r.captures.unexpected=r.captures.chat,
  r=>r.captures.http.producer=AI_PRODUCERS.chat.path,r=>r.captures.http.sourceSha256='0'.repeat(64),
  r=>r.captures.http.sha256='0'.repeat(64),r=>r.captures.http.bytes++,r=>r.captures.http.file='../other.json',
 ]){const changed=structuredClone(receipt);mutate(changed);assert.throws(()=>validateAiReceipt(changed,{expected,source,raw,identity:'http',now}));}
 assert.equal(suppressAiCaptures('before\nAI_CHAT_RUNTIME_CAPTURE:{"token":"synthetic-private"}\nafter'),'before\n[private AI capture omitted]\nafter');
});

test('actual root consumers fail without a current capture and receipt; no optional skips',()=>{
 const result=spawnSync(process.execPath,['--test','--experimental-strip-types','tests/ai-agent-http-producer-parity.test.mjs','tests/ai-agent-chat-runtime-parity.test.mjs'],{encoding:'utf8',env:{PATH:process.env.PATH,LANG:'C',LC_ALL:'C'}});
 assert.equal(result.status,1);assert.match(result.stdout,/(?:#|ℹ) tests 3\n/u);assert.match(result.stdout,/(?:#|ℹ) pass 0\n/u);assert.match(result.stdout,/(?:#|ℹ) skipped 0\n/u);
 assert.match(result.stdout,/current-run capture receipt required/);
});

test('source snapshot rejects undeclared local imports, missing source and canonical migration drift',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ai-receipt-negative-'));
 try{
  // Only the source allowlist and ten AI migrations, no dependency/app copy.
  const {AI_SOURCE_CLOSURE}=await import('../../scripts/lib/ai-producer-receipt.mjs');
  for(const path of [...AI_SOURCE_CLOSURE,...CURRENT_AI_MIGRATIONS.map(m=>'supabase/migrations/'+m.fileName)]){
   await mkdir(join(root,path,'..'),{recursive:true});await writeFile(join(root,path),await readFile(path));
  }
  const file=join(root,'src/features/ai-agent/server/ai-agent-auth.ts');
  await writeFile(file,(await readFile(file))+'\nimport x from "./undeclared.ts";\n');
  await assert.rejects(snapshotAiSource(root),/import outside audited AI closure/);
  await rm(file);await assert.rejects(snapshotAiSource(root),/ENOENT/);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('source closure rejects side-effect imports before accepting source provenance',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ai-receipt-side-effect-'));
 try{
  const {AI_SOURCE_CLOSURE}=await import('../../scripts/lib/ai-producer-receipt.mjs');
  for(const path of [...AI_SOURCE_CLOSURE,...CURRENT_AI_MIGRATIONS.map(m=>'supabase/migrations/'+m.fileName)]){
   await mkdir(join(root,path,'..'),{recursive:true});await writeFile(join(root,path),await readFile(path));
  }
  const file=join(root,'src/features/ai-agent/server/ai-agent-auth.ts'),original=await readFile(file);
  for(const statement of ['import "./unhashed-side-effect.ts";','import\n "./unhashed-side-effect.ts";','import "@/unhashed-side-effect";','import /* side effect */ "./unhashed-side-effect.ts";',String.raw`import "\u002e\u002funhashed-side-effect.ts";`,String.raw`import('\x2e\x2funhashed-side-effect.ts');`,String.raw`export {x} from "\u002e\u002funhashed-side-effect.ts";`,String.raw`import x from "\u002e\u002funhashed-side-effect.ts";`,String.raw`require("\u002e\u002funhashed-side-effect.ts");`]){
   await writeFile(file,original+'\n'+statement+'\n');
   await assert.rejects(snapshotAiSource(root),/import outside audited AI closure/);
  }
 }finally{await rm(root,{recursive:true,force:true});}
});

test('source closure rejects a side-effect import separated by a line comment',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ai-receipt-line-comment-'));
 try{
  const {AI_SOURCE_CLOSURE}=await import('../../scripts/lib/ai-producer-receipt.mjs');
  for(const path of [...AI_SOURCE_CLOSURE,...CURRENT_AI_MIGRATIONS.map(m=>'supabase/migrations/'+m.fileName)]){
   await mkdir(join(root,path,'..'),{recursive:true});await writeFile(join(root,path),await readFile(path));
  }
  const file=join(root,'src/features/ai-agent/server/ai-agent-auth.ts'),original=await readFile(file);
  for(const statement of [
   'import // side effect\n "./outside.ts";','import /* first */ // side effect\n /* last */ "./outside.ts";',
   ...['\r\n','\u2028','\u2029'].map(newline=>'import // side effect'+newline+' "./outside.ts";'),
   'import /* before */ (/* after */ "./outside.ts");',
   'import // before\n (// after\n "./outside.ts");',
   'require /* before */ (/* after */ "./outside.ts");',
   'require // before\r\n (// after\u2028 "./outside.ts");',
  ]){
   await writeFile(file,original+'\n'+statement+'\n');
   await assert.rejects(snapshotAiSource(root),/import outside audited AI closure/);
  }
 }finally{await rm(root,{recursive:true,force:true});}
});


test('current migration identity preserves the six accepted pins and rejects canonical/source drift',async()=>{
 assert.equal(ACCEPTED_AI_MIGRATIONS.length,6);
 assert.equal(CURRENT_AI_MIGRATIONS.length,10);
 assert.deepEqual(CURRENT_AI_MIGRATIONS.slice(0,6),ACCEPTED_AI_MIGRATIONS);
 const root=await mkdtemp(join(tmpdir(),'ai-receipt-migration-drift-'));
 try{
  const {AI_SOURCE_CLOSURE}=await import('../../scripts/lib/ai-producer-receipt.mjs');
  for(const path of [...AI_SOURCE_CLOSURE,...CURRENT_AI_MIGRATIONS.map(m=>'supabase/migrations/'+m.fileName)]){
   await mkdir(join(root,path,'..'),{recursive:true});await writeFile(join(root,path),await readFile(path));
  }
  const manifestPath=join(root,'supabase/test-baselines/dashboard-free-tier-v1.manifest.json');
  const original=JSON.parse(await readFile(manifestPath));
  assert.equal(original.orderedNewMigrations.length,162);
  const reviewedLegacy=original.orderedNewMigrations.filter(m=>!CURRENT_WITHDRAWAL_MIGRATIONS.some(pin=>pin.fileName===m.fileName) && m.fileName!==THREAD_REPLY_MIGRATION.fileName);
  assert.equal(reviewedLegacy.length,156);
  const mainFileName='20261007135140_textbook_latest_count_read_aggregation.sql';
  assert.equal(reviewedLegacy.at(-1).fileName,mainFileName);
  for(const mutate of [
   m=>m.orderedNewMigrations.splice(m.orderedNewMigrations.findIndex(row=>row.fileName===mainFileName),1),
   m=>m.orderedNewMigrations.push({...CURRENT_AI_MIGRATIONS[6],fileName:'20990101000000_ai_agent_unreviewed.sql'}),
   m=>m.orderedNewMigrations.find(row=>row.fileName===mainFileName).sha256='0'.repeat(64),
   m=>m.orderedNewMigrations.find(row=>row.fileName===THREAD_REPLY_MIGRATION.fileName).sha256='0'.repeat(64),
   m=>m.orderedNewMigrations.find(row=>row.fileName===THREAD_REPLY_MIGRATION.fileName).status='draft',
   m=>m.orderedNewMigrations.splice(m.orderedNewMigrations.findIndex(row=>row.fileName===THREAD_REPLY_MIGRATION.fileName),1),
   m=>m.orderedNewMigrations.find(row=>row.fileName===mainFileName).status='draft',
   m=>m.orderedNewMigrations.find(row=>row.fileName===mainFileName).fileName='20990101000000_unreviewed.sql',
   m=>m.orderedNewMigrations[0].sha256='0'.repeat(64),
   m=>m.orderedNewMigrations[0]=m.orderedNewMigrations[1],
   m=>[m.orderedNewMigrations[0],m.orderedNewMigrations[1]]=[m.orderedNewMigrations[1],m.orderedNewMigrations[0]],
   m=>m.orderedNewMigrations.find(row=>row.fileName===CURRENT_AI_MIGRATIONS[0].fileName).sha256='0'.repeat(64),
   m=>{const a=m.orderedNewMigrations.findIndex(row=>row.fileName===CURRENT_AI_MIGRATIONS[0].fileName),b=m.orderedNewMigrations.findIndex(row=>row.fileName===CURRENT_AI_MIGRATIONS[1].fileName);[m.orderedNewMigrations[a],m.orderedNewMigrations[b]]=[m.orderedNewMigrations[b],m.orderedNewMigrations[a]]},
  ]){
   const changed=structuredClone(original);mutate(changed);await writeFile(manifestPath,JSON.stringify(changed));
   await assert.rejects(snapshotAiSource(root),/(?:AI canonical manifest inventory|current migration manifest drift)/);
  }
  await writeFile(manifestPath,JSON.stringify(original));
  const mainMigration=join(root,'supabase/migrations/'+mainFileName);
  const mainSource=await readFile(mainMigration);
  await writeFile(mainMigration,Buffer.concat([mainSource,Buffer.from('\n-- drift\n')]));
  await assert.rejects(snapshotAiSource(root),/reviewed main migration source drift/);
  await rm(mainMigration);await assert.rejects(snapshotAiSource(root),/ENOENT/);
  await writeFile(mainMigration,mainSource);
  const replyPath=join(root,'supabase/migrations/'+THREAD_REPLY_MIGRATION.fileName),replyBytes=await readFile(replyPath);
  const alteredReply=Buffer.concat([replyBytes,Buffer.from('\n-- drift\n')]);
  await writeFile(replyPath,alteredReply);
  await assert.rejects(snapshotAiSource(root),/accepted migration source drift/);
  const alteredManifest=structuredClone(original);alteredManifest.orderedNewMigrations.find(row=>row.fileName===THREAD_REPLY_MIGRATION.fileName).sha256=hash(alteredReply);
  await writeFile(manifestPath,JSON.stringify(alteredManifest));
  await assert.rejects(snapshotAiSource(root),/current migration manifest drift/);
  await writeFile(manifestPath,JSON.stringify(original));await rm(replyPath);
  await assert.rejects(snapshotAiSource(root),/ENOENT/);await writeFile(replyPath,replyBytes);
  const newest=join(root,'supabase/migrations/'+CURRENT_AI_MIGRATIONS[6].fileName);
  await writeFile(newest,(await readFile(newest))+'\n-- drift\n');
  await assert.rejects(snapshotAiSource(root),/accepted migration source drift/);
  await rm(newest);await assert.rejects(snapshotAiSource(root),/ENOENT/);
 }finally{await rm(root,{recursive:true,force:true});}
});


test('reviewed withdrawal pins admit the final ordered chain and reject each manifest/source drift',async()=>{
 assert.equal(CURRENT_WITHDRAWAL_MIGRATIONS.length,5);
 const current=await snapshotAiSource();
 assert.deepEqual(current.migrations,CURRENT_AI_MIGRATIONS,'AI receipt migration protocol stays unchanged');
 for(const pin of CURRENT_WITHDRAWAL_MIGRATIONS){
  const path='supabase/migrations/'+pin.fileName;
  assert.equal(current.closure.find(row=>row.path===path)?.sha256,pin.sha256,'withdrawal SQL is bound into the receipt closure');
 }
 const root=await mkdtemp(join(tmpdir(),'ai-receipt-withdrawal-drift-'));
 try{
  const {AI_SOURCE_CLOSURE}=await import('../../scripts/lib/ai-producer-receipt.mjs');
  for(const path of [...AI_SOURCE_CLOSURE,...CURRENT_AI_MIGRATIONS.map(m=>'supabase/migrations/'+m.fileName)]){
   await mkdir(join(root,path,'..'),{recursive:true});await writeFile(join(root,path),await readFile(path));
  }
  const manifestPath=join(root,'supabase/test-baselines/dashboard-free-tier-v1.manifest.json');
  const original=JSON.parse(await readFile(manifestPath));
  for(const [pinIndex,pin]of CURRENT_WITHDRAWAL_MIGRATIONS.entries()){
   assert.deepEqual(original.orderedNewMigrations.find(row=>row.fileName===pin.fileName),pin,'exact reviewed withdrawal manifest entry');
   const index=original.orderedNewMigrations.findIndex(row=>row.fileName===pin.fileName);
   assert.ok(index>0);
   for(const [label,mutate]of [
    ['missing',rows=>rows.splice(index,1)],
    ['duplicate appended',rows=>rows.push({...rows[index]})],
    ['same-length duplicate',rows=>rows[index]={...CURRENT_WITHDRAWAL_MIGRATIONS[(pinIndex+1)%CURRENT_WITHDRAWAL_MIGRATIONS.length]}],
    ['reordered',rows=>[rows[index-1],rows[index]]=[rows[index],rows[index-1]]],
    ['hash drift',rows=>rows[index].sha256='0'.repeat(64)],
    ['status drift',rows=>rows[index].status='draft'],
    ['filename drift',rows=>rows[index].fileName='20990101000000_unreviewed_withdrawal.sql'],
   ]){
    const changed=structuredClone(original);mutate(changed.orderedNewMigrations);
    await writeFile(manifestPath,JSON.stringify(changed));
    await assert.rejects(snapshotAiSource(root),/(?:AI canonical manifest inventory|current migration manifest drift)/,pin.fileName+' '+label);
   }
   await writeFile(manifestPath,JSON.stringify(original));
   const sqlPath=join(root,'supabase/migrations/'+pin.fileName),sql=await readFile(sqlPath);
   const drift=Buffer.concat([sql,Buffer.from('\n-- source drift\n')]);
   await writeFile(sqlPath,drift);
   await assert.rejects(snapshotAiSource(root),/reviewed withdrawal migration source drift/,pin.fileName+' source content drift');
   const coordinated=structuredClone(original);coordinated.orderedNewMigrations[index].sha256=hash(drift);
   await writeFile(manifestPath,JSON.stringify(coordinated));
   await assert.rejects(snapshotAiSource(root),/current migration manifest drift/,pin.fileName+' coordinated manifest and source drift');
   await writeFile(manifestPath,JSON.stringify(original));
   await rm(sqlPath);await assert.rejects(snapshotAiSource(root),/ENOENT/,pin.fileName+' missing source');
   await writeFile(sqlPath,sql);
  }
 }finally{await rm(root,{recursive:true,force:true});}
});

test('capture freshness keeps original run identity and enforces the exact 15-minute capture boundary',async()=>{
 const source=await snapshotAiSource(),raw=Buffer.from('{"negativeProtocolFixture":true}'),now=2_000_000;
 const expected={runId:'a'.repeat(32),nonce:'b'.repeat(64),startedAt:1,captureStartedAt:now-1};
 const receipt={version:1,...expected,finishedAt:now,before:source,after:source,migrations:CURRENT_AI_MIGRATIONS,credentialPrefix:{...AI_CREDENTIAL_PREFIX,committed:true},sqlTests:AI_SQL_TESTS,probes:AI_PROBES,captures:Object.fromEntries(Object.entries(AI_PRODUCERS).map(([name,p])=>[name,{producer:p.path,file:p.file,sourceSha256:source.closure.find(v=>v.path===p.path).sha256,sha256:hash(raw),bytes:raw.length}]))};
 const validate=(r=receipt,e=expected)=>validateAiReceipt(r,{expected:e,source,raw,identity:'http',now});
 assert.equal(validate(),true,'old setup with fresh actual captures remains a current run');
 for(const age of [899_999,900_000,900_001]){
  const r=structuredClone(receipt),e={...expected,captureStartedAt:now-age};r.captureStartedAt=e.captureStartedAt;
  if(age<900_000)assert.equal(validate(r,e),true);else assert.throws(()=>validate(r,e),/receipt time window/);
 }
 for(const field of ['startedAt','captureStartedAt','finishedAt'])for(const value of [undefined,null,NaN,Infinity,-Infinity,1.5,0,-1,'1']){
  const r=structuredClone(receipt),e={...expected};r[field]=value;if(field!=='finishedAt')e[field]=value;
  assert.throws(()=>validate(r,e),'invalid '+field);
 }
 for(const values of [
  {startedAt:now,captureStartedAt:now-1},
  {captureStartedAt:now,finishedAt:now-1},
  {finishedAt:now+1},
 ]){const r={...receipt,...values},e={...expected,...Object.fromEntries(Object.entries(values).filter(([k])=>k!=='finishedAt'))};assert.throws(()=>validate(r,e),/receipt time window/);}
 for(const field of ['runId','nonce','startedAt','captureStartedAt']){
  const e={...expected,[field]:typeof expected[field]==='number'?expected[field]+1:'c'.repeat(expected[field].length)};
  assert.throws(()=>validate(receipt,e),'independent '+field+' mismatch');
 }
});

test('capture phase checks source before the first producer and cannot refresh for later producers',async()=>{
 const before={sourceHead:'a'.repeat(40),closure:[{path:'producer',sha256:'b'.repeat(64)}]};
 const phase={startedAt:100,captureStartedAt:null,before};let reads=0,clock=200;
 const readSource=async()=>{reads++;return structuredClone(before);};
 assert.equal(await beginAiCapturePhase(phase,readSource,()=>clock),200);
 clock=400;assert.equal(await beginAiCapturePhase(phase,readSource,()=>clock),200);
 assert.equal(phase.startedAt,100);assert.equal(phase.captureStartedAt,200);assert.equal(reads,1);
 const drift={startedAt:100,captureStartedAt:null,before};let launched=false;
 await assert.rejects(beginAiCapturePhase(drift,async()=>({...before,sourceHead:'c'.repeat(40)}),()=>200).then(()=>{launched=true;}),/capture phase source drift/);
 assert.equal(launched,false);assert.equal(drift.captureStartedAt,null);
});

// Negative runner orchestration only: every external process is replaced by a
// deterministic stub. These synthetic captures can never count as DB/HTTP QA.
test('final personal probe failure prevents a receipt and consumer launch after both producers',async(t)=>{
 const {readdir,lstat}=await import('node:fs/promises');
 const tempDirectory=await mkdtemp(join(tmpdir(),'ai-final-probe-failure-'));t.after(()=>rm(tempDirectory,{recursive:true,force:true}));
 const applied=new Set(),probes=[];let consumers=0,checkedReceiptAbsence=false;
 const output=stdout=>({code:0,stdout,stderr:''});
 const executeNetwork=async({args,cwd})=>{
  const config=await readFile(join(cwd,'supabase/config.toml'),'utf8');
  const project=config.match(/^project_id = "([a-z0-9_]+)"/mu)[1],port=config.match(/\[db\]\nport = (\d+)/u)[1],network=project+'_internal',id='a'.repeat(64);
  if(args[0]==='network'&&args[1]==='create')return output(id);
  if(args[0]==='network'&&args[1]==='inspect')return output(JSON.stringify([{Id:id,Name:network,Internal:true,Driver:'bridge',EnableIPv6:false,Options:{'com.docker.network.bridge.host_binding_ipv4':'127.0.0.1'},Labels:{'tips.isolated-db-qa':project}}]));
  if(args[0]==='inspect')return output(JSON.stringify([{Name:'/supabase_db_'+project,State:{Running:true},HostConfig:{NetworkMode:id,PortBindings:{'5432/tcp':[{HostIp:'',HostPort:port}]}},NetworkSettings:{Networks:{[network]:{NetworkID:id}},Ports:{'5432/tcp':[{HostIp:'127.0.0.1',HostPort:port}]}}}]));
  if(args[0]==='exec')return output('Iface\tDestination\tGateway\tFlags\tRefCnt\tUse\tMetric\tMask\tMTU\tWindow\tIRTT\neth0\t000011AC\t00000000\t0001\t0\t0\t0\t0000FFFF\t0\t0\t0\n');
  return output('');
 };
 const executeProcess=async({command,args,cwd})=>{
  if(args[0]==='migration'){
   const local=(await readdir(join(cwd,'supabase/migrations'))).filter(x=>/^\d{14}_.+\.sql$/u.test(x)).map(x=>x.slice(0,14));
   if(args[1]==='up')for(const v of local)applied.add(v);
   if(args[1]==='list')return output(JSON.stringify({message:'Migrations listed',migrations:[...new Set([...local,...applied])].sort().map(v=>({local:local.includes(v)?v:'',remote:applied.has(v)?v:'',time:'synthetic'}))}));
  }
  if(args[0]==='test'&&args[1]==='db')return output(`Files=${args.filter(x=>x.startsWith('supabase/tests/')).length}, Tests=100, 1 wallclock secs\nResult: PASS\n`);
  if(command==='docker')return output('a'.repeat(32));
  if(args[0]==='status')return output(JSON.stringify({DB_URL:'postgresql://postgres:synthetic@127.0.0.1:56702/postgres'}));
  const probe=AI_PROBES.find(p=>args[0]?.endsWith('/'+p));
  if(probe){
   probes.push(probe);
   if(probe===AI_PROBES.at(-1))return {code:1,stdout:'',stderr:'synthetic_final_probe_failure'};
   const producer=Object.values(AI_PRODUCERS).find(p=>p.path===probe);
   return output(producer?producer.prefix+'{"negativeProtocolFixture":true}\n':'');
  }
  if(args[0]==='--test'){consumers++;throw Error('consumers must not run after final probe failure');}
  if(args[0]==='stop'){
   await assert.rejects(lstat(join(cwd,'ai-private-captures/receipt.json')),{code:'ENOENT'});
   assert.deepEqual((await readdir(join(cwd,'ai-private-captures'))).sort(),['chat.json','http.json']);checkedReceiptAbsence=true;
  }
  return output('');
 };
 const postdeploy=await readFile(new URL('../../supabase/tests/active_registration_workflow_postdeploy_readonly.sql',import.meta.url),'utf8');
 const run=runIsolatedSupabaseDbTests({argv:parityArguments({tests:AI_SQL_TESTS,probes:AI_PROBES}),tempDirectory,
  allocatePort:(()=>{let port=56700;return()=>++port;})(),executeNetwork,
  executeProcess:invocation=>invocation.command==='docker'&&invocation.args.at(-1)===postdeploy?output('t'):executeProcess(invocation),log:()=>{}});
 await assert.rejects(run,/isolated_supabase_db_probe_failed/);
 assert.deepEqual(probes,AI_PROBES);assert.equal(consumers,0);assert.equal(checkedReceiptAbsence,true);
});
