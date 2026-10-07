// Called only by the fresh, network-none personal-owner QA runner. No standalone
// database URL, credential, environment target, or production execution path.
import { randomUUID, createHash } from 'node:crypto';

const fail = code => { throw new Error(`ai_agent_personal_owner_qa:${code}`); };
const digest = value => createHash('sha256').update(value).digest('hex');
const literal = value => `'${String(value).replaceAll("'","''")}'`;
const json = value => `${literal(JSON.stringify(value))}::jsonb`;

export function requirePersonalOwnerConcurrentOutcome(value,state,code) {
  if (!value || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'code,sqlstate' || !/^[A-Z0-9]{5}$/u.test(value.sqlstate) || value.code !== null && !/^ai_agent_[a-z_]{1,80}$/u.test(value.code) || value.sqlstate !== state || value.code !== code) fail('concurrency_outcome_unexpected');
  return { sqlstate: value.sqlstate, code: value.code };
}

export async function runPersonalOwnerConcurrencyProbes({runtime,parseTap,requireRunning}) {
  const issuer = randomUUID(), owner = randomUUID(), other = randomUUID();
  const claimHash = digest(randomUUID()); // Synthetic claim capability; never emitted.
  const credentials = [], evidence = [];
  let proof,stage = 'fixture_setup';
  const asEmployee = actor => `select set_config('request.jwt.claim.sub',${literal(actor)},true);set local role authenticated;`;
  const loadHash = id => `select token_hash as probe_hash from dashboard_private.ai_agent_credentials where id=${literal(id)}\n\\gset\n`;
  const bot = (action,input) => `public.ai_agent_bot_api_v1(p_hash,${literal(action)},${json(input)})`;
  const chat = (action,input) => `public.ai_agent_chat_api_v1(p_hash,${literal(action)},${json(input)})`;
  const exercise = (expression,directStatement = false) => `create function pg_temp.po_exercise(p_hash text default null) returns jsonb language plpgsql as $$begin ${directStatement ? '' : 'perform '}${expression};return jsonb_build_object('sqlstate','00000','code',null);exception when others then return jsonb_build_object('sqlstate',SQLSTATE,'code',case when SQLERRM ~ '^ai_agent_[a-z_]{1,80}$' then SQLERRM else null end);end$$;`;
  const invoke = (expression,credentialId) => `${exercise(expression)}${credentialId ? loadHash(credentialId) : ''}${credentialId ? 'set local role service_role;' : ''}select 'OUTCOME:'||pg_temp.po_exercise(${credentialId ? ":'probe_hash'" : 'null'})::text;`;
  const claimInput = id => ({id,version:'1',idempotencyKey:randomUUID(),claimTokenHash:claimHash});
  async function queryLast(sql) { return (await runtime.query(sql)).split('\n').at(-1); }
  async function outcome(expression,credentialId) {
    const output = await runtime.query(`begin;${invoke(expression,credentialId)}commit;`);
    const line = output.split('\n').find(line => line.startsWith('OUTCOME:'));
    if (!line) fail('concurrency_outcome_missing');
    try { return JSON.parse(line.slice(8)); } catch { fail('concurrency_outcome_invalid'); }
  }
  async function request() {
    const value = await queryLast(`begin;${asEmployee(owner)}select public.ai_agent_user_api_v1('create',${json({title:'Synthetic personal concurrency',body:'Owned disposable fixture',notifyOnDone:false,idempotencyKey:randomUUID()})})->>'id';commit;`);
    if (!/^[a-f0-9-]{36}$/u.test(value)) fail('concurrency_request_fixture_invalid');
    return value;
  }
  async function counts(id) {
    return JSON.parse(await queryLast(`select jsonb_build_object('status',r.status,'version',r.version::text,'ownerMatches',r.requester_id=${literal(owner)},'liveClaims',(select count(*) from dashboard_private.ai_agent_request_claims c where c.request_id=r.id and c.lease_expires_at>clock_timestamp()),'claimEvents',(select count(*) from dashboard_private.ai_agent_request_events e where e.request_id=r.id and e.kind='claimed'),'receipts',(select count(*) from dashboard_private.ai_agent_request_receipts q where q.resource_id=r.id and q.principal_kind='bot'),'messages',(select count(*) from dashboard_private.ai_agent_request_messages m where m.request_id=r.id),'outboxes',(select count(*) from dashboard_private.chat_delivery_outbox o where o.request_id=r.id)) from dashboard_private.ai_agent_requests r where r.id=${literal(id)};`));
  }
  function equalCounts(left,right) { if (JSON.stringify(left) !== JSON.stringify(right)) fail('concurrency_effects_changed'); }
  function validateClaimed(value) { if (value.status !== 'processing' || value.version !== '2' || value.ownerMatches !== true || value.liveClaims !== 1 || value.claimEvents !== 1 || value.receipts !== 1) fail('concurrency_claim_counts_invalid'); }
  function callFirst(expression,credentialId) {
    return `${exercise(expression)}${loadHash(credentialId)}set local role service_role;select 'FIRST:'||pg_temp.po_exercise(:'probe_hash')::text;`;
  }
  async function race(name,firstSql,expression,credentialId,state,code,directStatement = false) {
    requireRunning();
    const first = runtime.session(), second = runtime.session();
    try {
      first.write(`begin;${firstSql}select 'LOCKED:'||pg_backend_pid();\n`);
      const blockerPid = Number((await first.line(/^LOCKED:([1-9][0-9]*)$/mu))[1]);
      if (firstSql.includes('FIRST:')) requirePersonalOwnerConcurrentOutcome(JSON.parse((await first.line(/^FIRST:(.*)$/mu))[1]),'00000',null);
      second.write(`begin;select 'WRITER:'||pg_backend_pid();create temp table po_probe_outcome(v jsonb);grant all on po_probe_outcome to service_role;${exercise(expression,directStatement)}${credentialId ? loadHash(credentialId) : ''}${credentialId ? 'set local role service_role;' : ''}insert into po_probe_outcome values(pg_temp.po_exercise(${credentialId ? ":'probe_hash'" : 'null'}));select 'OUTCOME:'||v::text from po_probe_outcome;select plan(2);select is(v->>'sqlstate',${literal(state)},'waited personal RPC exact SQLSTATE') from po_probe_outcome;select is(v->>'code',${code === null ? 'null::text' : literal(code)},'waited personal RPC exact domain result') from po_probe_outcome;select * from finish();\n`);
      const writerPid = Number((await second.line(/^WRITER:([1-9][0-9]*)$/mu))[1]);
      const waited = await runtime.waitForLock(writerPid,blockerPid);
      if (waited !== true) fail('concurrency_lock_wait_unobserved');
      first.end('commit;\n');
      const firstResult = await first.complete;
      runtime.requireComplete(firstResult,'concurrency_first_commit_failed');
      const actual = requirePersonalOwnerConcurrentOutcome(JSON.parse((await second.line(/^OUTCOME:(.*)$/mu))[1]),state,code);
      second.end('commit;\n');
      const secondResult = await second.complete;
      runtime.requireComplete(secondResult,'concurrency_second_commit_failed');
      const tap = parseTap(secondResult.stdout);
      if (tap.tests !== 2) fail('concurrency_tap_count_invalid');
      return { name,lockWaitObserved: true,waitEventType:'Lock',blockingPidMembershipObserved:true,firstCommittedBeforeSecond: true,outcome: actual,tap,backendPairSha256: digest(`${blockerPid}:${writerPid}`) };
    } finally { await runtime.closeSessions(first,second); }
  }
  try {
    await runtime.query(`insert into auth.users(id,instance_id,aud,role,email) values ${[issuer,owner,other].map(id => `(${literal(id)},'00000000-0000-0000-0000-000000000000','authenticated','authenticated',${literal(`po-race-${id}@test.invalid`)})`).join(',')};insert into public.profiles(id,role,name) values(${literal(issuer)},'admin','Synthetic probe issuer'),(${literal(owner)},'teacher','Synthetic probe owner'),(${literal(other)},'teacher','Synthetic other owner') on conflict(id) do update set role=excluded.role,name=excluded.name;update dashboard_private.ai_agent_chat_support set issuance_enabled=true;update dashboard_private.chat_space_configuration set configured=true,resource_name='spaces/PERSONAL_PROBE',public_origin='https://dashboard.test.invalid' where space_key='space_1';`);
    await runtime.query(`begin;${asEmployee(issuer)}select public.ai_agent_space_policy_api_v1('set',${json({userId:owner,revision:'0',spaceKeys:['space_1'],idempotencyKey:randomUUID()})}) is not null;commit;`);
    for (let index = 0; index < 2; index++) {
      const credentialId = await queryLast(`begin;${asEmployee(issuer)}select public.ai_agent_personal_credential_api_v1('create',${json({ownerProfileId:owner,label:'Synthetic concurrent personal worker',scopes:['ai-agent:requests:read','ai-agent:requests:claim','ai-agent:requests:update','chat:outbox:read','chat:send'],grant:{queues:['employee_requests'],actions:['read','claim','renew','progress','question','done'],spaceKeys:['space_1'],purposes:['ai_completion']},expiresAt:null,idempotencyKey:randomUUID()})})->>'id';commit;`);
      if (!/^[a-f0-9-]{36}$/u.test(credentialId)) fail('concurrency_credential_fixture_invalid');
      credentials.push(credentialId);
    }
    stage = 'competing_claims';
    const claimId = await request(), firstInput = claimInput(claimId), secondInput = claimInput(claimId);
    const competing = await race('personal_same_owner_two_claimers',callFirst(bot('claim',firstInput),credentials[0]),bot('claim',secondInput),credentials[1],'55000','ai_agent_conflict');
    competing.counts = await counts(claimId); validateClaimed(competing.counts); evidence.push(competing);

    stage = 'owner_role_change_before_claim';
    const deniedId = await request(), deniedBefore = await counts(deniedId);
    const denied = await race('owner_role_change_before_waited_claim',`update public.profiles set role='viewer' where id=${literal(owner)};`,bot('claim',claimInput(deniedId)),credentials[0],'42501','ai_agent_forbidden');
    denied.before = deniedBefore; denied.after = await counts(deniedId); equalCounts(denied.before,denied.after); evidence.push(denied);
    await runtime.query(`update public.profiles set role='teacher' where id=${literal(owner)};`);

    stage = 'owner_role_change_after_claim';
    const heldId = await request(), heldInput = claimInput(heldId);
    const held = await race('owner_role_change_waits_for_authenticated_claim',callFirst(bot('claim',heldInput),credentials[0]),`update public.profiles set role='viewer' where id=${literal(owner)}`,null,'00000',null,true);
    held.counts = await counts(heldId); validateClaimed(held.counts);
    held.cachedClaimAfterRoleChange = requirePersonalOwnerConcurrentOutcome(await outcome(bot('claim',heldInput),credentials[0]),'42501','ai_agent_forbidden');
    equalCounts(held.counts,await counts(heldId)); evidence.push(held);
    await runtime.query(`update public.profiles set role='teacher' where id=${literal(owner)};`);

    stage = 'prepare_attempt_fixture';
    const doneId = await queryLast(`begin;${asEmployee(owner)}select public.ai_agent_user_api_v1('create',${json({title:'Synthetic retry permission',body:'No provider send',notifyOnDone:true,notificationSpace:'space_1',idempotencyKey:randomUUID()})})->>'id';commit;`);
    requirePersonalOwnerConcurrentOutcome(await outcome(bot('claim',claimInput(doneId)),credentials[0]),'00000',null);
    requirePersonalOwnerConcurrentOutcome(await outcome(bot('done',{id:doneId,version:'2',idempotencyKey:randomUUID(),claimTokenHash:claimHash,claimGeneration:'1',result:'Synthetic completion'}),credentials[0]),'00000',null);
    const outboxId = await queryLast(`select id::text from dashboard_private.chat_delivery_outbox where request_id=${literal(doneId)};`);
    if (!/^[a-f0-9-]{36}$/u.test(outboxId)) fail('concurrency_outbox_fixture_invalid');
    const retryInput = {id:outboxId,revision:'1',idempotencyKey:randomUUID()};
    requirePersonalOwnerConcurrentOutcome(await outcome(chat('prepare_attempt',retryInput),credentials[0]),'00000',null);
    const chatCounts = async () => JSON.parse(await queryLast(`select jsonb_build_object('state',o.state,'revision',o.revision::text,'attempts',(select count(*) from dashboard_private.chat_delivery_attempts a where a.outbox_id=o.id),'receipts',(select count(*) from dashboard_private.ai_agent_request_receipts r where r.resource_id=o.id),'rate',(select rate_count from dashboard_private.ai_agent_credentials where id=${literal(credentials[0])}),'globalBudget',(select coalesce(sum(count),0) from dashboard_private.chat_send_global_budget),'spaceBudgetLastDispatchSha256',(select encode(sha256(convert_to(last_dispatch_at::text,'UTF8')),'hex') from dashboard_private.chat_space_send_budgets where space_key='space_1')) from dashboard_private.chat_delivery_outbox o where o.id=${literal(outboxId)};`));
    const retryBefore = await chatCounts();
    if (retryBefore.state !== 'sending' || retryBefore.attempts !== 1 || retryBefore.receipts !== 1 || !/^[a-f0-9]{64}$/u.test(retryBefore.spaceBudgetLastDispatchSha256)) fail('concurrency_attempt_fixture_invalid');
    stage = 'permission_revoked_retry';
    const revoked = await race('same_key_prepare_retry_after_space_permission_revoke',`${asEmployee(issuer)}select public.ai_agent_space_policy_api_v1('set',${json({userId:owner,revision:'1',spaceKeys:[],idempotencyKey:randomUUID()})}) is not null;`,chat('prepare_attempt',retryInput),credentials[0],'42501','ai_agent_space_forbidden');
    revoked.before = retryBefore; revoked.after = await chatCounts(); equalCounts(revoked.before,revoked.after); evidence.push(revoked);
    if (evidence.length !== 4 || evidence.some(probe => probe.lockWaitObserved !== true || probe.tap.pass !== 2)) fail('concurrency_evidence_incomplete');
    proof = { status:'passed',tasks:4,pgTapAssertions:8,probes:evidence,realRpcOperations:true,providerSend:false,rawCredentialsLogged:false,fixtureCommits:'fresh_owned_synthetic_database_only' };
    return proof;
  } catch (error) { error.diagnostics = { ...error.diagnostics,concurrencyStage:stage,completedTasks:evidence.length }; throw error; }
  finally { const cleanup = await runtime.finish(); if (proof) proof.runtimeCleanup = cleanup; }
}
