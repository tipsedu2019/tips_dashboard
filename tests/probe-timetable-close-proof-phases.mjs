import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { lineBefore, personalProbeRuntime } from './helpers/ai-personal-probe-runtime.mjs';

const fixtureUrl = new URL('../scripts/fixtures/timetable-close-gateway-phases.sql', import.meta.url);
const metadataSql = `select md5(coalesce(jsonb_agg(to_jsonb(p) order by p.oid)::text,'[]'))
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname in('public','dashboard_private');`;
const gateway = `set local role authenticated;
select set_config('test.proof_gateway_result',public.update_class_operational_v1(
 'fe101234-0000-4000-8000-000000000001',current_setting('test.proof_gateway_patch')::jsonb,
 'fe101234-0000-4000-8000-000000000801',null)::text,true);
reset role;
select 'BEFORE:'||pg_temp.gateway_observation('gateway')::text;
`;
const counters = value => [value.reads, value.validations, value.assertions];
function requireClosed(value) {
  assert.equal(value.status, '종강');
  assert.equal(value.receiptStatus, '종강');
  assert.equal(value.savedStatus, '종강');
  assert.equal(value.closedInTransaction, true);
  assert.equal(value.rosterAndWaitlistEmpty, true);
  assert.equal(value.receipts, 2, 'inner and outer receipts retained');
}
function requireScope(value) {
  assert.equal(value.readCommitted, true);
  assert.equal(value.otherClientOrWriterAbsent, true, 'uncontrolled backend observed: fail, never skip/retry');
}
function requireProof(value) {
  assert.equal(value.proofExists, true);
  assert.equal(value.baselineExists, true);
  assert.equal(value.baselineHashMatches, true);
  assert.equal(value.storedProofUnchanged, true);
}

