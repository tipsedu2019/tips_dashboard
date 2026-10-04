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
// Explicit import closure, including type-only imports and the VM-loaded issuer.
// No app/dependency/environment copy; packages resolve in the source checkout.
export const AI_SOURCE_CLOSURE=Object.freeze([
 'scripts/lib/ai-producer-receipt.mjs',
 'scripts/run-isolated-supabase-db-tests.mjs',
 'scripts/build-supabase-transactional-preflight.mjs',
 'scripts/isolated-db-loopback-relay.mjs',
 'scripts/generate-ai-agent-probe-runtime.mjs',
 'scripts/lib/ai-agent-probe-runtime.mjs',
 'package.json','package-lock.json',
 'supabase/test-baselines/dashboard-free-tier-v1.manifest.json',
 'tests/probe-ai-agent-http-producer.mjs',
 'tests/probe-ai-agent-chat-runtime-concurrency.mjs',
 ...AI_CONSUMERS,
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
].sort());
export const ACCEPTED_AI_MIGRATIONS=Object.freeze([
 {"fileName": "20261003084028_ai_agent_requests.sql", "sha256": "5f4657b2e9835617caec86d7ff17bdd2bf94f664d8001e564031385cf85ea249", "status": "final"},
 {"fileName": "20261003084048_ai_agent_scoped_credentials.sql", "sha256": "a0ae48fa06def310113da34822f792416a85c0b4311acc1bc51397f30b53696a", "status": "final"},
 {"fileName": "20261003091944_ai_agent_request_lifecycle.sql", "sha256": "84b57276ead7a30c7a4a51e7cdfa6952dbf7ebc27542f935b634ad7c1921aa87", "status": "final"},
 {"fileName": "20261003092019_ai_agent_chat_outbox.sql", "sha256": "95212aec139a02b259cc1f7a2ede7c8f7ea51526bb4d2ba2d6dbbbf804dfeedb", "status": "final"},
 {"fileName": "20261003105447_ai_agent_space_policy.sql", "sha256": "794a67d1daaaf8aecaca81aad3d8d7363b9c9de1bcbecdcec9f219dd34e00692", "status": "final"},
 {"fileName": "20261003133222_ai_agent_chat_delivery_runtime.sql", "sha256": "a6f0400ec89c95c391d089226deb10e4d74acd847b4b8612ab349bc7b04efffb", "status": "final"},
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
export async function snapshotAiSource(root=ROOT){
 const closure=[];
 for(const path of AI_SOURCE_CLOSURE){
  const contents=await readFile(join(root,path));
  // Fail closed if a local import is added outside the audited allowlist.
  if(/\.[mt]?[js]+x?$/u.test(path))for(const match of contents.toString().matchAll(/(?:\bfrom|\bimport(?:\s*\()?|\brequire\s*\()\s*(?:\/\*[\s\S]*?\*\/\s*)*((['"])(?:\\[\s\S]|(?!\2)[^\\\r\n])*\2)/gu)){
   // Evaluate only the matched quoted literal, never application/source code.
   // JS Unicode/hex escapes must be decoded before classifying local imports.
   const spec=runInNewContext(match[1],Object.create(null),{timeout:50});
   if(!spec.startsWith('.')&&!spec.startsWith('@/'))continue;
   const stem=spec.startsWith('@/')?'src/'+spec.slice(2):join(dirname(path),spec);
   assert.ok([stem,stem+'.ts',stem+'.tsx',stem+'.js',stem+'.mjs'].some(target=>AI_SOURCE_CLOSURE.includes(target)),'import outside audited AI closure');
  }
  closure.push({path,sha256:hash(contents),bytes:contents.length});
 }
 const manifest=JSON.parse(await readFile(join(root,'supabase/test-baselines/dashboard-free-tier-v1.manifest.json')));
 assert.equal(manifest.orderedNewMigrations.length,146,'AI canonical manifest inventory');
 assert.deepEqual(manifest.orderedNewMigrations.filter(m=>m.fileName.includes('_ai_agent_')),ACCEPTED_AI_MIGRATIONS,'accepted migration manifest drift');
 for(const m of ACCEPTED_AI_MIGRATIONS)assert.equal(hash(await readFile(join(root,'supabase/migrations',m.fileName))),m.sha256,'accepted migration source drift');
 const sourceHead=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',env:{PATH:process.env.PATH,LANG:'C'}}).trim();
 assert.match(sourceHead,/^[a-f0-9]{40}$/u);
 return {sourceHead,closure,migrations:ACCEPTED_AI_MIGRATIONS};
}
export function validateAiReceipt(receipt,{expected,source,raw,identity,now=Date.now()}){
 assert.equal(receipt?.version,1,'receipt version');
 assert.match(expected?.runId??'',/^[a-f0-9]{32}$/u);assert.match(expected?.nonce??'',/^[a-f0-9]{64}$/u);
 assert.equal(receipt.runId,expected.runId,'receipt stale run');assert.equal(receipt.nonce,expected.nonce,'receipt stale nonce');
 assert.equal(receipt.startedAt,expected.startedAt,'receipt stale start');
 assert.ok(receipt.startedAt<=receipt.finishedAt && receipt.finishedAt<=now && now-receipt.startedAt<900_000,'receipt time window');
 assert.deepEqual(receipt.before,source,'receipt stale source');assert.deepEqual(receipt.after,source,'receipt closure drift');
 assert.deepEqual(receipt.sqlTests,AI_SQL_TESTS,'receipt SQL inventory');
 assert.deepEqual(receipt.probes,AI_PROBES,'receipt probe inventory');
 assert.deepEqual(receipt.migrations,ACCEPTED_AI_MIGRATIONS,'receipt migration drift');
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
  validateAiReceipt(receipt,{expected:{runId:env.TASK_AI_RUN_ID,nonce:env.TASK_AI_RUN_NONCE,startedAt:Number(env.TASK_AI_STARTED_AT)},source,raw,identity:name});
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
  "supabase/tests/timetable_continuous_class_scope_test.sql",
  "supabase/tests/timetable_guard_aggregation_test.sql",
  "supabase/tests/timetable_legacy_content_preservation_test.sql",
  "supabase/tests/timetable_lesson_save_performance_test.sql",
  "supabase/tests/timetable_makeup_domain_sqlstate_test.sql",
  "supabase/tests/timetable_normalized_time_matching_test.sql",
  "supabase/tests/timetable_operational_conflicts_test.sql",
  "supabase/tests/timetable_repeatable_read_guard_test.sql",
  "supabase/tests/timetable_serializable_guard_test.sql",
  "supabase/tests/timetable_plan_import_test.sql",
  "supabase/tests/timetable_plan_no_send_test.sql",
  "supabase/tests/timetable_plan_permissions_test.sql",
  "supabase/tests/timetable_plan_storage_test.sql",
  "supabase/tests/timetable_plan_transfers_test.sql",
  "supabase/tests/timetable_schedule_mutation_safety_test.sql",
  "supabase/tests/timetable_scoped_occupancy_test.sql",
  "supabase/tests/academic_operations_numbered_pages_test.sql",
  "supabase/tests/performance_catalog_taxonomy_test.sql",
  "supabase/tests/makeup_approval_collision_candidates_test.sql",
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
  "supabase/tests/timetable_unknown_snapshot_reader_fast_path_test.sql",
  "supabase/tests/ai_agent_chat_outbox_test.sql",
  "supabase/tests/ai_agent_chat_runtime_test.sql",
  "supabase/tests/ai_agent_credentials_test.sql",
  "supabase/tests/ai_agent_requests_authz_test.sql",
  "supabase/tests/ai_agent_requests_transition_test.sql",
  "supabase/tests/ai_agent_space_policy_test.sql",
]);

export const AI_PROBES = Object.freeze([
  "tests/probe-agent-class-edit-dto.mjs",
  "tests/probe-agent-calendar-dto.mjs",
  "tests/probe-curriculum-scheduling-dto.mjs",
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
  "tests/probe-ai-agent-chat-runtime-concurrency.mjs",
  "tests/probe-ai-agent-http-producer.mjs",
]);
