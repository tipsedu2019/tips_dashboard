// Orchestration-only tests: every child process below is synthetic. These tests
// never establish a SQL/pgTAP runtime PASS or satisfy the isolated DB gate.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { parseWithdrawalPrefixArguments, injectWithdrawalPrefixFailure, runWithdrawalHoursPrefixQa, WITHDRAWAL_PREFIX_FILES } from '../scripts/run-teacher-withdrawal-hours-prefix-qa.mjs';
import { AI_CREDENTIAL_PREFIX } from '../scripts/lib/ai-producer-receipt.mjs';
import { validateIsolatedMigrationLedger } from '../scripts/run-isolated-supabase-db-tests.mjs';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const revisions = ['--review-base-sha','a'.repeat(40),'--review-head-sha','b'.repeat(40)];
const execution = ['--execute','--authorized','--request-id','teacher-hours-prefix-unit',...revisions];
const originals = ['begin;\nselect 1;\ncommit;\n','begin;\nselect 2;\ncommit;\n'];
const early = '20260930000000_early_fixture.sql';
const prior = '20261027005334_teacher_own_request_workflow.sql';
const suffix = '20261031120000_class_close_occupancy_release.sql';
const unexpected = '20261101000000_unregistered.sql';
const fixtures = Array.from({length:7},(_,i)=>`${String(i).padStart(14,'0')}_fixture.sql`);

test('prefix wrapper requires explicit execution authority and both source revisions', () => {
  assert.equal(parseWithdrawalPrefixArguments(revisions).execute, false);
  assert.equal(parseWithdrawalPrefixArguments(execution).execute, true);
  for (const args of [[],['--execute',...revisions],['--authorized',...revisions],['--execute','--authorized','--request-id','short',...revisions],['--execute','--authorized','--request-id','teacher-hours-prefix-unit','--review-head-sha','b'.repeat(40)],['--base','x',...revisions],[...revisions,'--review-head-sha','c'.repeat(40)]]) assert.throws(() => parseWithdrawalPrefixArguments(args));
});
test('fault injection preserves all migration bytes except the final transaction checkpoint', () => {
  const changed = injectWithdrawalPrefixFailure(originals[1]);
  assert.ok(changed.startsWith('begin;\nselect 2;\n'));
  assert.match(changed,/teacher_withdrawal_prefix_injected_failure/); assert.match(changed,/23514/); assert.ok(changed.endsWith('commit;\n'));
  assert.throws(() => injectWithdrawalPrefixFailure('select 2;\n'));
  assert.throws(() => injectWithdrawalPrefixFailure('begin; commit; select 2;'));
});

