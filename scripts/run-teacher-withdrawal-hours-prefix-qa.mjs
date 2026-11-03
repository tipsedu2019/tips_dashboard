// Supplemental committed-boundary QA. Uses the existing isolated runner's
// verified network, baseline, immutable manifest and cleanup. No production URL
// or alternate image/registry is accepted. A plan is not SQL runtime evidence.
import { createHash } from 'node:crypto';
import { readFile, writeFile, rm, readdir, lstat, mkdir } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runIsolatedSupabaseDbTests, processResult, executeProcessWithDeadline, parseIsolatedMigrationLedger, validateIsolatedMigrationLedger, parsePgTapSummary, sanitizeChildDiagnostic } from './run-isolated-supabase-db-tests.mjs';
import { AI_CREDENTIAL_PREFIX } from './lib/ai-producer-receipt.mjs';
const ROOT=resolve(fileURLToPath(new URL('..',import.meta.url)));
export const WITHDRAWAL_PREFIX_FILES=Object.freeze(['20261029100252_teacher_withdrawal_hours_snapshot.sql','20261029105121_teacher_withdrawal_hours_server_snapshot.sql']);
const PREFIX_TEST='supabase/tests/teacher_withdrawal_hours_prefix_test.sql';
const FINAL_TEST='supabase/tests/teacher_withdrawal_hours_snapshot_test.sql';
const fault='teacher_withdrawal_prefix_injected_failure';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const invalid=reason=>{throw new Error(`withdrawal_prefix_${reason}`);};
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const FINGERPRINT_SQL=`select jsonb_build_object(
 'mutation',md5((select jsonb_build_array(pg_get_functiondef(p.oid),p.proowner,p.proacl,p.prosecdef,p.provolatile,p.proconfig)::text from pg_proc p where p.oid='dashboard_private.mutate_teacher_own_request_v1_impl(text,uuid,text,jsonb,text,uuid)'::regprocedure)),
 'writer',md5((select jsonb_agg(jsonb_build_array(p.oid::regprocedure::text,pg_get_functiondef(p.oid),p.proowner,p.proacl,p.prosecdef,p.provolatile,p.proconfig) order by p.oid::regprocedure::text)::text
 from pg_proc p where p.oid in('dashboard_private.teacher_request_ops_input_v1(text,jsonb,uuid)'::regprocedure,'dashboard_private.mutate_teacher_own_request_v1_impl(text,uuid,text,jsonb,text,uuid)'::regprocedure))),
 'schema',md5((select coalesce(jsonb_agg(jsonb_build_array(n.nspname,p.oid::regprocedure::text,pg_get_functiondef(p.oid),p.proowner,p.proacl,p.prosecdef,p.provolatile,p.proconfig) order by n.nspname,p.oid::regprocedure::text)::text,'[]')
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','dashboard_private') and p.prokind in('f','p'))),
 'effects',md5(jsonb_build_array(
 (select coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'[]') from public.ops_tasks t),
 (select coalesce(jsonb_agg(to_jsonb(t) order by task_id)::text,'[]') from public.ops_withdrawal_details t),
 (select coalesce(jsonb_agg(to_jsonb(t) order by request_key)::text,'[]') from dashboard_private.teacher_request_receipts_v1 t),
 (select coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'[]') from dashboard_private.teacher_request_history_v1 t),
 (select count(*) from dashboard_private.notification_deliveries),
 (select count(*) from public.textbook_stock_moves))::text)
)::text;`;

