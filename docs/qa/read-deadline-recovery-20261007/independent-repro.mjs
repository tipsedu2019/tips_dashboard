import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const repo = path.resolve(process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), '../../tips-read-deadline-fix'));
const require = createRequire(path.join(repo, 'package.json'));
const { createClient } = require('@supabase/supabase-js');
const { withReadDeadline } = await import(pathToFileURL(path.join(repo, 'src/lib/read-deadline.ts')).href);
const { createManagementReadService } = await import(pathToFileURL(path.join(repo, 'src/features/management/management-service.js')).href);
const tick = () => new Promise(resolve => setImmediate(resolve));
const sourceFiles = ['src/lib/read-deadline.ts', 'src/features/management/management-service.js', 'src/features/management/management-numbered-service.ts', 'src/features/management/use-management-records.ts'];
const sourceSha256 = Object.fromEntries(sourceFiles.map(file => [file, createHash('sha256').update(readFileSync(path.join(repo, file))).digest('hex')]));
const results = [];

// Exercise the installed SDK getSession branch, not the alternate accessToken option.
{
  const session = Promise.withResolvers();
  let sessionCalls = 0, fetchEntries = 0, transportWork = 0;
  const client = createClient('https://fixture.invalid', 'fixture-only', {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: async (_url, init) => {
      fetchEntries++;
      init.signal.throwIfAborted();
      transportWork++;
      return new Response('[]', { headers: { 'content-type': 'application/json' } });
    } },
  });
  client.auth.getSession = () => { sessionCalls++; return session.promise; };
  const caller = new AbortController();
  const canceled = withReadDeadline(signal => client.from('fixture').select('id').limit(1).abortSignal(signal).retry(false), { signal: caller.signal });
  const survivor = client.from('fixture').select('id').limit(1).abortSignal(new AbortController().signal).retry(false).then(result => result);
  const rejection = assert.rejects(canceled, { name: 'AbortError' });
  await tick();
  caller.abort();
  await rejection;
  assert.equal(transportWork, 0);
  session.resolve({ data: { session: { access_token: 'fixture-token' } }, error: null });
  assert.equal((await survivor).error, null);
  await tick();
  assert.equal(sessionCalls, 2);
  assert.equal(fetchEntries, 2);
  assert.equal(transportWork, 1);
  results.push({ check: 'one caller cancellation preserves another consumer of shared getSession', sessionCalls, fetchEntries, transportWork, passed: true });
}

// Supabase errors resolve as envelopes. Both metadata branches must reject inside
// the shared deadline so the non-cooperative sibling signal aborts immediately.
for (const failedRpc of ['get_management_stats_v1', 'list_management_filter_options_v1']) {
  const held = Promise.withResolvers();
  const requests = [];
  const failure = { code: '57014', message: 'synthetic metadata failure', details: null, hint: null };
  const client = createClient('https://fixture.invalid', 'fixture-only', {
    accessToken: async () => 'fixture-token',
    global: { fetch: async (url, init) => {
      const rpc = new URL(url).pathname.split('/').at(-1);
      requests.push({ rpc, signal: init.signal });
      if (rpc === failedRpc) return new Response(JSON.stringify(failure), { status: 500, headers: { 'content-type': 'application/json' } });
      if (rpc === 'list_management_page_v1') return new Response('[]', { headers: { 'content-type': 'application/json' } });
      return held.promise; // Deliberately ignores cancellation; no real transport.
    } },
  });
  const filters = { kind: 'classes', search: '', status: '수강', periodId: 'period', subject: null, grade: null, teacher: null, classroom: null };
  const bundle = await createManagementReadService({ supabase: client }).loadPage({ kind: 'classes', filters, limit: 10 });
  let guard;
  let result;
  try {
    result = await Promise.race([bundle.metadata, new Promise((_, reject) => { guard = setTimeout(() => reject(new Error('metadata did not fail fast')), 250); })]);
  } finally { clearTimeout(guard); }
  assert.equal(result.ok, false);
  assert.equal(result.error.code, '57014');
  const sibling = requests.find(item => item.rpc !== failedRpc && item.rpc !== 'list_management_page_v1');
  assert.equal(sibling.signal.aborted, true);
  assert.equal(requests.length, 3);
  held.resolve(new Response(JSON.stringify({ stale: true }), { headers: { 'content-type': 'application/json' } }));
  await tick(); await tick();
  assert.equal((await bundle.metadata).error.code, '57014');
  assert.equal(requests.length, 3);
  results.push({ check: 'metadata resolved error cancels sibling before deadline and preserves error', failedRpc, requests: requests.length, siblingAborted: true, errorCode: result.error.code, passed: true });
}

// A supplied signal represents the same timer at both helper and RPC boundary.
{
  const originalTimeout = AbortSignal.timeout;
  let timerCalls = 0, invoked = false;
  const deadline = new AbortController();
  AbortSignal.timeout = () => { timerCalls++; throw new Error('must not create a second timer'); };
  try {
    const pending = withReadDeadline(() => { invoked = true; return new Promise(() => {}); }, { deadline: deadline.signal });
    assert.equal(invoked, true, 'callback start timing stays synchronous');
    const rejection = assert.rejects(pending, { code: 'read_operation_timeout' });
    deadline.abort(new DOMException('synthetic deadline', 'TimeoutError'));
    await rejection;
    assert.equal(timerCalls, 0);
    results.push({ check: 'shared deadline uses no additional timer and callback starts synchronously', timerCalls, passed: true });
  } finally { AbortSignal.timeout = originalTimeout; }
}

{
  let calls = 0;
  const deadline = AbortSignal.abort(new DOMException('expired before helper entry', 'TimeoutError'));
  await assert.rejects(withReadDeadline(() => { calls++; return Promise.resolve('unexpected'); }, { deadline }), { code: 'read_operation_timeout' });
  assert.equal(calls, 0);
  results.push({ check: 'already expired shared deadline preserves normalized error and never starts read', calls, passed: true });
}

console.log(JSON.stringify({ at: new Date().toISOString(), sourceHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(), sourceSha256, network: 'none; SDK uses injected fetch and synthetic getSession', results }, null, 2));