async function setup(t, failure = '', withSuffix = false, withCredential = false, injectedResult = null) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(),'withdrawal-prefix-unit-')); t.after(() => fs.rm(directory,{recursive:true,force:true}));
  const root = path.join(directory,'source'), runtime = path.join(directory,'tips-supabase-db-qa-teacher-hours-prefix-unit');
  const sourceDirectory=path.join(root,'supabase','migrations'), stagedDirectory=path.join(runtime,'supabase','migrations');
  await fs.mkdir(sourceDirectory,{recursive:true}); await fs.mkdir(path.join(root,'supabase','tests'),{recursive:true});
  await fs.mkdir(path.join(root,'supabase','test-baselines'),{recursive:true}); await fs.mkdir(stagedDirectory,{recursive:true});
  const all = [...(withCredential?[early,AI_CREDENTIAL_PREFIX.migration]:[]),prior,...WITHDRAWAL_PREFIX_FILES,...(withSuffix?[suffix]:[])]; const versions=all.map(file=>file.slice(0,14));
  const sources = new Map(all.map(file=>[file,WITHDRAWAL_PREFIX_FILES.includes(file)?originals[WITHDRAWAL_PREFIX_FILES.indexOf(file)]:file===suffix?'begin;\nselect 3;\ncommit;\n':'begin; select 0; commit;\n']));
  const entries=all.map(fileName=>({fileName,status:'final',sha256:hash(sources.get(fileName))}));
  const manifestPath=path.join(root,'supabase','test-baselines','dashboard-free-tier-v1.manifest.json');
  const writeManifest=()=>fs.writeFile(manifestPath,JSON.stringify({orderedNewMigrations:entries}));
  await writeManifest();
  for(const [file,bytes] of sources) await fs.writeFile(path.join(sourceDirectory,file),bytes);
  await fs.writeFile(path.join(root,'supabase','tests','teacher_withdrawal_hours_prefix_test.sql'),'begin; select no_plan(); select * from finish(); rollback;\n');
  await fs.writeFile(path.join(runtime,'supabase','config.toml'),'project_id = "tips_supabase_db_qa_012345abcdef"\n');
  const calls=[],logs=[],stages=[],finalSnapshots=[]; let applied=[]; let schema='0'.repeat(32),writer='1'.repeat(32),mutation='5'.repeat(32),effects='4'.repeat(32); let restored=false,failedOnce=false,testCount=0;
  const executeProcess=async invocation=>{
    const args=invocation.args; calls.push(args);
    if(args[0]==='network'&&args[1]==='create') return {code:0,stdout:'d'.repeat(64),stderr:''};
    if(args[0]==='migration'&&args[1]==='up') {
      const staged=await fs.readdir(stagedDirectory), forward=all.filter(file=>staged.includes(file));
      if(forward.length) stages.push([...forward]);
      if(staged.includes(WITHDRAWAL_PREFIX_FILES[1])) {
        const source=await fs.readFile(path.join(stagedDirectory,WITHDRAWAL_PREFIX_FILES[1]),'utf8');
        if(source.includes('teacher_withdrawal_prefix_injected_failure')) {
          assert.equal(applied.includes(WITHDRAWAL_PREFIX_FILES[0].slice(0,14)),true);
          failedOnce=true;
          if(injectedResult!==null)return injectedResult;
          if(failure==='unexpected-success') {applied=[...versions]; schema='2'.repeat(32); return {code:0,stdout:'',stderr:''};}
          if(failure==='source-echo') return {code:1,stdout:"raise exception 'teacher_withdrawal_prefix_injected_failure' using errcode='23514'",stderr:'ERROR: syntax_error (SQLSTATE 42601)'};
          if(failure==='wrong-error') return {code:1,stdout:'',stderr:'ERROR: teacher_withdrawal_prefix_injected_failure (SQLSTATE 42601)'};
          if(failure==='partial-commit') schema='f'.repeat(32);
          if(failure==='data-drift') effects='f'.repeat(32);
          if(failure==='ledger-drift') applied=[...versions];
          if(failure==='late-unexpected-file') await fs.writeFile(path.join(stagedDirectory,unexpected),'select 9;');
          return {code:1,stdout:'',stderr:'ERROR: teacher_withdrawal_prefix_injected_failure (SQLSTATE 23514)'};
        }
        assert.equal(source,originals[1]); restored=true;
        applied=forward.map(file=>file.slice(0,14));schema=staged.includes(suffix)?'9'.repeat(32):'2'.repeat(32);
        if(failure==='retry-ledger-drift'&&!staged.includes(suffix))applied=versions.slice(0,2);
        if(failure==='suffix-ledger-drift'&&staged.includes(suffix))applied=versions.slice(0,3);
        if(failure==='suffix-reappears'&&!staged.includes(suffix))await fs.writeFile(path.join(stagedDirectory,suffix),'select 999;');
      } else if(staged.includes(WITHDRAWAL_PREFIX_FILES[0])) {applied=forward.map(file=>file.slice(0,14));schema='3'.repeat(32);writer='6'.repeat(32);if(failure==='first-mutation-change')mutation='f'.repeat(32);}
      else {applied=forward.map(file=>file.slice(0,14));if(failure==='credential-ledger-drift'&&forward.includes(AI_CREDENTIAL_PREFIX.migration))applied=[];}
      return {code:0,stdout:'',stderr:''};
    }
    if(args[0]==='migration'&&args[1]==='list') {
      const staged=await fs.readdir(stagedDirectory);
      const rows=fixtures.map(file=>({local:file.slice(0,14),remote:file.slice(0,14)}));
      rows.push(...all.filter(file=>staged.includes(file)).map(file=>({local:file.slice(0,14),remote:applied.includes(file.slice(0,14))?file.slice(0,14):null})));
      return {code:0,stdout:JSON.stringify({message:'Migrations listed',migrations:rows}),stderr:''};
    }
    if(args[0]==='exec'&&args.includes('psql')) return {code:0,stdout:JSON.stringify({schema,writer,mutation,effects}),stderr:''};
    if(args[0]==='test'&&args[1]==='db') {
      if(args.includes('supabase/tests/teacher_withdrawal_hours_snapshot_test.sql')){
        finalSnapshots.push([...applied]);assert.deepEqual(applied,versions);
        return failure==='final-suite-failure'?{code:1,stdout:'Result: FAIL',stderr:''}:{code:0,stdout:'Files=1, Tests=12, 1 wallclock secs\nResult: PASS\n',stderr:''};
      }
      if(args.includes(AI_CREDENTIAL_PREFIX.test)){
        assert.deepEqual(applied,versions.slice(0,2));
        return failure==='credential-test-failure'?{code:1,stdout:'Result: FAIL',stderr:''}:{code:0,stdout:'Files=1, Tests=12, 1 wallclock secs\nResult: PASS\n',stderr:''};
      }
      testCount++;
      if(failure==='retry-drift'&&testCount===3)await fs.writeFile(path.join(stagedDirectory,WITHDRAWAL_PREFIX_FILES[0]),'select 999;');
      return failure==='prefix-failure'&&failedOnce?{code:1,stdout:'Result: FAIL',stderr:''}:{code:0,stdout:'Files=1, Tests=12, 1 wallclock secs\nResult: PASS\n',stderr:''};
    }
    return {code:0,stdout:'',stderr:''};
  };
  const runIsolated=async options=>{
    assert.ok(options.argv.includes('--verify-local-ledger')); assert.ok(options.argv.includes('--require-final'));
    assert.equal(options.argv[options.argv.indexOf('--test')+1],'supabase/tests/teacher_withdrawal_hours_snapshot_test.sql');
    const invocation={command:'supabase',args:['migration','up','--local','--workdir',runtime,'--include-all'],cwd:runtime,env:{PATH:process.env.PATH}};
    await options.executeProcess(invocation); // early unrelated call must pass through
    await options.executeNetwork({command:'docker',args:['network','create'],cwd:runtime,env:{PATH:process.env.PATH}});
    if(failure!=='unverified-network') options.log(JSON.stringify({event:'isolated_supabase_db_network_verified',internal:true,exclusive:true,beforeRepositorySql:true}));
    for(const file of fixtures)await fs.writeFile(path.join(stagedDirectory,file),'begin; select 0; commit;\n');
    await options.executeProcess(invocation); // verified runner's committed fixture prerequisite
    for(const [file,bytes]of sources)await fs.writeFile(path.join(stagedDirectory,file),bytes);
    if(failure==='fixture-drift')await fs.writeFile(path.join(stagedDirectory,fixtures[0]),'select 999;');
    if(failure==='fixture-missing')await fs.rm(path.join(stagedDirectory,fixtures[0]));
    if(failure==='staged-missing')await fs.rm(path.join(stagedDirectory,WITHDRAWAL_PREFIX_FILES[1]));
    if(failure==='staged-suffix-drift')await fs.writeFile(path.join(stagedDirectory,suffix),'select 999;');
    if(failure==='unexpected-file')await fs.writeFile(path.join(stagedDirectory,unexpected),'select 999;');
    try {
      if(withCredential&&failure!=='credential-skipped'){
        // Match the real runner: stage all, withhold the exact suffix at the AI
        // credential boundary, commit/test it, emit its receipt, restore suffix.
        for(const file of all.slice(2))await fs.rm(path.join(stagedDirectory,file));
        if(failure==='credential-prefix-missing')await fs.rm(path.join(stagedDirectory,early));
        if(failure==='credential-prefix-hash')await fs.writeFile(path.join(stagedDirectory,AI_CREDENTIAL_PREFIX.migration),'select 999;');
        if(failure==='credential-prefix-extra')await fs.writeFile(path.join(stagedDirectory,unexpected),'select 999;');
        if(failure==='credential-wrong-boundary')await fs.writeFile(path.join(stagedDirectory,prior),sources.get(prior));
        const prefix=await options.executeProcess(invocation);assert.equal(prefix.code,0);
        const list=await options.executeProcess({...invocation,args:['migration','list','--local','--workdir',runtime,'--output-format','json']});
        validateIsolatedMigrationLedger(list.stdout,{forwardVersions:versions.slice(0,2)});
        const testResult=await options.executeProcess({...invocation,args:['test','db','--local','--workdir',runtime,AI_CREDENTIAL_PREFIX.test]});
        if(testResult.code!==0)throw new Error('synthetic_credential_test_failed');
        if(failure!=='credential-missing-receipt')options.log(JSON.stringify({event:'isolated_ai_credential_committed_prefix_passed',...AI_CREDENTIAL_PREFIX,committed:true,...(failure==='credential-wrong-receipt'?{test:'supabase/tests/other_test.sql'}:{})}));
        if(failure==='credential-repeated')await options.executeProcess(invocation);
        for(const file of all.slice(2))await fs.writeFile(path.join(stagedDirectory,file),sources.get(file));
        if(failure==='credential-then-missing-pair')await fs.rm(path.join(stagedDirectory,WITHDRAWAL_PREFIX_FILES[1]));
      }
      await options.executeProcess(invocation);
      const final=await options.executeProcess({...invocation,args:['test','db','--local','--workdir',runtime,'supabase/tests/teacher_withdrawal_hours_snapshot_test.sql']});
      return {status:final.code===0?'passed':'failed'}; // synthetic driver result, not real SQL evidence
    } finally {
      if(stages.some(files=>files.includes(WITHDRAWAL_PREFIX_FILES[0])))for(const file of all.slice(1))assert.equal(await fs.readFile(path.join(stagedDirectory,file),'utf8'),sources.get(file));
      for(const [file,bytes]of sources)assert.equal(await fs.readFile(path.join(sourceDirectory,file),'utf8'),bytes);
    }
  };
  return {root,calls,logs,stages,finalSnapshots,entries,writeManifest,sourceDirectory,run:()=>runWithdrawalHoursPrefixQa({argv:execution,root,runIsolated,executeProcess,log:entry=>logs.push(JSON.parse(entry))}),restored:()=>restored};
}

