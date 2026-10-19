import test from 'node:test';
import assert from 'node:assert/strict';
import {extractAiCapture} from '../../scripts/lib/ai-producer-receipt.mjs';
test('capture protocol preserves JSON bytes and rejects missing, duplicate, unknown and malformed captures',()=>{
 const raw=' {"value": "한\\n글", "synthetic":true} ';
 assert.equal(extractAiCapture('step\nAI_HTTP_CAPTURE:'+raw+'\n','http').toString(),raw);
 for(const output of ['', 'AI_HTTP_CAPTURE:{}\nAI_HTTP_CAPTURE:{}\n','AI_UNKNOWN_CAPTURE:{}\nAI_HTTP_CAPTURE:{}\n','AI_HTTP_CAPTURE:{\n'])assert.throws(()=>extractAiCapture(output,'http'));
});

import {AI_PRODUCERS,AI_SQL_TESTS,AI_PROBES,AI_CREDENTIAL_PREFIX,ACCEPTED_AI_MIGRATIONS,CURRENT_AI_MIGRATIONS,CURRENT_WITHDRAWAL_MIGRATIONS,CURRENT_PR126_MIGRATIONS,THREAD_REPLY_MIGRATION,NONEXPIRING_CHAT_MIGRATION,TIMETABLE_VALIDATION_MIGRATION,TIMETABLE_CLOSE_MIGRATIONS,TIMETABLE_BATCH_SAVE_MIGRATION,snapshotAiSource,validateAiReceipt,suppressAiCaptures,beginAiCapturePhase} from '../../scripts/lib/ai-producer-receipt.mjs';
import {createHash,randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {writeFile,readFile,rm,mkdir,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {parseIsolatedDbArguments,runIsolatedSupabaseDbTests} from '../../scripts/run-isolated-supabase-db-tests.mjs';
import {decodeAiImportLiteral} from '../../scripts/lib/ai-producer-receipt.mjs';
import vm from 'node:vm';
import {syncBuiltinESMExports} from 'node:module';
import * as receiptProtocol from '../../scripts/lib/ai-producer-receipt.mjs';
const hash=v=>createHash('sha256').update(v).digest('hex');
const registrationPin={fileName:'20261013084134_registration_enrollment_guarded_save.sql',status:'final',sha256:'befb880ae63b997aa71912b1775cf779933758b89c00fcb9440b3698fb9338c3'};
const calendarMovePin={fileName:'20261019082218_academic_calendar_move_atomic.sql',status:'final',sha256:'c14525d01c3c3e8d225b0f59986895815e6d831bfa2c0823dbf2237dd98cc70a'};
const repositoryRoot=fileURLToPath(new URL('../../',import.meta.url));
const isolatedWorkflows=['supabase-db-push.yml','supabase-sql-review.yml'];
const legacyOccupancyTest='supabase/tests/makeup_legacy_approval_occupancy_test.sql';
const timetableCloseTests=Object.freeze([
 'supabase/tests/timetable_reader_explicit_native_resolution_test.sql',
 'supabase/tests/timetable_shared_validation_workset_test.sql',
 'supabase/tests/timetable_close_gateway_validation_reuse_test.sql',
 'supabase/tests/legacy_context_binding_preparation_test.sql',
]);
test('import literal decoding preserves plain and escaped string values and rejects expressions',()=>{
 for(const [literal,value] of [
  ['""',''],["'node:fs'",'node:fs'],['"./한글/😀.mjs"','./한글/😀.mjs'],["'a\"b'",'a"b'],['"a\'b"',"a'b"],
  [String.raw`'\u002e\u002fmodule.mjs'`,'./module.mjs'],[String.raw`"\x2e\x2fmodule.mjs"`,'./module.mjs'],
  [String.raw`'\u{2e}\u{2f}module.mjs'`,'./module.mjs'],[String.raw`'\056\057module.mjs'`,'./module.mjs'],
  [String.raw`'\.\/module.mjs'`,'./module.mjs'],[String.raw`'\uD83D\uDE00'`,'😀'],
  [String.raw`'a\nb\rc\td\ve\ff\bg\0'`,'a\nb\rc\td\ve\ff\bg\0'],
  [String.raw`'quote\'slash\\'`,"quote'slash\\"],
  ["'./line\\\nbreak.mjs'",'./linebreak.mjs'],["'./line\\\r\nbreak.mjs'",'./linebreak.mjs'],
 ])assert.equal(decodeAiImportLiteral(literal),value);
 for(const invalid of ['"a"+"b"','"ok";throw 1','`template`','"unterminated','"line\nbreak"','"done"\n',null]){
  assert.throws(()=>decodeAiImportLiteral(invalid),/invalid import literal/);
 }
 for(const invalid of [String.raw`'\xGG'`,String.raw`'\uZZZZ'`,String.raw`'\u{110000}'`]){
  assert.throws(()=>decodeAiImportLiteral(invalid),{name:'SyntaxError'});
 }
});
test('literal value memo preserves the VM budget, propagates errors and remains bounded',async()=>{
 // A separate module instance keeps deliberate cache saturation local to this
 // capacity test, without warming or filling the real snapshot module's memo.
 const {decodeAiImportLiteral}=await import('../../scripts/lib/ai-producer-receipt.mjs?literal-capacity-regression');
 const original=vm.runInNewContext,calls=[];
 vm.runInNewContext=(literal,context,options)=>{
  calls.push(literal);assert.equal(Object.getPrototypeOf(context),null);assert.deepEqual(options,{timeout:50});
  if(literal.includes('timeout-probe'))throw Object.assign(new Error('synthetic VM timeout'),{code:'ERR_SCRIPT_EXECUTION_TIMEOUT'});
  return original(literal,context,options);
 };
 syncBuiltinESMExports();
 try{
  assert.equal(decodeAiImportLiteral('"plain-probe"'),'plain-probe');assert.equal(calls.length,0);
  const escaped=String.raw`'memo-probe-\u002e'`;
  assert.equal(decodeAiImportLiteral(escaped),'memo-probe-.');assert.equal(decodeAiImportLiteral(escaped),'memo-probe-.');assert.equal(calls.length,1);
  for(let i=0;i<2;i++)assert.throws(()=>decodeAiImportLiteral(String.raw`'timeout-probe-\u002e'`),{code:'ERR_SCRIPT_EXECUTION_TIMEOUT'});
  assert.equal(calls.filter(s=>s.includes('timeout-probe')).length,2);
  const invalid=String.raw`'invalid-probe-\xGG'`;
  for(let i=0;i<2;i++)assert.throws(()=>decodeAiImportLiteral(invalid),{name:'SyntaxError'});
  assert.equal(calls.filter(s=>s===invalid).length,2);
  const large="'"+'x'.repeat(4097)+String.raw`\u002e'`;
  for(let i=0;i<2;i++)assert.equal(decodeAiImportLiteral(large),'x'.repeat(4097)+'.');
  assert.equal(calls.filter(s=>s===large).length,2);
  // More distinct small values than the capacity: new values must still be
  // evaluated and accepted, without growing the retained cache indefinitely.
  for(let i=0;i<65;i++)decodeAiImportLiteral("'capacity-"+i+String.raw`-\u002e'`);
  const overflow=String.raw`'capacity-overflow-\u002e'`,before=calls.length;
  for(let i=0;i<2;i++)assert.equal(decodeAiImportLiteral(overflow),'capacity-overflow-.');
  assert.equal(calls.length-before,2);
 }finally{vm.runInNewContext=original;syncBuiltinESMExports();}
});
test('warmed literal values never cache source hashes, relative import authorization or manifest validity',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ai-receipt-memo-boundary-'));
 const originalVm=vm.runInNewContext,calls=[];
 try{
  const {AI_SOURCE_CLOSURE,snapshotAiSource}=await import('../../scripts/lib/ai-producer-receipt.mjs?literal-boundary-regression');
  for(const path of [...AI_SOURCE_CLOSURE,...CURRENT_AI_MIGRATIONS.map(m=>'supabase/migrations/'+m.fileName)]){
   await mkdir(join(root,path,'..'),{recursive:true});await writeFile(join(root,path),await readFile(path));
  }
  for(const args of [['init','-q'],['-c','core.hooksPath=/dev/null','-c','user.name=Fixture','-c','user.email=fixture@test.invalid','commit','-q','--allow-empty','-m','synthetic source snapshot']]){
   const result=spawnSync('git',args,{cwd:root,encoding:'utf8',env:{PATH:process.env.PATH,LANG:'C'}});
   assert.equal(result.status,0,result.stderr);
  }
  vm.runInNewContext=(literal,context,options)=>{
   assert.ok(literal.includes('\\'),'plain literal must not require VM execution');
   assert.deepEqual(options,{timeout:50});calls.push(literal);return originalVm(literal,context,options);
  };
  syncBuiltinESMExports();
  const first=await snapshotAiSource(root),initialCalls=calls.length;
  assert.ok(initialCalls>0,'the real escaped source literal reaches the VM');
  assert.deepEqual(await snapshotAiSource(root),first);assert.equal(calls.length,initialCalls);
  const allowedPath='src/features/operations/academic-event-utils.js',forbiddenPath='src/lib/auth-utils.ts';
  const allowedOriginal=await readFile(join(root,allowedPath)),forbiddenOriginal=await readFile(join(root,forbiddenPath));
  const literal=String.raw`'..\u002f..\u002flib/class-schedule-planner.js'`;
  const statement='\nimport '+literal+';\n';
  await writeFile(join(root,allowedPath),Buffer.concat([allowedOriginal,Buffer.from(statement)]));
  const allowed=await snapshotAiSource(root),warmCalls=calls.length;
  assert.equal(warmCalls,initialCalls+1);
  assert.notEqual(allowed.closure.find(r=>r.path===allowedPath).sha256,first.closure.find(r=>r.path===allowedPath).sha256);
  await writeFile(join(root,forbiddenPath),Buffer.concat([forbiddenOriginal,Buffer.from(statement)]));
  await assert.rejects(snapshotAiSource(root),/import outside audited AI closure/);
  assert.equal(calls.length,warmCalls,'same decoded literal still needs authorization at a different source location');
  await writeFile(join(root,forbiddenPath),forbiddenOriginal);
  const manifestPath=join(root,'supabase/test-baselines/dashboard-free-tier-v1.manifest.json'),manifestOriginal=await readFile(manifestPath);
  const changed=JSON.parse(manifestOriginal);changed.orderedNewMigrations.at(-1).sha256='0'.repeat(64);
  await writeFile(manifestPath,JSON.stringify(changed));
  await assert.rejects(snapshotAiSource(root),/current migration manifest drift/);
  await writeFile(manifestPath,manifestOriginal);
  await writeFile(join(root,allowedPath),Buffer.concat([allowedOriginal,Buffer.from(statement+'// source changed after memo hit\n')]));
  const edited=await snapshotAiSource(root);
  assert.notEqual(edited.closure.find(r=>r.path===allowedPath).sha256,allowed.closure.find(r=>r.path===allowedPath).sha256);
  assert.equal(calls.length,warmCalls,'changed files are rehashed even when literal decoding is reused');
  await rm(join(root,allowedPath));await assert.rejects(snapshotAiSource(root),/ENOENT/);
 }finally{vm.runInNewContext=originalVm;syncBuiltinESMExports();await rm(root,{recursive:true,force:true});}
});
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
// This reviewed-final source fixture is solely for negative orchestration.
// It inherits the existing read-only HEAD from its repository ancestor; it has
// no .git, dependencies, environment copy, or external execution capability.
async function isolatedFinalSourceFixture(t){
 const parent=join(repositoryRoot,'.codex-temp');await mkdir(parent,{recursive:true});
 const root=await mkdtemp(join(parent,'ai-receipt-negative-source-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const manifestPath='supabase/test-baselines/dashboard-free-tier-v1.manifest.json';
 const realManifestBytes=await readFile(join(repositoryRoot,manifestPath));
 const manifest=JSON.parse(realManifestBytes);
 assert.deepEqual(manifest.orderedNewMigrations.find(row=>row.fileName===registrationPin.fileName),registrationPin);
 const runnerPath='scripts/run-isolated-supabase-db-tests.mjs';
 const helperPath='scripts/lib/ai-producer-receipt.mjs';
 const protectedPaths=[manifestPath,runnerPath,helperPath,'supabase/migrations/'+registrationPin.fileName];
 const protectedHashes=new Map(await Promise.all(protectedPaths.map(async file=>[file,hash(await readFile(join(repositoryRoot,file)))])));
 const assertRealSourcesUnchanged=async()=>{
  for(const [file,expected] of protectedHashes)assert.equal(hash(await readFile(join(repositoryRoot,file))),expected,file+' remains byte-identical');
 };
 const runnerSource=await readFile(join(repositoryRoot,runnerPath),'utf8');
 const dependencyBlock=runnerSource.match(/const PROBE_DEPENDENCIES = Object\.freeze\(\{([\s\S]*?)\n\}\);/u)?.[1];
 assert.ok(dependencyBlock,'the curated dependency allowlist must remain explicit');
 const dependencies=[...dependencyBlock.matchAll(/"([^"]+)"/gu)].map(match=>match[1]);
 const prerequisiteBlock=runnerSource.match(/const NOTIFICATION_CONTENT_PREREQUISITE_MIGRATIONS = Object\.freeze\(\[([\s\S]*?)\n\]\);/u)?.[1];
 assert.ok(prerequisiteBlock);
 const prerequisites=[...prerequisiteBlock.matchAll(/"(\d{14}_[a-z0-9_]+\.sql)"/gu)].map(match=>'supabase/migrations/'+match[1]);
 const activePath='supabase/test-baselines/dashboard-free-tier-v1.active.json';
 const active=JSON.parse(await readFile(join(repositoryRoot,activePath)));
 assert.match(active.captureId,/^[a-f0-9]{16}$/u);
 const capture='supabase/test-baselines/dashboard-free-tier-v1-captures/'+active.captureId+'/';
 const files=new Set([
  ...receiptProtocol.AI_SOURCE_CLOSURE,...CURRENT_AI_MIGRATIONS.map(pin=>'supabase/migrations/'+pin.fileName),
  ...manifest.orderedNewMigrations.map(pin=>'supabase/migrations/'+pin.fileName),
  ...AI_SQL_TESTS,...AI_PROBES,...dependencies,...prerequisites,
  activePath,...Object.values(active.artifactPaths),...['baseline.sql','catalog.json','manifest.json','parity.sql'].map(file=>capture+file),
  'supabase/tests/dashboard_free_tier_baseline_smoke_test.sql',
  'supabase/tests/active_registration_workflow_postdeploy_readonly.sql',
  'scripts/fixtures/dashboard-free-tier-isolated-schema-repair.sql',
  'scripts/fixtures/dashboard-free-tier-migration-prerequisites.sql',
  'scripts/fixtures/dashboard-free-tier-notification-settings-prerequisites.sql',
 ]);
 for(const file of files){
  assert.ok(/^(?:scripts|src|tests|supabase|integrations|package\.json|package-lock\.json)(?:\/|$)/u.test(file));
  assert.ok(!file.split('/').some(part=>part==='..'||part==='.git'||part==='node_modules'||part.startsWith('.env')));
  await mkdir(join(root,file,'..'),{recursive:true});await writeFile(join(root,file),await readFile(join(repositoryRoot,file)));
 }
 const isolatedProtocol=await import(pathToFileURL(join(root,helperPath)).href);
  assert.deepEqual(isolatedProtocol.REGISTRATION_ENROLLMENT_MIGRATION,registrationPin);
  assert.equal(registrationPin.status,'final');
 const source=await isolatedProtocol.snapshotAiSource(root);
 assert.equal(source.sourceHead,(await snapshotAiSource()).sourceHead);
 assert.equal(source.closure.find(row=>row.path===helperPath).sha256,hash(await readFile(join(root,helperPath))));
 assert.equal(hash(await readFile(join(root,runnerPath))),hash(runnerSource),'runner itself is byte-identical');
 const {lstat}=await import('node:fs/promises');
 await assert.rejects(lstat(join(root,'.git')),{code:'ENOENT'});
 assert.deepEqual(await readFile(join(repositoryRoot,manifestPath)),realManifestBytes);
 await assertRealSourcesUnchanged();
 const isolatedRunner=await import(pathToFileURL(join(root,runnerPath)).href);
 return {root,run:isolatedRunner.runIsolatedSupabaseDbTests,realManifestBytes,assertRealSourcesUnchanged};
}
test('registration final is explicitly pinned in the closure without changing the accepted AI protocol',async()=>{
 assert.deepEqual(receiptProtocol.REGISTRATION_ENROLLMENT_MIGRATION,registrationPin);
 const current=await snapshotAiSource();
 const path='supabase/migrations/'+registrationPin.fileName;
 assert.equal(receiptProtocol.AI_SOURCE_CLOSURE.filter(file=>file===path).length,1);
 assert.equal(current.closure.find(row=>row.path===path)?.sha256,registrationPin.sha256);
 assert.deepEqual(current.migrations,CURRENT_AI_MIGRATIONS);
 const manifest=JSON.parse(await readFile('supabase/test-baselines/dashboard-free-tier-v1.manifest.json'));
 assert.equal(manifest.orderedNewMigrations.length,175);
 assert.deepEqual(manifest.orderedNewMigrations.find(row=>row.fileName===registrationPin.fileName),registrationPin);
});
test('registration final rejects missing, duplicate, reordered, hash, status and coordinated source drift',async()=>{
 assert.deepEqual(receiptProtocol.REGISTRATION_ENROLLMENT_MIGRATION,registrationPin);
 const warmSource=await snapshotAiSource();
 const parent=join(repositoryRoot,'.codex-temp');await mkdir(parent,{recursive:true});
 const root=await mkdtemp(join(parent,'ai-receipt-registration-drift-'));
 try{
  for(const file of [...receiptProtocol.AI_SOURCE_CLOSURE,...CURRENT_AI_MIGRATIONS.map(m=>'supabase/migrations/'+m.fileName)]){
   await mkdir(join(root,file,'..'),{recursive:true});await writeFile(join(root,file),await readFile(file));
  }
  const manifestPath=join(root,'supabase/test-baselines/dashboard-free-tier-v1.manifest.json');
  const original=JSON.parse(await readFile(manifestPath));
  assert.deepEqual(await snapshotAiSource(root),warmSource,'a warmed literal cache still validates the exact copied source');
  const allowedPath='src/features/ai-agent/server/ai-agent-auth.ts';
  const allowedFile=join(root,allowedPath),allowedBytes=await readFile(allowedFile);
  const correctedBytes=Buffer.concat([allowedBytes,Buffer.from('\n// isolated allowed-source correction\n')]);
  await writeFile(allowedFile,correctedBytes);
  const corrected=await snapshotAiSource(root);
  assert.equal(corrected.closure.find(row=>row.path===allowedPath).sha256,hash(correctedBytes));
  assert.notEqual(corrected.closure.find(row=>row.path===allowedPath).sha256,warmSource.closure.find(row=>row.path===allowedPath).sha256);
  assert.equal(corrected.sourceHead,warmSource.sourceHead);
  for(const statement of ['import "./warm-cache-outside.ts";',String.raw`import "\u002e\u002fwarm-cache-outside.ts";`]){
   await writeFile(allowedFile,Buffer.concat([correctedBytes,Buffer.from('\n'+statement+'\n')]));
   await assert.rejects(snapshotAiSource(root),/import outside audited AI closure/,'warmed cache must reject each current unknown import');
  }
  await rm(allowedFile);await assert.rejects(snapshotAiSource(root),/ENOENT/,'warmed cache must not replace a missing source file');
  await writeFile(allowedFile,allowedBytes);
  const index=original.orderedNewMigrations.findIndex(row=>row.fileName===registrationPin.fileName);
  assert.equal(index,170);
  for(const [label,mutate] of [
   ['missing',rows=>rows.splice(index,1)],
   ['duplicate appended',rows=>rows.push({...rows[index]})],
   ['same-length duplicate',rows=>rows[index]={...rows[index-1]}],
   ['reordered',rows=>[rows[index-1],rows[index]]=[rows[index],rows[index-1]]],
   ['hash drift',rows=>rows[index].sha256='0'.repeat(64)],
    ['unauthorized candidate demotion',rows=>rows[index].status='candidate'],
   ['unknown status',rows=>rows[index].status='draft'],
   ['filename drift',rows=>rows[index].fileName='20990101000000_unreviewed_registration.sql'],
  ]){
   const changed=structuredClone(original);mutate(changed.orderedNewMigrations);
   await writeFile(manifestPath,JSON.stringify(changed));
   await assert.rejects(snapshotAiSource(root),/(?:AI canonical manifest inventory|current migration manifest drift)/,label);
  }
  await writeFile(manifestPath,JSON.stringify(original));
  const sqlPath=join(root,'supabase/migrations/'+registrationPin.fileName),sql=await readFile(sqlPath);
  const drift=Buffer.concat([sql,Buffer.from('\n-- unreviewed registration drift\n')]);
  await writeFile(sqlPath,drift);
  await assert.rejects(snapshotAiSource(root),/registration enrollment migration source drift/);
  const coordinated=structuredClone(original);coordinated.orderedNewMigrations[index].sha256=hash(drift);
  await writeFile(manifestPath,JSON.stringify(coordinated));
  await assert.rejects(snapshotAiSource(root),/current migration manifest drift/);
  await writeFile(manifestPath,JSON.stringify(original));
  await rm(sqlPath);await assert.rejects(snapshotAiSource(root),/ENOENT/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('registration final plans and copied candidate refusals launch no external runner process',async(t)=>{
  const fixture=await isolatedFinalSourceFixture(t);
 const manifestPath='supabase/test-baselines/dashboard-free-tier-v1.manifest.json';
 const before=await readFile(manifestPath);
 let launched=0;
  const forbidden=async()=>{launched++;throw Error('external process forbidden for final plan or copied candidate refusal');};
  const boundaries={executeProcess:forbidden,executeNetwork:forbidden,executeGit:forbidden,allocatePort:forbidden,createRelay:forbidden};
  const plan=await runIsolatedSupabaseDbTests({...boundaries,argv:['--review-head','--require-final']});
  assert.equal(plan.status,'plan');
  assert.deepEqual(plan.manifest.orderedNewMigrations.find(row=>row.fileName===registrationPin.fileName),registrationPin);
  const copiedManifestPath=join(fixture.root,manifestPath);
  const candidate=JSON.parse(await readFile(copiedManifestPath,'utf8'));
  candidate.orderedNewMigrations.find(row=>row.fileName===registrationPin.fileName).status='candidate';
  await writeFile(copiedManifestPath,JSON.stringify(candidate));
 for(const argv of [
  ['--review-head','--require-final'],
  parityArguments({tests:AI_SQL_TESTS,probes:AI_PROBES}),
  ])await assert.rejects(fixture.run({...boundaries,root:fixture.root,argv}),
  /^Error: isolated_supabase_db_final_manifest_required$/);
 assert.equal(launched,0);
 assert.deepEqual(await readFile(manifestPath),before);
  await fixture.assertRealSourcesUnchanged();
});
test('both isolated workflows retain the exact full parity inventory including legacy approval occupancy',async()=>{
 assert.equal(AI_SQL_TESTS.length,102);
 assert.equal(AI_PROBES.length,23);
 assert.equal(AI_SQL_TESTS.filter(path=>path===legacyOccupancyTest).length,1);
 assert.equal(AI_SQL_TESTS[AI_SQL_TESTS.indexOf('supabase/tests/makeup_approval_collision_candidates_test.sql')+1],legacyOccupancyTest);
 for(const name of isolatedWorkflows){
  const parsed=parseIsolatedDbArguments(parityArguments(await workflowInventory(name)));
  assert.deepEqual(parsed.tests,AI_SQL_TESTS,name+' SQL inventory');
  assert.deepEqual(parsed.probes,AI_PROBES,name+' probe inventory');
 }
});
test('timetable validation is exactly pinned without changing earlier migration pins',async()=>{
 const current=await snapshotAiSource();
 const path='supabase/migrations/'+TIMETABLE_VALIDATION_MIGRATION.fileName;
 assert.equal(current.closure.find(row=>row.path===path)?.sha256,TIMETABLE_VALIDATION_MIGRATION.sha256);
 const root=await mkdtemp(join(tmpdir(),'ai-receipt-timetable-drift-'));
 try{
  const {AI_SOURCE_CLOSURE}=await import('../../scripts/lib/ai-producer-receipt.mjs');
  for(const file of [...AI_SOURCE_CLOSURE,...CURRENT_AI_MIGRATIONS.map(m=>'supabase/migrations/'+m.fileName)]){
   await mkdir(join(root,file,'..'),{recursive:true});await writeFile(join(root,file),await readFile(file));
  }
  const manifestPath=join(root,'supabase/test-baselines/dashboard-free-tier-v1.manifest.json');
  const original=JSON.parse(await readFile(manifestPath));
  for(const change of [entry=>({...entry,sha256:'0'.repeat(64)}),entry=>({...entry,status:'candidate'})]){
   await writeFile(manifestPath,JSON.stringify({...original,orderedNewMigrations:original.orderedNewMigrations.map(entry=>entry.fileName===TIMETABLE_VALIDATION_MIGRATION.fileName?change(entry):entry)}));
   await assert.rejects(snapshotAiSource(root),/current migration manifest drift/);
  }
  await writeFile(manifestPath,JSON.stringify(original));
  await writeFile(join(root,path),(await readFile(join(root,path),'utf8'))+'\n-- unreviewed drift\n');
  await assert.rejects(snapshotAiSource(root),/timetable validation migration source drift/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('close candidate pins reject each missing, reordered, draft or changed migration and preserve regression source closure',async()=>{
 const current=await snapshotAiSource();
 assert.equal(TIMETABLE_CLOSE_MIGRATIONS.length,5);
 assert.deepEqual(AI_SQL_TESTS.slice(AI_SQL_TESTS.indexOf('supabase/tests/timetable_validation_date_reuse_test.sql')+1,
  AI_SQL_TESTS.indexOf('supabase/tests/timetable_validation_date_reuse_test.sql')+5),timetableCloseTests);
 for(const path of timetableCloseTests){
  assert.equal(current.closure.find(row=>row.path===path)?.sha256,hash(await readFile(path)));
 }
 for(const pin of TIMETABLE_CLOSE_MIGRATIONS){
  assert.equal(current.closure.find(row=>row.path==='supabase/migrations/'+pin.fileName)?.sha256,pin.sha256);
 }
 const root=await mkdtemp(join(tmpdir(),'ai-receipt-close-drift-'));
 try{
  const {AI_SOURCE_CLOSURE}=await import('../../scripts/lib/ai-producer-receipt.mjs');
  for(const path of [...AI_SOURCE_CLOSURE,...CURRENT_AI_MIGRATIONS.map(m=>'supabase/migrations/'+m.fileName)]){
   await mkdir(join(root,path,'..'),{recursive:true});await writeFile(join(root,path),await readFile(path));
  }
  const manifestPath=join(root,'supabase/test-baselines/dashboard-free-tier-v1.manifest.json');
  const original=JSON.parse(await readFile(manifestPath));
  assert.deepEqual(original.orderedNewMigrations.filter(row=>TIMETABLE_CLOSE_MIGRATIONS.some(pin=>pin.fileName===row.fileName)),TIMETABLE_CLOSE_MIGRATIONS);
  for(const pin of TIMETABLE_CLOSE_MIGRATIONS){
   for(const mutate of [
    (rows,i)=>rows.splice(i,1),
    (rows,i)=>rows[i].status='draft',
    (rows,i)=>rows[i].sha256='0'.repeat(64),
    (rows,i)=>[rows[i-1],rows[i]]=[rows[i],rows[i-1]],
    (rows,i)=>rows.push({...rows[i]}),
   ]){
    const changed=structuredClone(original),rows=changed.orderedNewMigrations;
    mutate(rows,rows.findIndex(row=>row.fileName===pin.fileName));
    await writeFile(manifestPath,JSON.stringify(changed));
    await assert.rejects(snapshotAiSource(root),/(?:AI canonical manifest inventory|current migration manifest drift)/);
   }
   await writeFile(manifestPath,JSON.stringify(original));
   const path=join(root,'supabase/migrations',pin.fileName),bytes=await readFile(path);
   const altered=Buffer.concat([bytes,Buffer.from('\n-- unreviewed drift\n')]);
   await writeFile(path,altered);
   await assert.rejects(snapshotAiSource(root),/timetable close migration source drift/);
   const changed=structuredClone(original);
   changed.orderedNewMigrations.find(row=>row.fileName===pin.fileName).sha256=hash(altered);
   await writeFile(manifestPath,JSON.stringify(changed));
   await assert.rejects(snapshotAiSource(root),/current migration manifest drift/);
   await writeFile(manifestPath,JSON.stringify(original));
   await rm(path);await assert.rejects(snapshotAiSource(root),/ENOENT/);
   await writeFile(path,bytes);
  }
 }finally{await rm(root,{recursive:true,force:true});}
});
test('full parity guard rejects missing, duplicate and reordered workflow selectors before process launch',async(t)=>{
 const fixture=await isolatedFinalSourceFixture(t);
 let launched=0;
 const executeProcess=async()=>{launched++;throw new Error('process launch forbidden in inventory regression');};
 for(const name of isolatedWorkflows){
  const inventory=await workflowInventory(name);
  const swapFirst=list=>[list[1],list[0],...list.slice(2)];
  for(const [label,changed] of [
   ['missing legacy occupancy',{...inventory,tests:inventory.tests.filter(path=>path!==legacyOccupancyTest)}],
   ...timetableCloseTests.map(test=>['missing '+test,{...inventory,tests:inventory.tests.filter(path=>path!==test)}]),
   ['missing batch SQL',{...inventory,tests:inventory.tests.filter(path=>path!=='supabase/tests/timetable_plan_batch_save_test.sql')}],
   ['missing batch DTO',{...inventory,probes:inventory.probes.filter(path=>path!=='tests/probe-timetable-batch-save-dto.mjs')}],
   ['missing batch concurrency',{...inventory,probes:inventory.probes.filter(path=>path!=='tests/probe-timetable-batch-save-concurrency.mjs')}],
   ['duplicate batch SQL',{...inventory,tests:[...inventory.tests,'supabase/tests/timetable_plan_batch_save_test.sql']}],
   ['duplicate batch probe',{...inventory,probes:[...inventory.probes,'tests/probe-timetable-batch-save-concurrency.mjs']}],
   ['reordered batch SQL',{...inventory,tests:[...inventory.tests.filter(path=>path!=='supabase/tests/timetable_plan_batch_save_test.sql'),'supabase/tests/timetable_plan_batch_save_test.sql']}],
   ['reordered batch DTO',{...inventory,probes:[...inventory.probes.filter(path=>path!=='tests/probe-timetable-batch-save-dto.mjs'),'tests/probe-timetable-batch-save-dto.mjs']}],
   ['duplicate SQL',{...inventory,tests:[...inventory.tests,legacyOccupancyTest]}],
   ['reordered SQL',{...inventory,tests:swapFirst(inventory.tests)}],
   ['missing probe',{...inventory,probes:inventory.probes.slice(1)}],
   ['duplicate probe',{...inventory,probes:[...inventory.probes,inventory.probes[0]]}],
   ['reordered probes',{...inventory,probes:swapFirst(inventory.probes)}],
  ]){
   await assert.rejects(fixture.run({root:fixture.root,argv:parityArguments(changed),executeProcess,executeNetwork:executeProcess,executeGit:executeProcess}),
    /isolated_ai_parity_full_run_required/,name+' '+label);
   assert.equal(launched,0,name+' '+label+' must stop before process launch');
  }
 }
 assert.deepEqual(await readFile(join(repositoryRoot,'supabase/test-baselines/dashboard-free-tier-v1.manifest.json')),fixture.realManifestBytes);
 await fixture.assertRealSourcesUnchanged();
});
test('atomic timetable migration is pinned without accepting prior-source or new batch drift',async()=>{
 const {AI_SOURCE_CLOSURE,TIMETABLE_BATCH_SAVE_MIGRATION}=await import('../../scripts/lib/ai-producer-receipt.mjs');
 const current=await snapshotAiSource();
 const path='supabase/migrations/'+TIMETABLE_BATCH_SAVE_MIGRATION.fileName;
 assert.equal(current.closure.find(row=>row.path===path)?.sha256,TIMETABLE_BATCH_SAVE_MIGRATION.sha256);
 const root=await mkdtemp(join(tmpdir(),'ai-receipt-batch-drift-'));
 try{
  for(const file of [...AI_SOURCE_CLOSURE,...CURRENT_AI_MIGRATIONS.map(m=>'supabase/migrations/'+m.fileName)]){
   await mkdir(join(root,file,'..'),{recursive:true});await writeFile(join(root,file),await readFile(file));
  }
  const manifestPath=join(root,'supabase/test-baselines/dashboard-free-tier-v1.manifest.json');
  const original=JSON.parse(await readFile(manifestPath));
  for(const change of [entry=>({...entry,sha256:'0'.repeat(64)}),entry=>({...entry,status:'candidate'})]){
   await writeFile(manifestPath,JSON.stringify({...original,orderedNewMigrations:original.orderedNewMigrations.map(entry=>entry.fileName===TIMETABLE_BATCH_SAVE_MIGRATION.fileName?change(entry):entry)}));
   await assert.rejects(snapshotAiSource(root),/current migration manifest drift/);
  }
  await writeFile(manifestPath,JSON.stringify(original));
  await writeFile(join(root,path),(await readFile(join(root,path),'utf8'))+'\n-- unreviewed drift\n');
  await assert.rejects(snapshotAiSource(root),/timetable batch migration source drift/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('atomic calendar move adds one exact final source pin without changing the AI receipt migration protocol',async()=>{
 assert.deepEqual(receiptProtocol.ACADEMIC_CALENDAR_MOVE_MIGRATION,calendarMovePin);
 assert.ok(Object.isFrozen(receiptProtocol.ACADEMIC_CALENDAR_MOVE_MIGRATION));
 const source=await snapshotAiSource();
 const path='supabase/migrations/'+calendarMovePin.fileName;
 assert.equal(receiptProtocol.AI_SOURCE_CLOSURE.filter(file=>file===path).length,1);
 assert.equal(source.closure.find(row=>row.path===path)?.sha256,calendarMovePin.sha256);
 assert.deepEqual(source.migrations,CURRENT_AI_MIGRATIONS);
 assert.equal(CURRENT_AI_MIGRATIONS.length,11);
 const manifest=JSON.parse(await readFile('supabase/test-baselines/dashboard-free-tier-v1.manifest.json'));
 assert.equal(manifest.orderedNewMigrations.length,175);
 assert.deepEqual(manifest.orderedNewMigrations.at(-1),calendarMovePin);
});
test('atomic calendar move pin rejects missing, duplicate, reordered, unapproved and coordinated source drift',async()=>{
 const current=await snapshotAiSource();
 const root=await mkdtemp(join(tmpdir(),'ai-receipt-calendar-move-drift-'));
 try{
  for(const file of [...receiptProtocol.AI_SOURCE_CLOSURE,...CURRENT_AI_MIGRATIONS.map(m=>'supabase/migrations/'+m.fileName)]){
   await mkdir(join(root,file,'..'),{recursive:true});await writeFile(join(root,file),await readFile(file));
  }
  const manifestPath=join(root,'supabase/test-baselines/dashboard-free-tier-v1.manifest.json');
  const original=JSON.parse(await readFile(manifestPath));
  const index=original.orderedNewMigrations.findIndex(row=>row.fileName===calendarMovePin.fileName);
  assert.equal(index,174);
  for(const [label,mutate] of [
   ['missing',rows=>rows.splice(index,1)],
   ['duplicate appended',rows=>rows.push({...rows[index]})],
   ['same-length duplicate',rows=>rows[index]={...rows[index-1]}],
   ['reordered',rows=>[rows[index-1],rows[index]]=[rows[index],rows[index-1]]],
   ['hash drift',rows=>rows[index].sha256='0'.repeat(64)],
   ['candidate status',rows=>rows[index].status='candidate'],
   ['unknown status',rows=>rows[index].status='draft'],
   ['similar unapproved name',rows=>rows[index].fileName='20261019082218_academic_calendar_move_atomic_v2.sql'],
   ['extra unapproved migration',rows=>rows.push({...rows[index],fileName:'20990101000000_unreviewed_calendar.sql'})],
  ]){
   const changed=structuredClone(original);mutate(changed.orderedNewMigrations);
   await writeFile(manifestPath,JSON.stringify(changed));
   await assert.rejects(snapshotAiSource(root),/(?:AI canonical manifest inventory|current migration manifest drift)/,label);
  }
  await writeFile(manifestPath,JSON.stringify(original));
  const sqlPath=join(root,'supabase/migrations/'+calendarMovePin.fileName);
  const sql=await readFile(sqlPath),drift=Buffer.concat([sql,Buffer.from('\n-- unapproved source drift\n')]);
  await writeFile(sqlPath,drift);
  await assert.rejects(snapshotAiSource(root),/academic calendar move migration source drift/);
  const coordinated=structuredClone(original);coordinated.orderedNewMigrations[index].sha256=hash(drift);
  await writeFile(manifestPath,JSON.stringify(coordinated));
  await assert.rejects(snapshotAiSource(root),/current migration manifest drift/);
  await writeFile(manifestPath,JSON.stringify(original));
  await rm(sqlPath);await assert.rejects(snapshotAiSource(root),/ENOENT/);
  assert.deepEqual(await snapshotAiSource(),current,'negative fixtures never modify the real pinned source');
 }finally{await rm(root,{recursive:true,force:true});}
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
 assert.equal(CURRENT_AI_MIGRATIONS.length,11);
 assert.deepEqual(CURRENT_AI_MIGRATIONS.slice(0,6),ACCEPTED_AI_MIGRATIONS);
 const root=await mkdtemp(join(tmpdir(),'ai-receipt-migration-drift-'));
 try{
  const {AI_SOURCE_CLOSURE}=await import('../../scripts/lib/ai-producer-receipt.mjs');
  for(const path of [...AI_SOURCE_CLOSURE,...CURRENT_AI_MIGRATIONS.map(m=>'supabase/migrations/'+m.fileName)]){
   await mkdir(join(root,path,'..'),{recursive:true});await writeFile(join(root,path),await readFile(path));
  }
  const manifestPath=join(root,'supabase/test-baselines/dashboard-free-tier-v1.manifest.json');
  const original=JSON.parse(await readFile(manifestPath));
  assert.equal(original.orderedNewMigrations.length,175);
  const reviewedLegacy=original.orderedNewMigrations.filter(m=>!CURRENT_WITHDRAWAL_MIGRATIONS.some(pin=>pin.fileName===m.fileName) && ![...CURRENT_PR126_MIGRATIONS,...TIMETABLE_CLOSE_MIGRATIONS].some(pin=>pin.fileName===m.fileName) && m.fileName!==THREAD_REPLY_MIGRATION.fileName && m.fileName!==NONEXPIRING_CHAT_MIGRATION.fileName && m.fileName!==TIMETABLE_VALIDATION_MIGRATION.fileName && m.fileName!==registrationPin.fileName && m.fileName!==TIMETABLE_BATCH_SAVE_MIGRATION.fileName && m.fileName!==calendarMovePin.fileName);
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
  const neverPath=join(root,'supabase/migrations/'+NONEXPIRING_CHAT_MIGRATION.fileName),neverBytes=await readFile(neverPath);
  const alteredNever=Buffer.concat([neverBytes,Buffer.from('\n-- drift\n')]);
  await writeFile(neverPath,alteredNever);await assert.rejects(snapshotAiSource(root),/accepted migration source drift/);
  const neverManifest=structuredClone(original);neverManifest.orderedNewMigrations.find(row=>row.fileName===NONEXPIRING_CHAT_MIGRATION.fileName).sha256=hash(alteredNever);
  await writeFile(manifestPath,JSON.stringify(neverManifest));await assert.rejects(snapshotAiSource(root),/current migration manifest drift/);
  await writeFile(manifestPath,JSON.stringify(original));await rm(neverPath);await assert.rejects(snapshotAiSource(root),/ENOENT/);await writeFile(neverPath,neverBytes);
  const newest=join(root,'supabase/migrations/'+CURRENT_AI_MIGRATIONS[6].fileName);
  await writeFile(newest,(await readFile(newest))+'\n-- drift\n');
  await assert.rejects(snapshotAiSource(root),/accepted migration source drift/);
  await rm(newest);await assert.rejects(snapshotAiSource(root),/ENOENT/);
 }finally{await rm(root,{recursive:true,force:true});}
});


test('reviewed withdrawal pins admit the final ordered chain and reject each manifest/source drift',async()=>{
 assert.equal(CURRENT_WITHDRAWAL_MIGRATIONS.length,6);
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

test('reviewed PR126 pins admit the final ordered chain and reject each manifest/source drift',async()=>{
 assert.equal(CURRENT_PR126_MIGRATIONS.length,2);
 const current=await snapshotAiSource();
 assert.deepEqual(current.migrations,CURRENT_AI_MIGRATIONS,'AI receipt migration protocol stays unchanged');
 for(const pin of CURRENT_PR126_MIGRATIONS){
  const path='supabase/migrations/'+pin.fileName;
  assert.equal(current.closure.find(row=>row.path===path)?.sha256,pin.sha256,'PR126 SQL is bound into the receipt closure');
 }
 const root=await mkdtemp(join(tmpdir(),'ai-receipt-PR126-drift-'));
 try{
  const {AI_SOURCE_CLOSURE}=await import('../../scripts/lib/ai-producer-receipt.mjs');
  for(const path of [...AI_SOURCE_CLOSURE,...CURRENT_AI_MIGRATIONS.map(m=>'supabase/migrations/'+m.fileName)]){
   await mkdir(join(root,path,'..'),{recursive:true});await writeFile(join(root,path),await readFile(path));
  }
  const manifestPath=join(root,'supabase/test-baselines/dashboard-free-tier-v1.manifest.json');
  const original=JSON.parse(await readFile(manifestPath));
  for(const [pinIndex,pin]of CURRENT_PR126_MIGRATIONS.entries()){
   assert.deepEqual(original.orderedNewMigrations.find(row=>row.fileName===pin.fileName),pin,'exact reviewed PR126 manifest entry');
   const index=original.orderedNewMigrations.findIndex(row=>row.fileName===pin.fileName);
   assert.ok(index>0);
   for(const [label,mutate]of [
    ['missing',rows=>rows.splice(index,1)],
    ['duplicate appended',rows=>rows.push({...rows[index]})],
    ['same-length duplicate',rows=>rows[index]={...CURRENT_PR126_MIGRATIONS[(pinIndex+1)%CURRENT_PR126_MIGRATIONS.length]}],
    ['reordered',rows=>[rows[index-1],rows[index]]=[rows[index],rows[index-1]]],
    ['hash drift',rows=>rows[index].sha256='0'.repeat(64)],
    ['status drift',rows=>rows[index].status='draft'],
    ['filename drift',rows=>rows[index].fileName='20990101000000_unreviewed_PR126.sql'],
   ]){
    const changed=structuredClone(original);mutate(changed.orderedNewMigrations);
    await writeFile(manifestPath,JSON.stringify(changed));
    await assert.rejects(snapshotAiSource(root),/(?:AI canonical manifest inventory|current migration manifest drift)/,pin.fileName+' '+label);
   }
   await writeFile(manifestPath,JSON.stringify(original));
   const sqlPath=join(root,'supabase/migrations/'+pin.fileName),sql=await readFile(sqlPath);
   const drift=Buffer.concat([sql,Buffer.from('\n-- source drift\n')]);
   await writeFile(sqlPath,drift);
   await assert.rejects(snapshotAiSource(root),/reviewed PR126 migration source drift/,pin.fileName+' source content drift');
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
 const fixture=await isolatedFinalSourceFixture(t);
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
 const run=fixture.run({root:fixture.root,argv:parityArguments({tests:AI_SQL_TESTS,probes:AI_PROBES}),tempDirectory,
  allocatePort:(()=>{let port=56700;return()=>++port;})(),executeNetwork,
  executeProcess:invocation=>invocation.command==='docker'&&invocation.args.at(-1)===postdeploy?output('t'):executeProcess(invocation),log:()=>{}});
 await assert.rejects(run,/isolated_supabase_db_probe_failed/);
 assert.deepEqual(probes,AI_PROBES);assert.equal(consumers,0);assert.equal(checkedReceiptAbsence,true);
 assert.deepEqual(await readFile(join(repositoryRoot,'supabase/test-baselines/dashboard-free-tier-v1.manifest.json')),fixture.realManifestBytes);
 await fixture.assertRealSourcesUnchanged();
});