// Exported for the native offline fixture. The production entry below accepts
// only the existing runner's nonce-scoped local container; never a remote URL.
export async function verifyCloseProofPhases(runtime) {
  const fixture = await readFile(fixtureUrl, 'utf8');
  const schema = `gateway_phases_${randomUUID().replaceAll('-', '')}`;
  const metadataBefore = await runtime.query(metadataSql);
  const cases = [];
  await runtime.query(`create schema ${schema};
create table ${schema}.unrelated(id integer primary key);
create table ${schema}.jobs_before as select * from cron.job;`);
  let jobsRestored = false;
  try {
    // Pause only actually active jobs in this disposable DB. No server setting,
    // worker termination, product function, role, ACL or scheduler definition changes.
    const paused = JSON.parse(await runtime.query(`begin;
do $$declare j record;begin
 if not exists(select 1 from pg_roles where rolname=current_user and (rolsuper or rolbypassrls))
 then raise exception 'fixture scheduler visibility insufficient';end if;
 for j in select jobid from ${schema}.jobs_before where active loop
  perform cron.alter_job(j.jobid,active:=false);
 end loop;
end$$;commit;
select jsonb_build_object('paused',(select count(*) from ${schema}.jobs_before where active),
 'allInactive',not exists(select 1 from cron.job where active));`));
    assert.equal(paused.allInactive, true);
    for (const mode of ['stable', 'committed-drift']) {
      const session = runtime.session(35_000), deadlineAt = Date.now() + 25_000;
      const read = async label => JSON.parse((await lineBefore(session, new RegExp(`^${label}:(.*)$`, 'mu'), deadlineAt))[1]);
      try {
        // No finalizer is queued until its explicit checkpoint has been checked.
        session.write(`begin isolation level read committed;\n${fixture}\n${gateway}`);
        const before = await read('BEFORE');
        requireScope(before); requireClosed(before); requireProof(before);
        assert.equal(before.snapshotStable, true);
        assert.equal(before.snapshotMatchesProof, true, 'gateway token snapshot already drifted');
        assert.deepEqual(counters(before), [2, 2, 2]);
        if (mode === 'committed-drift') {
          // A distinct backend must exit successfully AFTER COMMIT. A fresh
          // session verifies its row is visible before releasing the finalizer.
          assert.equal(await runtime.query(`begin;insert into ${schema}.unrelated values(1);commit;`), '');
          assert.equal(await runtime.query(`select count(*) from ${schema}.unrelated;`), '1');
          session.write("select 'CHANGED:'||pg_temp.gateway_observation('after-commit')::text;\n");
          const changed = await read('CHANGED');
          requireScope(changed); requireClosed(changed); requireProof(changed);
          assert.equal(changed.snapshotStable, false, 'commit must actually change snapshot');
          assert.equal(changed.snapshotMatchesProof, false);
          assert.deepEqual(counters(changed), [2, 2, 2], 'observer never runs reader/validator');
        }
        session.write("set local role authenticated;set constraints all immediate;reset role;select 'FINAL:'||pg_temp.gateway_observation('finalizer')::text;\n");
        const final = await read('FINAL');
        requireScope(final); requireClosed(final);
        assert.equal(final.baselineExists, false);
        assert.equal(final.proofExists, false);
        const drift = mode === 'committed-drift';
        assert.equal(final.snapshotStable, !drift, 'unexpected snapshot boundary fails the case');
        assert.equal(final.snapshotMatchesProof, !drift);
        assert.deepEqual(counters(final), drift ? [3, 3, 2] : [2, 3, 2]);
        if (!drift) {
          session.write("select 'ORIGINAL:'||pg_temp.assert_stable_gateway()::text;\n");
          assert.deepEqual(await read('ORIGINAL'), {
            reads: 2, validations: 3, assertions: 2, status: '종강', receiptStatus: '종강', proofs: 0,
          });
        }
        session.end('rollback;\n');
        runtime.requireComplete(await session.complete);
        cases.push({ mode, gatewayCounts: counters(before), finalizerCounts: counters(final).map((v, i) => v-counters(before)[i]),
          finalCounts: counters(final), snapshotChanged: !final.snapshotStable,
          committedRowObserved: drift, proofAndBaselineCleaned: true, statusAndReceiptsChecked: true,
          rosterAndWaitlistEmpty: true, rolledBack: true });
      } catch (error) {
        session.end('rollback;\n');
        const result = await session.complete;
        // Forward only SQLSTATE, never arbitrary SQL, request bodies or tokens.
        if (result.code !== 0) throw new Error(`gateway SQL failed: ${result.stderr.match(/ERROR:\s+([0-9A-Z]{5}):/u)?.[1] ?? 'unknown'}`);
        throw error;
      } finally { await runtime.closeSessions(session); }
      assert.equal(await runtime.query(`select count(*) from public.classes where id in(
 'fe101234-0000-4000-8000-000000000001','fe101234-0000-4000-8000-000000000002','fe101234-0000-4000-8000-000000000003');`), '0');
      assert.equal(await runtime.query(`select count(*) from dashboard_private.class_schedule_mutation_receipts
 where request_key='fe101234-0000-4000-8000-000000000801';`), '0');
      assert.equal(await runtime.query(metadataSql), metadataBefore, 'product functions and ACL unchanged');
    }
    return { status: 'passed', cases, activeFixtureJobsPaused: paused.paused,
      productFunctionsUnchanged: true, gatewayInvocations: 2 };
  } finally {
    await runtime.query(`begin;do $$declare j record;begin
 for j in select jobid,active from ${schema}.jobs_before where active loop
  perform cron.alter_job(j.jobid,active:=j.active);
 end loop;
end$$;commit;`);
    jobsRestored = await runtime.query(`select not exists(
 (select to_jsonb(j) from cron.job j except all select to_jsonb(j) from ${schema}.jobs_before j)
 union all (select to_jsonb(j) from ${schema}.jobs_before j except all select to_jsonb(j) from cron.job j));`) === 't';
    assert.equal(jobsRestored, true, 'exact scheduler rows must be restored');
    await runtime.query(`drop schema ${schema} cascade;`);
    assert.equal(await runtime.query(`select to_regnamespace('${schema}') is null;`), 't');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const runtime = await personalProbeRuntime();
  let result;
  try { result = await verifyCloseProofPhases(runtime); }
  finally { await runtime.finish(); }
  console.log(JSON.stringify({ ...result, schedulerRestored: true, fixtureDropped: true, sessionsReaped: true }));
}