test('mock orchestration observes committed base/prefix, failure rollback and exact-byte retry in order', async t=>{
  const h=await setup(t);const result=await h.run();
  assert.equal(result.verification.withdrawalPrefix.rollbackVerified,true);assert.equal(h.restored(),true);
  assert.deepEqual(h.logs.filter(x=>x.event==='withdrawal_hours_boundary_test').map(x=>x.phase),['base','first_committed','failed_second_rollback']);
  assert.equal(h.calls.filter(args=>args[0]==='test').length,4);
});
test('later class-close suffix stays absent through both committed boundaries and rollback, then applies after exact-byte retry',async t=>{
  const h=await setup(t,'',true);const result=await h.run();
  assert.deepEqual(h.stages,[[prior],[prior,WITHDRAWAL_PREFIX_FILES[0]],[prior,...WITHDRAWAL_PREFIX_FILES],[prior,...WITHDRAWAL_PREFIX_FILES],[prior,...WITHDRAWAL_PREFIX_FILES,suffix]]);
  const v=result.verification.withdrawalPrefix;
  assert.equal(v.retryCommitted,true);assert.equal(v.suffixCommitted,true);
  assert.deepEqual(v.migrations.map(x=>x.fileName),WITHDRAWAL_PREFIX_FILES);
  assert.deepEqual(v.suffixMigrations.map(x=>x.fileName),[suffix]);
  assert.equal(v.forwardMigrations,4);
  assert.deepEqual(h.finalSnapshots,[[prior,...WITHDRAWAL_PREFIX_FILES,suffix].map(file=>file.slice(0,14))]);
  assert.deepEqual(h.logs.filter(x=>x.event==='withdrawal_hours_boundary_test').map(x=>x.phase),['base','first_committed','failed_second_rollback']);
});
for(const [failure,reason]of Object.entries({
  'unexpected-success':'expected_fault_missing','wrong-error':'expected_fault_missing','source-echo':'expected_fault_missing',
  'partial-commit':'failed_second_rollback_drift','data-drift':'failed_second_rollback_drift','ledger-drift':'failed_second_rollback_drift',
  'first-mutation-change':'first_boundary_changed_mutation_or_data','prefix-failure':'child_failed','unverified-network':'network_unverified',
  'fixture-drift':'staged_source_drift','fixture-missing':'staged_files_invalid',
  'staged-missing':'staged_files_invalid','staged-suffix-drift':'staged_source_drift','unexpected-file':'staged_files_invalid',
  'late-unexpected-file':'staged_files_invalid','retry-drift':'staged_source_drift','suffix-reappears':'staged_files_invalid',
  'final-suite-failure':'boundaries_not_completed',
  'retry-ledger-drift':'isolated_supabase_db_ledger_drift','suffix-ledger-drift':'isolated_supabase_db_ledger_drift'
}))test(`mock orchestration rejects ${failure} with the later suffix preserved`,async t=>{
  const h=await setup(t,failure,true);await assert.rejects(h.run(),new RegExp(reason));
  if(!['suffix-reappears','retry-ledger-drift','suffix-ledger-drift','final-suite-failure'].includes(failure))assert.equal(h.restored(),false);
});
for(const [name,change]of Object.entries({
  missing:entries=>entries.splice(1,1), reordered:entries=>entries.splice(1,2,entries[2],entries[1]),
  duplicate:entries=>entries.splice(2,0,{...entries[1]}),
  malformed:entries=>{entries[3].fileName='../20261031120000_escape.sql';},
  nonfinal:entries=>{entries[3].status='draft';}, hash:entries=>{entries[3].sha256='f'.repeat(64);}
}))test(`manifest ${name} is rejected before child execution`,async t=>{
  const h=await setup(t,'',true);change(h.entries);await h.writeManifest();
  await assert.rejects(h.run(),/withdrawal_prefix_(migration_pair_invalid|migration_manifest_invalid|migration_hash_drift)/);
  assert.equal(h.calls.length,0);
});

