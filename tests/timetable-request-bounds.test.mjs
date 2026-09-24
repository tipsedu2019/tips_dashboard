import assert from 'node:assert/strict';
import test from 'node:test';
import { createClient } from '@supabase/supabase-js';
import { createTimetablePlanService } from '../src/features/academic/timetable-plan-service.ts';

const options = fetch => ({ auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch } });
const fixture = fetch => createTimetablePlanService({ actorScope: 'actor', client: createClient('https://timetable.example.invalid', 'fixture-anon', options(fetch)) });

test('installed transport sends a 30-row plan page and makes only one request on a transient failure', async () => {
  const calls = [];
  const service = fixture(async (url, init) => {
    calls.push({ url: String(url), args: JSON.parse(init.body), signal: init.signal });
    if (calls.length === 1) return Response.json({ plans: [], total: 0, canManage: true });
    return Response.json({ code: 'XX000', message: 'temporary fixture failure' }, { status: 503 });
  });
  await service.listPlans(false, 2);
  assert.deepEqual(calls[0].args, { p_archived: false, p_page: 2, p_page_size: 30 });
  assert.ok(calls[0].signal instanceof AbortSignal);
  await assert.rejects(service.readPlan('plan'), error => error.message === 'temporary fixture failure');
  assert.equal(calls.length, 2);
});

test('caller cancellation aborts the installed PostgREST transport without retrying', async () => {
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  let calls = 0;
  const service = fixture((_url, { signal }) => new Promise((_resolve, reject) => {
    calls++;
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    entered();
  }));
  const controller = new AbortController();
  const response = service.readPlan('plan', { signal: controller.signal });
  const rejected = assert.rejects(response);
  await started;
  controller.abort();
  await rejected;
  assert.equal(calls, 1);
});

test('every plan request retains the 8-second deadline even without a caller signal', async t => {
  const timeoutCalls = [];
  const original = AbortSignal.timeout;
  t.mock.method(AbortSignal, 'timeout', ms => {
    timeoutCalls.push(ms);
    return original.call(AbortSignal, 1);
  });
  let calls = 0;
  const service = fixture((_url, { signal }) => new Promise((_resolve, reject) => {
    calls++;
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }));
  // Native timeout signals are unref'd; retain the event loop until the assertion finishes.
  const keepAlive = setTimeout(() => {}, 1000);
  try { await assert.rejects(service.readPlan('plan')); }
  finally { clearTimeout(keepAlive); }
  assert.deepEqual(timeoutCalls, [8_000]);
  assert.equal(calls, 1);
});
