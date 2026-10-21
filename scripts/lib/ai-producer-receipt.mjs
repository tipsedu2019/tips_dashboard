// Source-owned attestation; raw producer DTOs remain byte-identical and private.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, lstat} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
const ROOT=resolve(fileURLToPath(new URL('../..',import.meta.url)));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export const AI_PRODUCERS=Object.freeze({
 http:{path:'tests/probe-ai-agent-http-producer.mjs',prefix:'AI_HTTP_CAPTURE:',file:'http.json'},
 chat:{path:'tests/probe-ai-agent-chat-runtime-concurrency.mjs',prefix:'AI_CHAT_RUNTIME_CAPTURE:',file:'chat.json'},
});
export const AI_CONSUMERS=Object.freeze(['tests/ai-agent-http-producer-parity.test.mjs','tests/ai-agent-chat-runtime-parity.test.mjs']);
export const AI_CREDENTIAL_PREFIX=Object.freeze({migration:'20261003084048_ai_agent_scoped_credentials.sql',test:'supabase/tests/ai_agent_credentials_committed_prefix_test.sql'});
// Explicit import closure, including type-only imports and the VM-loaded issuer.
// No app/dependency/environment copy; packages resolve in the source checkout.
export const AI_SOURCE_CLOSURE=Object.freeze([
 'scripts/lib/ai-producer-receipt.mjs',
 'scripts/run-isolated-supabase-db-tests.mjs',
 'scripts/build-supabase-transactional-preflight.mjs',
 'scripts/isolated-db-loopback-relay.mjs',
 'scripts/generate-ai-agent-probe-runtime.mjs',
 'scripts/lib/ai-agent-probe-runtime.mjs',
 AI_CREDENTIAL_PREFIX.test,
 'package.json','package-lock.json',
 'supabase/test-baselines/dashboard-free-tier-v1.manifest.json',
 'supabase/migrations/20261007135140_textbook_latest_count_read_aggregation.sql',
 'supabase/migrations/20261006080000_withdrawal_chat_last_lesson_wording.sql',
 'supabase/migrations/20261006090000_withdrawal_last_lesson_release.sql',
 'supabase/migrations/20261006091000_withdrawal_future_roster_boundary.sql',
 'supabase/migrations/20261007141548_withdrawal_completion_without_settlement.sql',
 'supabase/migrations/20261008113322_withdrawal_completion_optional_request_snapshot.sql',
 'supabase/migrations/20261012102015_withdrawal_immediate_completion.sql',
 'supabase/migrations/20261012155755_timetable_validation_date_reuse.sql',
 'supabase/migrations/20261013043948_class_close_gateway_noop_validation_reuse.sql',
 'supabase/migrations/20261013070534_timetable_reader_explicit_native_resolution.sql',
 'supabase/migrations/20261013193200_timetable_shared_validation_workset.sql',
 'supabase/migrations/20261014180000_timetable_validation_unchanged_inputs.sql',
 'supabase/migrations/20261014193500_legacy_context_binding_preparation.sql',
 'supabase/migrations/20261019100046_academic_calendar_move_atomic.sql',
 'supabase/migrations/20261020001626_word_retest_completed_failed_retry.sql',
 'supabase/migrations/20261020134458_timetable_optional_classroom_occupancy.sql',
 'supabase/migrations/20261021155723_class_lesson_input_policy.sql',
 'supabase/tests/timetable_nullable_classroom_test.sql',
 'supabase/tests/class_lesson_input_policy_test.sql',
 'supabase/tests/class_lesson_input_save_performance_test.sql',
 'tests/probe-timetable-nullable-room-concurrency.mjs',
 'tests/helpers/ai-personal-probe-runtime.mjs',
 'supabase/tests/timetable_reader_explicit_native_resolution_test.sql',
 'supabase/tests/timetable_shared_validation_workset_test.sql',
 'supabase/tests/timetable_close_gateway_validation_reuse_test.sql',
 'supabase/tests/legacy_context_binding_preparation_test.sql',
 'supabase/migrations/20261013084134_registration_enrollment_guarded_save.sql',
 'supabase/migrations/20261013051620_timetable_plan_atomic_batch_save.sql',
 'supabase/migrations/20261008140556_ai_agent_thread_replies.sql',
 'supabase/tests/ai_agent_thread_replies_test.sql',
 'supabase/tests/ai_agent_nonexpiring_chat_test.sql',
 'supabase/migrations/20261009065500_ai_agent_nonexpiring_chat_credentials.sql',
 'supabase/migrations/20261009065550_transfer_completion_preexcluded_rosters.sql',
 'supabase/migrations/20261009082000_ops_legacy_dispatch_actor_null_guard.sql',
 'tests/probe-ai-agent-nonexpiring-concurrency.mjs',
 'tests/probe-ai-agent-http-producer.mjs',
 'tests/probe-ai-agent-chat-runtime-concurrency.mjs',
 'tests/probe-ai-agent-thread-replies-concurrency.mjs',
 'src/features/chat/server/chat-outbox.ts',
 ...AI_CONSUMERS,
 'tests/ai-agent-http-producer-assertions.mjs',
 'tests/ai-agent-chat-runtime-assertions.mjs',
 'tests/helpers/notification-component-loader.mjs',
 'src/features/ai-agent/ai-agent-credential-service.ts',
 'src/features/ai-agent/ai-agent-request-access.ts',
 'src/features/ai-agent/ai-agent-request-contract.ts',
 'src/features/ai-agent/server/ai-agent-auth.ts',
 'src/features/ai-agent/server/ai-agent-routes.ts',
 'src/features/ai-agent/server/ai-agent-repository.ts',
 'src/features/ai-agent/server/ai-agent-space-policy-route.ts',
 'src/features/chat/server/chat-contract.ts',
 'src/features/chat/server/chat-send-route.ts',
 'src/features/chat/server/chat-runtime-configuration.ts',
 'src/features/chat/server/chat-space-catalog.ts',
 'src/features/chat/server/google-chat-transport.ts',
 'supabase/tests/ai_agent_personal_owner_test.sql',
 'supabase/tests/agent_personal_dashboard_read_test.sql',
 'src/features/ai-agent/ai-agent-personal-credential-service.ts',
 'src/features/agent-api/server/personal-dashboard-read.ts',
 'src/features/agent-api/server/http.ts',
 'src/features/agent-api/server/response-contract.ts',
 'src/features/agent-api/server/openapi.ts',
 'src/features/agent-api/server/openapi-contract.ts',
 'src/features/agent-api/server/calendar-compiler.mjs',
 'src/features/agent-api/server/calendar-contract.ts',
 'src/features/agent-api/server/class-edit-compiler.mjs',
 'src/features/operations/legacy-effective-schedule.js',
 'src/features/agent-api/server/class-edit-contract.ts',
 'src/lib/auth-utils.ts',
 'src/lib/class-schedule-planner.js',
 'src/features/operations/academic-event-utils.js',
 'src/app/admin/calendar/utils/calendar-grid.js',
].sort());
export const ACCEPTED_AI_MIGRATIONS=Object.freeze([
 {"fileName": "20261003084028_ai_agent_requests.sql", "sha256": "5f4657b2e9835617caec86d7ff17bdd2bf94f664d8001e564031385cf85ea249", "status": "final"},
 {"fileName": "20261003084048_ai_agent_scoped_credentials.sql", "sha256": "809b8ec2ef1e72184dd8a0fc9933b99ece2698585cab2a9509761feb6f1482d9", "status": "final"},
 {"fileName": "20261003091944_ai_agent_request_lifecycle.sql", "sha256": "84b57276ead7a30c7a4a51e7cdfa6952dbf7ebc27542f935b634ad7c1921aa87", "status": "final"},
 {"fileName": "20261003092019_ai_agent_chat_outbox.sql", "sha256": "85a96399907447cf73b2e955dfbe39157fa116be3a49700177c58848ee34f614", "status": "final"},
 {"fileName": "20261003105447_ai_agent_space_policy.sql", "sha256": "794a67d1daaaf8aecaca81aad3d8d7363b9c9de1bcbecdcec9f219dd34e00692", "status": "final"},
 {"fileName": "20261003133222_ai_agent_chat_delivery_runtime.sql", "sha256": "a6f0400ec89c95c391d089226deb10e4d74acd847b4b8612ab349bc7b04efffb", "status": "final"},
]);
// Current reviewed source pins. The authorized pre-install Squawk correction
// and intermediate-issuance ACL correction supersede uninstalled SQL snapshots;
// prior receipts remain historical.
export const THREAD_REPLY_MIGRATION=Object.freeze({"fileName":"20261008140556_ai_agent_thread_replies.sql","sha256":"2b618a4944c4e5bdf573b1335cd146a4eb989fff451ca585f4e55a8c348682c1","status":"final"});
export const NONEXPIRING_CHAT_MIGRATION=Object.freeze({"fileName":"20261009065500_ai_agent_nonexpiring_chat_credentials.sql","sha256":"e404d9eb1fff35514dd8822e8b745ef8f59444fc4e614736ca6d59b4210be912","status":"final"});
export const CURRENT_AI_MIGRATIONS=Object.freeze([...ACCEPTED_AI_MIGRATIONS,
 {"fileName": "20261004030228_ai_agent_request_notification_optin.sql", "sha256": "02fcfb01e37cea1d5ddf2030f66b13512217e4441b2ed9cfe64f6b5e1f821b01", "status": "final"},
 {"fileName": "20261007062153_ai_agent_personal_owner.sql", "sha256": "3ba31674ad33d258e70e39a2048ad1d28508cde3473bc7e61d5f9cc6213a1fad", "status": "final"},
 {"fileName": "20261007062159_agent_personal_dashboard_read.sql", "sha256": "28a40477e01001d664d716ab4ab8be550db295ea2300822bb3ff009531341954", "status": "final"},
 THREAD_REPLY_MIGRATION,
 NONEXPIRING_CHAT_MIGRATION,
]);
// Preserve the reviewed ac84 inventory and exact main addition.
// Only explicitly pinned withdrawal, Chat, PR126, timetable, registration, calendar and word-retest migrations extend it.
// A future migration requires an explicit review of these source-owned pins.
const REVIEWED_MANIFEST_PREFIX_SHA256='80a6a4d06fe190ef65e9c926392cf187995c07ce1a25c275ac07dc9d72df79c2';
const MAIN_MIGRATION=Object.freeze({fileName:'20261007135140_textbook_latest_count_read_aggregation.sql',status:'final',sha256:'1491b4b824c343e23dc24b83e1be41214f5fda197813dca012c252a9b541cb23'});
export const TIMETABLE_VALIDATION_MIGRATION=Object.freeze({fileName:'20261012155755_timetable_validation_date_reuse.sql',status:'final',sha256:'83ec63aad313c61b6c2205ce4748a0707b1f478a424e5e6c67d92fb4b27c9e82'});
export const TIMETABLE_CLOSE_MIGRATIONS=Object.freeze([
 Object.freeze({"fileName":"20261013043948_class_close_gateway_noop_validation_reuse.sql","status":"final","sha256":"8c6c0897694d935bbcb276d19ffdf8376146d42fe7da767d9508c6d626ef8886"}),
 Object.freeze({"fileName":"20261013070534_timetable_reader_explicit_native_resolution.sql","status":"final","sha256":"cf8bec62963545e209ea4d18c5b7276ff75a62e93fac1e5bddbb55ab7c5922c0"}),
 Object.freeze({"fileName":"20261013193200_timetable_shared_validation_workset.sql","status":"final","sha256":"f5df6c1d0494ff8f0d5ad75251e1b3592ee5a14b7a532eb43534413976886559"}),
 Object.freeze({"fileName":"20261014180000_timetable_validation_unchanged_inputs.sql","status":"final","sha256":"cc7ada2b9a4670b38d431cc69c16b4e63d0008b40914f4d17594cfb0c1aafc7f"}),
 Object.freeze({"fileName":"20261014193500_legacy_context_binding_preparation.sql","status":"final","sha256":"70ef7db3791f04a8b9e42986d21e2afa6396f8967084b293c3f1f3c77889b5af"}),
]);
// Finalize the reviewed registration SQL without changing its exact bytes.
// Runtime producer parity still requires the full final-source run and receipt.
export const REGISTRATION_ENROLLMENT_MIGRATION=Object.freeze({fileName:'20261013084134_registration_enrollment_guarded_save.sql',status:'final',sha256:'befb880ae63b997aa71912b1775cf779933758b89c00fcb9440b3698fb9338c3'});
export const TIMETABLE_BATCH_SAVE_MIGRATION=Object.freeze({fileName:'20261013051620_timetable_plan_atomic_batch_save.sql',status:'final',sha256:'d84407072b358e36d071d38d7c0818568716a8566683d1059121637e85e2b4a7'});
export const ACADEMIC_CALENDAR_MOVE_MIGRATION=Object.freeze({fileName:'20261019100046_academic_calendar_move_atomic.sql',status:'final',sha256:'4fd992887e81cfb23e9e3585ee4a63eda82de8bb6bdbb21b5392501bcb5e83de'});
export const WORD_RETEST_COMPLETED_FAILED_MIGRATION=Object.freeze({fileName:'20261020001626_word_retest_completed_failed_retry.sql',status:'final',sha256:'7b964368c629ac92e1655513783147a985b9dc659f818c1148e765eb11dfa35b'});
export const OPTIONAL_CLASSROOM_MIGRATION=Object.freeze({fileName:'20261020134458_timetable_optional_classroom_occupancy.sql',status:'final',sha256:'31cd689964a52b5f084a8a167cb41a0b61b12403a88d4dff7b20d9106e29a8b6'});
export const CLASS_LESSON_INPUT_MIGRATION=Object.freeze({fileName:'20261021155723_class_lesson_input_policy.sql',status:'final',sha256:'051525d83a5f3e5a8faf3b0fce73bc356e02ac87290b20daada06161feeb1345'});
export const CURRENT_PR126_MIGRATIONS=Object.freeze([
 Object.freeze({fileName:'20261009065550_transfer_completion_preexcluded_rosters.sql',status:'final',sha256:'59ca0b65f1d0873b29040afb34551e1d58071291e222e9cc51cd4fbd6ce38099'}),
 Object.freeze({fileName:'20261009082000_ops_legacy_dispatch_actor_null_guard.sql',status:'final',sha256:'191aaeb47a383122b52d85b6c0c21bb8ffe235c9bc9c456d3518dd4cb3ae05b3'}),
]);
export const CURRENT_WITHDRAWAL_MIGRATIONS=Object.freeze([
 Object.freeze({"fileName":"20261006080000_withdrawal_chat_last_lesson_wording.sql","status":"final","sha256":"b33601339abe5ef2f96d553ce0dc1423981225f308be45394a2b81206ce6a30d"}),
 Object.freeze({"fileName":"20261006090000_withdrawal_last_lesson_release.sql","status":"final","sha256":"4f73f75bbf0aa8f457eb3b1c070281ae3f94dcbf79e20b119f8fb79f0de3e921"}),
 Object.freeze({"fileName":"20261006091000_withdrawal_future_roster_boundary.sql","status":"final","sha256":"59b76d0271adacbddb49896adc272a889314766caa58f61534f7dc45ab71c009"}),
 Object.freeze({"fileName":"20261007141548_withdrawal_completion_without_settlement.sql","status":"final","sha256":"221a7f214457ea6f02e86b5e2775b749cbfe2dce64708fce3c3e262b202e74fe"}),
 Object.freeze({"fileName":"20261008113322_withdrawal_completion_optional_request_snapshot.sql","status":"final","sha256":"649a119837bfb55428e835fca4b32de9f066408dd50c37e238782c16877d5b45"}),
 Object.freeze({"fileName":"20261012102015_withdrawal_immediate_completion.sql","status":"final","sha256":"4283c5a46522d473a710913ffe564bb2796ebc80a200210055165cc88abc8eac"}),
]);
export function extractAiCapture(stdout,identity){
 const producer=AI_PRODUCERS[identity];assert.ok(producer,'unknown capture producer');
 const lines=stdout.split(/\r?\n/u).filter(line=>/AI_[A-Z_]*CAPTURE:/u.test(line));
 assert.equal(lines.length,1,'exactly one capture required');
 assert.ok(lines[0].startsWith(producer.prefix),'unexpected capture');
 const raw=Buffer.from(lines[0].slice(producer.prefix.length));
 assert.ok(raw.length>0 && raw.length<4_000_000,'capture size invalid');
 assert.ok(JSON.parse(raw.toString()) && !raw.includes(Buffer.from('\ufffd')),'capture JSON invalid');
 return raw;
}
export function suppressAiCaptures(value){return value.replace(/[^\r\n]*AI_[A-Z_]*CAPTURE:[^\r\n]*/gu,'[private AI capture omitted]');}
const decodedImportLiterals=new Map();
export function decodeAiImportLiteral(literal){
 // Accept exactly one quoted literal, including its closing quote. This also
 // keeps the exported helper from evaluating expressions supplied by a caller.
 assert.ok(typeof literal==='string' && /^(['"])(?:\\(?:\r\n|[\s\S])|(?!\1)[^\\\r\n])*\1(?![\s\S])/u.test(literal),'invalid import literal');
 if(!literal.includes('\\'))return literal.slice(1,-1);
 if(decodedImportLiterals.has(literal))return decodedImportLiterals.get(literal);
 // Keep V8's existing escape semantics, timeout, and exception propagation.
 // Only successful literal values are reusable, never an import authorization.
 const value=runInNewContext(literal,Object.create(null),{timeout:50});
 if(decodedImportLiterals.size<64 && literal.length<=4096)decodedImportLiterals.set(literal,value);
 return value;
}
export async function snapshotAiSource(root=ROOT){
 const closure=[];
 for(const path of AI_SOURCE_CLOSURE){
  const contents=await readFile(join(root,path));
  // Fail closed if a local import is added outside the audited allowlist.
  if(/\.[mt]?[js]+x?$/u.test(path))for(const match of contents.toString().matchAll(/(?:\bfrom|\bimport|\brequire)(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\r\n\u2028\u2029]*(?:[\r\n\u2028\u2029]|$))*(?:\((?:\s|\/\*[\s\S]*?\*\/|\/\/[^\r\n\u2028\u2029]*(?:[\r\n\u2028\u2029]|$))*)?((['"])(?:\\[\s\S]|(?!\2)[^\\\r\n])*\2)/gu)){
   // Recheck each occurrence against this file's location even on a value hit.
   // JS Unicode/hex escapes are decoded before classifying local imports.
   const spec=decodeAiImportLiteral(match[1]);
   if(!spec.startsWith('.')&&!spec.startsWith('@/'))continue;
   const stem=spec.startsWith('@/')?'src/'+spec.slice(2):join(dirname(path),spec);
   assert.ok([stem,stem+'.ts',stem+'.tsx',stem+'.js',stem+'.mjs'].some(target=>AI_SOURCE_CLOSURE.includes(target)),'import outside audited AI closure');
  }
  closure.push({path,sha256:hash(contents),bytes:contents.length});
 }
 const manifest=JSON.parse(await readFile(join(root,'supabase/test-baselines/dashboard-free-tier-v1.manifest.json')));
 const withdrawalNames=CURRENT_WITHDRAWAL_MIGRATIONS.map(m=>m.fileName);
 const integratedNames=[...CURRENT_PR126_MIGRATIONS,...TIMETABLE_CLOSE_MIGRATIONS].map(m=>m.fileName);
 const reviewedLegacy=manifest.orderedNewMigrations.filter(m=>!withdrawalNames.includes(m.fileName) && !integratedNames.includes(m.fileName) && m.fileName!==THREAD_REPLY_MIGRATION.fileName && m.fileName!==NONEXPIRING_CHAT_MIGRATION.fileName && m.fileName!==TIMETABLE_VALIDATION_MIGRATION.fileName && m.fileName!==REGISTRATION_ENROLLMENT_MIGRATION.fileName && m.fileName!==TIMETABLE_BATCH_SAVE_MIGRATION.fileName && m.fileName!==ACADEMIC_CALENDAR_MOVE_MIGRATION.fileName && m.fileName!==WORD_RETEST_COMPLETED_FAILED_MIGRATION.fileName && m.fileName!==OPTIONAL_CLASSROOM_MIGRATION.fileName && m.fileName!==CLASS_LESSON_INPUT_MIGRATION.fileName);
 assert.equal(reviewedLegacy.length,156,'AI canonical manifest inventory');
 assert.deepEqual(reviewedLegacy.at(-1),MAIN_MIGRATION,'current migration manifest drift');
 assert.equal(hash(JSON.stringify(reviewedLegacy.slice(0,-1))),REVIEWED_MANIFEST_PREFIX_SHA256,'current migration manifest drift');
 assert.equal(manifest.orderedNewMigrations.length,178,'AI canonical manifest inventory');
 const expected=[...reviewedLegacy,...CURRENT_WITHDRAWAL_MIGRATIONS,THREAD_REPLY_MIGRATION,NONEXPIRING_CHAT_MIGRATION,...CURRENT_PR126_MIGRATIONS,TIMETABLE_VALIDATION_MIGRATION,...TIMETABLE_CLOSE_MIGRATIONS,REGISTRATION_ENROLLMENT_MIGRATION,TIMETABLE_BATCH_SAVE_MIGRATION,ACADEMIC_CALENDAR_MOVE_MIGRATION,WORD_RETEST_COMPLETED_FAILED_MIGRATION,OPTIONAL_CLASSROOM_MIGRATION,CLASS_LESSON_INPUT_MIGRATION].sort((left,right)=>left.fileName<right.fileName?-1:left.fileName>right.fileName?1:0);
 assert.deepEqual(manifest.orderedNewMigrations,expected,'current migration manifest drift');
 assert.equal(hash(await readFile(join(root,'supabase/migrations',MAIN_MIGRATION.fileName))),MAIN_MIGRATION.sha256,'reviewed main migration source drift');
 for(const m of CURRENT_WITHDRAWAL_MIGRATIONS)assert.equal(hash(await readFile(join(root,'supabase/migrations',m.fileName))),m.sha256,'reviewed withdrawal migration source drift');
 for(const m of CURRENT_PR126_MIGRATIONS)assert.equal(hash(await readFile(join(root,'supabase/migrations',m.fileName))),m.sha256,'reviewed PR126 migration source drift');
 assert.equal(hash(await readFile(join(root,'supabase/migrations',TIMETABLE_VALIDATION_MIGRATION.fileName))),TIMETABLE_VALIDATION_MIGRATION.sha256,'timetable validation migration source drift');
 for(const m of TIMETABLE_CLOSE_MIGRATIONS)assert.equal(hash(await readFile(join(root,'supabase/migrations',m.fileName))),m.sha256,'timetable close migration source drift');
 assert.equal(hash(await readFile(join(root,'supabase/migrations',REGISTRATION_ENROLLMENT_MIGRATION.fileName))),REGISTRATION_ENROLLMENT_MIGRATION.sha256,'registration enrollment migration source drift');
 assert.equal(hash(await readFile(join(root,'supabase/migrations',TIMETABLE_BATCH_SAVE_MIGRATION.fileName))),TIMETABLE_BATCH_SAVE_MIGRATION.sha256,'timetable batch migration source drift');
 assert.equal(hash(await readFile(join(root,'supabase/migrations',ACADEMIC_CALENDAR_MOVE_MIGRATION.fileName))),ACADEMIC_CALENDAR_MOVE_MIGRATION.sha256,'academic calendar move migration source drift');
 assert.equal(hash(await readFile(join(root,'supabase/migrations',WORD_RETEST_COMPLETED_FAILED_MIGRATION.fileName))),WORD_RETEST_COMPLETED_FAILED_MIGRATION.sha256,'completed failed word-retest migration source drift');
 assert.equal(hash(await readFile(join(root,'supabase/migrations',OPTIONAL_CLASSROOM_MIGRATION.fileName))),OPTIONAL_CLASSROOM_MIGRATION.sha256,'optional classroom migration source drift');
 assert.equal(hash(await readFile(join(root,'supabase/migrations',CLASS_LESSON_INPUT_MIGRATION.fileName))),CLASS_LESSON_INPUT_MIGRATION.sha256,'class lesson input migration source drift');
 assert.deepEqual(manifest.orderedNewMigrations.filter(m=>m.fileName.includes('_ai_agent_') || m.fileName.includes('_agent_personal_dashboard_read') || m.fileName.includes('_agent_personal_dashboard_read') || m.fileName.includes('_agent_personal_dashboard_read')),CURRENT_AI_MIGRATIONS,'current migration manifest drift');
 for(const m of CURRENT_AI_MIGRATIONS)assert.equal(hash(await readFile(join(root,'supabase/migrations',m.fileName))),m.sha256,'accepted migration source drift');
 const sourceHead=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',env:{PATH:process.env.PATH,LANG:'C'}}).trim();
 assert.match(sourceHead,/^[a-f0-9]{40}$/u);
 return {sourceHead,closure,migrations:CURRENT_AI_MIGRATIONS};
}
// Database setup and unrelated probes do not create captured DTOs. Keep the
// original run identity and start the unchanged freshness window exactly once,
// immediately before the first producer is allowed to execute.
export async function beginAiCapturePhase(phase,readSource,now=Date.now) {
 if(phase.captureStartedAt!==null){
  assert.ok(Number.isSafeInteger(phase.captureStartedAt)&&phase.captureStartedAt>=phase.startedAt,'capture phase timestamp invalid');
  return phase.captureStartedAt;
 }
 assert.deepEqual(await readSource(),phase.before,'capture phase source drift');
 const started=now();
 assert.ok(Number.isSafeInteger(started)&&Number.isSafeInteger(phase.startedAt)&&phase.startedAt>0&&started>=phase.startedAt,'capture phase timestamp invalid');
 phase.captureStartedAt=started;
 return started;
}
export function validateAiReceipt(receipt,{expected,source,raw,identity,now=Date.now()}){
 assert.equal(receipt?.version,1,'receipt version');
 assert.match(expected?.runId??'',/^[a-f0-9]{32}$/u);assert.match(expected?.nonce??'',/^[a-f0-9]{64}$/u);
 assert.equal(receipt.runId,expected.runId,'receipt stale run');assert.equal(receipt.nonce,expected.nonce,'receipt stale nonce');
 assert.equal(receipt.startedAt,expected.startedAt,'receipt stale start');
 assert.equal(receipt.captureStartedAt,expected.captureStartedAt,'receipt stale capture start');
 assert.ok([receipt.startedAt,receipt.captureStartedAt,receipt.finishedAt,now].every(value=>Number.isSafeInteger(value)&&value>0),'receipt timestamp invalid');
 assert.ok(receipt.startedAt<=receipt.captureStartedAt && receipt.captureStartedAt<=receipt.finishedAt && receipt.finishedAt<=now && now-receipt.captureStartedAt<900_000,'receipt time window');
 assert.deepEqual(receipt.before,source,'receipt stale source');assert.deepEqual(receipt.after,source,'receipt closure drift');
 assert.deepEqual(receipt.sqlTests,AI_SQL_TESTS,'receipt SQL inventory');
 assert.deepEqual(receipt.probes,AI_PROBES,'receipt probe inventory');
 assert.deepEqual(receipt.migrations,CURRENT_AI_MIGRATIONS,'receipt migration drift');
 assert.deepEqual(receipt.credentialPrefix,{...AI_CREDENTIAL_PREFIX,committed:true},'committed credential-prefix evidence required');
 assert.deepEqual(Object.keys(receipt.captures).sort(),['chat','http']);
 for(const [name,producer]of Object.entries(AI_PRODUCERS)){
  const c=receipt.captures[name];assert.equal(c.producer,producer.path);assert.equal(c.sourceSha256,source.closure.find(row=>row.path===producer.path).sha256);
  assert.equal(c.file,producer.file);assert.match(c.sha256,/^[a-f0-9]{64}$/u);assert.ok(c.bytes>0);
 }
 const capture=receipt.captures[identity];assert.ok(capture);
 assert.equal(capture.sha256,hash(raw),'raw capture drift');assert.equal(capture.bytes,raw.length,'raw capture length');
 return true;
}
export async function readCurrentAiCapture(identity,env=process.env,root=ROOT){
 assert.ok(env.TASK_AI_RECEIPT && env.TASK_AI_CAPTURE_DIRECTORY,'current-run capture receipt required');
 const directory=env.TASK_AI_CAPTURE_DIRECTORY;
 const directoryStat=await lstat(directory);assert.ok(directoryStat.isDirectory());assert.equal(directoryStat.mode&0o777,0o700);
 const receiptPath=join(directory,'receipt.json');assert.equal(env.TASK_AI_RECEIPT,receiptPath);
 const receiptStat=await lstat(receiptPath);assert.ok(receiptStat.isFile());assert.equal(receiptStat.mode&0o777,0o600);
 const receipt=JSON.parse(await readFile(receiptPath));
 const source=await snapshotAiSource(root),payloads={};
 for(const name of Object.keys(AI_PRODUCERS)){
  const rawPath=join(directory,AI_PRODUCERS[name].file),rawStat=await lstat(rawPath);assert.ok(rawStat.isFile());assert.equal(rawStat.mode&0o777,0o600);
  const raw=await readFile(rawPath);
  validateAiReceipt(receipt,{expected:{runId:env.TASK_AI_RUN_ID,nonce:env.TASK_AI_RUN_NONCE,startedAt:Number(env.TASK_AI_STARTED_AT),captureStartedAt:Number(env.TASK_AI_CAPTURE_STARTED_AT)},source,raw,identity:name});
  payloads[name]=raw;
 }
 return JSON.parse(payloads[identity].toString());
}

export const AI_SQL_TESTS = Object.freeze([
  "supabase/tests/agent_api_scoped_schedule_test.sql",
  "supabase/tests/agent_api_class_changes_test.sql",
  "supabase/tests/agent_management_calendar_test.sql",
  "supabase/tests/student_enrollment_status_test.sql",
  "supabase/tests/management_numbered_pages_test.sql",
  "supabase/tests/management_page_reads_test.sql",
  "supabase/tests/class_detail_roster_counts_test.sql",
  "supabase/tests/class_period_membership_optional_test.sql",
  "supabase/tests/curriculum_scheduling_textbook_usage_test.sql",
  "supabase/tests/academic_curriculum_unscoped_period_test.sql",
  "supabase/tests/academic_scoped_reads_test.sql",
  "supabase/tests/operations_annual_board_range_test.sql",
  "supabase/tests/operations_calendar_inclusive_range_test.sql",
  "supabase/tests/timetable_continuous_class_scope_test.sql",
  "supabase/tests/timetable_guard_aggregation_test.sql",
  "supabase/tests/timetable_legacy_content_preservation_test.sql",
  "supabase/tests/timetable_lesson_save_performance_test.sql",
  "supabase/tests/timetable_makeup_domain_sqlstate_test.sql",
  "supabase/tests/timetable_normalized_time_matching_test.sql",
  "supabase/tests/timetable_nullable_classroom_test.sql",
  "supabase/tests/class_lesson_input_policy_test.sql",
  "supabase/tests/class_lesson_input_save_performance_test.sql",
  "supabase/tests/timetable_operational_conflicts_test.sql",
  "supabase/tests/timetable_repeatable_read_guard_test.sql",
  "supabase/tests/timetable_serializable_guard_test.sql",
  "supabase/tests/timetable_plan_import_test.sql",
  "supabase/tests/timetable_plan_no_send_test.sql",
  "supabase/tests/timetable_plan_permissions_test.sql",
  "supabase/tests/timetable_plan_storage_test.sql",
  "supabase/tests/timetable_plan_batch_save_test.sql",
  "supabase/tests/timetable_plan_transfers_test.sql",
  "supabase/tests/timetable_schedule_mutation_safety_test.sql",
  "supabase/tests/timetable_scoped_occupancy_test.sql",
  "supabase/tests/academic_operations_numbered_pages_test.sql",
  "supabase/tests/performance_catalog_taxonomy_test.sql",
  "supabase/tests/makeup_approval_collision_candidates_test.sql",
  "supabase/tests/makeup_legacy_approval_occupancy_test.sql",
  "supabase/tests/makeup_numbered_pages_test.sql",
  "supabase/tests/makeup_numbered_optional_keys_test.sql",
  "supabase/tests/textbook_stock_count_atomic_test.sql",
  "supabase/tests/textbook_purchase_lifecycle_atomic_test.sql",
  "supabase/tests/textbook_workflow_numbered_reads_test.sql",
  "supabase/tests/textbook_workflow_purchase_cost_whitespace_test.sql",
  "supabase/tests/signup_identity_isolation_test.sql",
  "supabase/tests/textbook_sale_transition_atomic_test.sql",
  "supabase/tests/dashboard_statistics_sources_test.sql",
  "supabase/tests/dashboard_workload_test.sql",
  "supabase/tests/dashboard_conflict_task_producer_test.sql",
  "supabase/tests/ops_task_page_reads_test.sql",
  "supabase/tests/ops_task_numbered_pages_test.sql",
  "supabase/tests/ops_task_source_plan_budget_test.sql",
  "supabase/tests/active_registration_workflow_sqlstate_contract_test.sql",
  "supabase/tests/registration_teacher_feedback_request_retirement_test.sql",
  "supabase/tests/registration_observation_status_independence_test.sql",
  "supabase/tests/registration_observation_booking_test.sql",
  "supabase/tests/registration_observation_class_lifecycle_test.sql",
  "supabase/tests/registration_notification_readiness_decoupling_test.sql",
  "supabase/tests/registration_flat_common_input_decoupling_test.sql",
  "supabase/tests/registration_subject_soft_archive_test.sql",
  "supabase/tests/registration_subject_snapshot_test.sql",
  "supabase/tests/registration_flat_case_creation_test.sql",
  "supabase/tests/registration_collaboration_write_role_test.sql",
  "supabase/tests/registration_archived_subject_delivery_fence_test.sql",
  "supabase/tests/registration_manager_write_and_integrity_fence_test.sql",
  "supabase/tests/registration_management_notification_explicit_v2_test.sql",
  "supabase/tests/registration_flat_fact_runtime_finalization_test.sql",
  "supabase/tests/registration_admission_order_independence_test.sql",
  "supabase/tests/registration_multiple_textbooks_test.sql",
  "supabase/tests/registration_admission_checklist_roster_consistency_test.sql",
  "supabase/tests/registration_level_test_result_parent_reconciliation_test.sql",
  "supabase/tests/notification_contract_drain_evidence_schema_repair_test.sql",
  "supabase/tests/registration_customer_reminder_claim_final_gate_test.sql",
  "supabase/tests/registration_customer_delivery_lookup_test.sql",
  "supabase/tests/registration_notification_settings_atomic_policy_test.sql",
  "supabase/tests/registration_visit_cancellation_explicit_test.sql",
  "supabase/tests/registration_case_customer_message_history_test.sql",
  "supabase/tests/registration_observation_explicit_chat_test.sql",
  "supabase/tests/registration_management_notification_preview_test.sql",
  "supabase/tests/registration_management_notification_owner_test.sql",
  "supabase/tests/registration_management_notification_source_recovery_test.sql",
  "supabase/tests/dashboard_google_chat_profile_mentions_test.sql",
  "supabase/tests/registration_manual_workflow_status_test.sql",
  "supabase/tests/operations_subject_completion_chat_test.sql",
  "supabase/tests/word_retest_google_chat_retirement_test.sql",
  "supabase/tests/standalone_approvals_retirement_test.sql",
  "supabase/tests/legacy_notification_retry_storm_test.sql",
  "supabase/tests/agent_past_lesson_state_correction_test.sql",
  "supabase/tests/timetable_default_projection_performance_test.sql",
  "supabase/tests/timetable_save_conflict_details_test.sql",
  "supabase/tests/timetable_validation_date_reuse_test.sql",
  "supabase/tests/timetable_reader_explicit_native_resolution_test.sql",
  "supabase/tests/timetable_shared_validation_workset_test.sql",
  "supabase/tests/timetable_close_gateway_validation_reuse_test.sql",
  "supabase/tests/legacy_context_binding_preparation_test.sql",
  "supabase/tests/timetable_unknown_snapshot_reader_fast_path_test.sql",
  "supabase/tests/ai_agent_chat_outbox_test.sql",
  "supabase/tests/ai_agent_chat_runtime_test.sql",
  "supabase/tests/ai_agent_credentials_test.sql",
  "supabase/tests/ai_agent_requests_authz_test.sql",
  "supabase/tests/ai_agent_requests_transition_test.sql",
  "supabase/tests/ai_agent_space_policy_test.sql",
  "supabase/tests/ai_agent_personal_owner_test.sql",
  "supabase/tests/agent_personal_dashboard_read_test.sql",
  "supabase/tests/ai_agent_thread_replies_test.sql",
  "supabase/tests/ai_agent_nonexpiring_chat_test.sql",
]);

export const AI_PROBES = Object.freeze([
  "tests/probe-agent-class-edit-dto.mjs",
  "tests/probe-agent-calendar-dto.mjs",
  "tests/probe-curriculum-scheduling-dto.mjs",
  "tests/probe-operations-annual-board-http.mjs",
  "tests/probe-timetable-batch-save-dto.mjs",
  "tests/probe-timetable-batch-save-concurrency.mjs",
  "tests/probe-makeup-approval-collision-dto.mjs",
  "tests/probe-textbook-stock-count-concurrency.mjs",
  "tests/probe-signup-identity-concurrency.mjs",
  "tests/probe-textbook-purchase-concurrency.mjs",
  "tests/probe-textbook-sale-transition-concurrency.mjs",
  "tests/probe-dashboard-workload-dto.mjs",
  "tests/probe-registration-subject-snapshot-concurrency.mjs",
  "tests/probe-registration-management-recovery-concurrency.mjs",
  "tests/probe-registration-visit-cancellation-dto.mjs",
  "tests/probe-ai-agent-auth-concurrency.mjs",
  "tests/probe-ai-agent-claim-concurrency.mjs",
  "tests/probe-ai-agent-space-policy-concurrency.mjs",
  "tests/probe-ai-agent-nonexpiring-concurrency.mjs",
  "tests/probe-ai-agent-chat-runtime-concurrency.mjs",
  "tests/probe-ai-agent-http-producer.mjs",
  "tests/probe-ai-agent-personal-integration.mjs",
  "tests/probe-ai-agent-thread-replies-concurrency.mjs",
  "tests/probe-timetable-nullable-room-concurrency.mjs",
]);