test('real runner credential committed-prefix phase completes before withdrawal/suffix boundaries',async t=>{
  const h=await setup(t,'',true,true);const result=await h.run();
  const before=[early,AI_CREDENTIAL_PREFIX.migration,prior];
  assert.deepEqual(h.stages,[[early,AI_CREDENTIAL_PREFIX.migration],before,[...before,WITHDRAWAL_PREFIX_FILES[0]],[...before,...WITHDRAWAL_PREFIX_FILES],[...before,...WITHDRAWAL_PREFIX_FILES],[...before,...WITHDRAWAL_PREFIX_FILES,suffix]]);
  assert.equal(h.logs.filter(x=>x.event==='isolated_ai_credential_committed_prefix_passed').length,1);
  assert.equal(h.calls.filter(args=>args.includes(AI_CREDENTIAL_PREFIX.test)).length,1);
  assert.equal(result.verification.withdrawalPrefix.rollbackVerified,true);
});
for(const [failure,reason]of Object.entries({
  'credential-prefix-missing':'staged_files_invalid','credential-prefix-hash':'staged_source_drift',
  'credential-prefix-extra':'staged_files_invalid','credential-wrong-boundary':'staged_files_invalid',
  'credential-ledger-drift':'isolated_supabase_db_ledger_drift','credential-test-failure':'synthetic_credential_test_failed',
  'credential-missing-receipt':'credential_prefix_phase_invalid','credential-wrong-receipt':'credential_prefix_phase_invalid',
  'credential-repeated':'credential_prefix_phase_invalid','credential-skipped':'credential_prefix_phase_invalid',
  'credential-then-missing-pair':'staged_files_invalid'
}))test(`real runner credential phase rejects ${failure} before withdrawal work`,async t=>{
  const h=await setup(t,failure,true,true);await assert.rejects(h.run(),new RegExp(reason));
  assert.equal(h.logs.filter(x=>x.event==='withdrawal_hours_boundary_test').length,0);
  assert.equal(h.restored(),false);
});