export function parseWithdrawalPrefixArguments(argv){
 const result={execute:false,authorized:false,requestId:null,baseSha:null,headSha:null};const seen=new Set();
 const flags={'--request-id':'requestId','--review-base-sha':'baseSha','--review-head-sha':'headSha'};
 for(let i=0;i<argv.length;i++){
  const flag=argv[i];if(seen.has(flag))invalid('arguments_invalid');seen.add(flag);
  if(flag==='--execute')result.execute=true;
  else if(flag==='--authorized')result.authorized=true;
  else if(Object.hasOwn(flags,flag))result[flags[flag]]=argv[++i]??null;
  else invalid('arguments_invalid');
 }
 if(!/^[a-f0-9]{40}$/.test(result.baseSha??'')||!/^[a-f0-9]{40}$/.test(result.headSha??''))invalid('review_revisions_required');
 if(result.execute?(!result.authorized||!/^teacher-hours-prefix-[a-z0-9][a-z0-9-]{0,80}$/.test(result.requestId??'')):(result.authorized||result.requestId!==null))invalid('authorization_required');
 return result;
}
export function injectWithdrawalPrefixFailure(source){
 // Require the reviewed hours migration's single outer transaction. Do not
 // strip/rewrite any function body or anchor. Failure occurs after all patches.
 if(typeof source!=='string'||!/^begin;\r?\n/.test(source)||!/(?:\r?\n)commit;\s*$/.test(source)||source.includes(fault))invalid('fault_anchor_invalid');
 const anchor=source.lastIndexOf('\ncommit;');if(anchor<0)invalid('fault_anchor_invalid');
 return source.slice(0,anchor)+`\ndo $withdrawal_prefix_fault$ begin raise exception '${fault}' using errcode='23514'; end $withdrawal_prefix_fault$;\n`+source.slice(anchor+1);
}
export async function runWithdrawalHoursPrefixQa({argv=process.argv.slice(2),root=ROOT,log=()=>{},runIsolated=runIsolatedSupabaseDbTests,executeProcess=invocation=>processResult(invocation.command,invocation.args,invocation)}={}){
 const args=parseWithdrawalPrefixArguments(argv);
 const delegated=['--review-head','--require-final','--review-base-sha',args.baseSha,'--review-head-sha',args.headSha,'--lint','--verify-local-ledger','--test',FINAL_TEST];
 if(!args.execute)return runIsolated({argv:delegated,root,log});
 delegated.push('--execute','--authorized','--request-id',args.requestId);
 const manifest=JSON.parse(await readFile(join(root,'supabase/test-baselines/dashboard-free-tier-v1.manifest.json'),'utf8'));
 const entries=manifest.orderedNewMigrations;
 if(!Array.isArray(entries)||entries.some(entry=>!entry||!/^\d{14}_[a-z0-9_]+\.sql$/.test(entry.fileName??'')||entry.status!=='final'||!/^[a-f0-9]{64}$/.test(entry.sha256??'')))invalid('migration_manifest_invalid');
 const versions=entries.map(entry=>entry.fileName.slice(0,14));
 if(versions.some((version,i)=>i>0&&version<=versions[i-1]))invalid('migration_manifest_invalid');
 const first=entries.findIndex(entry=>entry.fileName===WITHDRAWAL_PREFIX_FILES[0]);
 if(first<0||entries[first+1]?.fileName!==WITHDRAWAL_PREFIX_FILES[1])invalid('migration_pair_invalid');
 const reviewed=await Promise.all(entries.map(async entry=>{
  const target=join(root,'supabase/migrations',entry.fileName),stat=await lstat(target);
  if(!stat.isFile()||stat.isSymbolicLink())invalid('migration_hash_drift');
  const bytes=await readFile(target);if(hash(bytes)!==entry.sha256)invalid('migration_hash_drift');return bytes;
 }));
 const originals=reviewed.slice(first,first+2),suffix=entries.slice(first+2);
 const credentialIndex=entries.findIndex(entry=>entry.fileName===AI_CREDENTIAL_PREFIX.migration);
 if(credentialIndex>=first)invalid('migration_pair_invalid');
 let credentialPhase='pending';
 const prefixSql=await readFile(join(root,PREFIX_TEST));
 let networkId=null,networkVerified=false,started=false,verification=null;
 let fixtureSources=new Map();
 const observedLog=entry=>{
  let record;try{record=JSON.parse(entry);}catch{}
  if(record?.event==='isolated_supabase_db_network_verified'&&record.internal===true&&record.exclusive===true&&record.beforeRepositorySql===true)networkVerified=true;
  if(record?.event==='isolated_ai_credential_committed_prefix_passed'){
   if(credentialPhase!=='committed'||record.migration!==AI_CREDENTIAL_PREFIX.migration||record.test!==AI_CREDENTIAL_PREFIX.test||record.committed!==true)invalid('credential_prefix_phase_invalid');
   credentialPhase='verified';
  }
  log(entry);
 };
 const actual=async invocation=>executeProcessWithDeadline(invocation,{timeoutMs:120000,executeProcess});
 const success=async invocation=>{const result=await actual(invocation);if(result.code!==0)invalid('child_failed');return result;};
 const execute=async invocation=>{
  if(invocation.command==='docker'&&invocation.args[0]==='network'&&invocation.args[1]==='create'){
   const result=await actual(invocation);if(result.code===0&&/^[a-f0-9]{64}$/.test(result.stdout.trim()))networkId=result.stdout.trim();return result;
  }
  if(started||invocation.args[0]!=='migration'||invocation.args[1]!=='up')return actual(invocation);
  const runtime=resolve(invocation.cwd),directory=join(runtime,'supabase/migrations');
  const files=await readdir(directory);
  if(!entries.some(entry=>files.includes(entry.fileName))){
   if(credentialIndex>=0&&credentialPhase!=='pending')invalid('credential_prefix_phase_invalid');
   // Before forward SQL is staged, retain only the runner's verified fixture
   // bytes. Later phases may neither add a fixture nor change an existing one.
   if(networkVerified){
    const fixtureVersions=files.map(file=>file.match(/^(0000000000000[0-6])_[a-z0-9_]+\.sql$/)?.[1]);
    if(fixtureVersions.some(version=>!version)||new Set(fixtureVersions).size!==files.length)invalid('staged_files_invalid');
    fixtureSources=new Map(await Promise.all(files.map(async file=>{
     const target=join(directory,file),stat=await lstat(target);
     if(!stat.isFile()||stat.isSymbolicLink())invalid('staged_source_drift');
     return [file,await readFile(target)];
    })));
   }
   return actual(invocation);
  }
  if(!networkVerified||!/^[a-f0-9]{64}$/.test(networkId??''))invalid('network_unverified');
  if(runtime===resolve(root)||basename(runtime)!==`tips-supabase-db-qa-${args.requestId}`)invalid('runtime_path_invalid');
  if(fixtureSources.size!==7)invalid('staged_files_invalid');
  const assertStage=async(end,overrides=new Map())=>{
   const expected=new Map([...fixtureSources,...entries.slice(0,end).map((entry,i)=>[entry.fileName,overrides.get(entry.fileName)??reviewed[i]])]);
   if(!equal((await readdir(directory)).sort(),[...expected.keys()].sort()))invalid('staged_files_invalid');
   for(const [file,bytes]of expected){
    const target=join(directory,file),stat=await lstat(target);
    if(!stat.isFile()||stat.isSymbolicLink()||!(await readFile(target)).equals(bytes))invalid('staged_source_drift');
   }
  };
  const up=async(end,overrides)=>{
   await assertStage(end,overrides);const result=await actual(invocation);await assertStage(end,overrides);return result;
  };
  const committedUp=async end=>{const result=await up(end);if(result.code!==0)invalid('child_failed');return result;};
  const project=(await readFile(join(runtime,'supabase/config.toml'),'utf8')).match(/^project_id = "(tips_supabase_db_qa_[a-f0-9]{12})"$/m)?.[1];
  if(!project)invalid('runtime_project_invalid');
  if(!WITHDRAWAL_PREFIX_FILES.every(file=>files.includes(file))){
   // The delegated runner always tests its exact AI credential committed prefix
   // before restoring later migrations. Only that known, byte-checked boundary
   // may precede ours; missing withdrawal files are not generally passed through.
   if(credentialIndex>=0&&credentialPhase==='pending'){
    const result=await up(credentialIndex+1);
    if(result.code===0)credentialPhase='committed';
    return result; // The runner still requires its exact ledger and SQL test.
   }
   const credentialFiles=[...fixtureSources.keys(),...entries.slice(0,credentialIndex+1).map(entry=>entry.fileName)].sort();
   if(credentialIndex>=0&&equal([...files].sort(),credentialFiles))invalid('credential_prefix_phase_invalid');
   invalid('staged_files_invalid');
  }
  if(credentialIndex>=0&&credentialPhase!=='verified')invalid('credential_prefix_phase_invalid');
  await assertStage(entries.length);
  started=true;
  const child=(command,childArgs)=>({...invocation,command,args:childArgs});
  const ledger=async()=>{
   const result=await success(child(invocation.command,['migration','list','--local','--workdir',runtime,'--output-format','json']));
   return {text:result.stdout,rows:parseIsolatedMigrationLedger(result.stdout)};
  };
  const fingerprint=async()=>{
   const result=await success(child('docker',['exec',`supabase_db_${project}`,'psql','-XqAt','--set','ON_ERROR_STOP=1','--username','postgres','--dbname','postgres','--command',FINGERPRINT_SQL]));
   let value;try{value=JSON.parse(result.stdout.trim());}catch{invalid('fingerprint_invalid');}
   if(!value||!equal(Object.keys(value).sort(),['effects','mutation','schema','writer'])||Object.values(value).some(x=>!(/^[a-f0-9]{32}$/.test(x))))invalid('fingerprint_invalid');return value;
  };
  const pgTap=async phase=>{
   await mkdir(join(runtime,'supabase/tests'),{recursive:true,mode:0o700});
   await writeFile(join(runtime,PREFIX_TEST),prefixSql,{mode:0o600});
   const result=await success(child(invocation.command,['test','db','--network-id',networkId,'--local','--workdir',runtime,PREFIX_TEST]));
   const summary=parsePgTapSummary(result.stdout);if(!summary)invalid('pgtap_summary_invalid');
   log(JSON.stringify({event:'withdrawal_hours_boundary_test',phase,summary}));
  };
  try{
   // Hold all later files until the pair's failure/retry boundary is proven;
   // otherwise the suffix could alter the schema or commit ahead of that proof.
   for(const entry of entries.slice(first))await rm(join(directory,entry.fileName));
   await committedUp(first);
   validateIsolatedMigrationLedger((await ledger()).text,{forwardVersions:versions.slice(0,first)});
   const base=await fingerprint();await pgTap('base');
   if(!equal(base,await fingerprint()))invalid('base_test_rollback_drift');
   await writeFile(join(directory,WITHDRAWAL_PREFIX_FILES[0]),originals[0],{mode:0o600});
   await committedUp(first+1);
   const prefixLedger=await ledger();validateIsolatedMigrationLedger(prefixLedger.text,{forwardVersions:versions.slice(0,first+1)});
   const prefix=await fingerprint();if(prefix.mutation!==base.mutation||prefix.effects!==base.effects)invalid('first_boundary_changed_mutation_or_data');
   await pgTap('first_committed');if(!equal(prefix,await fingerprint()))invalid('prefix_test_rollback_drift');
   const injected=Buffer.from(injectWithdrawalPrefixFailure(originals[1].toString('utf8')));
   await writeFile(join(directory,WITHDRAWAL_PREFIX_FILES[1]),injected,{mode:0o600});
   const failed=await up(first+2,new Map([[WITHDRAWAL_PREFIX_FILES[1],injected]]));
   if(failed.code===0||!new RegExp(`(?:^|\\n)ERROR: +${fault} +\\(SQLSTATE 23514\\)\\s*(?:\\r?\\n|$)`).test(`${failed.stdout}\n${failed.stderr}`)){
    log(JSON.stringify({event:'withdrawal_hours_prefix_fault_mismatch',exitCode:Number.isInteger(failed.code)?failed.code:null,
     stdout:sanitizeChildDiagnostic(failed.stdout),stderr:sanitizeChildDiagnostic(failed.stderr)}));
    invalid('expected_fault_missing');
   }
   const failedLedger=await ledger();const expectedFailed=[...prefixLedger.rows,{local:versions[first+1],remote:null}].sort((a,b)=>a.local.localeCompare(b.local));
   if(!equal(failedLedger.rows,expectedFailed)||!equal(prefix,await fingerprint()))invalid('failed_second_rollback_drift');
   await pgTap('failed_second_rollback');if(!equal(prefix,await fingerprint()))invalid('failed_prefix_test_rollback_drift');
   await writeFile(join(directory,WITHDRAWAL_PREFIX_FILES[1]),originals[1],{mode:0o600});
   let finalResult=await committedUp(first+2);
   validateIsolatedMigrationLedger((await ledger()).text,{forwardVersions:versions.slice(0,first+2)});
   // Restore and apply the exact reviewed suffix only after the retry commits.
   for(let i=first+2;i<entries.length;i++)await writeFile(join(directory,entries[i].fileName),reviewed[i],{mode:0o600});
   if(suffix.length)finalResult=await committedUp(entries.length);
   validateIsolatedMigrationLedger((await ledger()).text,{forwardVersions:versions});
   const describe=items=>items.map(({fileName,sha256})=>({fileName,sha256}));
   verification={baseVerified:true,firstCommitted:true,expectedFailureSqlstate:'23514',rollbackVerified:true,retryCommitted:true,suffixCommitted:true,forwardMigrations:entries.length,migrations:describe(entries.slice(first,first+2)),suffixMigrations:describe(suffix)};
   log(JSON.stringify({event:'withdrawal_hours_committed_boundaries_verified',...verification}));
   return finalResult;
  }finally{
   // The existing runner subsequently owns DB/network/temp-root cleanup. Restore
   // the exact snapshotted source even when an expected check unexpectedly fails.
   for(let i=first;i<entries.length;i++){
    const target=join(directory,entries[i].fileName);
    await rm(target,{force:true});await writeFile(target,reviewed[i],{mode:0o600});
   }
  }
 };
 const result=await runIsolated({argv:delegated,root,log:observedLog,executeProcess:execute,executeNetwork:execute});
 if(!verification||result.status!=='passed')invalid('boundaries_not_completed');
 // Final SQL is still executed by the unmodified runner after the successful
 // retry and suffix application. Boundary checks never replace that final suite.
 return {...result,verification:{...result.verification,withdrawalPrefix:verification}};
}
if(process.argv[1]===fileURLToPath(import.meta.url))runWithdrawalHoursPrefixQa({log:entry=>process.stderr.write(`${entry}\n`)}).then(result=>process.stdout.write(`${JSON.stringify(result)}\n`)).catch(error=>{process.stderr.write(`${error.message}\n`);process.exitCode=1;});
