// Orchestration-only tests: every child process below is synthetic. These tests
// never establish a SQL/pgTAP runtime PASS or satisfy the isolated DB gate.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { parseWithdrawalPrefixArguments, injectWithdrawalPrefixFailure, runWithdrawalHoursPrefixQa, WITHDRAWAL_PREFIX_FILES } from '../scripts/run-teacher-withdrawal-hours-prefix-qa.mjs';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const revisions = ['--review-base-sha','a'.repeat(40),'--review-head-sha','b'.repeat(40)];
const execution = ['--execute','--authorized','--request-id','teacher-hours-prefix-unit',...revisions];
const originals = ['begin;\nselect 1;\ncommit;\n','begin;\nselect 2;\ncommit;\n'];
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
async function setup(t, failure = '') {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(),'withdrawal-prefix-unit-')); t.after(() => fs.rm(directory,{recursive:true,force:true}));
  const root = path.join(directory,'source'), runtime = path.join(directory,'tips-supabase-db-qa-teacher-hours-prefix-unit');
  await fs.mkdir(path.join(root,'supabase','migrations'),{recursive:true}); await fs.mkdir(path.join(root,'supabase','tests'),{recursive:true});
  await fs.mkdir(path.join(root,'supabase','test-baselines'),{recursive:true}); await fs.mkdir(path.join(runtime,'supabase','migrations'),{recursive:true});
  const prior = '20261027005334_teacher_own_request_workflow.sql';
  const all = [prior,...WITHDRAWAL_PREFIX_FILES]; const versions=all.map(file=>file.slice(0,14));
  const entries=all.map((fileName,i)=>({fileName,status:'final',sha256:hash(i?originals[i-1]:'begin; select 0; commit;\n')}));
  await fs.writeFile(path.join(root,'supabase','test-baselines','dashboard-free-tier-v1.manifest.json'),JSON.stringify({orderedNewMigrations:entries}));
  for(const [i,file] of WITHDRAWAL_PREFIX_FILES.entries()) await fs.writeFile(path.join(root,'supabase','migrations',file),originals[i]);
  await fs.writeFile(path.join(root,'supabase','tests','teacher_withdrawal_hours_prefix_test.sql'),'begin; select no_plan(); select * from finish(); rollback;\n');
  await fs.writeFile(path.join(runtime,'supabase','config.toml'),'project_id = "tips_supabase_db_qa_012345abcdef"\n');
  const calls=[],logs=[]; let applied=[]; let schema='0'.repeat(32); let writer='1'.repeat(32); let mutation='5'.repeat(32); let count=0; let restored=false;
  const executeProcess=async invocation=>{
    const args=invocation.args; calls.push(args);
    if(args[0]==='network'&&args[1]==='create') return {code:0,stdout:'d'.repeat(64),stderr:''};
    if(args[0]==='migration'&&args[1]==='up') {
      count++;
      const staged=await fs.readdir(path.join(runtime,'supabase','migrations'));
      if(staged.includes(WITHDRAWAL_PREFIX_FILES[1])) {
        const source=await fs.readFile(path.join(runtime,'supabase','migrations',WITHDRAWAL_PREFIX_FILES[1]),'utf8');
        if(source.includes('teacher_withdrawal_prefix_injected_failure')) {
          assert.equal(applied.includes(versions[1]),true);
          if(failure==='unexpected-success') {applied=[...versions]; schema='2'.repeat(32); return {code:0,stdout:'',stderr:''};}
          if(failure==='source-echo') return {code:1,stdout:"raise exception 'teacher_withdrawal_prefix_injected_failure' using errcode='23514'",stderr:'ERROR: syntax_error (SQLSTATE 42601)'};
          if(failure==='wrong-error') return {code:1,stdout:'',stderr:'ERROR 42601 syntax_error'};
          if(failure==='partial-commit') schema='f'.repeat(32);
          if(failure==='ledger-drift') applied=[...versions];
          return {code:1,stdout:'',stderr:'ERROR: teacher_withdrawal_prefix_injected_failure (SQLSTATE 23514)'};
        }
        assert.equal(source,originals[1]); restored=true; applied=[...versions];schema='2'.repeat(32);
      } else if(staged.includes(WITHDRAWAL_PREFIX_FILES[0])) {applied=versions.slice(0,2);schema='3'.repeat(32);writer='6'.repeat(32);if(failure==='first-mutation-change')mutation='f'.repeat(32);}
      else applied=versions.slice(0,1);
      return {code:0,stdout:'',stderr:''};
    }
    if(args[0]==='migration'&&args[1]==='list') {
      const staged=await fs.readdir(path.join(runtime,'supabase','migrations'));
      const rows=Array.from({length:7},(_,i)=>({local:String(i).padStart(14,'0'),remote:String(i).padStart(14,'0')}));
      rows.push(...all.filter(file=>staged.includes(file)).map(file=>({local:file.slice(0,14),remote:applied.includes(file.slice(0,14))?file.slice(0,14):null})));
      return {code:0,stdout:JSON.stringify({message:'Migrations listed',migrations:rows}),stderr:''};
    }
    if(args[0]==='exec'&&args.includes('psql')) return {code:0,stdout:JSON.stringify({schema,writer,mutation,effects:'4'.repeat(32)}),stderr:''};
    if(args[0]==='test'&&args[1]==='db') return failure==='prefix-failure'&&count>=3?{code:1,stdout:'Result: FAIL',stderr:''}:{code:0,stdout:'Files=1, Tests=12, 1 wallclock secs\nResult: PASS\n',stderr:''};
    return {code:0,stdout:'',stderr:''};
  };
  const runIsolated=async options=>{
    assert.ok(options.argv.includes('--verify-local-ledger')); assert.ok(options.argv.includes('--require-final'));
    await options.executeProcess({command:'supabase',args:['migration','up','--local'],cwd:runtime,env:{PATH:process.env.PATH}}); // early unrelated call must pass through
    await fs.writeFile(path.join(runtime,'supabase','migrations',prior),'begin; select 0; commit;\n');
    for(const [i,file]of WITHDRAWAL_PREFIX_FILES.entries())await fs.writeFile(path.join(runtime,'supabase','migrations',file),originals[i]);
    await options.executeNetwork({command:'docker',args:['network','create'],cwd:runtime,env:{PATH:process.env.PATH}});
    if(failure!=='unverified-network') options.log(JSON.stringify({event:'isolated_supabase_db_network_verified',internal:true,exclusive:true,beforeRepositorySql:true}));
    try {
      await options.executeProcess({command:'supabase',args:['migration','up','--local','--workdir',runtime,'--include-all'],cwd:runtime,env:{PATH:process.env.PATH}});
      return {status:'passed'}; // synthetic driver result, not real SQL evidence
    } finally {
      for(const [i,file]of WITHDRAWAL_PREFIX_FILES.entries())assert.equal(await fs.readFile(path.join(runtime,'supabase','migrations',file),'utf8'),originals[i]);
    }
  };
  return {root,calls,logs,run:()=>runWithdrawalHoursPrefixQa({argv:execution,root,runIsolated,executeProcess,log:entry=>logs.push(JSON.parse(entry))}),restored:()=>restored};
}
test('mock orchestration observes committed base/prefix, failure rollback and exact-byte retry in order', async t=>{
  const h=await setup(t);const result=await h.run();
  assert.equal(result.verification.withdrawalPrefix.rollbackVerified,true);assert.equal(h.restored(),true);
  assert.deepEqual(h.logs.filter(x=>x.event==='withdrawal_hours_boundary_test').map(x=>x.phase),['base','first_committed','failed_second_rollback']);
  assert.equal(h.calls.filter(args=>args[0]==='test').length,3);
});
for(const failure of ['unexpected-success','wrong-error','source-echo','partial-commit','ledger-drift','first-mutation-change','prefix-failure','unverified-network'])test(`mock orchestration stops and restores original files for ${failure}`,async t=>{
 const expected={ 'unexpected-success':'expected_fault_missing','wrong-error':'expected_fault_missing','source-echo':'expected_fault_missing','partial-commit':'failed_second_rollback_drift','ledger-drift':'failed_second_rollback_drift','first-mutation-change':'first_boundary_changed_mutation_or_data','prefix-failure':'child_failed','unverified-network':'network_unverified' };
 const h=await setup(t,failure);await assert.rejects(h.run(),new RegExp('withdrawal_prefix_'+expected[failure]));assert.equal(h.restored(),false);
});