const faultDiagnosticEvent='withdrawal_hours_prefix_fault_mismatch';
const exactFaultLine='ERROR: teacher_withdrawal_prefix_injected_failure (SQLSTATE 23514)';
for(const [name,result,exitCode]of [
  ['wrong SQLSTATE',{code:1,stdout:'',stderr:'ERROR: teacher_withdrawal_prefix_injected_failure (SQLSTATE 42601)'},1],
  ['SQL source echo',{code:1,stdout:"raise exception 'teacher_withdrawal_prefix_injected_failure' using errcode='23514'",stderr:'ERROR: syntax_error (SQLSTATE 42601)'},1],
  ['unexpected success',{code:0,stdout:'completed',stderr:''},0],
  ['success with expected error text',{code:0,stdout:'',stderr:exactFaultLine},0],
  ['noninteger exit code',{code:'failed',stdout:'',stderr:'ERROR: different_error (SQLSTATE 42601)'},null]
])test(`fault mismatch diagnostics: ${name} stays rejected with one bounded event`,async t=>{
  const h=await setup(t,'',true,true,result);
  await assert.rejects(h.run(),/withdrawal_prefix_expected_fault_missing/);
  const events=h.logs.filter(entry=>entry.event===faultDiagnosticEvent);
  assert.equal(events.length,1);
  assert.deepEqual(Object.keys(events[0]).sort(),['event','exitCode','stderr','stdout']);
  assert.equal(events[0].exitCode,exitCode);
  assert.equal(events[0].stdout,result.stdout);assert.equal(events[0].stderr,result.stderr);
  assert.equal(h.restored(),false);
  assert.deepEqual(h.logs.filter(entry=>entry.event==='withdrawal_hours_boundary_test').map(entry=>entry.phase),['base','first_committed']);
});
test('fault mismatch diagnostics: credential canaries are redacted in both streams and nowhere logged raw',async t=>{
  const secrets=['synthetic_db_password_81','synthetic_bearer_82','synthetic_key_83','synthetic_secret_84','synthetic_token_85','eyJsyntheticAAAA.syntheticBBBB.syntheticCCCC','sbp_synthetic_86','sb_secret_synthetic_87'];
  const credentialLines=[`postgres://unit:${secrets[0]}@localhost/unit`,`authorization: Bearer ${secrets[1]}`,`api_key="${secrets[2]}"`,`secret='${secrets[3]}'`,`token=${secrets[4]}`,secrets[5],secrets[6],secrets[7]].join('\n');
  const h=await setup(t,'',true,true,{code:2,stdout:credentialLines,stderr:credentialLines+'\nERROR: different_error (SQLSTATE 42601)'});
  await assert.rejects(h.run(),/withdrawal_prefix_expected_fault_missing/);
  const events=h.logs.filter(entry=>entry.event===faultDiagnosticEvent);assert.equal(events.length,1);
  assert.equal(events[0].exitCode,2);
  for(const stream of ['stdout','stderr']){
    assert.match(events[0][stream],/\[redacted\]/);assert.ok(events[0][stream].length<=8000);
  }
  const allLogs=JSON.stringify(h.logs);
  for(const secret of secrets)assert.equal(allLogs.includes(secret),false,`raw canary must not enter logs: ${secret}`);
  assert.match(events[0].stderr,/SQLSTATE 42601/);
});
test('fault mismatch diagnostics: each sanitized stream retains at most the final 8000 characters',async t=>{
  const result={code:1,stdout:'s'.repeat(8100)+'stdout-tail',stderr:'e'.repeat(8100)+'stderr-tail (SQLSTATE 42601)'};
  const h=await setup(t,'',true,true,result);await assert.rejects(h.run(),/withdrawal_prefix_expected_fault_missing/);
  const events=h.logs.filter(entry=>entry.event===faultDiagnosticEvent);assert.equal(events.length,1);
  for(const stream of ['stdout','stderr']){assert.equal(events[0][stream].length,8000);assert.equal(events[0][stream],result[stream].slice(-8000));}
});
test('fault mismatch diagnostics: expected failure and successful rollback/retry emit no mismatch event',async t=>{
  const h=await setup(t,'',true,true);const result=await h.run();
  assert.equal(result.verification.withdrawalPrefix.rollbackVerified,true);
  assert.equal(result.verification.withdrawalPrefix.retryCommitted,true);
  assert.equal(h.logs.filter(entry=>entry.event===faultDiagnosticEvent).length,0);
});
