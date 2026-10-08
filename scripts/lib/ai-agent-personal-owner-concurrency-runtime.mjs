// Interactive sessions belong only to the runner's fresh, isolated QA container.
import { spawn } from 'node:child_process';
import { randomUUID,createHash } from 'node:crypto';

const ENDPOINT = 'unix:///Users/hyunjun/.docker/run/docker.sock';
const IMAGE = 'sha256:86a2e078779e5bdccda1f6f6c5063aa9779a322d1fface5fb408d051909b230f';
const fail = code => { throw new Error(`ai_agent_personal_owner_qa:${code}`); };
const delay = ms => new Promise(done => setTimeout(done,ms));
const cleanEnvironment = () => {
  if (typeof process.env.PATH !== 'string' || !process.env.PATH || /[\r\n\0]/u.test(process.env.PATH)) fail('concurrency_path_invalid');
  return { PATH: process.env.PATH, LANG: 'C', LC_ALL: 'C' };
};

export function requirePersonalOwnerSqlCompletion(result,code = 'concurrency_query_failed') {
  if (result.code === 0 && result.signal === null) return;
  const error = new Error(`ai_agent_personal_owner_qa:${code}`);
  error.diagnostics = {
    sqlstates: [...new Set([...result.stderr.matchAll(/ERROR:\s+([0-9A-Z]{5}):/gu)].map(match => match[1]))],
    stdoutSha256: createHash('sha256').update(result.stdout).digest('hex'),
    stderrSha256: createHash('sha256').update(result.stderr).digest('hex'),
  };
  throw error;
}

export function requirePersonalOwnerSessionCleanup({natural,processResult,remaining}) {
  if (remaining !== '0') fail('concurrency_backend_cleanup_unconfirmed');
  // A naturally reaped psql code 3 is a SQL failure, independent of cleanup.
  if (!natural || processResult.problem) fail('concurrency_session_cleanup_required_cancellation');
  return { ownedChildReaped:true,ownedPostgresSessionAbsent:true };
}

export function boundedPersonalOwnerProcess(command,args,{ timeoutMs = 45_000, registerStop = () => () => {} } = {}) {
  const child = spawn(command,args,{ env: cleanEnvironment(), stdio: ['pipe','pipe','pipe'] });
  const out = [], err = [], signals = [];
  let bytes = 0, closed = false, problem, cancellation, release = () => {};
  let finish;
  const exited = new Promise(done => { finish = done; });
  const stop = code => { cancel(code).catch(() => {}); };
  const timer = setTimeout(() => stop('concurrency_process_timeout'),timeoutMs);
  release = registerStop(stop);
  const collect = target => chunk => {
    bytes += chunk.length;
    if (bytes > 2_000_000) stop('concurrency_process_output_limit');
    else target.push(chunk);
  };
  child.stdout.on('data',collect(out)); child.stderr.on('data',collect(err));
  child.stdin.on('error',error => { if (error.code !== 'EPIPE') stop('concurrency_process_stdin_error'); });
  child.on('error',() => stop('concurrency_process_spawn_error'));
  child.on('close',(code,signal) => {
    closed = true; clearTimeout(timer); release();
    finish({ code,signal,problem,signals,stdout: Buffer.concat(out).toString('utf8'),stderr: Buffer.concat(err).toString('utf8') });
  });
  async function cancel(code = 'concurrency_process_cancelled') {
    if (cancellation) return cancellation;
    cancellation = (async () => {
      if (closed) return;
      problem = code;
      child.stdin.destroy();
      signals.push('SIGTERM'); child.kill('SIGTERM');
      if (await Promise.race([exited.then(() => true),delay(750).then(() => false)])) return;
      signals.push('SIGKILL'); child.kill('SIGKILL');
      if (!await Promise.race([exited.then(() => true),delay(1500).then(() => false)])) {
        clearTimeout(timer); release();
        child.stdout.destroy(); child.stderr.destroy(); child.unref();
        problem = 'concurrency_process_reaping_unconfirmed';
        finish({ code: null,signal: null,problem,signals,stdout: '',stderr: '' });
        fail(problem);
      }
    })();
    return cancellation;
  }
  const complete = exited.then(result => {
    if (result.problem) fail(result.problem);
    return result;
  });
  complete.catch(() => {});
  return { child,complete,exited,cancel,signals,get closed() { return closed; },get stdout() { return Buffer.concat(out).toString('utf8'); } };
}

export function validatePersonalOwnerProbeTarget(name,nonce,info) {
  if (!/^[a-f0-9]{32}$/u.test(nonce) || name !== `tips-ai-agent-personal-owner-${nonce}` || info?.Name !== `/${name}` || info.Image !== IMAGE || info.Config?.Labels?.['tips.ai-agent-personal-owner-qa.owner'] !== nonce) fail('concurrency_target_not_owned');
  if (info.HostConfig?.NetworkMode !== 'none' || !Array.isArray(info.Mounts) || info.Mounts.length || Object.keys(info.HostConfig?.PortBindings ?? {}).length || Object.keys(info.NetworkSettings?.Ports ?? {}).some(key => info.NetworkSettings.Ports[key] !== null)) fail('concurrency_target_not_isolated');
}

