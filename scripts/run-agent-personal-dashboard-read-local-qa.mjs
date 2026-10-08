// Focused original-dashboard-schema QA. No CLI, provider or formal receipt.
import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { lstat, readFile, realpath, readdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { validateBaselineManifest, validateManifestMigrations } from './run-isolated-supabase-db-tests.mjs';
import { parsePersonalOwnerTap } from './run-ai-agent-personal-owner-local-qa.mjs';
import { createPersonalOwnerConcurrencyRuntime, boundedPersonalOwnerProcess } from './lib/ai-agent-personal-owner-concurrency-runtime.mjs';
import { runPersonalDashboardReadConcurrencyProbes } from '../tests/probe-agent-personal-dashboard-read-concurrency.mjs';
import { createPersonalDashboardReadHandler, personalDashboardReadProducerSchema } from '../src/features/agent-api/server/personal-dashboard-read.ts';

const ROOT=resolve(fileURLToPath(new URL('..',import.meta.url)));
const PERSONAL_OWNER_IMAGE='public.ecr.aws/supabase/postgres:17.6.1.159';
const IMAGE_ID='sha256:86a2e078779e5bdccda1f6f6c5063aa9779a322d1fface5fb408d051909b230f';
const DOCKER_SOCKET='/Users/hyunjun/.docker/run/docker.sock';
const DOCKER_ENDPOINT=`unix://${DOCKER_SOCKET}`;
const OWNER_LABEL='tips.ai-agent-personal-owner-qa.owner';
const EXPECTED_HEAD='6c4a3dc7336e6abcfb8d5c74b03409f13a677796';
const CAPTURE_PREFIX='AGENT_PERSONAL_DASHBOARD_READ_CAPTURE:';
const DRAFT='docs/superpowers/drafts/agent-personal-dashboard-read.sql';
const TEST='supabase/tests/agent_personal_dashboard_read_test.sql';
const OWNER_DRAFT='docs/superpowers/drafts/ai-agent-personal-owner.sql';
const BOOTSTRAP='scripts/fixtures/agent-personal-dashboard-read-image-prerequisites.sql';
const FORWARD_BOOTSTRAP='scripts/fixtures/agent-personal-dashboard-read-forward-image-prerequisites.sql';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=code=>{throw new Error(`agent_personal_dashboard_qa:${code}`)};
const delay=ms=>new Promise(done=>setTimeout(done,ms));
const activeStops=new Set();
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}':JSON.stringify(value);
const literal=value=>`'${String(value).replaceAll("'","''")}'`;
const id=n=>`ad050000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const json=value=>`${literal(JSON.stringify(value))}::jsonb`;
const IMAGE_BASELINE_MISMATCHES=Object.freeze([1,2,545,546,547,548,549,550,551,552,553,1131,1132,1133,1134,1135,1136,1137,1139,1561,1666,1667]);
const IMAGE_BASELINE_TAP_SHA256='e83151f1eb741cf6783ef667997506eb915abb4680a7900f7130f6f94fbc6d7b';
export function inspectFocusedBaselineTap(stdout,parity){
 const lines=stdout.split(/\r?\n/u),plans=lines.map(line=>/^1\.\.([1-9][0-9]*)$/u.exec(line)).filter(Boolean);
 const results=lines.map(line=>/^(ok|not ok) ([1-9][0-9]*)(?:\s|$)/u.exec(line)).filter(Boolean);
 if(plans.length!==1||Number(plans[0][1])!==1923||results.length!==1923||results.some((item,index)=>Number(item[2])!==index+1)||lines.some(line=>/^Bail out!/iu.test(line)||/#\s*(?:SKIP|TODO)\b/iu.test(line)))fail('baseline_tap_incomplete');
 const failed=results.filter(item=>item[1]==='not ok').map(item=>Number(item[2]));
 if(failed.length===0)return{...parsePersonalOwnerTap(stdout),fullBaselineCatalogParity:true};
 if(JSON.stringify(failed)!==JSON.stringify(IMAGE_BASELINE_MISMATCHES)||hash(Buffer.from(stdout))!==IMAGE_BASELINE_TAP_SHA256)fail('baseline_unexpected_catalog_mismatch');
 const assertions=parity.toString('utf8').split(/\r?\n/u).filter(line=>line.startsWith('select is('));
 if(assertions.length!==1923)fail('baseline_parity_source_changed');
 const mismatches=failed.map(number=>{
  const label=/, '([^']+)'\);$/u.exec(assertions[number-1])?.[1];
  if(!label||!(label.startsWith('catalog ')&&label.includes(' auth.')&&label.endsWith(' fingerprint')||label==='catalog schema .supabase_migrations fingerprint'))fail('baseline_mismatch_boundary_invalid');
  if(!lines.includes(`not ok ${number} - ${label}`))fail('baseline_actual_mismatch_label_invalid');
  return{assertion:number,label};
 });
 return{tests:1923,pass:1901,fail:22,skipped:0,todo:0,outputSha256:hash(Buffer.from(stdout)),fullBaselineCatalogParity:false,dashboardCatalogFingerprintsPassed:true,mismatches,boundary:'Cached image Auth shape, RLS/ACL and missing CLI ledger schema differ from managed baseline. Full original parity remains failed; this separate harness verifies the new callback with original dashboard definitions.'};
}
function inspectFocusedSmokeTap(stdout){
 const lines=stdout.split(/\r?\n/u),results=lines.map(line=>/^(ok|not ok) ([1-9][0-9]*)(?:\s|$)/u.exec(line)).filter(Boolean);
 if(lines.filter(line=>/^1\.\.[1-9][0-9]*$/u.test(line)).join()!=='1..14'||results.length!==14||results.some((item,index)=>Number(item[2])!==index+1)||lines.some(line=>/^Bail out!/iu.test(line)||/#\s*(?:SKIP|TODO)\b/iu.test(line)))fail('baseline_smoke_incomplete');
 if(results.every(item=>item[1]==='ok'))return{...parsePersonalOwnerTap(stdout),completePass:true};
 if(results.filter(item=>item[1]==='not ok').map(item=>item[2]).join()!=='1'||!lines.includes('not ok 1 - baseline restores migration ledger schema')||hash(Buffer.from(stdout))!=='51a98543ee61b0494d320f5f836bc904d46af97840c270c60cd7810c7c703c11')fail('baseline_smoke_unexpected_mismatch');
 return{tests:14,pass:13,fail:1,skipped:0,todo:0,outputSha256:hash(Buffer.from(stdout)),completePass:false,mismatches:[{assertion:1,label:'baseline restores migration ledger schema'}],boundary:'Original smoke ran in full; missing CLI ledger schema remains failed. No synthetic ledger or receipt is created.'};
}
async function head(){
 const child=boundedPersonalOwnerProcess('git',['-C',ROOT,'rev-parse','HEAD'],{timeoutMs:5000});child.child.stdin.end();const result=await child.complete;
 if(result.code!==0||!/^[a-f0-9]{40}\n$/u.test(result.stdout))fail('source_head_invalid');return result.stdout.trim();
}
async function dependencyEvidence(){
 const packagePath=createRequire(import.meta.url).resolve('zod/package.json'),packageBytes=await readFile(packagePath),pkg=JSON.parse(packageBytes),lock=JSON.parse((await source('package-lock.json')).bytes);
 if(pkg.version!=='4.3.2'||hash(packageBytes)!=='960ff000566fb22d64e62ab6c5924f435466567e958bf9b3625ba6a73e2810d3'||lock.packages['node_modules/zod'].version!=='4.3.6')fail('cached_dependency_identity_drift');
 const root=await realpath(dirname(packagePath)),files=[];
 async function walk(path){for(const item of (await readdir(path,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const full=resolve(path,item.name);if(item.isSymbolicLink())fail('cached_dependency_symlink');if(item.isDirectory())await walk(full);else if(item.isFile()){const bytes=await readFile(full);files.push({path:full.slice(root.length+1),bytes:bytes.length,sha256:hash(bytes)});if(files.length>1000)fail('cached_dependency_size_invalid')}else fail('cached_dependency_not_regular')}}
 await walk(root);return{name:'zod',installedVersion:pkg.version,lockedVersion:'4.3.6',lockedDependencyParity:false,packageSha256:hash(packageBytes),root,files,treeSha256:hash(canonical(files)),boundary:'Existing cached version strictly pinned, no install/update; does not prove dependency equivalence with CI lock'};
}

async function source(path){
 const absolute=resolve(ROOT,path);if(!absolute.startsWith(ROOT+'/'))fail('source_path_invalid');
 const stat=await lstat(absolute);if(!stat.isFile()||stat.isSymbolicLink())fail('source_not_regular');
 const bytes=await readFile(absolute);const max=path.endsWith('/baseline.sql')?8_000_000:2_000_000;
 if(!bytes.length||bytes.length>max)fail('source_size_invalid');return{path,bytes,sha256:hash(bytes)};
}
const metadata=s=>({path:s.path,bytes:s.bytes.length,sha256:s.sha256});
async function codeClosure(entries){
 const found=new Map();async function walk(path){
  if(found.has(path))return;const item=await source(path);found.set(path,item);
  for(const match of item.bytes.toString('utf8').matchAll(/(?:import|export)\s[^;]*?from\s*["']([^"']+)["']/gu)){
   if(!match[1].startsWith('.'))continue;const next=resolve(ROOT,dirname(path),match[1]);
   if(!next.startsWith(ROOT+'/'))fail('closure_path_invalid');await walk(next.slice(ROOT.length+1));
  }
 }
 for(const path of entries)await walk(path);return[...found.values()].sort((a,b)=>a.path.localeCompare(b.path));
}
async function sources(){
 const active=await source('supabase/test-baselines/dashboard-free-tier-v1.active.json');const pointer=JSON.parse(active.bytes);
 if(pointer.captureId!=='ec11107ba2c0eab4')fail('reviewed_capture_changed');
 const base=`supabase/test-baselines/dashboard-free-tier-v1-captures/${pointer.captureId}/`;
 const [captureManifest,manifest,baseline,catalog,parity]=await Promise.all([source(base+'manifest.json'),source('supabase/test-baselines/dashboard-free-tier-v1.manifest.json'),source(base+'baseline.sql'),source(base+'catalog.json'),source(base+'parity.sql')]);
 const cm=validateBaselineManifest(JSON.parse(captureManifest.bytes)),m=validateBaselineManifest(JSON.parse(manifest.bytes)),cat=JSON.parse(catalog.bytes);
 if(baseline.sha256!==cm.baselineSha256||catalog.sha256!==cm.catalogSha256||hash(canonical({baseline:baseline.bytes.toString('utf8'),catalog:catalog.bytes.toString('utf8'),manifest:cm,parity:parity.bytes.toString('utf8')})).slice(0,16)!==pointer.captureId||cat.captureStatus!=='reviewed'||cat.originMainSha!==m.originMainSha)fail('reviewed_baseline_invalid');
 const verified=await validateManifestMigrations({root:ROOT,manifest:m,baselineVersions:cat.migrationLedger.map(r=>r.version)});
 if(verified.length!==147||verified.some(s=>s.status!=='final'))fail('ordered_migration_inventory_changed');
 const migrations=await Promise.all(verified.map(m=>source('supabase/migrations/'+m.fileName)));
 const repairs=await Promise.all(['scripts/fixtures/dashboard-free-tier-isolated-schema-repair.sql','scripts/fixtures/dashboard-free-tier-migration-prerequisites.sql','scripts/fixtures/dashboard-free-tier-notification-settings-prerequisites.sql','supabase/migrations/20260803142000_notification_word_retest_content_payload.sql','supabase/migrations/20260803144000_notification_transfer_content_payload.sql','supabase/migrations/20260803145000_notification_withdrawal_content_payload.sql'].map(source));
 const expected=['00c1a584269816060933bb6d728494aef085592d6c6b08dbc8a715cf6ee2794b','051f9a7f82ab02abfb3437c6064782651032e4eded02aa89d8986dc9cf94c5f1','41277cc9025e33e8ade8b134ee5f7b4836fb2fb828ecca9f28eb910d8a5edf48','cf4342833bf32a86c6e8bff6f04428d68871f02a4c1819d713ff72bb5fdcfeb8','80ed588ae512fa0ffbd318c49b6f1f928cb09a3181fc1199b2ec86e80ba5ed2f','6bc943b720a564847baff2240d4a90756ce46c6e776968a39a799683de083bd7'];
 if(repairs.some((s,i)=>s.sha256!==expected[i]))fail('canonical_repair_changed');
 const extra=await Promise.all([BOOTSTRAP,OWNER_DRAFT,DRAFT,TEST,'supabase/tests/dashboard_free_tier_baseline_smoke_test.sql','package-lock.json','package.json','scripts/fixtures/ai-agent-personal-owner-local-prerequisites.sql','scripts/qa/timetable-clean-replay.py',FORWARD_BOOTSTRAP].map(source));
 if(cat.catalog.some(item=>item.schema==='auth'&&item.objectKind==='function'))fail('captured_auth_function_boundary_changed');
 const authReaders=/create or replace function auth\.(?:uid|jwt|role)\(\)[\s\S]*?\$\$;/gu;
 const readers=extra[0].bytes.toString('utf8').match(authReaders),previousReaders=extra[7].bytes.toString('utf8').match(authReaders);
 if(readers?.length!==3||JSON.stringify(readers)!==JSON.stringify(previousReaders))fail('synthetic_auth_reader_source_changed');
 const storageStatements=extra[0].bytes.toString('utf8').match(/create table storage\.(?:buckets|objects)\([^;]+;/gu);
 if(storageStatements?.length!==2||storageStatements.some(statement=>!extra[8].bytes.toString('utf8').includes(statement)))fail('synthetic_storage_adapter_source_changed');
 const code=await codeClosure(['scripts/run-agent-personal-dashboard-read-local-qa.mjs']);
 const all=[active,captureManifest,manifest,baseline,catalog,parity,...repairs,...migrations,...extra,...code];
 const closure=[...new Map(all.map(s=>[s.path,s])).values()].sort((a,b)=>a.path.localeCompare(b.path));
 return{baseline,parity,repairs,migrations,bootstrap:extra[0],ownerDraft:extra[1],draft:extra[2],test:extra[3],smoke:extra[4],forwardBootstrap:extra[9],closure,baselineLedgerVersions:cat.migrationLedger.length};
}
const evidence=input=>input.closure.map(metadata);
function captured(stdout){
 const lines=stdout.split(/\r?\n/u).filter(l=>l.startsWith(CAPTURE_PREFIX));if(lines.length!==1)fail('capture_missing_or_duplicate');
 const raw=lines[0].slice(CAPTURE_PREFIX.length);let result;try{result=JSON.parse(raw)}catch{fail('capture_invalid')}
 if(Object.keys(result).sort().join(',')!=='calendar,class,schools')fail('capture_invalid');
 for(const kind of ['class','calendar','schools']){const parsed=personalDashboardReadProducerSchema.safeParse({...result[kind]?.data,kind});if(!parsed.success)fail('real_producer_contract_mismatch')}
 if(result.class.data.context.weeklySlots.length<1||result.class.data.context.sessions.length<1||result.calendar.data.context.events.length<1||result.schools.data.context.items.length<1)fail('real_producer_empty');
 return{status:'passed',dtos:3,nonempty:true,captureSha256:hash(raw),rawCaptureLogged:false};
}
function fixturePrefix(test){
 const text=test.bytes.toString('utf8'),marker='create temp table pd_evidence';const end=text.indexOf(marker);
 if(end<0||text.indexOf(marker,end+marker.length)>=0||!text.includes('select plan(110);'))fail('fixture_prefix_invalid');
 return Buffer.from(text.slice(0,end).replace('select plan(110);','')+'commit;\n');
}
async function focusedAuthorizationPreflight(name){
 const out=await sql(name,Buffer.from(`select jsonb_build_object(
 'inspectionRole',current_user,
 'callback',(select jsonb_build_object('owner',pg_get_userbyid(proowner),'securityDefiner',prosecdef,'serviceExecute',has_function_privilege('service_role',oid,'EXECUTE'),'anonymousExecute',has_function_privilege('anon',oid,'EXECUTE'),'employeeExecute',has_function_privilege('authenticated',oid,'EXECUTE')) from pg_proc where oid='public.agent_personal_dashboard_read_v1(text,text,jsonb)'::regprocedure),
 'authColumns',(select jsonb_agg(jsonb_build_object('name',attname,'type',format_type(atttypid,atttypmod),'notNull',attnotnull) order by attname) from pg_attribute where attrelid='auth.users'::regclass and attname in('id','deleted_at','banned_until') and not attisdropped),
 'authIdPrimaryKey',exists(select 1 from pg_constraint where conrelid='auth.users'::regclass and contype='p' and conkey=array[(select attnum from pg_attribute where attrelid='auth.users'::regclass and attname='id')]::smallint[]),
 'authUsers',(select jsonb_build_object('owner',pg_get_userbyid(relowner),'rls',relrowsecurity,'forceRls',relforcerowsecurity,'acl',relacl::text) from pg_class where oid='auth.users'::regclass),
 'roles',(select jsonb_agg(jsonb_build_object('role',rolname,'superuser',rolsuper,'bypassRls',rolbypassrls) order by rolname) from pg_roles where rolname in('postgres','service_role','supabase_admin')),
 'postgresAuthMember',pg_has_role('postgres','supabase_auth_admin','MEMBER'),
 'postgresAuthUsage',has_schema_privilege('postgres','auth','USAGE'),
 'postgresAuthSelect',has_table_privilege('postgres','auth.users','SELECT'),
 'postgresAuthUpdate',has_table_privilege('postgres','auth.users','UPDATE'),
 'authDirectPrivileges',(select jsonb_agg(jsonb_build_object('role',r,'select',has_table_privilege(r,'auth.users','SELECT'),'insert',has_table_privilege(r,'auth.users','INSERT'),'update',has_table_privilege(r,'auth.users','UPDATE'),'delete',has_table_privilege(r,'auth.users','DELETE'),'schemaUsage',has_schema_privilege(r,'auth','USAGE')) order by r) from unnest(array['anon','authenticated','service_role']) r),
 'syntheticAuthHelpers',(select jsonb_agg(jsonb_build_object('name',proname,'owner',pg_get_userbyid(proowner),'acl',proacl::text) order by proname) from pg_proc where oid=any(array['auth.uid()'::regprocedure,'auth.jwt()'::regprocedure,'auth.role()'::regprocedure]))
 );`),'supabase_admin');
 const value=JSON.parse(out.stdout.trim()),c=value.callback;
 if(c?.owner!=='postgres'||c.securityDefiner!==true||c.serviceExecute!==true||c.anonymousExecute!==false||c.employeeExecute!==false||value.authIdPrimaryKey!==true||value.postgresAuthUsage!==true||value.postgresAuthSelect!==true||value.postgresAuthUpdate!==true||value.postgresAuthMember!==false)fail('focused_authorization_prerequisite_invalid');
 if(JSON.stringify(value.authColumns)!==JSON.stringify([{name:'banned_until',type:'timestamp with time zone',notNull:false},{name:'deleted_at',type:'timestamp with time zone',notNull:false},{name:'id',type:'uuid',notNull:true}]))fail('focused_auth_column_shape_invalid');
 if(value.authDirectPrivileges.some(item=>item.role!=='service_role'&&(item.select||item.insert||item.update||item.delete)))fail('focused_auth_browser_direct_access');
 if(canonical(value.roles)!==canonical([{role:'postgres',superuser:false,bypassRls:true},{role:'service_role',superuser:false,bypassRls:true},{role:'supabase_admin',superuser:true,bypassRls:true}]))fail('focused_database_roles_changed');
 return{...value,status:'passed',boundary:'Auth RLS/ACL and cached shape are recorded as observed, not equivalent to managed provider Auth. No Auth membership or ACL changes were applied.'};
}
async function consumeLive(runtime){
 const token='tips_dashboard_personal_'+randomBytes(32).toString('hex');const tokenHash=hash(token);const credentialId=id(705);
 await runtime.query(`insert into dashboard_private.agent_personal_dashboard_credentials(id,created_by,owner_profile_id,label,token_hash,scopes,class_ids,school_ids,expires_at) values(${literal(credentialId)},${literal(id(1))},${literal(id(2))},'Synthetic live producer',${literal(tokenHash)},array['class-details:read','calendar:read'],array[${literal(id(201))}::uuid],array[${literal(id(501))}::uuid],clock_timestamp()+interval '1 day');`);
 let calls=0;const observed=[];
 const handler=createPersonalDashboardReadHandler({enabled:()=>true,rpc:async(name,args)=>{
  if(name!=='agent_personal_dashboard_read_v1'||args.p_token_hash!==tokenHash)fail('live_rpc_binding_invalid');calls++;
  const out=await runtime.query(`begin;create function pg_temp.pd_live() returns jsonb language plpgsql as $$begin return jsonb_build_object('data',public.agent_personal_dashboard_read_v1(${literal(args.p_token_hash)},${literal(args.p_action)},${json(args.p_input)}),'error',null);exception when others then return jsonb_build_object('data',null,'error',jsonb_build_object('code',SQLSTATE,'message',case when SQLERRM ~ '^agent_[a-z_]{1,80}$' then SQLERRM else 'agent_api_unavailable' end));end$$;set local role service_role;select 'LIVE:'||pg_temp.pd_live()::text;commit;`);
  const line=out.split('\n').find(l=>l.startsWith('LIVE:'));if(!line)fail('live_result_missing');const value=JSON.parse(line.slice(5));observed.push(value.error?{sqlstate:value.error.code,code:value.error.message}:{sha256:hash(JSON.stringify(value.data))});return value;
 }});
 const cases=[{path:['classes',id(201)],query:'from=2099-10-01&to=2099-10-07'},{path:['calendar','schools',id(501)],query:'schoolYear=2099'},{path:['calendar','schools'],query:'page=1&search='}];
 for(const c of cases){const res=await handler(new Request('https://synthetic.invalid/api/agent/v2/'+c.path.join('/')+'?'+c.query,{headers:{authorization:'Bearer '+token}}),c.path);const value=await res.json();if(res.status!==200||!value.data||res.headers.get('cache-control')?.includes('no-store')!==true||JSON.stringify(value).includes('PRIVATE_'))fail('live_consumer_failed');if(c.path[0]==='classes'&&value.data.capabilities?.readOnly!==true)fail('live_read_only_missing')}
 await runtime.query(`update public.profiles set role='viewer' where id=${literal(id(2))};`);
 const denied=await handler(new Request('https://synthetic.invalid/api/agent/v2/calendar/schools?page=1',{headers:{authorization:'Bearer '+token}}),['calendar','schools']);const deniedBody=await denied.json();
 if(denied.status!==403||deniedBody.data!==null||observed.at(-1)?.sqlstate!=='42501'||observed.at(-1)?.code!=='agent_forbidden')fail('live_retry_current_authority_failed');
 await runtime.query(`update public.profiles set role='teacher' where id=${literal(id(2))};`);
 return{status:'passed',actualDbRpcCalls:calls,realHandlerGetSuccesses:3,currentAuthorityRetryDenied:true,deniedSqlstate:'42501',rawCredentialsLogged:false,producerHashes:observed.filter(x=>x.sha256).map(x=>x.sha256),boundary:'Actual new SQL callback through real HTTP handler; in-container psql transport replaces Supabase client/provider, not an authenticated production endpoint'};
}
function cleanEnvironment() {
  if (typeof process.env.PATH !== 'string' || !process.env.PATH || /[\r\n\0]/u.test(process.env.PATH)) fail('path_invalid');
  return { PATH: process.env.PATH, LANG: 'C', LC_ALL: 'C' };
}

async function runProcess(args, { input, timeoutMs = 30_000 } = {}) {
  return new Promise((done, reject) => {
    const child = spawn('docker', ['--host',DOCKER_ENDPOINT,...args], { cwd: ROOT, env: cleanEnvironment(), stdio: ['pipe','pipe','pipe'] });
    const out = [], err = [];
    let bytes = 0, problem = null, killTimer, reapTimer, settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer); clearTimeout(killTimer); clearTimeout(reapTimer);
      activeStops.delete(stop);
      if (error) reject(error); else done(result);
    };
    const stop = code => {
      if (problem) return;
      problem = code;
      child.stdin.destroy();
      child.kill('SIGTERM');
      killTimer = setTimeout(() => {
        child.kill('SIGKILL');
        reapTimer = setTimeout(() => {
          child.stdout.destroy(); child.stderr.destroy(); child.unref();
          finish(new Error('ai_agent_personal_owner_qa:process_reaping_unconfirmed'));
        }, 1500);
      }, 750);
    };
    activeStops.add(stop);
    const timer = setTimeout(() => stop('process_timeout'), timeoutMs);
    const collect = target => chunk => {
      bytes += chunk.length;
      if (bytes > 2_000_000) stop('process_output_limit');
      else target.push(chunk);
    };
    child.stdout.on('data', collect(out)); child.stderr.on('data', collect(err));
    child.stdin.on('error', error => { if (error.code !== 'EPIPE') stop('process_stdin_error'); });
    child.on('error', () => stop('process_spawn_error'));
    child.on('close', (code, signal) => {
      if (problem) finish(new Error(`ai_agent_personal_owner_qa:${problem}`));
      else finish(null, { code, signal, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8') });
    });
    child.stdin.end(input);
  });
}

export function validatePersonalOwnerContainer(info, name, nonce) {
  if (!/^[a-f0-9]{32}$/u.test(nonce) || name !== `tips-ai-agent-personal-owner-${nonce}`) fail('container_ownership_invalid');
  if (info?.Name !== `/${name}` || info.Config?.Labels?.[OWNER_LABEL] !== nonce || info.Image !== IMAGE_ID) fail('container_ownership_invalid');
  if (info.HostConfig?.NetworkMode !== 'none' || !Array.isArray(info.Mounts) || info.Mounts.length !== 0 || Object.keys(info.HostConfig?.PortBindings ?? {}).length || Object.keys(info.NetworkSettings?.Ports ?? {}).some(port => info.NetworkSettings.Ports[port] !== null)) fail('container_isolation_invalid');
  return info;
}

async function assertOwnedContainer(name, nonce, invoke = runProcess, allowMissing = false) {
  const result = await invoke(['container','inspect',name,'--format', '{{json .}}']);
  if (allowMissing && result.code !== 0 && new RegExp(`(?:No such (?:container|object): )${name}(?:\\s|$)`, 'u').test(result.stderr)) return null;
  if (result.code !== 0) fail('owned_container_inspect_failed');
  let info; try { info = JSON.parse(result.stdout); } catch { fail('owned_container_metadata_invalid'); }
  return validatePersonalOwnerContainer(info, name, nonce);
}

export async function cleanupPersonalOwnerQaContainer(name, nonce, invoke = runProcess, allowMissing = false) {
  if (!await assertOwnedContainer(name, nonce, invoke, allowMissing)) return;
  const result = await invoke(['rm','--force',name]);
  if (result.code !== 0 || result.stdout.trim() !== name) fail('owned_container_cleanup_failed');
  const remaining = await invoke(['container','inspect',name,'--format','{{.Id}}']);
  if (remaining.code === 0 || !new RegExp(`(?:No such (?:container|object): )${name}(?:\\s|$)`, 'u').test(remaining.stderr)) fail('owned_container_cleanup_unconfirmed');
}

async function sql(name, source, user='postgres') {
  if(!['postgres','supabase_admin'].includes(user))fail('synthetic_sql_role_invalid');
  const result = await runProcess(['exec','--interactive','--env','PGOPTIONS=-c statement_timeout=120000 -c lock_timeout=5000 -c idle_in_transaction_session_timeout=120000',name,'psql','-XqAt','--set','ON_ERROR_STOP=1','--set','VERBOSITY=verbose','--username',user,'--dbname','postgres'], { input: source, timeoutMs: 130_000 });
  if (result.code !== 0 || result.signal != null) {
    const error = new Error('ai_agent_personal_owner_qa:sql_failed');
    // The raw output remains private, including any first-return synthetic token.
    error.diagnostics = {
      stdoutSha256: hash(Buffer.from(result.stdout)), stderrSha256: hash(Buffer.from(result.stderr)),
      sqlstates: [...new Set([...result.stderr.matchAll(/ERROR:\s+([0-9A-Z]{5}):/gu)].map(match => match[1]))],
      safeMessages: [...new Set([...result.stderr.matchAll(/ERROR:\s+[0-9A-Z]{5}:\s+([a-z_]{1,120})(?:\r?\n|$)/gu)].map(match => match[1]))],
      constraints: [...new Set([...result.stderr.matchAll(/constraint "([^"]*)"/gu)].map(match => match[1]).filter(value => /^[a-z0-9_]{1,120}$/u.test(value)))],
      tables: [...new Set([...result.stderr.matchAll(/relation "([^"]*)"/gu)].map(match => match[1]).filter(value => /^[a-z0-9_]{1,120}$/u.test(value)))],
      lineNumbers: [...new Set([...result.stderr.matchAll(/^LINE ([1-9][0-9]*):/gmu)].map(match => Number(match[1])))],
      inputLineNumbers: [...new Set([...result.stderr.matchAll(/^psql:<stdin>:([1-9][0-9]*):/gmu)].map(match => Number(match[1])))],
      configurationNames: [...new Set([...result.stderr.matchAll(/(?:configuration parameter|extension) "([a-z0-9_.]{1,80})"/gu)].map(match => match[1]))],
      syntaxNear: [...new Set([...result.stderr.matchAll(/syntax error at or near "([a-z0-9_.:=-]{1,100})"/gu)].map(match => match[1]))],
      permissionMessages: [...new Set([...result.stderr.matchAll(/ERROR:\s+42501:\s+([^\r\n]{1,180})/gu)].map(match => match[1]).filter(value => /^(?:must be owner of (?:table|relation|function|extension|schema|type) [a-z0-9_."() ]+|permission denied for (?:table|relation|function|extension|schema|type) [a-z0-9_."() ]+|permission denied to create extension "[a-z0-9_]+"|must be superuser to [a-z_ ]+)$/u.test(value)))],
      permissionFailures: {
        authUsersOwnerRequired: /ERROR:\s+42501:\s+must be owner of (?:table|relation) users(?:\r?\n|$)/u.test(result.stderr),
        authSchemaDenied: /ERROR:\s+42501:\s+permission denied for schema auth(?:\r?\n|$)/u.test(result.stderr),
        authUsersDenied: /ERROR:\s+42501:\s+permission denied for (?:table|relation) users(?:\r?\n|$)/u.test(result.stderr),
      },
      lastPassedAssertion: Math.max(0,...[...result.stdout.matchAll(/^ok ([1-9][0-9]*)(?:\s|$)/gmu)].map(match => Number(match[1]))),
    };
    throw error;
  }
  return result;
}


export async function runPersonalDashboardReadLocalQa(argv=process.argv.slice(2)){
 const execute=argv.length===5&&argv[0]==='--execute'&&argv[1]==='--request-id'&&/^agent-dashboard-read-local-[a-z0-9-]{1,48}$/u.test(argv[2])&&argv[3]==='--review-plan-sha256'&&/^[a-f0-9]{64}$/u.test(argv[4]);
 if(!execute&&!(argv.length===0||argv.length===1&&argv[0]==='--plan'))fail('arguments_invalid');
 const input=await sources(),sourceHead=await head(),dependency=await dependencyEvidence();if(sourceHead!==EXPECTED_HEAD)fail('reviewed_head_mismatch');const common={sourceBase:EXPECTED_HEAD,sourceHead,sources:evidence(input),dependency,image:PERSONAL_OWNER_IMAGE,expectedImageId:IMAGE_ID,boundaries:{focusedOriginalDashboardSchema:true,fullBaselineCatalogParity:false,baselineCapture:'ec11107ba2c0eab4',directPsqlOrderedMigrations:147,syntheticAuthGucReaders:3,syntheticEmptyStorageRelations:2,storageServiceParity:false,imageExtensionsPreparedBy:'supabase_admin',baselineSqlRole:'postgres',sharedPreloadLibraries:['pg_stat_statements','pg_cron','pg_net'],supabaseCliInvoked:false,supabaseCliLedgerTransport:false,formalReceipt:false,requiredCi:false,production:false,providerJwtSignatureVerification:false,lockedDependencyParity:false,realCredentials:false,providerSend:false,network:'none',ports:[],volumes:[],pullPolicy:'never'}};
 const planSha256=hash(canonical(common));if(!execute)return{status:'plan',planSha256,...common};
 if(argv[4]!==planSha256)fail('reviewed_plan_mismatch');
 const nonce=randomBytes(16).toString('hex'),name=`tips-ai-agent-personal-owner-${nonce}`,pipelineEvidence={orderedMigrationsApplied:[]};let owned=false,startAttempted=false,failure,result,phase='local_docker_preflight',interrupted=false,imageRoleMetadata,containerProof;
 const interrupt=()=>{interrupted=true;for(const stop of [...activeStops])stop('interrupted')};const requireRunning=()=>{if(interrupted)fail('interrupted')};process.on('SIGINT',interrupt);process.on('SIGTERM',interrupt);
 try{
  const socket=await lstat(DOCKER_SOCKET);if(!socket.isSocket()||socket.isSymbolicLink()||socket.uid!==process.getuid())fail('local_docker_socket_invalid');
  const image=await runProcess(['image','inspect',PERSONAL_OWNER_IMAGE,'--format','{{.Id}}']);if(image.code!==0||image.stdout.trim()!==IMAGE_ID)fail('cached_image_unavailable');
  requireRunning();startAttempted=true;const start=await runProcess(['run','--pull=never','--detach','--network','none','--name',name,'--label',`${OWNER_LABEL}=${nonce}`,'--env','POSTGRES_PASSWORD=personal-dashboard-synthetic-only',IMAGE_ID,'postgres','-c','shared_preload_libraries=pg_stat_statements,pg_cron,pg_net','-c','cron.launch_active_jobs=off'],{timeoutMs:60000});if(start.code!==0||!/^[a-f0-9]{64}\n?$/u.test(start.stdout))fail('owned_container_start_failed');owned=true;const info=await assertOwnedContainer(name,nonce);containerProof={id:info.Id,name,image:info.Image,ownerLabelMatched:true,nonceSha256:hash(nonce),networkMode:info.HostConfig.NetworkMode,mounts:info.Mounts.length,portBindings:Object.keys(info.HostConfig.PortBindings??{}).length};
  let stable=0;for(let attempt=0;attempt<80&&stable<3;attempt++){requireRunning();const pid=await runProcess(['exec',name,'sh','-c',"tr '\\000' ' ' < /proc/1/cmdline"],{timeoutMs:5000});const ready=pid.code===0&&pid.stdout.trim().split(/\s/u)[0].split('/').at(-1)==='postgres'?await runProcess(['exec',name,'psql','-XqAt','--username','postgres','--dbname','postgres','--command','select 1'],{timeoutMs:5000}):null;stable=ready?.code===0&&ready.stdout.trim()==='1'?stable+1:0;if(stable<3)await delay(250)}if(stable!==3)fail('database_not_ready');
  requireRunning();phase='cached_image_role_metadata';const roles=await sql(name,Buffer.from("select jsonb_build_object('roles',(select jsonb_agg(jsonb_build_object('role',rolname,'superuser',rolsuper,'createRole',rolcreaterole,'createDb',rolcreatedb,'bypassRls',rolbypassrls) order by rolname) from pg_roles where rolname in('postgres','supabase_admin','service_role')),'extensions',(select jsonb_agg(jsonb_build_object('name',e.extname,'schema',n.nspname,'owner',pg_get_userbyid(e.extowner)) order by e.extname) from pg_extension e join pg_namespace n on n.oid=e.extnamespace),'authTableOwner',(select pg_get_userbyid(relowner) from pg_class where oid='auth.users'::regclass),'authRows',(select count(*) from auth.users),'profilesPresent',to_regclass('public.profiles') is not null,'authHelpers',jsonb_build_object('uid',to_regprocedure('auth.uid()') is not null,'jwt',to_regprocedure('auth.jwt()') is not null,'role',to_regprocedure('auth.role()') is not null),'sharedPreloadLibraries',current_setting('shared_preload_libraries'),'cronDatabaseName',current_setting('cron.database_name',true),'availableExtensions',(select jsonb_agg(jsonb_build_object('name',name,'version',default_version) order by name) from pg_available_extensions where name in('pgtap','pg_cron','pg_net')),'postgresAuthSelect',has_table_privilege('postgres','auth.users','SELECT'),'postgresAuthMember',pg_has_role('postgres','supabase_auth_admin','MEMBER'));"),'supabase_admin');imageRoleMetadata=JSON.parse(roles.stdout.trim());
  requireRunning();phase=BOOTSTRAP;await sql(name,input.bootstrap.bytes,'supabase_admin');requireRunning();phase=input.baseline.path;await sql(name,input.baseline.bytes);
  for(const repair of input.repairs.slice(0,2)){requireRunning();phase=repair.path;await sql(name,repair.bytes)}
  phase='reviewed_baseline_parity';const baselineTap=inspectFocusedBaselineTap((await sql(name,input.parity.bytes)).stdout,input.parity.bytes);phase='reviewed_baseline_smoke';const smokeTap=inspectFocusedSmokeTap((await sql(name,input.smoke.bytes)).stdout);
  pipelineEvidence.baselineTap=baselineTap;pipelineEvidence.smokeTap=smokeTap;
  requireRunning();phase=FORWARD_BOOTSTRAP;await sql(name,input.forwardBootstrap.bytes,'supabase_admin');
  for(const repair of input.repairs.slice(2)){requireRunning();phase=repair.path;await sql(name,repair.bytes)}
  for(const migration of input.migrations){requireRunning();phase=migration.path;await sql(name,migration.bytes);pipelineEvidence.orderedMigrationsApplied.push(metadata(migration))}
  requireRunning();phase=OWNER_DRAFT;await sql(name,input.ownerDraft.bytes);requireRunning();phase=DRAFT;await sql(name,input.draft.bytes);
  phase='focused_authorization_preflight';const authorizationPreflight=await focusedAuthorizationPreflight(name);
  pipelineEvidence.authorizationPreflight=authorizationPreflight;
  const versions=await sql(name,Buffer.from("select current_setting('server_version');select extversion from pg_extension where extname='pgtap';select current_user;select current_setting('cron.launch_active_jobs');"));
  requireRunning();phase=TEST;const tested=await sql(name,input.test.bytes);const tap=parsePersonalOwnerTap(tested.stdout),producerParity=captured(tested.stdout);
  pipelineEvidence.tap=tap;pipelineEvidence.producerParity=producerParity;
  requireRunning();phase='committed_synthetic_fixture_prefix';const prefix=fixturePrefix(input.test);await sql(name,prefix);
  phase='live_sql_http_consumer';const runtime=await createPersonalOwnerConcurrencyRuntime({name,nonce,requireRunning,registerStop:stop=>{activeStops.add(stop);return()=>activeStops.delete(stop)}});let liveConsumer,concurrency,runtimeCleanup;
  let consumerFailure;try{liveConsumer=await consumeLive(runtime);phase='new_callback_concurrency_probes';concurrency=await runPersonalDashboardReadConcurrencyProbes({runtime,parseTap:parsePersonalOwnerTap,requireRunning})}catch(error){consumerFailure=error}finally{try{runtimeCleanup=await runtime.finish()}catch(error){if(!consumerFailure)consumerFailure=error;else consumerFailure.diagnostics={...consumerFailure.diagnostics,runtimeCleanupFailed:true}}}if(consumerFailure)throw consumerFailure;
  if(await head()!==sourceHead||JSON.stringify(evidence(await sources()))!==JSON.stringify(evidence(input))||JSON.stringify(await dependencyEvidence())!==JSON.stringify(dependency))fail('source_changed_during_run');requireRunning();
  result={status:baselineTap.fullBaselineCatalogParity&&smokeTap.completePass?'focused_passed':'focused_passed_with_baseline_mismatches',requestId:argv[2],planSha256,...common,containerProof,imageRoleMetadata,authorizationPreflight,databaseVersions:versions.stdout.trim().split('\n'),baselineTap,smokeTap,tap,producerParity,liveConsumer,concurrency,runtimeCleanup,fixturePrefix:{source:TEST,bytes:prefix.length,sha256:hash(prefix),committedSyntheticOnly:true},sourceStable:true,cleanup:'owned_container_removed_and_absence_confirmed'};
 }catch(error){failure=error;failure.phase=phase;failure.sourceEvidence=evidence(input);failure.containerProof=containerProof??null;failure.imageRoleMetadata=imageRoleMetadata??null;failure.pipelineEvidence=pipelineEvidence}finally{
  if(startAttempted)try{await cleanupPersonalOwnerQaContainer(name,nonce,runProcess,!owned);if(failure)failure.cleanupConfirmed=owned}catch(error){if(!failure)failure=error;else failure.cleanupError=error.message}
  process.off('SIGINT',interrupt);process.off('SIGTERM',interrupt);
 }
 if(!failure&&interrupted)failure=new Error('agent_personal_dashboard_qa:interrupted');if(failure)throw failure;return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{process.stdout.write(JSON.stringify(await runPersonalDashboardReadLocalQa())+'\n')}catch(error){process.stderr.write(JSON.stringify({status:'failed',code:/^(?:agent_personal_dashboard(?:_read)?|ai_agent_personal_owner)_qa:[a-z_]+$/u.test(error?.message??'')?error.message:'agent_personal_dashboard_qa:execution_failed',phase:error?.phase??null,sources:error?.sourceEvidence??null,diagnostics:error?.diagnostics??null,containerProof:error?.containerProof??null,imageRoleMetadata:error?.imageRoleMetadata??null,pipelineEvidence:error?.pipelineEvidence??null,cleanupConfirmed:error?.cleanupConfirmed??false,cleanupError:error?.cleanupError??null})+'\n');process.exitCode=1}
}
