// Focused synthetic integration only: no production, provider, rollout or full-baseline claim.
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CURRENT_AI_MIGRATIONS } from './lib/ai-producer-receipt.mjs';
import { loadNotificationComponent } from '../tests/helpers/notification-component-loader.mjs';
import { createPersonalOwnerConcurrencyRuntime } from './lib/ai-agent-personal-owner-concurrency-runtime.mjs';
import { runPersonalOwnerConcurrencyProbes } from '../tests/probe-ai-agent-personal-owner-concurrency.mjs';

export const PERSONAL_OWNER_IMAGE = 'public.ecr.aws/supabase/postgres:17.6.1.159';
const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const OWNER_LABEL = 'tips.ai-agent-personal-owner-qa.owner';
const BOOTSTRAP = 'scripts/fixtures/ai-agent-personal-owner-local-prerequisites.sql';
const DRAFT = 'docs/superpowers/drafts/ai-agent-personal-owner.sql';
const TEST = 'supabase/tests/ai_agent_personal_owner_test.sql';
const IMAGE_ID = 'sha256:86a2e078779e5bdccda1f6f6c5063aa9779a322d1fface5fb408d051909b230f';
const DOCKER_SOCKET = '/Users/hyunjun/.docker/run/docker.sock';
const DOCKER_ENDPOINT = `unix://${DOCKER_SOCKET}`;
const CAPTURE_PREFIX = 'AI_PERSONAL_CREDENTIAL_CAPTURE:';
const LEGACY_CATALOG_SOURCES = Object.freeze([
  { path: 'supabase/migrations/20260929110109_agent_api_scoped_schedule.sql', sha256: '50f8bcc39ec77dc8dea68aa87c2b908b96e0ca54829fb07ccad5c3a58ac9793e' },
  { path: 'supabase/migrations/20260930092804_agent_management_calendar.sql', sha256: '99d388f89a05d66fe17cbd41cf2a171114541dfab11e6d79b57f7f4b6f59dab7' },
]);
const CONSUMER_CLOSURE = Object.freeze([
  'tests/helpers/notification-component-loader.mjs',
  'src/features/ai-agent/ai-agent-personal-credential-service.ts',
  'src/features/ai-agent/ai-agent-credential-service.ts',
  'src/features/ai-agent/ai-agent-request-access.ts',
]);
const CONCURRENCY_CLOSURE = Object.freeze([
  'scripts/lib/ai-agent-personal-owner-concurrency-runtime.mjs',
  'tests/probe-ai-agent-personal-owner-concurrency.mjs',
  'tests/ai-agent-personal-owner-concurrency.test.mjs',
]);
const REGRESSIONS = Object.freeze([
  'supabase/tests/ai_agent_requests_authz_test.sql',
  'supabase/tests/ai_agent_credentials_test.sql',
  'supabase/tests/ai_agent_requests_transition_test.sql',
  'supabase/tests/ai_agent_chat_outbox_test.sql',
  'supabase/tests/ai_agent_space_policy_test.sql',
  'supabase/tests/ai_agent_chat_runtime_test.sql',
]);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = code => { throw new Error(`ai_agent_personal_owner_qa:${code}`); };
const delay = ms => new Promise(done => setTimeout(done, ms));
const activeStops = new Set();