export async function createPersonalOwnerConcurrencyRuntime({name,nonce,registerStop,requireRunning}) {
  const sessions = new Set(), children = new Set();
  let finished = false;
  const trackStop = stop => {
    children.add(stop);
    const release = registerStop(stop);
    return () => { children.delete(stop); release(); };
  };
  const command = (args,timeoutMs) => boundedPersonalOwnerProcess('docker',['--host',ENDPOINT,...args],{timeoutMs,registerStop: trackStop});
  async function control(input,timeoutMs = 5000,tag) {
    const process = command(['exec','--interactive',...(tag ? ['--env',`PGAPPNAME=${tag}`] : []),'--env','PGOPTIONS=-c statement_timeout=4000 -c lock_timeout=2000',name,'psql','-XqAt','--set','ON_ERROR_STOP=1','--set','VERBOSITY=verbose','--username','supabase_admin','--dbname','postgres'],timeoutMs);
    process.child.stdin.end(input);
    const result = await process.complete;
    requirePersonalOwnerSqlCompletion(result,'concurrency_control_failed');
    return result.stdout;
  }
  const inspected = command(['container','inspect',name,'--format','{{json .}}'],5000);
  inspected.child.stdin.end();
  const result = await inspected.complete;
  let info;
  try { info = JSON.parse(result.stdout); } catch { fail('concurrency_target_metadata_invalid'); }
  if (result.code !== 0) fail('concurrency_target_metadata_invalid');
  validatePersonalOwnerProbeTarget(name,nonce,info);
  function session() {
    requireRunning();
    if (finished) fail('concurrency_runtime_closed');
    const tag = `poqa_${nonce.slice(0,12)}_${randomUUID().replaceAll('-','')}`;
    const process = command(['exec','--interactive','--env',`PGAPPNAME=${tag}`,'--env','PGOPTIONS=-c statement_timeout=30000 -c lock_timeout=20000 -c idle_in_transaction_session_timeout=30000',name,'psql','-XqAt','--set','ON_ERROR_STOP=1','--set','VERBOSITY=verbose','--username','supabase_admin','--dbname','postgres'],45_000);
    let closePromise;
    const client = {
      tag,complete: process.complete,
      write(input) { requireRunning(); if (process.closed || process.child.stdin.destroyed) fail('concurrency_session_closed'); process.child.stdin.write(input); },
      end(input) { if (!process.child.stdin.destroyed && !process.child.stdin.writableEnded) process.child.stdin.end(input); },
      async line(pattern) {
        const deadline = Date.now() + 20_000;
        while (Date.now() < deadline) {
          requireRunning();
          const match = process.stdout.match(pattern);
          if (match) return match;
          if (process.closed) { await process.complete; fail('concurrency_checkpoint_ended'); }
          await delay(25);
        }
        fail('concurrency_checkpoint_timeout');
      },
      close() {
        if (closePromise) return closePromise;
        closePromise = (async () => {
          client.end('rollback;\n');
          const natural = await Promise.race([process.exited.then(() => true),delay(1500).then(() => false)]);
          if (!natural) await process.cancel();
          const exited = await process.exited;
          // Docker CLI close alone does not prove PostgreSQL session cleanup.
          let remaining;
          for (let attempt = 0; attempt < 3; attempt++) {
            const sql = `${!natural || exited.problem ? `select pg_terminate_backend(pid) from pg_stat_activity where application_name='${tag}';` : ''}select count(*) from pg_stat_activity where application_name='${tag}';`;
            remaining = (await control(sql,5000)).trim().split('\n').at(-1);
            if (remaining === '0') break;
            await delay(50);
          }
          sessions.delete(client);
          return requirePersonalOwnerSessionCleanup({natural,processResult:exited,remaining});
        })();
        return closePromise;
      },
    };
    sessions.add(client);
    return client;
  }
  async function closeSessions(...clients) {
    const closed = await Promise.allSettled(clients.map(client => client.close()));
    const error = closed.find(entry => entry.status === 'rejected');
    if (error) throw error.reason;
  }
  async function query(input) {
    requireRunning();
    const client = session();
    let failure,output;
    try { client.end(input); const result = await client.complete; requirePersonalOwnerSqlCompletion(result); output = result.stdout.trim(); }
    catch (error) { failure = error; }
    finally {
      try { await client.close(); }
      catch (error) {
        if (!failure) failure = error;
        else failure.diagnostics = { ...failure.diagnostics,sessionCleanupCode:/^ai_agent_personal_owner_qa:[a-z_]+$/u.test(error.message) ? error.message : 'ai_agent_personal_owner_qa:concurrency_cleanup_failed' };
      }
    }
    if (failure) throw failure;
    return output;
  }
  async function waitForLock(writerPid,blockerPid) {
    if (![writerPid,blockerPid].every(pid => Number.isSafeInteger(pid) && pid > 0) || writerPid === blockerPid) fail('concurrency_pid_invalid');
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      requireRunning();
      if (await query(`select ${blockerPid}=any(pg_blocking_pids(${writerPid})) and exists(select 1 from pg_stat_activity where pid=${writerPid} and wait_event_type='Lock');`) === 't') return true;
      await delay(50);
    }
    fail('concurrency_lock_wait_unobserved');
  }
  async function finish() {
    finished = true;
    await closeSessions(...sessions);
    if (children.size !== 0 || sessions.size !== 0) fail('concurrency_cleanup_incomplete');
    return { ownedChildrenReaped: true, ownedPostgresSessionsAbsent: true };
  }
  return { session,query,waitForLock,closeSessions,finish,requireComplete:requirePersonalOwnerSqlCompletion };
}
