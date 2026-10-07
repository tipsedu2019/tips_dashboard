// Invoked only by the owned, network-none fresh QA runner after its exact
// committed synthetic fixture prefix. No standalone target, URL or env loader.
import { createHash } from 'node:crypto';

const fail = code => { throw new Error(`agent_personal_dashboard_qa:${code}`); };
const digest = value => createHash('sha256').update(value).digest('hex');
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
const json = value => `${literal(JSON.stringify(value))}::jsonb`;
const id = n => `ad050000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const credentialHash = n => digest(`synthetic-personal-dashboard-${n}`);

export function requirePersonalDashboardConcurrentOutcome(value, state, code) {
  if (!value || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'code,sqlstate'
    || !/^[A-Z0-9]{5}$/u.test(value.sqlstate)
    || value.code !== null && !/^agent_[a-z_]{1,80}$/u.test(value.code)
    || value.sqlstate !== state || value.code !== code) {
    const error = new Error('agent_personal_dashboard_qa:concurrency_outcome_unexpected');
    error.diagnostics = { expectedSqlstate:state,expectedCode:code,
      actualSqlstate:typeof value?.sqlstate === 'string' && /^[A-Z0-9]{5}$/u.test(value.sqlstate) ? value.sqlstate : null,
      actualCode:typeof value?.code === 'string' && /^agent_[a-z_]{1,80}$/u.test(value.code) ? value.code : null };
    throw error;
  }
  return { sqlstate: value.sqlstate, code: value.code };
}

export async function runPersonalDashboardReadConcurrencyProbes({ runtime, parseTap, requireRunning }) {
  // The runner validates container ownership and isolation through the unchanged
  // createPersonalOwnerConcurrencyRuntime before supplying this runtime.
  const owner = id(2), classId = id(201), slotId = id(301), ownCatalog = id(101), otherCatalog = id(102);
  const evidence = [];
  let proof, stage = 'committed_fixture_preflight', failure, expirySeedAttempted = false, peerCleanupFailed = false;
  const read = `public.agent_personal_dashboard_read_v1(${literal(credentialHash(701))},'class_context',${json({ classId })})`;
  const expiryLabel = 'Synthetic expiry during owner wait';
  const expiryRead = `public.agent_personal_dashboard_read_v1(${literal(credentialHash(709))},'calendar_context',${json({ schoolId:id(501),schoolYear:2099 })})`;
  const exercise = (expression, direct = false) => `create function pg_temp.pd_exercise() returns jsonb language plpgsql as $$begin ${direct ? '' : 'perform '}${expression};return jsonb_build_object('sqlstate','00000','code',null);exception when others then return jsonb_build_object('sqlstate',SQLSTATE,'code',case when SQLERRM ~ '^agent_[a-z_]{1,80}$' then SQLERRM else null end);end$$;`;
  const call = (expression = read, direct = false) => `${exercise(expression, direct)}${direct ? '' : 'set local role service_role;'}select 'OUTCOME:'||pg_temp.pd_exercise()::text;set local role postgres;`;
  const firstRead = `${exercise(read)}set local role service_role;select 'FIRST:'||pg_temp.pd_exercise()::text;set local role postgres;`;
  const snapshotSql = `select jsonb_build_object(
    'accounting',(select jsonb_agg(jsonb_build_object('credential',case id when ${literal(id(701))}::uuid then 701 when ${literal(id(702))}::uuid then 702 else 703 end,'count',rate_count::text,'windowSha256',case when rate_window is not null then encode(sha256(convert_to(rate_window::text,'UTF8')),'hex') end,'lastUsedSha256',case when last_used_at is not null then encode(sha256(convert_to(last_used_at::text,'UTF8')),'hex') end) order by id) from dashboard_private.agent_personal_dashboard_credentials where id=any(array[${[701,702,703].map(n => `${literal(id(n))}::uuid`).join(',')}])),
    'domain',jsonb_build_object(
      'classesSha256',(select encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]')::text,'UTF8')),'hex') from public.classes c where c.id=any(array[${[201,202,203,204].map(n => `${literal(id(n))}::uuid`).join(',')}])),
      'slotsSha256',(select encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]')::text,'UTF8')),'hex') from public.class_schedule_slots s where s.class_id=${literal(classId)}),
      'sessionsSha256',(select encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]')::text,'UTF8')),'hex') from public.class_lesson_sessions s where s.class_id=${literal(classId)}),
      'calendarSha256',(select encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(e) order by e.id),'[]')::text,'UTF8')),'hex') from public.academic_events e where e.school_id=any(array[${literal(id(501))}::uuid,${literal(id(502))}::uuid])),
      'notificationEvents',(select count(*)::text from dashboard_private.notification_events),
      'notificationDeliveries',(select count(*)::text from dashboard_private.notification_deliveries),
      'enrollmentHistory',(select count(*)::text from public.student_class_enrollment_history),
      'centralOperations',(select count(*)::text from dashboard_private.agent_edit_operations),
      'inboxRequests',(select count(*)::text from dashboard_private.ai_agent_requests)))`;
  function parseSnapshot(raw) {
    let value; try { value = JSON.parse(raw); } catch { fail('concurrency_snapshot_invalid'); }
    const fields = ['calendarSha256','centralOperations','classesSha256','enrollmentHistory','inboxRequests','notificationDeliveries','notificationEvents','sessionsSha256','slotsSha256'];
    if (!value || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'accounting,domain'
      || !Array.isArray(value.accounting) || value.accounting.length !== 3
      || !value.domain || Array.isArray(value.domain) || Object.keys(value.domain).sort().join(',') !== fields.join(',')
      || Object.entries(value.domain).some(([key,v]) => typeof v !== 'string' || !(key.endsWith('Sha256') ? /^[a-f0-9]{64}$/u : /^(?:0|[1-9][0-9]*)$/u).test(v))
      || value.accounting.some((item,index) => !item || Array.isArray(item) || Object.keys(item).sort().join(',') !== 'count,credential,lastUsedSha256,windowSha256' || item.credential !== 701 + index || typeof item.count !== 'string' || !/^(?:0|[1-9][0-9]*)$/u.test(item.count) || [item.windowSha256,item.lastUsedSha256].some(v => v !== null && (typeof v !== 'string' || !/^[a-f0-9]{64}$/u.test(v))))) fail('concurrency_snapshot_invalid');
    return value;
  }
  async function snapshot() {
    const output = await runtime.query(`begin;set local role postgres;${snapshotSql};commit;`);
    return parseSnapshot(output.split('\n').at(-1));
  }
  function same(left,right,code = 'concurrency_effects_changed') {
    if (JSON.stringify(left) !== JSON.stringify(right)) fail(code);
  }
  function successfulRead(before,held) {
    same(before.domain,held.domain);
    same(before.accounting.slice(1),held.accounting.slice(1));
    const old = before.accounting[0], current = held.accounting[0];
    const expected = old.windowSha256 === current.windowSha256 ? Number(old.count) + 1 : 1;
    if (Number(current.count) !== expected || current.windowSha256 === null || current.lastUsedSha256 === null) fail('concurrency_success_accounting_invalid');
  }
  async function outcome() {
    const output = await runtime.query(`begin;set local role postgres;${call()}commit;`);
    const line = output.split('\n').find(value => value.startsWith('OUTCOME:'));
    if (!line) fail('concurrency_outcome_missing');
    let value; try { value = JSON.parse(line.slice(8)); } catch { fail('concurrency_outcome_invalid'); }
    return value;
  }
  async function fixture(statement) {
    // This context authorizes only synthetic schedule DML under existing guards.
    // It is never used by the product callback to select owner/auth permissions.
    await runtime.query(`begin;set local role postgres;select set_config('app.class_schedule_mutation','release2-rpc',true);${statement}commit;`);
  }
  function expiryStateQuery(prefix = '') {
    return `select ${prefix ? `${literal(prefix)}||` : ''}jsonb_build_object('expired',clock_timestamp()>=expires_at,'accounting',jsonb_build_object('count',rate_count,'window',rate_window,'lastUsed',last_used_at))${prefix ? '::text' : ''} from dashboard_private.agent_personal_dashboard_credentials where id=${literal(id(709))}`;
  }
  function parseExpiryState(raw) {
    let value;try { value=JSON.parse(raw); } catch { fail('concurrency_expiry_state_invalid'); }
    if (!value || Array.isArray(value) || Object.keys(value).sort().join(',')!=='accounting,expired' || typeof value.expired!=='boolean'
      || !value.accounting || Array.isArray(value.accounting) || Object.keys(value.accounting).sort().join(',')!=='count,lastUsed,window'
      || value.accounting.count!==0 || value.accounting.window!==null || value.accounting.lastUsed!==null) fail('concurrency_expiry_accounting_changed');
    return value;
  }
  async function expiryState() {
    // Plain MVCC SELECT: the callback holds this credential FOR UPDATE while it
    // waits for owner authority. A locking expiry poll would itself block.
    const output = await runtime.query(`begin;set local role postgres;${expiryStateQuery()};commit;`);
    return parseExpiryState(output.split('\n').at(-1));
  }
  async function waitForExpiry({first,callbackStartedAt}) {
    // Start the deadline before the callback peer's SQL, leaving margin under
    // its unchanged five-second lock timeout. Reuse the connected blocker for
    // plain SELECT polling, with fresh markers and an actual wall-clock bound.
    const deadline=callbackStartedAt+3500;
    for (let iteration=0;Date.now()<deadline;iteration++) {
      requireRunning();
      const marker=`EXPIRY_CLOCK_${iteration}:`;
      first.write(`${expiryStateQuery(marker)};\n`);
      let deadlineTimer, match;
      try {
        match=await Promise.race([
          first.line(new RegExp(`^${marker}(.*)$`,'mu')),
          new Promise((_,reject)=>{deadlineTimer=setTimeout(()=>reject(new Error('agent_personal_dashboard_qa:concurrency_expiry_clock_timeout')),Math.max(1,deadline-Date.now()));}),
        ]);
      } finally { clearTimeout(deadlineTimer); }
      const value=parseExpiryState(match[1]);
      if (Date.now()>=deadline) fail('concurrency_expiry_clock_timeout');
      if (value.expired) return { dbClockExpiredBeforeRelease:true,pollingDeadlineFromPeerStartMs:3500 };
      await new Promise(resolve=>setTimeout(resolve,25));
    }
    fail('concurrency_expiry_clock_timeout');
  }
  async function removeExpiryCredential() {
    const output=await runtime.query(`begin;set local role postgres;delete from dashboard_private.agent_personal_dashboard_credentials where id=${literal(id(709))} and token_hash=${literal(credentialHash(709))} and created_by=${literal(id(1))} and owner_profile_id=${literal(owner)} and credential_kind='personal_dashboard_read' and label=${literal(expiryLabel)};select not exists(select 1 from dashboard_private.agent_personal_dashboard_credentials where id=${literal(id(709))} or token_hash=${literal(credentialHash(709))});commit;`);
    if (output.split('\n').at(-1)!=='t') fail('concurrency_expiry_cleanup_invalid');
    expirySeedAttempted=false;
  }
  async function race(name, firstSql, expression, state, code, direct = false, beforeRelease, initialSql = '') {
    requireRunning();
    const first = runtime.session(), second = runtime.session();
    let primaryFailure, initialExpiry;
    try {
      first.write("select 'FIRST_READY:'||pg_backend_pid();\n");
      second.write("select 'SECOND_READY:'||pg_backend_pid();\n");
      await first.line(/^FIRST_READY:([1-9][0-9]*)$/mu);
      await second.line(/^SECOND_READY:([1-9][0-9]*)$/mu);
      first.write(`${initialSql}begin;set local role postgres;${firstSql}${snapshotSql.replace('select jsonb_build_object(', "select 'HELD_SNAPSHOT:'||jsonb_build_object(")}::text;select 'LOCKED:'||pg_backend_pid();\n`);
      const blockerPid = Number((await first.line(/^LOCKED:([1-9][0-9]*)$/mu))[1]);
      if (initialSql) {
        initialExpiry=parseExpiryState((await first.line(/^INITIAL_EXPIRY:(.*)$/mu))[1]);
        if(initialExpiry.expired) fail('concurrency_expiry_fixture_already_expired');
      }
      if (firstSql.includes('FIRST:')) {
        const firstLine = (await first.line(/^FIRST:(.*)$/mu))[1];
        let firstOutcome; try { firstOutcome = JSON.parse(firstLine); } catch { fail('concurrency_first_outcome_invalid'); }
        requirePersonalDashboardConcurrentOutcome(firstOutcome,'00000',null);
      }
      const held = parseSnapshot((await first.line(/^HELD_SNAPSHOT:(.*)$/mu))[1]);
      const callbackStartedAt=Date.now();
      second.write(`begin;set local role postgres;select 'WRITER:'||pg_backend_pid();create temp table pd_probe_outcome(v jsonb);grant all on pd_probe_outcome to service_role;${exercise(expression,direct)}${direct ? '' : 'set local role service_role;'}insert into pd_probe_outcome values(pg_temp.pd_exercise());select 'OUTCOME:'||v::text from pd_probe_outcome;select plan(2);select is(v->>'sqlstate',${literal(state)},'waited dashboard read exact SQLSTATE') from pd_probe_outcome;select is(v->>'code',${code === null ? 'null::text' : literal(code)},'waited dashboard read exact domain result') from pd_probe_outcome;select * from finish();\n`);
      const writerPid = Number((await second.line(/^WRITER:([1-9][0-9]*)$/mu))[1]);
      if (await runtime.waitForLock(writerPid,blockerPid,{observer:first,...(beforeRelease ? {deadlineAt:callbackStartedAt+3500} : {})}) !== true) fail('concurrency_lock_wait_unobserved');
      const releaseProof=beforeRelease ? await beforeRelease({first,callbackStartedAt}) : undefined;
      first.end('commit;\n');
      runtime.requireComplete(await first.complete,'concurrency_first_commit_failed');
      const outcomeLine = (await second.line(/^OUTCOME:(.*)$/mu))[1];
      let raw; try { raw = JSON.parse(outcomeLine); } catch { fail('concurrency_outcome_invalid'); }
      const actual = requirePersonalDashboardConcurrentOutcome(raw,state,code);
      second.end('commit;\n');
      const completed = await second.complete;
      runtime.requireComplete(completed,'concurrency_second_commit_failed');
      const tap = parseTap(completed.stdout);
      if (tap.tests !== 2 || tap.pass !== 2 || tap.fail !== 0 || tap.skipped !== 0 || tap.todo !== 0) fail('concurrency_tap_count_invalid');
      const after = await snapshot();
      same(held,after);
      return { name,lockWaitObserved:true,waitEventType:'Lock',blockingPidMembershipObserved:true,firstCommittedBeforeSecond:true,outcome:actual,tap,held,after,backendPairSha256:digest(`${blockerPid}:${writerPid}`),...(releaseProof ? { releaseProof } : {}),...(initialExpiry ? {initialExpiry} : {}) };
    } catch (error) {
      primaryFailure=error;
      throw error;
    } finally {
      try { await runtime.closeSessions(first,second); }
      catch (error) {
        peerCleanupFailed=true;
        if (!primaryFailure) throw error;
        primaryFailure.diagnostics={...primaryFailure.diagnostics,sessionCleanupFailed:true,
          sessionCleanupCode:/^(?:ai_agent_personal_owner_qa|agent_personal_dashboard_qa):[a-z_]+$/u.test(error?.message ?? '') ? error.message : 'agent_personal_dashboard_qa:concurrency_cleanup_failed'};
      }
    }
  }
  try {
    const preflight = await runtime.query(`begin;set local role postgres;select (select role='teacher' from public.profiles where id=${literal(owner)}) and (select teacher_catalog_id=${literal(ownCatalog)}::uuid from public.class_schedule_slots where id=${literal(slotId)}) and (select revoked_at is null and expires_at>clock_timestamp() from dashboard_private.agent_personal_dashboard_credentials where id=${literal(id(701))});commit;`);
    if (preflight.split('\n').at(-1) !== 't') fail('concurrency_fixture_invalid');

    stage = 'owner_role_loss_before_read';
    let before = await snapshot();
    const denied = await race('owner_role_loss_before_waited_dashboard_read',`update public.profiles set role='viewer' where id=${literal(owner)};`,read,'42501','agent_forbidden');
    same(before,denied.after);denied.before=before;evidence.push(denied);
    await fixture(`update public.profiles set role='teacher' where id=${literal(owner)};`);

    stage = 'owner_role_writer_waits_for_read';
    before = await snapshot();
    const held = await race('owner_role_writer_waits_for_authenticated_dashboard_read',firstRead,`update public.profiles set role='viewer' where id=${literal(owner)}`,'00000',null,true);
    successfulRead(before,held.held);
    held.before=before;
    held.retryAfterRoleChange=requirePersonalDashboardConcurrentOutcome(await outcome(),'42501','agent_forbidden');
    same(held.after,await snapshot());evidence.push(held);
    await fixture(`update public.profiles set role='teacher' where id=${literal(owner)};`);

    stage = 'slot_reassignment_before_read';
    before = await snapshot();
    const reassigned = await race('uuid_slot_reassignment_before_waited_dashboard_read',`select id from public.classes where id=${literal(classId)} for update;select set_config('app.class_schedule_mutation','release2-rpc',true);update public.class_schedule_slots set teacher_catalog_id=${literal(otherCatalog)} where id=${literal(slotId)};`,read,'42501','agent_scope_forbidden');
    same(before.accounting,reassigned.after.accounting);
    same({ ...before.domain,slotsSha256:reassigned.after.domain.slotsSha256 },reassigned.after.domain);
    reassigned.before=before;evidence.push(reassigned);
    await fixture(`update public.class_schedule_slots set teacher_catalog_id=${literal(ownCatalog)} where id=${literal(slotId)};`);

    stage = 'credential_revoked_before_read';
    before = await snapshot();
    const revoked = await race('credential_revocation_before_waited_dashboard_read',`update dashboard_private.agent_personal_dashboard_credentials set revoked_at=clock_timestamp() where id=${literal(id(701))};`,read,'28000','agent_unauthorized');
    same(before,revoked.after);revoked.before=before;evidence.push(revoked);
    await fixture(`update dashboard_private.agent_personal_dashboard_credentials set revoked_at=null where id=${literal(id(701))};`);

    stage = 'credential_expires_during_owner_wait';
    const absent=await runtime.query(`begin;set local role postgres;select not exists(select 1 from dashboard_private.agent_personal_dashboard_credentials where id=${literal(id(709))} or token_hash=${literal(credentialHash(709))});commit;`);
    if (absent.split('\n').at(-1)!=='t') fail('concurrency_expiry_fixture_not_empty');
    before=await snapshot();
    // Commit before owner FOR UPDATE: an uncommitted credential would be
    // invisible to the callback, and a later INSERT would wait on its owner FK.
    expirySeedAttempted=true;
    const seed=`begin;set local role postgres;insert into dashboard_private.agent_personal_dashboard_credentials(id,created_by,owner_profile_id,label,token_hash,scopes,class_ids,school_ids,expires_at) values(${literal(id(709))},${literal(id(1))},${literal(owner)},${literal(expiryLabel)},${literal(credentialHash(709))},array['calendar:read'],'{}',array[${literal(id(501))}::uuid],clock_timestamp()+interval '3 seconds');${expiryStateQuery('INITIAL_EXPIRY:')};commit;`;
    const expired=await race('credential_expiry_during_waited_owner_authorization',`select id from public.profiles where id=${literal(owner)} for update;`,expiryRead,'28000','agent_unauthorized',false,waitForExpiry,seed);
    const initialExpiry=expired.initialExpiry;
    const finalExpiry=await expiryState();
    if (!finalExpiry.expired || expired.releaseProof?.dbClockExpiredBeforeRelease!==true) fail('concurrency_expiry_clock_unobserved');
    same(initialExpiry.accounting,finalExpiry.accounting,'concurrency_expiry_accounting_changed');
    same(before,expired.after);
    expired.before=before;
    // race() has awaited both session closes before any credential deletion.
    await removeExpiryCredential();
    same(expired.after,await snapshot());
    expired.expiry={credential:709,seededBeforeOwnerLock:true,credentialUseUnchanged:true,temporaryCredentialRemoved:true,before:initialExpiry.accounting,after:finalExpiry.accounting};
    evidence.push(expired);

    if (evidence.length !== 5 || evidence.some(probe => probe.lockWaitObserved !== true || probe.tap.pass !== 2)) fail('concurrency_evidence_incomplete');
    const restored = await runtime.query(`begin;set local role postgres;select (select role='teacher' from public.profiles where id=${literal(owner)}) and (select teacher_catalog_id=${literal(ownCatalog)}::uuid from public.class_schedule_slots where id=${literal(slotId)}) and (select revoked_at is null from dashboard_private.agent_personal_dashboard_credentials where id=${literal(id(701))});commit;`);
    if (restored.split('\n').at(-1) !== 't') fail('concurrency_fixture_restoration_invalid');
    proof={status:'passed',fixtureRestored:true,tasks:5,pgTapAssertions:10,probes:evidence,realRpcOperations:true,providerSend:false,rawCredentialsLogged:false,fixtureCommits:'fresh_owned_synthetic_database_only',expiryDuringWait:true};
  } catch (error) {
    failure=error;
    failure.diagnostics={...failure.diagnostics,concurrencyStage:stage,completedTasks:evidence.length};
  } finally {
    // Best-effort fixture restoration occurs only in this owned disposable DB.
    // Preserve original failure evidence if restoration or session cleanup fails.
    if (expirySeedAttempted) {
      if (peerCleanupFailed) {
        if (failure) failure.diagnostics={...failure.diagnostics,expiryCredentialCleanupSkipped:true};
      } else {
        try { await removeExpiryCredential(); }
        catch (error) { if (!failure) failure=error;else failure.diagnostics={...failure.diagnostics,expiryCredentialCleanupFailed:true}; }
      }
    }
    try { await fixture(`update public.profiles set role='teacher' where id=${literal(owner)};update dashboard_private.agent_personal_dashboard_credentials set revoked_at=null where id=${literal(id(701))};update public.class_schedule_slots set teacher_catalog_id=${literal(ownCatalog)} where id=${literal(slotId)};`); }
    catch (error) { if (!failure) failure=error;else failure.diagnostics={...failure.diagnostics,fixtureRestorationFailed:true}; }
    try { const cleanup=await runtime.finish();if (proof) proof.runtimeCleanup=cleanup; }
    catch (error) { if (!failure) failure=error;else failure.diagnostics={...failure.diagnostics,runtimeCleanupFailed:true}; }
  }
  if (failure) throw failure;
  return proof;
}
