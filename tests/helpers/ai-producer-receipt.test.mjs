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
const calendarMovePin={fileName:'20261019100046_academic_calendar_move_atomic.sql',status:'final',sha256:'4fd992887e81cfb23e9e3585ee4a63eda82de8bb6bdbb21b5392501bcb5e83de'};
const completedFailedRetestPin={fileName:'20261020001626_word_retest_completed_failed_retry.sql',status:'final',sha256:'7b964368c629ac92e1655513783147a985b9dc659f818c1148e765eb11dfa35b'};
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
 assert.equal(manifest.orderedNewMigrations.length,196);
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
test('isolated workflows retain main108/27 and exact PR113/28 inventories',async()=>{
 assert.equal(AI_SQL_TESTS.length,108);
 assert.deepEqual(receiptProtocol.PR_AI_SQL_TESTS,[...AI_SQL_TESTS.flatMap(path=>path===legacyOccupancyTest?[path,'supabase/tests/makeup_legacy_pair_adoption_test.sql']:[path]),'supabase/tests/dashboard_audit_predecessor_lookup_test.sql','supabase/tests/timetable_date_override_native_reader_test.sql','supabase/tests/legacy_context_adoption_reuse_test.sql','supabase/tests/legacy_adoption_pair_reuse_test.sql']);
 assert.equal(receiptProtocol.PR_AI_SQL_TESTS.length,113);
 assert.equal(receiptProtocol.PR_AI_PROBES.length,28);
 assert.ok(Object.isFrozen(receiptProtocol.PR_AI_PROBES));
 assert.deepEqual(receiptProtocol.PR_AI_PROBES,AI_PROBES.flatMap(path=>path==='tests/probe-makeup-approval-collision-dto.mjs'?['tests/probe-makeup-legacy-adoption-concurrency.mjs',path]:[path]));
 assert.equal(receiptProtocol.approvedAiProbesForSqlInventory(AI_SQL_TESTS),AI_PROBES);
 assert.equal(receiptProtocol.approvedAiProbesForSqlInventory(receiptProtocol.PR_AI_SQL_TESTS),receiptProtocol.PR_AI_PROBES);
 for(const value of [null,[],[...AI_SQL_TESTS].reverse(),[...AI_SQL_TESTS,'supabase/tests/unreviewed.sql']])assert.equal(receiptProtocol.approvedAiProbesForSqlInventory(value),null);
 assert.ok(Object.isFrozen(receiptProtocol.PR_AI_SQL_TESTS));
 assert.equal(AI_PROBES.length,27);
 assert.equal(AI_SQL_TESTS.filter(path=>path===legacyOccupancyTest).length,1);
 assert.equal(AI_SQL_TESTS[AI_SQL_TESTS.indexOf('supabase/tests/makeup_approval_collision_candidates_test.sql')+1],legacyOccupancyTest);
 for(const name of isolatedWorkflows){
  const parsed=parseIsolatedDbArguments(parityArguments(await workflowInventory(name)));
  assert.deepEqual(parsed.tests,name==='supabase-sql-review.yml'?receiptProtocol.PR_AI_SQL_TESTS:AI_SQL_TESTS,name+' SQL inventory');
  assert.deepEqual(parsed.probes,name==='supabase-sql-review.yml'?receiptProtocol.PR_AI_PROBES:AI_PROBES,name+' probe inventory');
 }
});
test('runner accepts only the two complete approved SQL inventories before isolated process launch',async(t)=>{
 const fixture=await isolatedFinalSourceFixture(t);
 const tempDirectory=await mkdtemp(join(tmpdir(),'ai-audit-inventory-boundary-'));
 t.after(()=>rm(tempDirectory,{recursive:true,force:true}));
 let launched=0,reachedRuntime=0;
 const forbidden=async()=>{launched++;throw Error('external process forbidden in inventory regression');};
 const boundaries={root:fixture.root,tempDirectory,executeProcess:forbidden,executeNetwork:forbidden,executeGit:forbidden,createRelay:forbidden,
  allocatePort:()=>{reachedRuntime++;throw Error('approved_inventory_runtime_boundary');}};
 for(const name of isolatedWorkflows){
  await assert.rejects(fixture.run({...boundaries,argv:parityArguments(await workflowInventory(name))}),/^Error: approved_inventory_runtime_boundary$/);
 }
 assert.equal(reachedRuntime,2,'both exact workflow inventories pass registration and source snapshots');
 const inventory=await workflowInventory('supabase-sql-review.yml'),audit=inventory.tests.at(-1);
 const swapFirst=list=>[list[1],list[0],...list.slice(2)];
 for(const changed of [
  {...inventory,tests:inventory.tests.slice(1)},
  {...inventory,tests:[...inventory.tests,audit]},
  {...inventory,tests:[...AI_SQL_TESTS,'supabase/tests/unreviewed_test.sql']},
  {...inventory,tests:[...inventory.tests,'supabase/tests/unreviewed_test.sql']},
  {...inventory,tests:[audit,...AI_SQL_TESTS]},
  {...inventory,tests:swapFirst(inventory.tests)},
  {...inventory,probes:inventory.probes.slice(1)},
  {...inventory,probes:[...inventory.probes,inventory.probes[0]]},
  {...inventory,probes:swapFirst(inventory.probes)},
  {...inventory,probes:AI_PROBES},
  {tests:AI_SQL_TESTS,probes:receiptProtocol.PR_AI_PROBES},
 ])await assert.rejects(fixture.run({...boundaries,argv:parityArguments(changed)}),/^Error: isolated_ai_parity_full_run_required$/);
 const argv=parityArguments(inventory);
 for(const flag of ['--lint','--require-final','--postdeploy-contract','--transactional-preflight','--verify-local-ledger']){
  await assert.rejects(fixture.run({...boundaries,argv:argv.filter(value=>value!==flag)}),/^Error: isolated_ai_parity_full_run_required$/);
 }
 await assert.rejects(fixture.run({...boundaries,argv,retainTempRoot:true}),/^Error: isolated_ai_parity_full_run_required$/);
 assert.equal(reachedRuntime,2,'invalid registrations stop before runtime allocation');
 assert.equal(launched,0);
 await fixture.assertRealSourcesUnchanged();
});
test('PR audit receipts and consumers bind the exact requested inventory without accepting arbitrary extras',async(t)=>{
 const source=await snapshotAiSource(),raw=Buffer.from('{"negativeProtocolFixture":true}'),now=Date.now();
 const identity={runId:'a'.repeat(32),nonce:'b'.repeat(64),startedAt:now-1,captureStartedAt:now-1};
 const receipt={version:1,...identity,finishedAt:now,before:source,after:source,migrations:CURRENT_AI_MIGRATIONS,
  credentialPrefix:{...AI_CREDENTIAL_PREFIX,committed:true},probes:AI_PROBES,
  captures:Object.fromEntries(Object.entries(AI_PRODUCERS).map(([name,p])=>[name,{producer:p.path,file:p.file,sourceSha256:source.closure.find(v=>v.path===p.path).sha256,sha256:hash(raw),bytes:raw.length}]))};
 const directory=await mkdtemp(join(tmpdir(),'ai-audit-receipt-inventory-'));
 t.after(()=>rm(directory,{recursive:true,force:true}));
 const receiptPath=join(directory,'receipt.json');
 for(const producer of Object.values(AI_PRODUCERS))await writeFile(join(directory,producer.file),raw,{mode:0o600});
 const env={TASK_AI_RECEIPT:receiptPath,TASK_AI_CAPTURE_DIRECTORY:directory,TASK_AI_RUN_ID:identity.runId,TASK_AI_RUN_NONCE:identity.nonce,
  TASK_AI_STARTED_AT:String(identity.startedAt),TASK_AI_CAPTURE_STARTED_AT:String(identity.captureStartedAt)};
 for(const sqlTests of [AI_SQL_TESTS,receiptProtocol.PR_AI_SQL_TESTS]){
  const current={...receipt,sqlTests,probes:receiptProtocol.approvedAiProbesForSqlInventory(sqlTests)},expected={...identity,sqlTests};
  assert.equal(validateAiReceipt(current,{expected,source,raw,identity:'http',now}),true);
  await writeFile(receiptPath,JSON.stringify(current),{mode:0o600});
  assert.deepEqual(await receiptProtocol.readCurrentAiCapture('http',{...env,TASK_AI_SQL_TESTS:JSON.stringify(sqlTests)}),{negativeProtocolFixture:true});
  const other=sqlTests===AI_SQL_TESTS?receiptProtocol.PR_AI_SQL_TESTS:AI_SQL_TESTS;
  assert.throws(()=>validateAiReceipt({...current,probes:receiptProtocol.approvedAiProbesForSqlInventory(other)},{expected,source,raw,identity:'http',now}),/receipt probe inventory/);
  assert.throws(()=>validateAiReceipt({...current,sqlTests:other},{expected,source,raw,identity:'http',now}),/receipt SQL inventory/);
  await assert.rejects(receiptProtocol.readCurrentAiCapture('http',{...env,TASK_AI_SQL_TESTS:JSON.stringify(other)}),/receipt SQL inventory/);
 }
 await assert.rejects(receiptProtocol.readCurrentAiCapture('http',env),/receipt SQL inventory/,'PR receipts require an explicit exact PR inventory expectation');
 for(const sqlTests of [
  [...receiptProtocol.PR_AI_SQL_TESTS,'supabase/tests/unreviewed_test.sql'],
  [...AI_SQL_TESTS,'supabase/tests/unreviewed_test.sql'],
  [...receiptProtocol.PR_AI_SQL_TESTS,receiptProtocol.PR_AI_SQL_TESTS.at(-1)],
  [...receiptProtocol.PR_AI_SQL_TESTS].reverse(),
  AI_SQL_TESTS.slice(1),null,
 ])assert.throws(()=>validateAiReceipt({...receipt,sqlTests},{expected:{...identity,sqlTests},source,raw,identity:'http',now}),/receipt expected SQL inventory/);
 const audit='supabase/tests/dashboard_audit_predecessor_lookup_test.sql';
 assert.equal(source.closure.filter(row=>row.path===audit).length,1);
 assert.equal(source.closure.find(row=>row.path===audit).sha256,hash(await readFile(join(repositoryRoot,audit))));
});
test('optional classroom final pin preserves all earlier migrations and rejects manifest or source drift',async()=>{
 const pin={fileName:'20261020134458_timetable_optional_classroom_occupancy.sql',status:'final',sha256:'31cd689964a52b5f084a8a167cb41a0b61b12403a88d4dff7b20d9106e29a8b6'};
 assert.deepEqual(receiptProtocol.OPTIONAL_CLASSROOM_MIGRATION,pin);
 assert.ok(Object.isFrozen(receiptProtocol.OPTIONAL_CLASSROOM_MIGRATION));
 const source=await snapshotAiSource(),path='supabase/migrations/'+pin.fileName;
 assert.equal(source.closure.find(row=>row.path===path)?.sha256,pin.sha256);
 assert.equal(source.closure.filter(row=>row.path==='tests/probe-timetable-nullable-room-concurrency.mjs').length,1);
 const root=await mkdtemp(join(tmpdir(),'ai-receipt-optional-room-drift-'));
 try{
  for(const file of [...receiptProtocol.AI_SOURCE_CLOSURE,...CURRENT_AI_MIGRATIONS.map(m=>'supabase/migrations/'+m.fileName)]){
   await mkdir(join(root,file,'..'),{recursive:true});await writeFile(join(root,file),await readFile(file));
  }
  const manifestPath=join(root,'supabase/test-baselines/dashboard-free-tier-v1.manifest.json');
  const original=JSON.parse(await readFile(manifestPath));
  assert.equal(original.orderedNewMigrations.length,196);
  assert.deepEqual(original.orderedNewMigrations[176],pin);
  assert.equal(hash(JSON.stringify(original.orderedNewMigrations.slice(0,176))),'0e6ea185605f5e3b060459f5c334988d8643b3c42a3b5e59d5a5e067af246b4f');
  for(const mutate of [
   rows=>rows.splice(176,1),
   rows=>rows.push({...pin}),
   rows=>rows[176].status='candidate',
   rows=>rows[176].sha256='0'.repeat(64),
   rows=>[rows[175],rows[176]]=[rows[176],rows[175]],
  ]){
   const candidate=structuredClone(original);mutate(candidate.orderedNewMigrations);
   await writeFile(manifestPath,JSON.stringify(candidate));
   await assert.rejects(snapshotAiSource(root),/canonical manifest inventory|current migration manifest drift/);
  }
  await writeFile(manifestPath,JSON.stringify(original));
  await writeFile(join(root,path),(await readFile(path,'utf8'))+'\n-- unreviewed drift\n');
  await assert.rejects(snapshotAiSource(root),/optional classroom migration source drift/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('class lesson input policy extends the exact final inventory and preserves the earlier 177 migrations',async()=>{
 const pin={fileName:'20261021155723_class_lesson_input_policy.sql',status:'final',sha256:'ffd1a50c7c08afbf1e71c65449d29565f93275b3465ec894c3b56ab1e4a65e06'};
 assert.deepEqual(receiptProtocol.CLASS_LESSON_INPUT_MIGRATION,pin);
 assert.ok(Object.isFrozen(receiptProtocol.CLASS_LESSON_INPUT_MIGRATION));
 const current=await snapshotAiSource();
 const path='supabase/migrations/'+pin.fileName;
 assert.equal(receiptProtocol.AI_SOURCE_CLOSURE.filter(file=>file===path).length,1);
 assert.equal(current.closure.find(row=>row.path===path)?.sha256,pin.sha256);
 const tests=['supabase/tests/class_lesson_input_policy_test.sql','supabase/tests/class_basic_info_input_policy_test.sql','supabase/tests/class_lesson_input_save_performance_test.sql'];
 const after=AI_SQL_TESTS.indexOf('supabase/tests/timetable_nullable_classroom_test.sql')+1;
 assert.deepEqual(AI_SQL_TESTS.slice(after,after+3),tests);
 for(const test of tests){
  assert.equal(AI_SQL_TESTS.filter(file=>file===test).length,1);
  assert.equal(current.closure.find(row=>row.path===test)?.sha256,hash(await readFile(test)));
 }
 const root=await mkdtemp(join(tmpdir(),'ai-receipt-lesson-input-drift-'));
 try{
  for(const file of [...receiptProtocol.AI_SOURCE_CLOSURE,...CURRENT_AI_MIGRATIONS.map(m=>'supabase/migrations/'+m.fileName)]){
   await mkdir(join(root,file,'..'),{recursive:true});await writeFile(join(root,file),await readFile(file));
  }
  const manifestPath=join(root,'supabase/test-baselines/dashboard-free-tier-v1.manifest.json');
  const original=JSON.parse(await readFile(manifestPath));
  assert.equal(original.orderedNewMigrations.length,196);
  assert.deepEqual(original.orderedNewMigrations[177],pin);
  assert.equal(hash(JSON.stringify(original.orderedNewMigrations.slice(0,177))),'95487023ee3748b68239fd40371a150c56fafc6b5dc20311aa79f4e0dd496d1a');
  for(const [label,mutate] of [
   ['missing',rows=>rows.splice(rows.findIndex(row=>row.fileName===pin.fileName),1)],
   ['duplicate',rows=>rows.push({...pin})],
   ['same-length duplicate',rows=>rows[177]={...rows[176]}],
   ['reordered',rows=>[rows[176],rows[177]]=[rows[177],rows[176]]],
   ['candidate status',rows=>rows[177].status='candidate'],
   ['hash drift',rows=>rows[177].sha256='0'.repeat(64)],
   ['similar unapproved name',rows=>rows[177].fileName='20261021155723_class_lesson_input_policy_v2.sql'],
  ]){
   const changed=structuredClone(original);mutate(changed.orderedNewMigrations);
   await writeFile(manifestPath,JSON.stringify(changed));
   await assert.rejects(snapshotAiSource(root),/canonical manifest inventory|current migration manifest drift/,label);
  }
  await writeFile(manifestPath,JSON.stringify(original));
  const sqlPath=join(root,path),sql=await readFile(sqlPath),drift=Buffer.concat([sql,Buffer.from('\n-- unreviewed drift\n')]);
  await writeFile(sqlPath,drift);
  await assert.rejects(snapshotAiSource(root),/class lesson input migration source drift/);
  const coordinated=structuredClone(original);coordinated.orderedNewMigrations[177].sha256=hash(drift);
  await writeFile(manifestPath,JSON.stringify(coordinated));
  await assert.rejects(snapshotAiSource(root),/current migration manifest drift/);
  await writeFile(manifestPath,JSON.stringify(original));
  await rm(sqlPath);await assert.rejects(snapshotAiSource(root),/ENOENT/);
  assert.deepEqual(await snapshotAiSource(),current,'negative fixtures never modify the real source');
 }finally{await rm(root,{recursive:true,force:true});}
});
test('class basic info input policy extends the exact final inventory and preserves the earlier 178 migrations',async()=>{
 const pin={fileName:'20261022015000_class_basic_info_input_policy.sql',status:'final',sha256:'ffaca553cb8905e58f21d83960150646b6eb9cfc58cc58dc01fb4c48d18e0e9b'};
 assert.deepEqual(receiptProtocol.CLASS_BASIC_INFO_INPUT_MIGRATION,pin);
 assert.ok(Object.isFrozen(receiptProtocol.CLASS_BASIC_INFO_INPUT_MIGRATION));
 const current=await snapshotAiSource();
 const path='supabase/migrations/'+pin.fileName;
 assert.equal(receiptProtocol.AI_SOURCE_CLOSURE.filter(file=>file===path).length,1);
 assert.equal(current.closure.find(row=>row.path===path)?.sha256,pin.sha256);
 const tests=['supabase/tests/class_lesson_input_policy_test.sql','supabase/tests/class_basic_info_input_policy_test.sql','supabase/tests/class_lesson_input_save_performance_test.sql'];
 const after=AI_SQL_TESTS.indexOf('supabase/tests/timetable_nullable_classroom_test.sql')+1;
 assert.deepEqual(AI_SQL_TESTS.slice(after,after+3),tests);
 for(const test of tests){
  assert.equal(AI_SQL_TESTS.filter(file=>file===test).length,1);
  assert.equal(current.closure.find(row=>row.path===test)?.sha256,hash(await readFile(test)));
 }
 const root=await mkdtemp(join(tmpdir(),'ai-receipt-basic-info-input-drift-'));
 try{
  for(const file of [...receiptProtocol.AI_SOURCE_CLOSURE,...CURRENT_AI_MIGRATIONS.map(m=>'supabase/migrations/'+m.fileName)]){
   await mkdir(join(root,file,'..'),{recursive:true});await writeFile(join(root,file),await readFile(file));
  }
  const manifestPath=join(root,'supabase/test-baselines/dashboard-free-tier-v1.manifest.json');
  const original=JSON.parse(await readFile(manifestPath));
  assert.equal(original.orderedNewMigrations.length,196);
  assert.deepEqual(original.orderedNewMigrations[178],pin);
  assert.equal(hash(JSON.stringify(original.orderedNewMigrations.slice(0,178))),'63b94d551b020f0118c3612f04acf34bae9057d9979537016479be3ea1b4af90');
  for(const [label,mutate] of [
   ['missing',rows=>rows.splice(rows.findIndex(row=>row.fileName===pin.fileName),1)],
   ['duplicate',rows=>rows.push({...pin})],
   ['same-length duplicate',rows=>rows[178]={...rows[177]}],
   ['reordered',rows=>[rows[177],rows[178]]=[rows[178],rows[177]]],
   ['candidate status',rows=>rows[178].status='candidate'],
   ['hash drift',rows=>rows[178].sha256='0'.repeat(64)],
   ['similar unapproved name',rows=>rows[178].fileName='20261022015000_class_basic_info_input_policy_v2.sql'],
  ]){
   const changed=structuredClone(original);mutate(changed.orderedNewMigrations);
   await writeFile(manifestPath,JSON.stringify(changed));
   await assert.rejects(snapshotAiSource(root),/canonical manifest inventory|current migration manifest drift/,label);
  }
  await writeFile(manifestPath,JSON.stringify(original));
  const sqlPath=join(root,path),sql=await readFile(sqlPath),drift=Buffer.concat([sql,Buffer.from('\n-- unreviewed drift\n')]);
  await writeFile(sqlPath,drift);
  await assert.rejects(snapshotAiSource(root),/class basic info input migration source drift/);
  const coordinated=structuredClone(original);coordinated.orderedNewMigrations[178].sha256=hash(drift);
  await writeFile(manifestPath,JSON.stringify(coordinated));
  await assert.rejects(snapshotAiSource(root),/current migration manifest drift/);
  await writeFile(manifestPath,JSON.stringify(original));
  await rm(sqlPath);await assert.rejects(snapshotAiSource(root),/ENOENT/);
  assert.deepEqual(await snapshotAiSource(),current,'negative fixtures never modify the real source');
 }finally{await rm(root,{recursive:true,force:true});}
});
test('preset owned placements extend the exact inventory and preserve all earlier 179 migrations',async()=>{
 const pin={fileName:'20261022041000_timetable_preset_owned_placements.sql',status:'final',sha256:'11ab457c63c06a1055e4d152af4b6b607864cb9c00c7a7c6744b44b33ef19c77'};
 assert.deepEqual(receiptProtocol.TIMETABLE_PRESET_OWNED_MIGRATION,pin);
 assert.ok(Object.isFrozen(receiptProtocol.TIMETABLE_PRESET_OWNED_MIGRATION));
 const current=await snapshotAiSource();
 const path='supabase/migrations/'+pin.fileName;
 assert.equal(receiptProtocol.AI_SOURCE_CLOSURE.filter(file=>file===path).length,1);
 assert.equal(current.closure.find(row=>row.path===path)?.sha256,pin.sha256);
 const tests=['supabase/tests/timetable_preset_owned_placements_test.sql'];
 for(const file of tests){assert.equal(AI_SQL_TESTS.filter(p=>p===file).length,1);assert.equal(current.closure.find(p=>p.path===file)?.sha256,hash(await readFile(file)));}
 for(const file of ['tests/probe-timetable-preset-owned-dto.mjs','tests/probe-timetable-preset-owned-concurrency.mjs']){assert.equal(AI_PROBES.filter(p=>p===file).length,1);assert.equal(current.closure.find(p=>p.path===file)?.sha256,hash(await readFile(file)));}
 const root=await mkdtemp(join(tmpdir(),'ai-receipt-preset-owned-drift-'));
 try{
  for(const file of [...receiptProtocol.AI_SOURCE_CLOSURE,...CURRENT_AI_MIGRATIONS.map(m=>'supabase/migrations/'+m.fileName)]){
   await mkdir(join(root,file,'..'),{recursive:true});await writeFile(join(root,file),await readFile(file));
  }
  const manifestPath=join(root,'supabase/test-baselines/dashboard-free-tier-v1.manifest.json');
  const original=JSON.parse(await readFile(manifestPath));
  assert.equal(original.orderedNewMigrations.length,196);
  assert.deepEqual(original.orderedNewMigrations[179],pin);
  assert.equal(hash(JSON.stringify(original.orderedNewMigrations.slice(0,179))),'82c0482b0a86781a43a6f64c591e2f452295e7db29f112f8291fa872ef4a1622');
  for(const [label,mutate] of [
   ['missing',rows=>rows.splice(rows.findIndex(row=>row.fileName===pin.fileName),1)],
   ['duplicate',rows=>rows.push({...pin})],
   ['same-length duplicate',rows=>rows[179]={...rows[178]}],
   ['reordered',rows=>[rows[178],rows[179]]=[rows[179],rows[178]]],
   ['candidate status',rows=>rows[179].status='candidate'],
   ['hash drift',rows=>rows[179].sha256='0'.repeat(64)],
   ['similar unapproved name',rows=>rows[179].fileName='20261022041000_timetable_preset_owned_placements_v2.sql'],
  ]){
   const changed=structuredClone(original);mutate(changed.orderedNewMigrations);
   await writeFile(manifestPath,JSON.stringify(changed));
   await assert.rejects(snapshotAiSource(root),/canonical manifest inventory|current migration manifest drift/,label);
  }
  await writeFile(manifestPath,JSON.stringify(original));
  const sqlPath=join(root,path),sql=await readFile(sqlPath),drift=Buffer.concat([sql,Buffer.from('\n-- unreviewed drift\n')]);
  await writeFile(sqlPath,drift);
  await assert.rejects(snapshotAiSource(root),/timetable preset owned migration source drift/);
  const coordinated=structuredClone(original);coordinated.orderedNewMigrations[179].sha256=hash(drift);
  await writeFile(manifestPath,JSON.stringify(coordinated));
  await assert.rejects(snapshotAiSource(root),/current migration manifest drift/);
  await writeFile(manifestPath,JSON.stringify(original));
  await rm(sqlPath);await assert.rejects(snapshotAiSource(root),/ENOENT/);
  assert.deepEqual(await snapshotAiSource(),current,'negative fixtures never modify the real source');
 }finally{await rm(root,{recursive:true,force:true});}
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
 assert.equal(manifest.orderedNewMigrations.length,196);
 assert.deepEqual(manifest.orderedNewMigrations[174],calendarMovePin);
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
   ['similar unapproved name',rows=>rows[index].fileName='20261019100046_academic_calendar_move_atomic_v2.sql'],
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
test('completed failed word-retest retry adds one exact final pin and preserves all previous migration entries',async()=>{
 assert.deepEqual(receiptProtocol.WORD_RETEST_COMPLETED_FAILED_MIGRATION,completedFailedRetestPin);
 assert.ok(Object.isFrozen(receiptProtocol.WORD_RETEST_COMPLETED_FAILED_MIGRATION));
 const source=await snapshotAiSource();
 const path='supabase/migrations/'+completedFailedRetestPin.fileName;
 assert.equal(receiptProtocol.AI_SOURCE_CLOSURE.filter(file=>file===path).length,1);
 assert.equal(source.closure.find(row=>row.path===path)?.sha256,completedFailedRetestPin.sha256);
 assert.deepEqual(source.migrations,CURRENT_AI_MIGRATIONS);
 assert.equal(CURRENT_AI_MIGRATIONS.length,11);
 const manifest=JSON.parse(await readFile('supabase/test-baselines/dashboard-free-tier-v1.manifest.json'));
 assert.equal(manifest.orderedNewMigrations.length,196);
 assert.deepEqual(manifest.orderedNewMigrations[175],completedFailedRetestPin);
 assert.equal(hash(JSON.stringify(manifest.orderedNewMigrations.slice(0,175))),'2a20cc18682c7a8c55b9750dee44191adcce33327a64b61d0ebaaecf11fd9cad');
});
test('completed failed word-retest pin rejects missing, duplicate, reordered, unapproved and coordinated source drift',async()=>{
 const current=await snapshotAiSource();
 const root=await mkdtemp(join(tmpdir(),'ai-receipt-completed-failed-retest-drift-'));
 try{
  for(const file of [...receiptProtocol.AI_SOURCE_CLOSURE,...CURRENT_AI_MIGRATIONS.map(m=>'supabase/migrations/'+m.fileName)]){
   await mkdir(join(root,file,'..'),{recursive:true});await writeFile(join(root,file),await readFile(file));
  }
  const manifestPath=join(root,'supabase/test-baselines/dashboard-free-tier-v1.manifest.json');
  const original=JSON.parse(await readFile(manifestPath));
  const index=original.orderedNewMigrations.findIndex(row=>row.fileName===completedFailedRetestPin.fileName);
  assert.equal(index,175);
  for(const [label,mutate] of [
   ['missing',rows=>rows.splice(index,1)],
   ['duplicate appended',rows=>rows.push({...rows[index]})],
   ['same-length duplicate',rows=>rows[index]={...rows[index-1]}],
   ['reordered',rows=>[rows[index-1],rows[index]]=[rows[index],rows[index-1]]],
   ['hash drift',rows=>rows[index].sha256='0'.repeat(64)],
   ['candidate status',rows=>rows[index].status='candidate'],
   ['unknown status',rows=>rows[index].status='draft'],
   ['similar unapproved name',rows=>rows[index].fileName='20261020001626_word_retest_completed_failed_retry_v2.sql'],
   ['extra unapproved migration',rows=>rows.push({...rows[index],fileName:'20990101000000_unreviewed_word_retest.sql'})],
  ]){
   const changed=structuredClone(original);mutate(changed.orderedNewMigrations);
   await writeFile(manifestPath,JSON.stringify(changed));
   await assert.rejects(snapshotAiSource(root),/(?:AI canonical manifest inventory|current migration manifest drift)/,label);
  }
  await writeFile(manifestPath,JSON.stringify(original));
  const sqlPath=join(root,'supabase/migrations/'+completedFailedRetestPin.fileName);
  const sql=await readFile(sqlPath),drift=Buffer.concat([sql,Buffer.from('\n-- unapproved source drift\n')]);
  await writeFile(sqlPath,drift);
  await assert.rejects(snapshotAiSource(root),/completed failed word-retest migration source drift/);
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
  assert.equal(original.orderedNewMigrations.length,196);
  const reviewedLegacy=original.orderedNewMigrations.filter(m=>!CURRENT_WITHDRAWAL_MIGRATIONS.some(pin=>pin.fileName===m.fileName) && ![...CURRENT_PR126_MIGRATIONS,...TIMETABLE_CLOSE_MIGRATIONS].some(pin=>pin.fileName===m.fileName) && m.fileName!==THREAD_REPLY_MIGRATION.fileName && m.fileName!==NONEXPIRING_CHAT_MIGRATION.fileName && m.fileName!==TIMETABLE_VALIDATION_MIGRATION.fileName && m.fileName!==registrationPin.fileName && m.fileName!==TIMETABLE_BATCH_SAVE_MIGRATION.fileName && m.fileName!==calendarMovePin.fileName && m.fileName!==completedFailedRetestPin.fileName && m.fileName!==receiptProtocol.OPTIONAL_CLASSROOM_MIGRATION.fileName && m.fileName!==receiptProtocol.CLASS_LESSON_INPUT_MIGRATION.fileName && m.fileName!==receiptProtocol.CLASS_BASIC_INFO_INPUT_MIGRATION.fileName && m.fileName!==receiptProtocol.TIMETABLE_PRESET_OWNED_MIGRATION.fileName && m.fileName!==receiptProtocol.CLASS_PUBLIC_MEMO_MIGRATION.fileName && m.fileName!==receiptProtocol.MANAGEMENT_CLASS_OWNERSHIP_MIGRATION.fileName && m.fileName!==receiptProtocol.DASHBOARD_ROLE_SCOPE_MIGRATION.fileName && m.fileName!==receiptProtocol.MAKEUP_RENDER_BRIDGE_MIGRATION.fileName && m.fileName!==receiptProtocol.TEACHER_OWN_REQUEST_MIGRATION.fileName && m.fileName!==receiptProtocol.MAKEUP_SUBJECT_DIRECTOR_MIGRATION.fileName && m.fileName!==receiptProtocol.CLASS_MONTH_SUMMARY_MIGRATION.fileName && m.fileName!==receiptProtocol.CLASS_CLOSE_OCCUPANCY_MIGRATION.fileName && m.fileName!==receiptProtocol.MAKEUP_SEOUL_TIME_MIGRATION.fileName && m.fileName!==receiptProtocol.TIMETABLE_PER_DATE_INPUTS_MIGRATION.fileName && m.fileName!==receiptProtocol.AUDIT_PREDECESSOR_LOOKUP_MIGRATION.fileName && m.fileName!==receiptProtocol.TIMETABLE_DATED_DIFF_PROJECTION_MIGRATION.fileName && m.fileName!==receiptProtocol.MAKEUP_LEGACY_PAIR_ADOPTION_MIGRATION.fileName && m.fileName!==receiptProtocol.TIMETABLE_DATE_OVERRIDE_NATIVE_READER_MIGRATION.fileName && m.fileName!==receiptProtocol.LEGACY_CONTEXT_ADOPTION_REUSE_MIGRATION.fileName && m.fileName!==receiptProtocol.LEGACY_ADOPTION_PAIR_REUSE_MIGRATION.fileName);
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


test('management ownership migration is pinned without relaxing legacy or source drift checks', async () => {
 const pin=receiptProtocol.MANAGEMENT_CLASS_OWNERSHIP_MIGRATION;
 assert.deepEqual(pin,{fileName:'20261022133155_management_class_schedule_ownership.sql',status:'final',sha256:'3f0e7b641157f46ebadfacd9b097c7bfd14f91521635afd476681ed7d45f4cd3'});
 const current=await snapshotAiSource();
 assert.equal(current.closure.find(row=>row.path==='supabase/migrations/'+pin.fileName)?.sha256,pin.sha256);
 const root=await mkdtemp(join(tmpdir(),'ai-management-ownership-pin-'));
 try {
  for(const path of [...receiptProtocol.AI_SOURCE_CLOSURE,...CURRENT_AI_MIGRATIONS.map(m=>'supabase/migrations/'+m.fileName)]) {
   await mkdir(join(root,path,'..'),{recursive:true}); await writeFile(join(root,path),await readFile(path));
  }
  const manifestPath=join(root,'supabase/test-baselines/dashboard-free-tier-v1.manifest.json');
  const original=JSON.parse(await readFile(manifestPath));
  const index=original.orderedNewMigrations.findIndex(row=>row.fileName===pin.fileName);
  assert.ok(index>0);
  for(const [label,mutate] of [
   ['missing',rows=>rows.splice(index,1)],
   ['duplicate',rows=>rows.push({...rows[index]})],
   ['reordered',rows=>[rows[index-1],rows[index]]=[rows[index],rows[index-1]]],
   ['hash',rows=>rows[index].sha256='0'.repeat(64)],
   ['status',rows=>rows[index].status='draft'],
  ]) {
   const changed=structuredClone(original); mutate(changed.orderedNewMigrations);
   await writeFile(manifestPath,JSON.stringify(changed));
   await assert.rejects(snapshotAiSource(root),/(?:AI canonical manifest inventory|current migration manifest drift)/,label);
  }
  await writeFile(manifestPath,JSON.stringify(original));
  const sqlPath=join(root,'supabase/migrations/'+pin.fileName),sql=await readFile(sqlPath);
  await writeFile(sqlPath,Buffer.concat([sql,Buffer.from('\n-- unexpected source\n')]));
  await assert.rejects(snapshotAiSource(root),/management class ownership migration source drift/);
  await rm(sqlPath); await assert.rejects(snapshotAiSource(root),/ENOENT/);
 } finally { await rm(root,{recursive:true,force:true}); }
});

test('operational role scope migration is pinned without relaxing legacy or source drift checks', async () => {
 const pin=receiptProtocol.DASHBOARD_ROLE_SCOPE_MIGRATION;
 assert.deepEqual(pin,{fileName:'20261023091500_dashboard_operational_role_scope.sql',status:'final',sha256:'dfa81cdeedcd307d8337235d7b2d2e0bf41eff059e63b66a43295c538ff3bdf5'});
 const current=await snapshotAiSource();
 assert.equal(current.closure.find(row=>row.path==='supabase/migrations/'+pin.fileName)?.sha256,pin.sha256);
 const root=await mkdtemp(join(tmpdir(),'ai-operational-role-scope-pin-'));
 try {
  for(const path of [...receiptProtocol.AI_SOURCE_CLOSURE,...CURRENT_AI_MIGRATIONS.map(m=>'supabase/migrations/'+m.fileName)]) {
   await mkdir(join(root,path,'..'),{recursive:true}); await writeFile(join(root,path),await readFile(path));
  }
  const manifestPath=join(root,'supabase/test-baselines/dashboard-free-tier-v1.manifest.json');
  const original=JSON.parse(await readFile(manifestPath));
  const index=original.orderedNewMigrations.findIndex(row=>row.fileName===pin.fileName);
  assert.ok(index>0);
  for(const [label,mutate] of [
   ['missing',rows=>rows.splice(index,1)],
   ['duplicate',rows=>rows.push({...rows[index]})],
   ['reordered',rows=>[rows[index-1],rows[index]]=[rows[index],rows[index-1]]],
   ['hash',rows=>rows[index].sha256='0'.repeat(64)],
   ['status',rows=>rows[index].status='draft'],
  ]) {
   const changed=structuredClone(original); mutate(changed.orderedNewMigrations);
   await writeFile(manifestPath,JSON.stringify(changed));
   await assert.rejects(snapshotAiSource(root),/(?:AI canonical manifest inventory|current migration manifest drift)/,label);
  }
  await writeFile(manifestPath,JSON.stringify(original));
  const sqlPath=join(root,'supabase/migrations/'+pin.fileName),sql=await readFile(sqlPath);
  await writeFile(sqlPath,Buffer.concat([sql,Buffer.from('\n-- unexpected source\n')]));
  await assert.rejects(snapshotAiSource(root),/dashboard role scope migration source drift/);
  await rm(sqlPath); await assert.rejects(snapshotAiSource(root),/ENOENT/);
 } finally { await rm(root,{recursive:true,force:true}); }
});


test('makeup render bridge adds one exact final pin while retaining all183 previous entries',async()=>{
 const pin=receiptProtocol.MAKEUP_RENDER_BRIDGE_MIGRATION;
 assert.deepEqual(pin,{fileName:'20261026124608_makeup_legacy_canonical_render_bridge.sql',status:'final',sha256:'3b11e40988854ed2e64a4a1e4dd5513820f075d183f639f5c49e9aadcf908329'});
 assert.ok(Object.isFrozen(pin));
 const path='supabase/migrations/'+pin.fileName,source=await snapshotAiSource();
 assert.equal(receiptProtocol.AI_SOURCE_CLOSURE.filter(file=>file===path).length,1);
 assert.equal(source.closure.find(row=>row.path===path)?.sha256,pin.sha256);
 assert.deepEqual(source.migrations,CURRENT_AI_MIGRATIONS);
 assert.equal(CURRENT_AI_MIGRATIONS.length,11);
 const manifest=JSON.parse(await readFile('supabase/test-baselines/dashboard-free-tier-v1.manifest.json'));
 assert.equal(manifest.orderedNewMigrations.length,196);
 assert.deepEqual(manifest.orderedNewMigrations[183],pin);
 assert.equal(hash(JSON.stringify(manifest.orderedNewMigrations.slice(0,183))),'38cde4a5f817140fc19ac7156d70b7eb5dbb5be0b3bdbf2c62a068c628b69ceb');
});
test('makeup render bridge pin rejects missing, duplicate, reordered, unapproved and coordinated source drift',async()=>{
 const calendarMovePin=receiptProtocol.MAKEUP_RENDER_BRIDGE_MIGRATION;
 const current=await snapshotAiSource();
 const root=await mkdtemp(join(tmpdir(),'ai-receipt-makeup-render-drift-'));
 try{
  for(const file of [...receiptProtocol.AI_SOURCE_CLOSURE,...CURRENT_AI_MIGRATIONS.map(m=>'supabase/migrations/'+m.fileName)]){
   await mkdir(join(root,file,'..'),{recursive:true});await writeFile(join(root,file),await readFile(file));
  }
  const manifestPath=join(root,'supabase/test-baselines/dashboard-free-tier-v1.manifest.json');
  const original=JSON.parse(await readFile(manifestPath));
  const index=original.orderedNewMigrations.findIndex(row=>row.fileName===calendarMovePin.fileName);
  assert.equal(index,183);
  for(const [label,mutate] of [
   ['missing',rows=>rows.splice(index,1)],
   ['duplicate appended',rows=>rows.push({...rows[index]})],
   ['same-length duplicate',rows=>rows[index]={...rows[index-1]}],
   ['reordered',rows=>[rows[index-1],rows[index]]=[rows[index],rows[index-1]]],
   ['hash drift',rows=>rows[index].sha256='0'.repeat(64)],
   ['candidate status',rows=>rows[index].status='candidate'],
   ['unknown status',rows=>rows[index].status='draft'],
   ['similar unapproved name',rows=>rows[index].fileName='20261026124608_makeup_legacy_canonical_render_bridge_v2.sql'],
   ['extra unapproved migration',rows=>rows.push({...rows[index],fileName:'20990101000000_unreviewed_makeup_render.sql'})],
  ]){
   const changed=structuredClone(original);mutate(changed.orderedNewMigrations);
   await writeFile(manifestPath,JSON.stringify(changed));
   await assert.rejects(snapshotAiSource(root),/(?:AI canonical manifest inventory|current migration manifest drift)/,label);
  }
  await writeFile(manifestPath,JSON.stringify(original));
  const sqlPath=join(root,'supabase/migrations/'+calendarMovePin.fileName);
  const sql=await readFile(sqlPath),drift=Buffer.concat([sql,Buffer.from('\n-- unapproved source drift\n')]);
  await writeFile(sqlPath,drift);
  await assert.rejects(snapshotAiSource(root),/makeup render bridge migration source drift/);
  const coordinated=structuredClone(original);coordinated.orderedNewMigrations[index].sha256=hash(drift);
  await writeFile(manifestPath,JSON.stringify(coordinated));
  await assert.rejects(snapshotAiSource(root),/current migration manifest drift/);
  await writeFile(manifestPath,JSON.stringify(original));
  await rm(sqlPath);await assert.rejects(snapshotAiSource(root),/ENOENT/);
  assert.deepEqual(await snapshotAiSource(),current,'negative fixtures never modify the real pinned source');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('teacher own request pin appends exactly one entry and rejects coordinated manifest/source drift',async()=>{
 const pin=receiptProtocol.TEACHER_OWN_REQUEST_MIGRATION;
 assert.equal(pin.fileName,'20261027005334_teacher_own_request_workflow.sql');assert.equal(pin.status,'final');assert.ok(Object.isFrozen(pin));
 const source=await snapshotAiSource(),path='supabase/migrations/'+pin.fileName;
 assert.equal(source.closure.find(item=>item.path===path)?.sha256,pin.sha256);
 const root=await mkdtemp(join(tmpdir(),'ai-receipt-teacher-own-drift-'));
 try{
  for(const file of [...receiptProtocol.AI_SOURCE_CLOSURE,...CURRENT_AI_MIGRATIONS.map(m=>'supabase/migrations/'+m.fileName)]){
   await mkdir(join(root,file,'..'),{recursive:true});await writeFile(join(root,file),await readFile(file));
  }
  const manifestPath=join(root,'supabase/test-baselines/dashboard-free-tier-v1.manifest.json'),original=JSON.parse(await readFile(manifestPath));
  assert.equal(original.orderedNewMigrations.length,196);assert.deepEqual(original.orderedNewMigrations[184],pin);
  assert.equal(hash(JSON.stringify(original.orderedNewMigrations.slice(0,184))),'3081116375a7b1f69e8d475415c83d772e4f62391e4720c23589a5894fca87ec');
  for(const [label,mutate] of [
   ['missing',rows=>rows.splice(184,1)],['duplicate',rows=>rows.push({...pin})],
   ['reordered',rows=>[rows[183],rows[184]]=[rows[184],rows[183]]],
   ['changed',rows=>rows[184].sha256='0'.repeat(64)],['candidate',rows=>rows[184].status='candidate'],
  ]){const candidate=structuredClone(original);mutate(candidate.orderedNewMigrations);await writeFile(manifestPath,JSON.stringify(candidate));await assert.rejects(snapshotAiSource(root),/(?:AI canonical manifest inventory|current migration manifest drift)/,label);}
  await writeFile(manifestPath,JSON.stringify(original));const sqlPath=join(root,path),sql=await readFile(sqlPath),drift=Buffer.concat([sql,Buffer.from('\n-- unauthorized drift\n')]);
  await writeFile(sqlPath,drift);await assert.rejects(snapshotAiSource(root),/teacher own request migration source drift/);
  const changed=structuredClone(original);changed.orderedNewMigrations[184].sha256=hash(drift);await writeFile(manifestPath,JSON.stringify(changed));await assert.rejects(snapshotAiSource(root),/current migration manifest drift/);
  assert.deepEqual(await snapshotAiSource(),source,'negative fixture never changes actual source');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('subject director pin appends exactly one entry and rejects coordinated manifest/source drift',async()=>{
 const pin=receiptProtocol.MAKEUP_SUBJECT_DIRECTOR_MIGRATION;
 assert.equal(pin.fileName,'20261027124217_makeup_subject_director_authority.sql');assert.equal(pin.status,'final');assert.ok(Object.isFrozen(pin));
 const source=await snapshotAiSource(),path='supabase/migrations/'+pin.fileName;
 assert.equal(source.closure.find(item=>item.path===path)?.sha256,pin.sha256);
 const root=await mkdtemp(join(tmpdir(),'ai-receipt-subject-director-drift-'));
 try{
  for(const file of [...receiptProtocol.AI_SOURCE_CLOSURE,...CURRENT_AI_MIGRATIONS.map(m=>'supabase/migrations/'+m.fileName)]){
   await mkdir(join(root,file,'..'),{recursive:true});await writeFile(join(root,file),await readFile(file));
  }
  const manifestPath=join(root,'supabase/test-baselines/dashboard-free-tier-v1.manifest.json'),original=JSON.parse(await readFile(manifestPath));
  assert.equal(original.orderedNewMigrations.length,196);assert.deepEqual(original.orderedNewMigrations[185],pin);
  // Prefix184 is unchanged; entry184 now pins the reviewed bigint/history CHECK
  // cleanup of the companion unpublished migration. Keep an independent hash.
  assert.equal(hash(JSON.stringify(original.orderedNewMigrations.slice(0,185))),'5ed9c588fcf68f214bda90c4b9550480449ceb88f6dd2b3deb8b78857af4aee8');
  for(const [label,mutate] of [
   ['missing',rows=>rows.splice(185,1)],['duplicate',rows=>rows.push({...pin})],
   ['reordered',rows=>[rows[184],rows[185]]=[rows[185],rows[184]]],
   ['changed',rows=>rows[185].sha256='0'.repeat(64)],['candidate',rows=>rows[185].status='candidate'],
  ]){const candidate=structuredClone(original);mutate(candidate.orderedNewMigrations);await writeFile(manifestPath,JSON.stringify(candidate));await assert.rejects(snapshotAiSource(root),/(?:AI canonical manifest inventory|current migration manifest drift)/,label);}
  await writeFile(manifestPath,JSON.stringify(original));const sqlPath=join(root,path),sql=await readFile(sqlPath),drift=Buffer.concat([sql,Buffer.from('\n-- unauthorized drift\n')]);
  await writeFile(sqlPath,drift);await assert.rejects(snapshotAiSource(root),/makeup subject director migration source drift/);
  const changed=structuredClone(original);changed.orderedNewMigrations[185].sha256=hash(drift);await writeFile(manifestPath,JSON.stringify(changed));await assert.rejects(snapshotAiSource(root),/current migration manifest drift/);
  assert.deepEqual(await snapshotAiSource(),source,'negative fixture never changes actual source');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('class month summary exact pin rejects removal, reordering, duplication and coordinated source drift',async()=>{
 const pin=receiptProtocol.CLASS_MONTH_SUMMARY_MIGRATION;
 const current=await snapshotAiSource();
 const path='supabase/migrations/'+pin.fileName;
 assert.equal(current.closure.find(row=>row.path===path)?.sha256,pin.sha256);
 const root=await mkdtemp(join(tmpdir(),'ai-receipt-month-summary-'));
 try{
  for(const file of [...receiptProtocol.AI_SOURCE_CLOSURE,...CURRENT_AI_MIGRATIONS.map(m=>'supabase/migrations/'+m.fileName)]){
   await mkdir(join(root,file,'..'),{recursive:true});await writeFile(join(root,file),await readFile(file));
  }
  const manifestPath=join(root,'supabase/test-baselines/dashboard-free-tier-v1.manifest.json');
  const original=JSON.parse(await readFile(manifestPath));
  assert.equal(original.orderedNewMigrations.length,196);
  assert.deepEqual(original.orderedNewMigrations[186],pin);
  assert.equal(hash(JSON.stringify(original.orderedNewMigrations.slice(0,186))),'ab04f6eeca206a57573ea149193706a04d6b1d223c18253de53acbd348b7e7c5');
  for(const mutate of [rows=>rows.splice(186,1),rows=>rows.push({...pin}),rows=>rows[186].status='candidate',rows=>rows[186].sha256='0'.repeat(64),rows=>{[rows[185],rows[186]]=[rows[186],rows[185]];}]){
   const changed=structuredClone(original);mutate(changed.orderedNewMigrations);
   await writeFile(manifestPath,JSON.stringify(changed));
   await assert.rejects(snapshotAiSource(root),/canonical manifest inventory|current migration manifest drift/);
  }
  await writeFile(manifestPath,JSON.stringify(original));
  const sqlPath=join(root,path),sql=await readFile(sqlPath),drift=Buffer.concat([sql,Buffer.from('\n-- unreviewed drift\n')]);
  await writeFile(sqlPath,drift);
  await assert.rejects(snapshotAiSource(root),/class month summary migration source drift/);
  const changed=structuredClone(original);changed.orderedNewMigrations[186].sha256=hash(drift);
  await writeFile(manifestPath,JSON.stringify(changed));
  await assert.rejects(snapshotAiSource(root),/current migration manifest drift/);
  assert.deepEqual(await snapshotAiSource(),current);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('class close occupancy exact pin admits the approved source and preserves all187 previous entries',async()=>{
 const source=await snapshotAiSource();
 const pin=receiptProtocol.CLASS_CLOSE_OCCUPANCY_MIGRATION;
 assert.deepEqual(pin,{fileName:'20261031120000_class_close_occupancy_release.sql',status:'final',sha256:'1872ae421e86e383e1c06ee9cc9df7a86c4c462ea6f9f2433cc254735f55fe63'});
 assert.ok(Object.isFrozen(pin));
 const path='supabase/migrations/'+pin.fileName;
 assert.equal(receiptProtocol.AI_SOURCE_CLOSURE.filter(file=>file===path).length,1);
 assert.equal(source.closure.find(row=>row.path===path)?.sha256,pin.sha256);
 assert.deepEqual(source.migrations,CURRENT_AI_MIGRATIONS);
 assert.equal(CURRENT_AI_MIGRATIONS.length,11,'the AI receipt migration protocol is unchanged');
 const manifest=JSON.parse(await readFile('supabase/test-baselines/dashboard-free-tier-v1.manifest.json'));
 assert.equal(manifest.orderedNewMigrations.length,196);
 assert.deepEqual(manifest.orderedNewMigrations[187],pin);
 assert.equal(hash(JSON.stringify(manifest.orderedNewMigrations.slice(0,187))),'5b23210043baa0bc71d6ce9aec955cc8b452a52305ff4390015601d38419924e');
});

test('class close occupancy pin rejects tampering and unregistered files without weakening prior guards',async()=>{
 const current=await snapshotAiSource();
 const pin=receiptProtocol.CLASS_CLOSE_OCCUPANCY_MIGRATION;
 const parent=join(repositoryRoot,'.codex-temp');await mkdir(parent,{recursive:true});
 const root=await mkdtemp(join(parent,'ai-receipt-class-close-occupancy-'));
 try{
  for(const file of [...receiptProtocol.AI_SOURCE_CLOSURE,...CURRENT_AI_MIGRATIONS.map(m=>'supabase/migrations/'+m.fileName)]){
   await mkdir(join(root,file,'..'),{recursive:true});await writeFile(join(root,file),await readFile(file));
  }
  const manifestPath=join(root,'supabase/test-baselines/dashboard-free-tier-v1.manifest.json');
  const originalBytes=await readFile(manifestPath);
  const original=JSON.parse(originalBytes);
  const index=original.orderedNewMigrations.findIndex(row=>row.fileName===pin.fileName);
  assert.equal(index,187);
  assert.deepEqual(await snapshotAiSource(root),current,'the copied approved source is accepted');
  const unknown={fileName:'20990101000000_unregistered_class_close.sql',status:'final',sha256:hash('select 1;\n')};
  await writeFile(join(root,'supabase/migrations',unknown.fileName),'select 1;\n');
  for(const [label,mutate] of [
   ['missing',rows=>rows.splice(index,1)],
   ['duplicate',rows=>rows.push({...pin})],
   ['same-length duplicate',rows=>rows[index]={...rows[index-1]}],
   ['reordered',rows=>{[rows[index-1],rows[index]]=[rows[index],rows[index-1]];}],
   ['unapproved',rows=>rows[index].status='candidate'],
   ['changed hash',rows=>rows[index].sha256='0'.repeat(64)],
   ['unregistered addition',rows=>rows.push({...unknown})],
   ['same-length unregistered replacement',rows=>rows[index]={...unknown}],
  ]){
   const changed=structuredClone(original);mutate(changed.orderedNewMigrations);
   await writeFile(manifestPath,JSON.stringify(changed));
   await assert.rejects(snapshotAiSource(root),/canonical manifest inventory|current migration manifest drift/,label);
  }
  await writeFile(manifestPath,originalBytes);
  const sqlPath=join(root,'supabase/migrations',pin.fileName),sql=await readFile(sqlPath);
  const drift=Buffer.concat([sql,Buffer.from('\n-- unreviewed source drift\n')]);
  await writeFile(sqlPath,drift);
  await assert.rejects(snapshotAiSource(root),/class close occupancy migration source drift/);
  const coordinated=structuredClone(original);coordinated.orderedNewMigrations[index].sha256=hash(drift);
  await writeFile(manifestPath,JSON.stringify(coordinated));
  await assert.rejects(snapshotAiSource(root),/current migration manifest drift/,'coordinated source and manifest edits remain rejected');
  await writeFile(manifestPath,originalBytes);await rm(sqlPath);
  await assert.rejects(snapshotAiSource(root),/ENOENT/);
  await writeFile(sqlPath,sql);
  assert.deepEqual(await snapshotAiSource(root),current,'restoring exact source restores acceptance');
  assert.deepEqual(await snapshotAiSource(),current,'negative fixtures never modify actual source');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('makeup Seoul time exact pin admits the approved source and preserves all188 previous entries',async()=>{
 const source=await snapshotAiSource();
 const pin=receiptProtocol.MAKEUP_SEOUL_TIME_MIGRATION;
 assert.deepEqual(pin,{fileName:'20261103135120_makeup_seoul_time_projection.sql',status:'final',sha256:'f6375de323d3d7bfd1e2e52bec28d1a13437399bf214949c3ecdd5b957c325c4'});
 assert.ok(Object.isFrozen(pin));
 const path='supabase/migrations/'+pin.fileName;
 assert.equal(receiptProtocol.AI_SOURCE_CLOSURE.filter(file=>file===path).length,1);
 assert.equal(source.closure.find(row=>row.path===path)?.sha256,pin.sha256);
 assert.deepEqual(source.migrations,CURRENT_AI_MIGRATIONS);
 assert.equal(CURRENT_AI_MIGRATIONS.length,11,'the AI receipt migration protocol is unchanged');
 const manifest=JSON.parse(await readFile('supabase/test-baselines/dashboard-free-tier-v1.manifest.json'));
 assert.equal(manifest.orderedNewMigrations.length,196);
 assert.deepEqual(manifest.orderedNewMigrations[188],pin);
 assert.equal(hash(JSON.stringify(manifest.orderedNewMigrations.slice(0,188))),'fc43ac24bd166be6ffae6efce42265175a9b81d525e495d31bb4b268950983ae');
});

test('makeup Seoul time pin rejects tampering and unregistered files without weakening prior guards',async()=>{
 const current=await snapshotAiSource();
 const pin=receiptProtocol.MAKEUP_SEOUL_TIME_MIGRATION;
 const parent=join(repositoryRoot,'.codex-temp');await mkdir(parent,{recursive:true});
 const root=await mkdtemp(join(parent,'ai-receipt-makeup-seoul-time-'));
 try{
  for(const file of [...receiptProtocol.AI_SOURCE_CLOSURE,...CURRENT_AI_MIGRATIONS.map(m=>'supabase/migrations/'+m.fileName)]){
   await mkdir(join(root,file,'..'),{recursive:true});await writeFile(join(root,file),await readFile(file));
  }
  const manifestPath=join(root,'supabase/test-baselines/dashboard-free-tier-v1.manifest.json');
  const originalBytes=await readFile(manifestPath);
  const original=JSON.parse(originalBytes);
  const index=original.orderedNewMigrations.findIndex(row=>row.fileName===pin.fileName);
  assert.equal(index,188);
  assert.deepEqual(await snapshotAiSource(root),current,'the copied approved source is accepted');
  const unknown={fileName:'20990101000000_unregistered_makeup_time.sql',status:'final',sha256:hash('select 1;\n')};
  await writeFile(join(root,'supabase/migrations',unknown.fileName),'select 1;\n');
  for(const [label,mutate] of [
   ['missing',rows=>rows.splice(index,1)],
   ['duplicate',rows=>rows.push({...pin})],
   ['same-length duplicate',rows=>rows[index]={...rows[index-1]}],
   ['reordered',rows=>{[rows[index-1],rows[index]]=[rows[index],rows[index-1]];}],
   ['unapproved',rows=>rows[index].status='candidate'],
   ['changed hash',rows=>rows[index].sha256='0'.repeat(64)],
   ['unregistered addition',rows=>rows.push({...unknown})],
   ['same-length unregistered replacement',rows=>rows[index]={...unknown}],
  ]){
   const changed=structuredClone(original);mutate(changed.orderedNewMigrations);
   await writeFile(manifestPath,JSON.stringify(changed));
   await assert.rejects(snapshotAiSource(root),/canonical manifest inventory|current migration manifest drift/,label);
  }
  await writeFile(manifestPath,originalBytes);
  const sqlPath=join(root,'supabase/migrations',pin.fileName),sql=await readFile(sqlPath);
  const drift=Buffer.concat([sql,Buffer.from('\n-- unreviewed source drift\n')]);
  await writeFile(sqlPath,drift);
  await assert.rejects(snapshotAiSource(root),/makeup Seoul time migration source drift/);
  const coordinated=structuredClone(original);coordinated.orderedNewMigrations[index].sha256=hash(drift);
  await writeFile(manifestPath,JSON.stringify(coordinated));
  await assert.rejects(snapshotAiSource(root),/current migration manifest drift/,'coordinated source and manifest edits remain rejected');
  await writeFile(manifestPath,originalBytes);await rm(sqlPath);
  await assert.rejects(snapshotAiSource(root),/ENOENT/);
  await writeFile(sqlPath,sql);
  assert.deepEqual(await snapshotAiSource(root),current,'restoring exact source restores acceptance');
  assert.deepEqual(await snapshotAiSource(),current,'negative fixtures never modify actual source');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('timetable per-date inputs exact pin admits the approved source and preserves all189 previous entries',async()=>{
 const source=await snapshotAiSource();
 const pin=receiptProtocol.TIMETABLE_PER_DATE_INPUTS_MIGRATION;
 assert.deepEqual(pin,{fileName:'20261103170744_timetable_validation_per_date_inputs.sql',status:'final',sha256:'e45ca46ee41fafd1cedce8c6bef74c1c14133f2f2534deb9a49e99ab2970d4e4'});
 assert.ok(Object.isFrozen(pin));
 const path='supabase/migrations/'+pin.fileName;
 assert.equal(receiptProtocol.AI_SOURCE_CLOSURE.filter(file=>file===path).length,1);
 assert.equal(source.closure.find(row=>row.path===path)?.sha256,pin.sha256);
 assert.deepEqual(source.migrations,CURRENT_AI_MIGRATIONS);
 assert.equal(CURRENT_AI_MIGRATIONS.length,11,'the AI receipt migration protocol is unchanged');
 const manifest=JSON.parse(await readFile('supabase/test-baselines/dashboard-free-tier-v1.manifest.json'));
 assert.equal(manifest.orderedNewMigrations.length,196);
 assert.deepEqual(manifest.orderedNewMigrations[189],pin);
 assert.equal(hash(JSON.stringify(manifest.orderedNewMigrations.slice(0,188))),'fc43ac24bd166be6ffae6efce42265175a9b81d525e495d31bb4b268950983ae');
 assert.equal(hash(JSON.stringify(manifest.orderedNewMigrations.slice(0,189))),'986d87749fc5f9e97cee8dff5f834677af18485a656d4947b6a817bbef363d86');
});

test('timetable per-date inputs pin rejects tampering and unregistered files without weakening prior guards',async()=>{
 const current=await snapshotAiSource();
 const pin=receiptProtocol.TIMETABLE_PER_DATE_INPUTS_MIGRATION;
 const parent=join(repositoryRoot,'.codex-temp');await mkdir(parent,{recursive:true});
 const root=await mkdtemp(join(parent,'ai-receipt-timetable-per-date-inputs-'));
 try{
  for(const file of [...receiptProtocol.AI_SOURCE_CLOSURE,...CURRENT_AI_MIGRATIONS.map(m=>'supabase/migrations/'+m.fileName)]){
   await mkdir(join(root,file,'..'),{recursive:true});await writeFile(join(root,file),await readFile(file));
  }
  const manifestPath=join(root,'supabase/test-baselines/dashboard-free-tier-v1.manifest.json');
  const originalBytes=await readFile(manifestPath);
  const original=JSON.parse(originalBytes);
  const index=original.orderedNewMigrations.findIndex(row=>row.fileName===pin.fileName);
  assert.equal(index,189);
  assert.deepEqual(await snapshotAiSource(root),current,'the copied approved source is accepted');
  const unknown={fileName:'20990101000000_unregistered_timetable_per_date.sql',status:'final',sha256:hash('select 1;\n')};
  await writeFile(join(root,'supabase/migrations',unknown.fileName),'select 1;\n');
  for(const [label,mutate] of [
   ['missing',rows=>rows.splice(index,1)],
   ['duplicate',rows=>rows.push({...pin})],
   ['same-length duplicate',rows=>rows[index]={...rows[index-1]}],
   ['reordered',rows=>{[rows[index-1],rows[index]]=[rows[index],rows[index-1]];}],
   ['unapproved',rows=>rows[index].status='candidate'],
   ['changed hash',rows=>rows[index].sha256='0'.repeat(64)],
   ['unregistered addition',rows=>rows.push({...unknown})],
   ['same-length unregistered replacement',rows=>rows[index]={...unknown}],
  ]){
   const changed=structuredClone(original);mutate(changed.orderedNewMigrations);
   await writeFile(manifestPath,JSON.stringify(changed));
   await assert.rejects(snapshotAiSource(root),/canonical manifest inventory|current migration manifest drift/,label);
  }
  await writeFile(manifestPath,originalBytes);
  const sqlPath=join(root,'supabase/migrations',pin.fileName),sql=await readFile(sqlPath);
  const drift=Buffer.concat([sql,Buffer.from('\n-- unreviewed source drift\n')]);
  await writeFile(sqlPath,drift);
  await assert.rejects(snapshotAiSource(root),/timetable per-date inputs migration source drift/);
  const coordinated=structuredClone(original);coordinated.orderedNewMigrations[index].sha256=hash(drift);
  await writeFile(manifestPath,JSON.stringify(coordinated));
  await assert.rejects(snapshotAiSource(root),/current migration manifest drift/,'coordinated source and manifest edits remain rejected');
  await writeFile(manifestPath,originalBytes);await rm(sqlPath);
  await assert.rejects(snapshotAiSource(root),/ENOENT/);
  await writeFile(sqlPath,sql);
  assert.deepEqual(await snapshotAiSource(root),current,'restoring exact source restores acceptance');
  assert.deepEqual(await snapshotAiSource(),current,'negative fixtures never modify actual source');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('audit predecessor lookup exact pin admits the approved source and preserves all 190 previous entries',async()=>{
 const source=await snapshotAiSource();
 const pin=receiptProtocol.AUDIT_PREDECESSOR_LOOKUP_MIGRATION;
 assert.deepEqual(pin,{fileName:'20261105073151_dashboard_audit_predecessor_index_lookup.sql',status:'final',sha256:'a1122689f58791337fbc5319d1e5b192bfd640dd96af9367f46924d517ebf069'});
 assert.ok(Object.isFrozen(pin));
 const path='supabase/migrations/'+pin.fileName;
 assert.equal(receiptProtocol.AI_SOURCE_CLOSURE.filter(file=>file===path).length,1);
 assert.equal(source.closure.find(row=>row.path===path)?.sha256,pin.sha256);
 assert.deepEqual(source.migrations,CURRENT_AI_MIGRATIONS);
 assert.equal(CURRENT_AI_MIGRATIONS.length,11,'the AI receipt migration protocol is unchanged');
 const manifest=JSON.parse(await readFile('supabase/test-baselines/dashboard-free-tier-v1.manifest.json'));
 assert.equal(manifest.orderedNewMigrations.length,196);
 assert.deepEqual(manifest.orderedNewMigrations[190],pin);
 assert.equal(hash(JSON.stringify(manifest.orderedNewMigrations.slice(0,190))),'0540427a10c9506981fa03b49ea6a092585fe790c61b14bc5c205591b8e0f74b');
});

test('audit predecessor lookup pin rejects tampering and unregistered files without weakening prior guards',async()=>{
 const current=await snapshotAiSource();
 const pin=receiptProtocol.AUDIT_PREDECESSOR_LOOKUP_MIGRATION;
 const parent=join(repositoryRoot,'.codex-temp');await mkdir(parent,{recursive:true});
 const root=await mkdtemp(join(parent,'ai-receipt-audit-predecessor-lookup-'));
 try{
  for(const file of [...receiptProtocol.AI_SOURCE_CLOSURE,...CURRENT_AI_MIGRATIONS.map(m=>'supabase/migrations/'+m.fileName)]){
   await mkdir(join(root,file,'..'),{recursive:true});await writeFile(join(root,file),await readFile(file));
  }
  const manifestPath=join(root,'supabase/test-baselines/dashboard-free-tier-v1.manifest.json');
  const originalBytes=await readFile(manifestPath);
  const original=JSON.parse(originalBytes);
  const index=original.orderedNewMigrations.findIndex(row=>row.fileName===pin.fileName);
  assert.equal(index,190);
  assert.deepEqual(await snapshotAiSource(root),current,'the copied approved source is accepted');
  const unknown={fileName:'20990101000000_unregistered_audit_predecessor.sql',status:'final',sha256:hash('select 1;\n')};
  await writeFile(join(root,'supabase/migrations',unknown.fileName),'select 1;\n');
  for(const [label,mutate] of [
   ['missing',rows=>rows.splice(index,1)],
   ['duplicate',rows=>rows.push({...pin})],
   ['same-length duplicate',rows=>rows[index]={...rows[index-1]}],
   ['reordered',rows=>{[rows[index-1],rows[index]]=[rows[index],rows[index-1]];}],
   ['unapproved',rows=>rows[index].status='candidate'],
   ['changed hash',rows=>rows[index].sha256='0'.repeat(64)],
   ['unregistered addition',rows=>rows.push({...unknown})],
   ['same-length unregistered replacement',rows=>rows[index]={...unknown}],
  ]){
   const changed=structuredClone(original);mutate(changed.orderedNewMigrations);
   await writeFile(manifestPath,JSON.stringify(changed));
   await assert.rejects(snapshotAiSource(root),/canonical manifest inventory|current migration manifest drift/,label);
  }
  await writeFile(manifestPath,originalBytes);
  const sqlPath=join(root,'supabase/migrations',pin.fileName),sql=await readFile(sqlPath);
  const drift=Buffer.concat([sql,Buffer.from('\n-- unreviewed source drift\n')]);
  await writeFile(sqlPath,drift);
  await assert.rejects(snapshotAiSource(root),/audit predecessor lookup migration source drift/);
  const coordinated=structuredClone(original);coordinated.orderedNewMigrations[index].sha256=hash(drift);
  await writeFile(manifestPath,JSON.stringify(coordinated));
  await assert.rejects(snapshotAiSource(root),/current migration manifest drift/,'coordinated source and manifest edits remain rejected');
  await writeFile(manifestPath,originalBytes);await rm(sqlPath);
  await assert.rejects(snapshotAiSource(root),/ENOENT/);
  await writeFile(sqlPath,sql);
  assert.deepEqual(await snapshotAiSource(root),current,'restoring exact source restores acceptance');
  assert.deepEqual(await snapshotAiSource(),current,'negative fixtures never modify actual source');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('dated diff projection exact pin preserves the 191 prior migrations and rejects source drift',async()=>{
 const current=await snapshotAiSource();
 const pin=receiptProtocol.TIMETABLE_DATED_DIFF_PROJECTION_MIGRATION;
 assert.deepEqual(pin,{fileName:'20261106015549_timetable_dated_diff_projection_reuse.sql',status:'final',sha256:'133044663cec2aa4b3f1bc4ae2dab7bcafb4a57c45d7b7d574baf834639f7ea6'});
 assert.ok(Object.isFrozen(pin));
 const sqlPath='supabase/migrations/'+pin.fileName;
 assert.equal(receiptProtocol.AI_SOURCE_CLOSURE.filter(path=>path===sqlPath).length,1);
 assert.equal(current.closure.find(row=>row.path===sqlPath)?.sha256,pin.sha256);
 const manifest=JSON.parse(await readFile('supabase/test-baselines/dashboard-free-tier-v1.manifest.json'));
 assert.equal(manifest.orderedNewMigrations.length,196);
 assert.deepEqual(manifest.orderedNewMigrations[191],pin);
 assert.equal(hash(JSON.stringify(manifest.orderedNewMigrations.slice(0,191))),'ddd04f013ef7f67687decbe57e43a903df29514971e46593f0ccf29f83407b41');
 const parent=join(repositoryRoot,'.codex-temp');await mkdir(parent,{recursive:true});
 const root=await mkdtemp(join(parent,'ai-receipt-dated-diff-projection-'));
 try{
  for(const file of [...receiptProtocol.AI_SOURCE_CLOSURE,...CURRENT_AI_MIGRATIONS.map(m=>'supabase/migrations/'+m.fileName)]){
   await mkdir(join(root,file,'..'),{recursive:true});await writeFile(join(root,file),await readFile(file));
  }
  assert.deepEqual(await snapshotAiSource(root),current);
  const manifestPath=join(root,'supabase/test-baselines/dashboard-free-tier-v1.manifest.json');
  const originalManifest=await readFile(manifestPath);
  const source=await readFile(join(root,sqlPath));
  const drift=Buffer.concat([source,Buffer.from('\n-- unreviewed projection drift\n')]);
  await writeFile(join(root,sqlPath),drift);
  await assert.rejects(snapshotAiSource(root),/timetable dated diff projection migration source drift/);
  const coordinated=structuredClone(manifest);coordinated.orderedNewMigrations[191].sha256=hash(drift);
  await writeFile(manifestPath,JSON.stringify(coordinated));
  await assert.rejects(snapshotAiSource(root),/current migration manifest drift/);
  await writeFile(join(root,sqlPath),source);
  const missing=structuredClone(manifest);missing.orderedNewMigrations.splice(191,1);
  await writeFile(manifestPath,JSON.stringify(missing));
  await assert.rejects(snapshotAiSource(root),/canonical manifest inventory/);
  await writeFile(manifestPath,originalManifest);
  assert.deepEqual(await snapshotAiSource(root),current);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('legacy pair adoption exact final pin preserves all 192 prior entries and rejects drift',async()=>{
 const current=await snapshotAiSource(),pin=receiptProtocol.MAKEUP_LEGACY_PAIR_ADOPTION_MIGRATION;
 assert.deepEqual(pin,{fileName:'20261106062342_makeup_legacy_pair_adoption.sql',status:'final',sha256:'44227227307e59de2429f7efa5e0a402c1ee9cf676d6ba520ec78fb7c6581909'});
 assert.ok(Object.isFrozen(pin));
 const sqlPath='supabase/migrations/'+pin.fileName;
 assert.equal(receiptProtocol.AI_SOURCE_CLOSURE.filter(path=>path===sqlPath).length,1);
 assert.equal(current.closure.find(row=>row.path===sqlPath)?.sha256,pin.sha256);
 assert.deepEqual(current.migrations,CURRENT_AI_MIGRATIONS);assert.equal(CURRENT_AI_MIGRATIONS.length,11);
 const manifest=JSON.parse(await readFile('supabase/test-baselines/dashboard-free-tier-v1.manifest.json'));
 assert.equal(manifest.orderedNewMigrations.length,196);assert.deepEqual(manifest.orderedNewMigrations[192],pin);
 assert.equal(hash(JSON.stringify(manifest.orderedNewMigrations.slice(0,192))),'fe467a9f5bbc6785529e2f9e6e97dfd07b5d019250008610879916152432c772');
 const parent=join(repositoryRoot,'.codex-temp');await mkdir(parent,{recursive:true});
 const root=await mkdtemp(join(parent,'ai-receipt-legacy-pair-'));
 try{
  for(const file of [...receiptProtocol.AI_SOURCE_CLOSURE,...CURRENT_AI_MIGRATIONS.map(m=>'supabase/migrations/'+m.fileName)]){
   await mkdir(join(root,file,'..'),{recursive:true});await writeFile(join(root,file),await readFile(file));
  }
  const manifestPath=join(root,'supabase/test-baselines/dashboard-free-tier-v1.manifest.json'),original=await readFile(manifestPath);
  assert.deepEqual(await snapshotAiSource(root),current);
  const unknown={fileName:'20990101000000_unregistered_legacy_pair.sql',status:'final',sha256:hash('select 1;\n')};
  await writeFile(join(root,'supabase/migrations',unknown.fileName),'select 1;\n');
  for(const [label,mutate]of[
   ['missing',rows=>rows.splice(192,1)],['duplicate',rows=>rows.push({...pin})],
   ['same-length duplicate',rows=>rows[192]={...rows[191]}],
   ['reorder',rows=>{[rows[191],rows[192]]=[rows[192],rows[191]];}],
   ['candidate',rows=>rows[192].status='candidate'],['hash',rows=>rows[192].sha256='0'.repeat(64)],
   ['unknown addition',rows=>rows.push({...unknown})],['unknown replacement',rows=>rows[192]={...unknown}],
  ]){
   const changed=structuredClone(manifest);mutate(changed.orderedNewMigrations);await writeFile(manifestPath,JSON.stringify(changed));
   await assert.rejects(snapshotAiSource(root),/canonical manifest inventory|current migration manifest drift/,label);
  }
  await writeFile(manifestPath,original);
  const sql=await readFile(join(root,sqlPath)),drift=Buffer.concat([sql,Buffer.from('\n-- unreviewed legacy adoption drift\n')]);
  await writeFile(join(root,sqlPath),drift);
  await assert.rejects(snapshotAiSource(root),/makeup legacy pair adoption migration source drift/);
  const coordinated=structuredClone(manifest);coordinated.orderedNewMigrations[192].sha256=hash(drift);
  await writeFile(manifestPath,JSON.stringify(coordinated));
  await assert.rejects(snapshotAiSource(root),/current migration manifest drift/);
  await writeFile(manifestPath,original);await rm(join(root,sqlPath));await assert.rejects(snapshotAiSource(root),/ENOENT/);
  await writeFile(join(root,sqlPath),sql);assert.deepEqual(await snapshotAiSource(root),current);
  assert.deepEqual(await snapshotAiSource(),current,'negative fixtures never mutate actual source');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('date override native reader exact final pin preserves all 193 prior entries and rejects drift',async()=>{
 const current=await snapshotAiSource(),pin=receiptProtocol.TIMETABLE_DATE_OVERRIDE_NATIVE_READER_MIGRATION;
 assert.deepEqual(pin,{fileName:'20261109015335_timetable_date_override_native_reader.sql',status:'final',sha256:'1344006e60eac96354b9547c11fec52d6b484ac808450b43124834799678fd44'});
 assert.ok(Object.isFrozen(pin));
 const sqlPath='supabase/migrations/'+pin.fileName;
 for(const path of [sqlPath,'supabase/rollbacks/'+pin.fileName,'supabase/tests/timetable_date_override_native_reader_test.sql']){
  assert.equal(receiptProtocol.AI_SOURCE_CLOSURE.filter(item=>item===path).length,1);
  assert.equal(current.closure.find(row=>row.path===path)?.sha256,hash(await readFile(path)));
 }
 assert.equal(current.closure.find(row=>row.path===sqlPath)?.sha256,pin.sha256);
 assert.deepEqual(current.migrations,CURRENT_AI_MIGRATIONS);assert.equal(CURRENT_AI_MIGRATIONS.length,11);
 const manifest=JSON.parse(await readFile('supabase/test-baselines/dashboard-free-tier-v1.manifest.json'));
 assert.equal(manifest.orderedNewMigrations.length,196);assert.deepEqual(manifest.orderedNewMigrations[193],pin);
 assert.equal(hash(JSON.stringify(manifest.orderedNewMigrations.slice(0,193))),'01d5b8a522c2dc84b5f6d16d7c6ca314e1dd6b7cbc58b8b75cca4acd3549b24c');
 const parent=join(repositoryRoot,'.codex-temp');await mkdir(parent,{recursive:true});
 const root=await mkdtemp(join(parent,'ai-receipt-date-override-native-reader-'));
 try{
  for(const file of [...receiptProtocol.AI_SOURCE_CLOSURE,...CURRENT_AI_MIGRATIONS.map(m=>'supabase/migrations/'+m.fileName)]){
   await mkdir(join(root,file,'..'),{recursive:true});await writeFile(join(root,file),await readFile(file));
  }
  const manifestPath=join(root,'supabase/test-baselines/dashboard-free-tier-v1.manifest.json'),original=await readFile(manifestPath);
  assert.deepEqual(await snapshotAiSource(root),current);
  const unknown={fileName:'20990101000000_unregistered_date_override_reader.sql',status:'final',sha256:hash('select 1;\n')};
  await writeFile(join(root,'supabase/migrations',unknown.fileName),'select 1;\n');
  for(const [label,mutate]of[
   ['missing',rows=>rows.splice(193,1)],['duplicate',rows=>rows.push({...pin})],
   ['same-length duplicate',rows=>rows[193]={...rows[192]}],
   ['reorder',rows=>{[rows[192],rows[193]]=[rows[193],rows[192]];}],
   ['candidate',rows=>rows[193].status='candidate'],['hash',rows=>rows[193].sha256='0'.repeat(64)],
   ['unknown addition',rows=>rows.push({...unknown})],['unknown replacement',rows=>rows[193]={...unknown}],
  ]){
   const changed=structuredClone(manifest);mutate(changed.orderedNewMigrations);await writeFile(manifestPath,JSON.stringify(changed));
   await assert.rejects(snapshotAiSource(root),/canonical manifest inventory|current migration manifest drift/,label);
  }
  await writeFile(manifestPath,original);
  const sql=await readFile(join(root,sqlPath)),drift=Buffer.concat([sql,Buffer.from('\n-- unreviewed native reader drift\n')]);
  await writeFile(join(root,sqlPath),drift);
  await assert.rejects(snapshotAiSource(root),/timetable date override native reader migration source drift/);
  const coordinated=structuredClone(manifest);coordinated.orderedNewMigrations[193].sha256=hash(drift);
  await writeFile(manifestPath,JSON.stringify(coordinated));
  await assert.rejects(snapshotAiSource(root),/current migration manifest drift/);
  await writeFile(manifestPath,original);await rm(join(root,sqlPath));await assert.rejects(snapshotAiSource(root),/ENOENT/);
  await writeFile(join(root,sqlPath),sql);assert.deepEqual(await snapshotAiSource(root),current);
  assert.deepEqual(await snapshotAiSource(),current,'negative fixtures never mutate actual source');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('context pgTAP embeds the exact published DO blocks and verified lifecycle core',async()=>{
 const name=receiptProtocol.LEGACY_CONTEXT_ADOPTION_REUSE_MIGRATION.fileName;
 const [sql,forward,recovery]=await Promise.all([
  readFile('supabase/tests/legacy_context_adoption_reuse_test.sql','utf8'),
  readFile('supabase/migrations/'+name,'utf8'),
  readFile('supabase/rollbacks/'+name,'utf8'),
 ]);
 const migrationDo=source=>{
  const start=source.indexOf('do $'),end=source.lastIndexOf('\ncommit;');
  assert.ok(start>=0&&end>start,'published artifact contains one transaction-scoped DO block');
  return source.slice(start,end).trim();
 };
 for(const [tag,artifact]of[['$forward$',forward],['$rollback$',recovery]]){
  const fragments=sql.split(tag);
  assert.equal(fragments.length,3,'one embedded '+tag+' literal');
  assert.equal(fragments[1],migrationDo(artifact));
 }
 const start=sql.indexOf('create function pg_temp.context_migration_sql(');
 const end=sql.indexOf('create temporary table context_lifecycle_results',start);
 assert.ok(start>=0&&end>start,'the lifecycle core precedes its pgTAP execution');
 // Same source as the completed 19-check isolated lifecycle, with one final LF.
 // The CI test uses only committed files; no private workspace artifact is read.
 assert.equal(hash(sql.slice(start,end).trimEnd()+'\n'),'f47d04db47001e9d4ba5e4de320f2cfd4dea134fbb813e5db965efe5983e3f1f');
 assert.ok(sql.includes('create temporary table context_lifecycle_results on commit drop as select * from pg_temp.context_lifecycle_checks();'));
 assert.ok(sql.includes("select is((select count(*) from context_lifecycle_results),19::bigint,'all nineteen context lifecycle checks execute');"));
 assert.ok(sql.includes('select ok(passed,label) from context_lifecycle_results;'));
 assert.ok(!sql.includes('LIFECYCLE_CHECKS_INSERT_HERE'));
});

test('legacy context adoption reuse exact final pin preserves all 194 prior entries and rejects drift',async()=>{
 const current=await snapshotAiSource(),pin=receiptProtocol.LEGACY_CONTEXT_ADOPTION_REUSE_MIGRATION;
 assert.deepEqual(pin,{fileName:'20261109122711_legacy_context_adoption_reuse.sql',status:'final',sha256:'8608efe5e2f2220021933beb68f9459960ae5313ca0c2b2490e1a7c5a833fbe4'});
 assert.ok(Object.isFrozen(pin));
 const sqlPath='supabase/migrations/'+pin.fileName;
 for(const path of [sqlPath,'supabase/rollbacks/'+pin.fileName,'supabase/tests/legacy_context_adoption_reuse_test.sql']){
  assert.equal(receiptProtocol.AI_SOURCE_CLOSURE.filter(item=>item===path).length,1);
  assert.equal(current.closure.find(row=>row.path===path)?.sha256,hash(await readFile(path)));
 }
 assert.equal(current.closure.find(row=>row.path===sqlPath)?.sha256,pin.sha256);
 assert.deepEqual(current.migrations,CURRENT_AI_MIGRATIONS);assert.equal(CURRENT_AI_MIGRATIONS.length,11);
 const manifest=JSON.parse(await readFile('supabase/test-baselines/dashboard-free-tier-v1.manifest.json'));
 assert.equal(manifest.orderedNewMigrations.length,196);assert.deepEqual(manifest.orderedNewMigrations[194],pin);
 assert.equal(hash(JSON.stringify(manifest.orderedNewMigrations.slice(0,194))),'1fcd7cc631ab371e7de7a9a5eb2bd875c81a3555ada3f95eb1aecbff069f4491');
 const parent=join(repositoryRoot,'.codex-temp');await mkdir(parent,{recursive:true});
 const root=await mkdtemp(join(parent,'ai-receipt-legacy-context-adoption-'));
 try{
  for(const file of [...receiptProtocol.AI_SOURCE_CLOSURE,...CURRENT_AI_MIGRATIONS.map(m=>'supabase/migrations/'+m.fileName)]){
   await mkdir(join(root,file,'..'),{recursive:true});await writeFile(join(root,file),await readFile(file));
  }
  const manifestPath=join(root,'supabase/test-baselines/dashboard-free-tier-v1.manifest.json'),original=await readFile(manifestPath);
  assert.deepEqual(await snapshotAiSource(root),current);
  const unknown={fileName:'20990101000000_unregistered_legacy_context_adoption.sql',status:'final',sha256:hash('select 1;\n')};
  await writeFile(join(root,'supabase/migrations',unknown.fileName),'select 1;\n');
  for(const [label,mutate]of[
   ['missing',rows=>rows.splice(194,1)],['duplicate',rows=>rows.push({...pin})],
   ['same-length duplicate',rows=>rows[194]={...rows[193]}],
   ['reorder',rows=>{[rows[193],rows[194]]=[rows[194],rows[193]];}],
   ['candidate',rows=>rows[194].status='candidate'],['hash',rows=>rows[194].sha256='0'.repeat(64)],
   ['unknown addition',rows=>rows.push({...unknown})],['unknown replacement',rows=>rows[194]={...unknown}],
  ]){
   const changed=structuredClone(manifest);mutate(changed.orderedNewMigrations);await writeFile(manifestPath,JSON.stringify(changed));
   await assert.rejects(snapshotAiSource(root),/canonical manifest inventory|current migration manifest drift/,label);
  }
  await writeFile(manifestPath,original);
  const sql=await readFile(join(root,sqlPath)),drift=Buffer.concat([sql,Buffer.from('\n-- unreviewed legacy context adoption drift\n')]);
  await writeFile(join(root,sqlPath),drift);
  await assert.rejects(snapshotAiSource(root),/legacy context adoption reuse migration source drift/);
  const coordinated=structuredClone(manifest);coordinated.orderedNewMigrations[194].sha256=hash(drift);
  await writeFile(manifestPath,JSON.stringify(coordinated));
  await assert.rejects(snapshotAiSource(root),/current migration manifest drift/);
  await writeFile(manifestPath,original);await rm(join(root,sqlPath));await assert.rejects(snapshotAiSource(root),/ENOENT/);
  await writeFile(join(root,sqlPath),sql);assert.deepEqual(await snapshotAiSource(root),current);
  assert.deepEqual(await snapshotAiSource(),current,'negative fixtures never mutate actual source');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('pair pgTAP binds exact recovery artifacts, body pins and nonbody guards',async()=>{
 const name=receiptProtocol.LEGACY_ADOPTION_PAIR_REUSE_MIGRATION.fileName;
 const [sql,forward,recovery]=await Promise.all([
  readFile('supabase/tests/legacy_adoption_pair_reuse_test.sql','utf8'),
  readFile('supabase/migrations/'+name,'utf8'),
  readFile('supabase/rollbacks/'+name,'utf8'),
 ]);
 const migrationDo=source=>{
  const start=source.indexOf('do $'),end=source.lastIndexOf('\ncommit;');
  assert.ok(start>=0&&end>start,'published artifact contains one transaction-scoped DO block');
  return source.slice(start,end).trim();
 };
 for(const [tag,artifact,fromMd5,toMd5]of[
  ['$forward$',forward,'16e95d3286be2806078c30c254bcf2b8','6566ec0f52e38ecea8aa4d63fd4cc7e9'],
  ['$rollback$',recovery,'6566ec0f52e38ecea8aa4d63fd4cc7e9','16e95d3286be2806078c30c254bcf2b8'],
 ]){
  const embedded=sql.split(tag);
  assert.equal(embedded.length,3,'one embedded '+tag+' literal');
  assert.equal(embedded[1],migrationDo(artifact));
  const body=artifact.split('$candidate_body$');
  assert.equal(body.length,3,'one replacement body literal');
  assert.equal(createHash('md5').update(body[1]).digest('hex'),toMd5,'pin binds actual replacement bytes');
  const apply=artifact.indexOf('execute replace(definition, c.prosrc, candidate_body);');
  assert.ok(apply>=0,'reuse the installed function header');
  for(const guard of[
   `md5(c.prosrc) is distinct from '${fromMd5}'`,
   "md5(s.prosrc) is distinct from '1d686cc9db164e9d43fe350f5d79c18a'",
   "is distinct from 'c73f03d09adb2972604eb5fb558a611f'",
   "is distinct from 'b9d10c2c5e9de854f44ce8a3d4061e35'",
   `md5(candidate_body) is distinct from '${toMd5}'`,
   'c.proowner is distinct from s.proowner or c.proacl is distinct from s.proacl',
   "pg_catalog.aclexplode(coalesce(c.proacl, pg_catalog.acldefault('f', c.proowner))) a where a.grantee <> c.proowner",
   "c.provolatile <> 's' or s.provolatile <> 's' or c.prosecdef or s.prosecdef",
   'or s.proisstrict',
   'c.proconfig is distinct from s.proconfig',
   'c.proconfig is null or cardinality(c.proconfig) <> 1',
   "not (c.proconfig[1] = any(array['search_path=', 'search_path=\"\"']))",
   "metadata_before := to_jsonb(c) - 'prosrc' - 'prosqlbody';",
   "length(definition) - length(replace(definition, c.prosrc, '')) <> length(c.prosrc)",
  ]){
   const at=artifact.indexOf(guard);
   assert.ok(at>=0&&at<apply,'guard precedes replacement: '+guard);
  }
  const after=artifact.slice(apply);
  assert.ok(after.includes("select p.prosrc, to_jsonb(p) - 'prosrc' - 'prosqlbody'"));
  assert.ok(after.includes(`md5(applied_body) is distinct from '${toMd5}'`));
  assert.ok(after.includes('metadata_after is distinct from metadata_before'));
  assert.ok(after.includes("using errcode = '55000'"),'post-apply mismatch aborts the transaction');
 }
 assert.ok(sql.includes('create function pg_temp.pair_migration_sql('));
 assert.ok(sql.includes('create function pg_temp.pair_lifecycle_checks('));
 assert.match(sql,/create (?:temp|temporary) table pair_lifecycle_results on commit drop as select \* from pg_temp\.pair_lifecycle_checks\(\);/u);
 assert.ok(sql.includes('select ok(passed,label) from pair_lifecycle_results;'));
 assert.match(sql,/select \* from finish\(\);\s*rollback;\s*$/u,'the complete pgTAP emits its plan and rolls back the fixture');
 assert.ok(!sql.includes('LIFECYCLE_CHECKS_INSERT_HERE'));
});

test('legacy adoption pair reuse exact final pin preserves all 195 prior entries and rejects drift',async()=>{
 const current=await snapshotAiSource(),pin=receiptProtocol.LEGACY_ADOPTION_PAIR_REUSE_MIGRATION;
 assert.deepEqual(pin,{fileName:'20261110022947_legacy_adoption_pair_reuse.sql',status:'final',sha256:'cc7864eb84265b3c6d57fbdfba627ddc82dc06252331ac8c1ba601010c21101f'});
 assert.ok(Object.isFrozen(pin));
 const sqlPath='supabase/migrations/'+pin.fileName;
 for(const path of [sqlPath,'supabase/rollbacks/'+pin.fileName,'supabase/tests/legacy_adoption_pair_reuse_test.sql']){
  assert.equal(receiptProtocol.AI_SOURCE_CLOSURE.filter(item=>item===path).length,1);
  assert.equal(current.closure.find(row=>row.path===path)?.sha256,hash(await readFile(path)));
 }
 assert.equal(current.closure.find(row=>row.path===sqlPath)?.sha256,pin.sha256);
 assert.deepEqual(current.migrations,CURRENT_AI_MIGRATIONS);assert.equal(CURRENT_AI_MIGRATIONS.length,11);
 const manifest=JSON.parse(await readFile('supabase/test-baselines/dashboard-free-tier-v1.manifest.json'));
 assert.equal(manifest.orderedNewMigrations.length,196);assert.deepEqual(manifest.orderedNewMigrations[195],pin);
 assert.equal(hash(JSON.stringify(manifest.orderedNewMigrations.slice(0,195))),'2f8f56a09eb7ddcaf0f1eb4c16bb287802e25a42df4186de7acdec325c434949');
 const parent=join(repositoryRoot,'.codex-temp');await mkdir(parent,{recursive:true});
 const root=await mkdtemp(join(parent,'ai-receipt-legacy-adoption-pair-'));
 try{
  for(const file of [...receiptProtocol.AI_SOURCE_CLOSURE,...CURRENT_AI_MIGRATIONS.map(m=>'supabase/migrations/'+m.fileName)]){
   await mkdir(join(root,file,'..'),{recursive:true});await writeFile(join(root,file),await readFile(file));
  }
  const manifestPath=join(root,'supabase/test-baselines/dashboard-free-tier-v1.manifest.json'),original=await readFile(manifestPath);
  assert.deepEqual(await snapshotAiSource(root),current);
  const unknown={fileName:'20990101000000_unregistered_legacy_adoption_pair.sql',status:'final',sha256:hash('select 1;\n')};
  await writeFile(join(root,'supabase/migrations',unknown.fileName),'select 1;\n');
  for(const [label,mutate]of[
   ['missing',rows=>rows.splice(195,1)],['duplicate',rows=>rows.push({...pin})],
   ['same-length duplicate',rows=>rows[195]={...rows[194]}],
   ['reorder',rows=>{[rows[194],rows[195]]=[rows[195],rows[194]];}],
   ['candidate',rows=>rows[195].status='candidate'],['hash',rows=>rows[195].sha256='0'.repeat(64)],
   ['unknown addition',rows=>rows.push({...unknown})],['unknown replacement',rows=>rows[195]={...unknown}],
  ]){
   const changed=structuredClone(manifest);mutate(changed.orderedNewMigrations);await writeFile(manifestPath,JSON.stringify(changed));
   await assert.rejects(snapshotAiSource(root),/canonical manifest inventory|current migration manifest drift/,label);
  }
  await writeFile(manifestPath,original);
  const sql=await readFile(join(root,sqlPath)),drift=Buffer.concat([sql,Buffer.from('\n-- unreviewed legacy adoption pair drift\n')]);
  await writeFile(join(root,sqlPath),drift);
  await assert.rejects(snapshotAiSource(root),/legacy adoption pair reuse migration source drift/);
  const coordinated=structuredClone(manifest);coordinated.orderedNewMigrations[195].sha256=hash(drift);
  await writeFile(manifestPath,JSON.stringify(coordinated));
  await assert.rejects(snapshotAiSource(root),/current migration manifest drift/);
  await writeFile(manifestPath,original);await rm(join(root,sqlPath));await assert.rejects(snapshotAiSource(root),/ENOENT/);
  await writeFile(join(root,sqlPath),sql);assert.deepEqual(await snapshotAiSource(root),current);
  assert.deepEqual(await snapshotAiSource(),current,'negative fixtures never mutate actual source');
 }finally{await rm(root,{recursive:true,force:true});}
});