export function parsePersonalOwnerQaArguments(argv) {
  if (argv.length === 0 || argv.length === 1 && argv[0] === '--plan') return { execute: false };
  if (argv.length === 3 && argv[0] === '--execute' && argv[1] === '--request-id' && /^ai-agent-personal-local-[a-z0-9][a-z0-9-]{0,48}$/u.test(argv[2])) return { execute: true, requestId: argv[2] };
  fail('arguments_invalid');
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

async function readSource(path) {
  const absolute = resolve(ROOT, path);
  let stat;
  try { stat = await lstat(absolute); } catch (error) { fail(error.code === 'ENOENT' ? 'source_missing' : 'source_read_failed'); }
  if (!stat.isFile() || stat.isSymbolicLink()) fail('source_not_regular');
  const bytes = await readFile(absolute);
  if (!bytes.length || bytes.length > 2_000_000) fail('source_size_invalid');
  return { path, bytes, sha256: hash(bytes) };
}

export function extractPersonalOwnerLegacyCatalog(initial, final) {
  const fragment = (source, id, start, end) => {
    const text = source.bytes.toString('utf8');
    if (!Buffer.from(text).equals(source.bytes)) fail('legacy_catalog_encoding_invalid');
    const index = text.indexOf(start);
    if (index < 0 || index > 0 && text[index - 1] !== '\n' || text.indexOf(start,index + start.length) !== -1) fail('legacy_catalog_statement_ambiguous');
    const finish = text.indexOf(end,index + start.length);
    if (finish < 0) fail('legacy_catalog_statement_missing');
    const bytes = Buffer.from(text.slice(index,finish + end.length));
    return { path: source.path, id, bytes, sha256: hash(bytes), provenance: 'byte_exact_source_statement' };
  };
  const line = (source,id,start) => fragment(source,id,start,';');
  const tableAclSource = line(initial,'legacy_credential_original_combined_acl','revoke all on dashboard_private.agent_credentials,');
  if (tableAclSource.bytes.toString('utf8') !== 'revoke all on dashboard_private.agent_credentials,dashboard_private.agent_previews,dashboard_private.agent_operations from public,anon,authenticated,service_role;') fail('legacy_table_acl_projection_drift');
  const tableAclBytes = Buffer.from('revoke all on dashboard_private.agent_credentials from public,anon,authenticated,service_role;');
  const helperAclSource = line(initial,'legacy_helper_original_combined_acl','revoke all on function dashboard_private.agent_require_admin_v1()');
  const helperAclOriginal = 'revoke all on function dashboard_private.agent_require_admin_v1(),dashboard_private.agent_class_version_v1(public.classes),dashboard_private.agent_class_json_v1(public.classes,jsonb),dashboard_private.agent_apply_weekly_time_v1(uuid,jsonb,uuid) from public,anon,authenticated,service_role;';
  if (helperAclSource.bytes.toString('utf8') !== helperAclOriginal) fail('legacy_helper_acl_projection_drift');
  const helperAclBytes = Buffer.from('revoke all on function dashboard_private.agent_require_admin_v1() from public,anon,authenticated,service_role;');
  // These are the final issuer/list definitions in migration order and the
  // unchanged original revoke definition/ACL. Only their catalog is exercised.
  return [
    fragment(initial,'legacy_credential_table','create table dashboard_private.agent_credentials (','\n);'),
    line(final,'legacy_all_classes_column','alter table dashboard_private.agent_credentials add column all_classes boolean'),
    line(initial,'legacy_credential_rls','alter table dashboard_private.agent_credentials enable row level security'),
    { path: initial.path, id: 'legacy_credential_table_acl', bytes: tableAclBytes, sha256: hash(tableAclBytes), provenance: 'final_per_table_roles_acl_projection', originalCombinedStatementSha256: tableAclSource.sha256, originalCombinedStatementBytes: tableAclSource.bytes.length },
    fragment(initial,'legacy_admin_helper','create function dashboard_private.agent_require_admin_v1()','\nend$$;'),
    { path: initial.path, id: 'legacy_admin_helper_acl', bytes: helperAclBytes, sha256: hash(helperAclBytes), provenance: 'final_per_function_roles_acl_projection', originalCombinedStatementSha256: helperAclSource.sha256, originalCombinedStatementBytes: helperAclSource.bytes.length },
    fragment(final,'legacy_final_issuer','create or replace function public.create_agent_credential_v1(','\nend$$;'),
    fragment(final,'legacy_final_list','create or replace function public.list_agent_credentials_v1(','\nend$$;'),
    fragment(initial,'legacy_final_revoke','create function public.revoke_agent_credential_v1(','\nend$$;'),
    line(initial,'legacy_issuer_acl_revoke','revoke all on function public.create_agent_credential_v1('),
    line(initial,'legacy_issuer_acl_grant','grant execute on function public.create_agent_credential_v1('),
  ];
}

async function sources() {
  if (CURRENT_AI_MIGRATIONS.length !== 7) fail('migration_inventory_drift');
  const migrationSources = [];
  for (const entry of CURRENT_AI_MIGRATIONS) {
    const source = await readSource(`supabase/migrations/${entry.fileName}`);
    if (source.sha256 !== entry.sha256 || entry.status !== 'final') fail('migration_hash_drift');
    migrationSources.push(source);
  }
  const legacySources = [];
  for (const entry of LEGACY_CATALOG_SOURCES) {
    const source = await readSource(entry.path);
    if (source.sha256 !== entry.sha256) fail('legacy_catalog_source_drift');
    legacySources.push(source);
  }
  return { bootstrap: await readSource(BOOTSTRAP), migrations: migrationSources, legacySources, legacyStatements: extractPersonalOwnerLegacyCatalog(...legacySources), draft: await readSource(DRAFT), test: await readSource(TEST), regressions: await Promise.all(REGRESSIONS.map(readSource)), consumers: await Promise.all(CONSUMER_CLOSURE.map(readSource)), concurrency: await Promise.all(CONCURRENCY_CLOSURE.map(readSource)), harness: await readSource('scripts/run-ai-agent-personal-owner-local-qa.mjs') };
}

const metadata = source => ({ path: source.path, bytes: source.bytes.length, sha256: source.sha256 });
const evidence = input => ({ bootstrap: metadata(input.bootstrap), migrations: input.migrations.map(metadata), legacySources: input.legacySources.map(metadata), legacyStatements: input.legacyStatements.map(source => ({ ...metadata(source), id: source.id, provenance: source.provenance, ...(source.originalCombinedStatementSha256 ? { originalCombinedStatementSha256: source.originalCombinedStatementSha256, originalCombinedStatementBytes: source.originalCombinedStatementBytes } : {}) })), draft: metadata(input.draft), test: metadata(input.test), regressions: input.regressions.map(metadata), consumers: input.consumers.map(metadata), concurrency: input.concurrency.map(metadata), harness: metadata(input.harness) });
const boundaries = Object.freeze({ integrationScope: 'focused_synthetic_prerequisites_exact_seven_ai_migrations_and_owner_draft', fullDashboardBaseline: false, fullRequiredCi: false, providerJwtSignatureVerification: false, legacyIssuerExecuted: false, legacyCatalogOnly: true, legacyIssuerDependenciesComplete: false, noSendChecksUseEmptySyntheticCounters: true, production: false, realCredentials: false, network: 'none', ports: [], volumes: [], pullPolicy: 'never' });

export function parsePersonalOwnerTap(stdout) {
  const lines = stdout.split(/\r?\n/u);
  const plans = lines.map(line => /^1\.\.([1-9][0-9]*)$/u.exec(line)).filter(Boolean);
  const results = lines.map(line => /^ok ([1-9][0-9]*)(?:\s|$)/u.exec(line)).filter(Boolean);
  if (plans.length !== 1 || !results.length || results.length !== Number(plans[0][1]) || results.some((line,index) => Number(line[1]) !== index + 1) || lines.some(line => /^(?:not ok\b|Bail out!)/iu.test(line) || /#\s*(?:SKIP|TODO)\b/iu.test(line))) {
    const error = new Error('ai_agent_personal_owner_qa:tap_not_complete_pass');
    error.diagnostics = { stdoutSha256: hash(Buffer.from(stdout)), plans: plans.map(plan => Number(plan[1])), failedAssertions: lines.map(line => /^not ok ([1-9][0-9]*)/iu.exec(line)).filter(Boolean).map(match => Number(match[1])) };
    throw error;
  }
  return { tests: results.length, pass: results.length, fail: 0, skipped: 0, todo: 0, outputSha256: hash(Buffer.from(stdout)) };
}

export async function consumePersonalOwnerCapture(stdout) {
  const captures = stdout.split(/\r?\n/u).filter(line => line.startsWith(CAPTURE_PREFIX));
  if (captures.length !== 1) fail('producer_capture_missing_or_duplicate');
  const raw = captures[0].slice(CAPTURE_PREFIX.length);
  let capture; try { capture = JSON.parse(raw); } catch { fail('producer_capture_invalid'); }
  if (!capture || Array.isArray(capture) || Object.keys(capture).sort().join(',') !== 'firstIssue,list,owners,replayIssue') fail('producer_capture_invalid');
  const consumer = loadNotificationComponent('src/features/ai-agent/ai-agent-personal-credential-service.ts');
  // Never echo a schema error or producer data: the first issuance contains an
  // actual ephemeral synthetic token. Production schemas consume it in memory.
  const first = consumer.personalCredentialIssueSchema.safeParse(capture.firstIssue);
  const replay = consumer.personalCredentialIssueSchema.safeParse(capture.replayIssue);
  const list = consumer.personalCredentialListSchema.safeParse(capture.list);
  const owners = consumer.personalCredentialOwnersSchema.safeParse(capture.owners);
  if (!first.success || !replay.success || !list.success || !owners.success) fail('producer_consumer_contract_mismatch');
  if (first.data.token === null || replay.data.token !== null || first.data.ownerProfileId === first.data.issuerProfileId || JSON.stringify({ ...first.data, token: null }) !== JSON.stringify(replay.data) || list.data.total < 1 || list.data.items.length < 1) fail('producer_capture_not_representative');
  const listed = list.data.items.find(item => item.id === first.data.id);
  if (!listed || listed.credentialKind !== 'personal' || listed.ownerProfileId !== first.data.ownerProfileId || listed.issuerProfileId !== first.data.issuerProfileId) fail('producer_inventory_identity_mismatch');
  if (owners.data.total < 1 || !owners.data.items.some(item => item.id === first.data.ownerProfileId) || !owners.data.items.some(item => item.name === null)) fail('producer_owners_not_representative');
  const actor = { userId: first.data.issuerProfileId, role: 'admin' };
  const calls = [];
  const service = consumer.createAiAgentPersonalCredentialService({
    actor, getCurrentActor: () => actor,
    rpc: async (name, args) => {
      if (name !== 'ai_agent_personal_credential_api_v1') fail('consumer_rpc_mismatch');
      calls.push(args.p_action);
      return { data: args.p_action === 'list' ? capture.list : args.p_action === 'owners' ? capture.owners : calls.length === 1 ? capture.firstIssue : capture.replayIssue, error: null };
    },
  });
  const payload = { label: first.data.label, ownerProfileId: first.data.ownerProfileId, scopes: first.data.scopes, grant: first.data.grant, expiresAt: first.data.expiresAt };
  // A fixed synthetic UUID is only a local mock RPC input; SQL already produced
  // these records. No request is sent to an application or provider here.
  const key = 'aa039900-0000-4000-8000-000000000001';
  await service.create(payload, key);
  await service.create(payload, key);
  await service.list(1,10);
  await service.owners(1,20);
  if (calls.join(',') !== 'create,create,list,owners') fail('consumer_rpc_mismatch');
  return { status: 'passed', firstIssue: true, metadataOnlyReplay: true, nonemptyInventory: true, nonemptyOwners: true, nullableOwnerName: true, ownerDistinctFromIssuer: true, realServiceRpcCalls: calls.length, captureSha256: hash(Buffer.from(raw)), rawCaptureLogged: false };
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

async function sql(name, source) {
  const result = await runProcess(['exec','--interactive','--env','PGOPTIONS=-c statement_timeout=120000 -c lock_timeout=5000 -c idle_in_transaction_session_timeout=120000',name,'psql','-XqAt','--set','ON_ERROR_STOP=1','--set','VERBOSITY=verbose','--username','supabase_admin','--dbname','postgres'], { input: source, timeoutMs: 130_000 });
  if (result.code !== 0 || result.signal != null) {
    const error = new Error('ai_agent_personal_owner_qa:sql_failed');
    // The raw output remains private, including any first-return synthetic token.
    error.diagnostics = {
      stdoutSha256: hash(Buffer.from(result.stdout)), stderrSha256: hash(Buffer.from(result.stderr)),
      sqlstates: [...new Set([...result.stderr.matchAll(/ERROR:\s+([0-9A-Z]{5}):/gu)].map(match => match[1]))],
      constraints: [...new Set([...result.stderr.matchAll(/constraint "([^"]*)"/gu)].map(match => match[1]).filter(value => /^[a-z0-9_]{1,120}$/u.test(value)))],
      tables: [...new Set([...result.stderr.matchAll(/relation "([^"]*)"/gu)].map(match => match[1]).filter(value => /^[a-z0-9_]{1,120}$/u.test(value)))],
      lineNumbers: [...new Set([...result.stderr.matchAll(/^LINE ([1-9][0-9]*):/gmu)].map(match => Number(match[1])))],
      lastPassedAssertion: Math.max(0,...[...result.stdout.matchAll(/^ok ([1-9][0-9]*)(?:\s|$)/gmu)].map(match => Number(match[1]))),
    };
    throw error;
  }
  return result;
}

export async function runPersonalOwnerLocalQa(argv = process.argv.slice(2)) {
  const args = parsePersonalOwnerQaArguments(argv), input = await sources();
  const common = { image: PERSONAL_OWNER_IMAGE, expectedImageId: IMAGE_ID, dockerEndpoint: DOCKER_ENDPOINT, boundaries, sources: evidence(input), excludedCredentialPrefixTest: { path: 'supabase/tests/ai_agent_credentials_committed_prefix_test.sql', reason: 'Requires committed two-migration prefix; this harness executes the final seven-migration state plus the owner draft.' } };
  if (!args.execute) return { status: 'plan', ...common };
  const nonce = randomBytes(16).toString('hex'), name = `tips-ai-agent-personal-owner-${nonce}`;
  let owned = false, startAttempted = false, failure, result, interrupted = false, phase = 'local_docker_preflight';
  const interrupt = () => { interrupted = true; for (const stop of [...activeStops]) stop('interrupted'); };
  const requireRunning = () => { if (interrupted) fail('interrupted'); };
  process.on('SIGINT',interrupt); process.on('SIGTERM',interrupt);
  try {
    const socket = await lstat(DOCKER_SOCKET);
    if (!socket.isSocket() || socket.isSymbolicLink() || socket.uid !== process.getuid()) fail('local_docker_socket_invalid');
    const image = await runProcess(['image','inspect',PERSONAL_OWNER_IMAGE,'--format','{{.Id}}']);
    if (image.code !== 0 || image.stdout.trim() !== IMAGE_ID) fail('cached_image_unavailable');
    requireRunning(); startAttempted = true;
    const start = await runProcess(['run','--pull=never','--detach','--network','none','--name',name,'--label',`${OWNER_LABEL}=${nonce}`,'--env','POSTGRES_PASSWORD=personal-owner-synthetic-only',IMAGE_ID], { timeoutMs: 60_000 });
    if (start.code !== 0 || !/^[a-f0-9]{64}\n?$/u.test(start.stdout)) fail('owned_container_start_failed');
    owned = true;
    await assertOwnedContainer(name, nonce);
    let stable = 0;
    for (let attempt = 0; attempt < 80 && stable < 3; attempt++) {
      requireRunning();
      const pid1 = await runProcess(['exec',name,'sh','-c',"tr '\\000' ' ' < /proc/1/cmdline"], { timeoutMs: 5000 });
      const ready = pid1.code === 0 && pid1.stdout.trim().split(/\s/u)[0].split('/').at(-1) === 'postgres'
        ? await runProcess(['exec',name,'psql','-XqAt','--username','supabase_admin','--dbname','postgres','--command','select 1'], { timeoutMs: 5000 }) : null;
      stable = ready?.code === 0 && ready.stdout.trim() === '1' ? stable + 1 : 0;
      if (stable < 3) await delay(250);
    }
    if (stable !== 3) fail('database_not_ready');
    requireRunning();
    phase = BOOTSTRAP;
    await sql(name, input.bootstrap.bytes);
    requireRunning();
    phase = 'canonical_legacy_credential_catalog';
    // Original helper/issuer definitions and issuer ACL are replayed for an ACL
    // assertion. Table/helper ACLs project final per-object roles denial from
    // their combined source statements; omitted class/domain functions have no
    // substitutes. These issuers are never invoked by the focused run.
    await sql(name, Buffer.concat([Buffer.from('begin;\n'),...input.legacyStatements.flatMap(source => [source.bytes,Buffer.from('\n')]),Buffer.from("do $catalog_guard$ begin if exists(select 1 from dashboard_private.agent_credentials) or exists(select 1 from unnest(array['anon','authenticated','service_role']) r where has_table_privilege(r,'dashboard_private.agent_credentials','SELECT,INSERT,UPDATE,DELETE')) then raise exception using errcode='55000',message='personal_owner_legacy_catalog_not_isolated'; end if; end $catalog_guard$;\ncommit;\n")]));
    for (const migration of input.migrations) { requireRunning(); phase = migration.path; await sql(name, migration.bytes); }
    requireRunning();
    phase = DRAFT;
    await sql(name, input.draft.bytes);
    const version = await sql(name, Buffer.from("select current_setting('server_version'); select extversion from pg_extension where extname='pgtap';"));
    phase = TEST;
    const tested = await sql(name, input.test.bytes);
    const tap = parsePersonalOwnerTap(tested.stdout);
    const producerParity = await consumePersonalOwnerCapture(tested.stdout);
    const regressions = [];
    for (const source of input.regressions) {
      requireRunning();
      phase = source.path;
      const executed = await sql(name, source.bytes);
      regressions.push({ source: metadata(source), ...parsePersonalOwnerTap(executed.stdout) });
    }
    requireRunning();
    phase = 'personal_owner_concurrency_probes';
    const runtime = await createPersonalOwnerConcurrencyRuntime({name,nonce,requireRunning,registerStop: stop => { activeStops.add(stop); return () => activeStops.delete(stop); }});
    const concurrency = await runPersonalOwnerConcurrencyProbes({runtime,parseTap: parsePersonalOwnerTap,requireRunning});
    requireRunning();
    const after = await sources();
    if (JSON.stringify(evidence(after)) !== JSON.stringify(evidence(input))) fail('source_changed_during_run');
    requireRunning();
    result = { status: 'passed', requestId: args.requestId, ...common, databaseVersions: version.stdout.trim().split('\n'), tap, producerParity, regressions, regressionTotal: regressions.reduce((sum,entry) => sum + entry.tests,0), concurrency, sourceStable: true, cleanup: 'owned_container_removed_and_absence_confirmed' };
  } catch (error) { failure = error; failure.phase = phase; failure.sourceEvidence = evidence(input); }
  finally {
    if (startAttempted) {
      try {
        await cleanupPersonalOwnerQaContainer(name, nonce, runProcess, !owned);
        if (failure) failure.cleanupConfirmed = owned;
      }
      catch (error) { if (!failure) failure = error; else failure.cleanupError = error.message; }
    }
    process.off('SIGINT',interrupt); process.off('SIGTERM',interrupt);
  }
  if (!failure && interrupted) failure = new Error('ai_agent_personal_owner_qa:interrupted');
  if (failure) { failure.sourceEvidence ??= evidence(input); throw failure; }
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(`${JSON.stringify(await runPersonalOwnerLocalQa())}\n`); }
  catch (error) {
    const code = /^ai_agent_personal_owner_qa:[a-z_]+$/u.test(error?.message ?? '') ? error.message : 'ai_agent_personal_owner_qa:execution_failed';
    process.stderr.write(`${JSON.stringify({ status: 'failed', code, phase: error?.phase ?? null, sources: error?.sourceEvidence ?? null, diagnostics: error?.diagnostics ?? null, cleanupConfirmed: error?.cleanupConfirmed ?? false, cleanupError: error?.cleanupError ?? null })}\n`);
    process.exitCode = 1;
  }
}
