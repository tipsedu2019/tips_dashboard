import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { modules, transport, servicePath, setup, button } from './helpers/makeup-numbered-harness.mjs';
import { legacyId, legacyPairFixture } from './helpers/makeup-legacy-pair-fixture.mjs';

const workspacePath = 'src/features/makeup-requests/makeup-request-workspace.tsx';
const clone = value => structuredClone(value);

function context(f, patch = {}) {
  return { classrooms: [f.room], classes: [], requests: [], academicEvents: [], collisionContextReady: true,
    reservationContext: { reservations: [], activeEventRequestIds: [], effectiveSchedule: { version: 1, occupancies: [f.occupancy] }, legacyBindings: [f.binding], ...patch } };
}

for (const timezone of ['UTC', 'Asia/Seoul']) test(`legacy pair consumer uses precise proof and requested Seoul interval in ${timezone}`, t => {
  const old = process.env.TZ; process.env.TZ = timezone;
  t.after(() => old === undefined ? delete process.env.TZ : process.env.TZ = old);
  const f = legacyPairFixture();
  const { hasMakeupRequestRoomCollision: collision, getMakeupRequestTableValue: value } = modules(null, { '@/providers/auth-provider': {} })(workspacePath);
  assert.equal(value(f.entry, 'makeupAt'), '2050-10-06 18:00 - 2050-10-06 20:00');
  assert.equal(collision(f.entry, context(f)), false, 'only the verified inherited interval is excluded');
  for (const extra of [
    { ...f.occupancy, id: 'synthetic-other-class', classId: legacyId(80) },
    { ...f.occupancy, id: 'synthetic-same-class-other-lesson' },
    { ...f.occupancy, uncertain: true, allRooms: true },
  ]) assert.equal(collision(f.entry, context(f, { effectiveSchedule: { version: 1, occupancies: [f.occupancy, extra] } })), true);
  for (const patch of [
    { legacyBindings: [] },
    { legacyBindings: [{ ...f.binding, requestUpdatedAt: '2050-09-30T00:00:00.123457+00:00' }] },
    { legacyBindings: [{ ...f.binding, occupancy: { ...f.occupancy, id: 'different-row' } }] },
    { legacyBindings: [f.binding, f.binding] },
  ]) assert.equal(collision(f.entry, context(f, patch)), true, 'missing, stale, malformed or duplicate proof stays blocked');
  assert.equal(collision({ ...f.entry, makeupSlots: [f.slot, { ...f.slot, endAt: '2050-10-06T12:00:00Z' }] }, context(f)), true, 'one proof cannot waive a multi-slot request');
});

test('numbered reservation DTO retains exact generation and rejects unsolicited or malformed bindings', async () => {
  const f = legacyPairFixture();
  async function read(bindings, requestIds = [f.entry.id]) {
    const io = transport(), service = modules(io.supabase)(servicePath);
    const pending = service.readMakeupReservationContext({ slots: [f.slot], eventRequestIds: [], requestIds });
    io.requests[0].resolve({ error: null, data: { reservations: [], activeEventRequestIds: [], legacyBindings: bindings } });
    return { result: await pending, query: io.requests[0].args };
  }
  const valid = await read([f.binding]);
  assert.equal(valid.result.legacyBindings[0].requestUpdatedAt, f.entry.updatedAt, 'microseconds are never rounded to milliseconds');
  assert.deepEqual(valid.query.p_slots, [{ startAt: f.binding.startAt, endAt: f.binding.endAt, requestIds: [f.entry.id] }]);
  assert.deepEqual(valid.query.p_event_request_ids, [], 'event ownership parameter retains its purpose');
  assert.deepEqual((await read(null)).result.legacyBindings, [], 'null is empty proof, never verified ownership');
  for (const bindings of [{}, [f.binding, f.binding], [{ ...f.binding, requestId: legacyId(90) }], [{ ...f.binding, occupancy: { ...f.occupancy, uncertain: true } }]]) {
    await assert.rejects(read(bindings), /makeup_reservation_response_invalid/);
  }
  await assert.rejects(read([f.binding], []), /makeup_reservation_response_invalid/);
});

test('completed adopted request excludes only its current verified generic row', () => {
  const f = legacyPairFixture();
  const { hasMakeupRequestRoomCollision: collision } = modules(null, { '@/providers/auth-provider': {} })(workspacePath);
  const current = { ...f.occupancy, startMinute: 1080, endMinute: 1200 };
  const binding = { ...f.binding, mode: 'bound', occupancy: current };
  for (const status of ['completed', 'makeup_pending']) {
    const entry = { ...f.entry, status };
    const data = context(f, { legacyBindings: [binding], effectiveSchedule: { version: 1, occupancies: [current] } });
    assert.equal(collision(entry, data), false);
    assert.equal(collision(entry, context(f, { legacyBindings: [binding] })), true, 'changed occupancy must be revalidated, not hidden by row identity alone');
    assert.equal(collision(entry, context(f, { legacyBindings: [], effectiveSchedule: { version: 1, occupancies: [current] } })), true, 'generic ID has no canonical self exemption without proof');
  }
});

for (const [label, other] of [['verified pair', false], ['other same-class lesson', true]]) test(`actual workspace list, mobile card and detail agree for ${label}`, async t => {
  const f = legacyPairFixture(), p = await setup(t, { search: `?view=approvalPending&requestId=${f.entry.id}` });
  // Both responsive DOM branches are asserted. JSDOM does not prove visual layout.
  const effective = Promise.withResolvers(), originalRpc = p.supabase.rpc;
  p.supabase.rpc = (name, args) => {
    if (name !== 'get_makeup_effective_occupancy_v1') return originalRpc(name, args);
    const record = { name, args }; p.requests.push(record);
    return { then: effective.promise.then.bind(effective.promise), abortSignal(signal) { record.signal = signal; return this; }, retry(value) { record.retry = value; return this; } };
  };
  await act(async () => {
    p.finish(p.numbered()[0], 1, { rows: [f.entry] });
    p.requests.find(r => r.name === 'get_makeup_detail_v1').resolve({ data: f.entry, error: null });
  });
  await p.catalogs();
  const reservation = p.context().at(-1);
  assert.deepEqual(reservation.args.p_slots[0].requestIds, [f.entry.id]);
  await act(async () => reservation.resolve({ data: { reservations: [], activeEventRequestIds: [], legacyBindings: [f.binding] }, error: null }));
  for (const control of [...document.querySelectorAll('button')].filter(n => n.textContent.trim() === '승인')) assert.equal(control.disabled, true, 'binding read alone is insufficient before occupancy completes');
  await act(async () => effective.resolve({ data: { version: 1, occupancies: [f.occupancy, ...(other ? [{ ...f.occupancy, id: 'synthetic-other-same-class' }] : [])] }, error: null }));
  const table = document.querySelector('[role="table"][aria-label="휴보강 신청 데이터테이블"]');
  const detail = document.querySelector('[aria-label="휴보강 상세 신청서"]');
  const mobile = [...document.querySelectorAll('div')].find(n => n.classList.contains('md:hidden') && n.textContent.includes(f.entry.className));
  assert.ok(table); assert.ok(detail); assert.ok(mobile, 'actual responsive card branch renders');
  for (const region of [table, mobile, detail]) {
    assert.equal(region.textContent.includes('충돌 있음'), other);
    assert.match(region.textContent, /2050-10-06 18:00 - 2050-10-06 20:00/);
  }
  assert.equal(button('승인').disabled, other);
  assert.equal(p.requests.some(r => /transition|create|approve/.test(r.name || '')), false, 'display does not submit approval');
});

for (const freshProof of [false, true]) test(`same-slot detail generation refreshes collision context; ${freshProof ? 'new' : 'old'} proof ${freshProof ? 'clears' : 'retains'} the block`, async t => {
  const f = legacyPairFixture(), p = await setup(t, { search: '?view=approvalPending' });
  const originalRpc = p.supabase.rpc;
  p.supabase.rpc = (name, args) => {
    if (name !== 'get_makeup_effective_occupancy_v1') return originalRpc(name, args);
    p.requests.push({ name, args });
    return { abortSignal() { return this; }, retry() { return Promise.resolve({ data: { version: 1, occupancies: [f.occupancy] }, error: null }); } };
  };
  await act(async () => p.finish(p.numbered()[0], 1, { rows: [f.entry] }));
  await p.catalogs();
  await act(async () => p.context().at(-1).resolve({ data: { reservations: [], activeEventRequestIds: [], legacyBindings: [f.binding] }, error: null }));
  assert.equal(button('승인').disabled, false, 'initial list proof is current');
  const reads = p.context().length, pages = p.numbered().length;
  window.history.pushState(null, '', `?view=approvalPending&requestId=${f.entry.id}`);
  await p.render();
  const updatedAt = '2050-09-30T00:00:00.123457+00:00';
  await act(async () => p.requests.filter(r => r.name === 'get_makeup_detail_v1').at(-1).resolve({ data: { ...f.entry, updatedAt }, error: null }));
  assert.equal(p.context().length, reads + 1, 'same ID and same slots still require a read for the latest request generation');
  assert.equal(p.numbered().length, pages, 'detail refresh does not perform an unrelated list reload');
  const detail = document.querySelector('[aria-label="휴보강 상세 신청서"]');
  const approve = () => [...detail.querySelectorAll('button')].find(n => n.textContent.trim() === '승인');
  assert.equal(approve().disabled, true, 'previous context proof cannot enable a newer detail while the new read is pending');
  const next = p.context().at(-1);
  assert.deepEqual(next.args.p_slots, [{ startAt: f.binding.startAt, endAt: f.binding.endAt, requestIds: [f.entry.id] }], 'generation is local cache identity, not a new RPC contract');
  await act(async () => next.resolve({ data: { reservations: [], activeEventRequestIds: [], legacyBindings: [{ ...f.binding, requestUpdatedAt: freshProof ? updatedAt : f.binding.requestUpdatedAt }] }, error: null }));
  assert.equal(approve().disabled, !freshProof);
  assert.equal(detail.textContent.includes('충돌 있음'), !freshProof);
  assert.equal(p.requests.some(r => /transition|create|approve/.test(r.name || '')), false);
});

function routeFixture(f, { bindings = [f.binding], occupancies = [f.occupancy], replay = false, writerError = null } = {}) {
  const calls = [];
  const client = { auth: { getUser: async () => ({ data: { user: { id: legacyId(804) } }, error: null }) },
    from(table) {
      const call = { table, steps: [] }; calls.push(call);
      const chain = {};
      for (const method of ['select', 'eq', 'in', 'single', 'maybeSingle', 'abortSignal', 'retry']) chain[method] = (...args) => { call.steps.push({ method, args }); return chain; };
      chain.then = (resolve, reject) => Promise.resolve({ error: null, data: table === 'profiles' ? { role: 'admin' }
        : table === 'makeup_requests' ? f.request : table === 'classes' ? { id: f.request.class_id, name: f.request.class_name, subject: f.request.subject, schedule_plan: f.plan }
        : table === 'teacher_catalogs' ? f.teacher : table === 'classroom_catalogs' ? [f.room] : [] }).then(resolve, reject);
      return chain;
    },
    rpc(name, args) {
      const call = { name, args }; calls.push(call);
      const wrapped = data => ({ abortSignal(signal) { call.signal = signal; return this; }, retry(value) { call.retry = value; return Promise.resolve({ data, error: null }); } });
      if (name === 'get_makeup_director_capability_v1') return Promise.resolve({ data: true, error: null });
      if (name === 'get_makeup_approval_collision_context_v1') return wrapped({ classes: [], requests: [], academicEvents: [], legacyBindings: bindings });
      if (name === 'get_makeup_effective_occupancy_v1') return wrapped({ version: 1, occupancies });
      assert.equal(name, 'transition_makeup_request_v2');
      const writes = calls.filter(c => c.name === name);
      if (writes.length === 1 && !replay) return Promise.resolve({ data: null, error: { code: '22023', message: 'makeup_calendar_effects_invalid' } });
      return Promise.resolve({ data: writerError ? null : { request: { ...f.request, status: 'completed' }, sourceEventId: legacyId(999) }, error: writerError });
    },
  };
  const handler = modules(null, { '@supabase/supabase-js': { createClient: () => client } })('src/app/api/makeup-requests/approve/route.ts').POST;
  return { calls, run: () => handler(new Request('https://synthetic.invalid/api/makeup-requests/approve', { method: 'POST', headers: { authorization: 'Bearer synthetic-not-a-credential' }, body: JSON.stringify({ requestId: f.request.id, mutationRequestId: legacyId(500), expectedStatus: 'approval_pending', note: '' }) })) };
}

function serverEnvironment(t) {
  const keys = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'], old = keys.map(key => process.env[key]);
  for (const key of keys) process.env[key] = key.includes('URL') ? 'https://synthetic.invalid' : 'synthetic-not-a-credential';
  t.after(() => keys.forEach((key, index) => old[index] === undefined ? delete process.env[key] : process.env[key] = old[index]));
}

test('actual approve route passes preserved before and exact reused pair to the locked writer', async t => {
  serverEnvironment(t);
  const f = legacyPairFixture(), original = clone(f.plan), api = routeFixture(f);
  const result = await api.run(); assert.equal(result.status, 200, await result.text());
  assert.deepEqual(f.plan, original);
  const writes = api.calls.filter(c => c.name === 'transition_makeup_request_v2'); assert.equal(writes.length, 2);
  const patch = writes[1].args.p_patch;
  assert.deepEqual(patch.schedule_plan_before, original, 'cancellation gets the actual pre-adoption pair');
  assert.equal(patch.schedule_plan_after.sessions.length, 2);
  const adopted = patch.schedule_plan_after.sessions.find(r => r.id === f.makeup.id);
  assert.equal(adopted.startTime, '18:00'); assert.equal(adopted.endTime, '20:00');
  assert.equal(adopted.teacherNote, f.makeup.teacherNote); assert.equal(adopted.billingId, f.makeup.billingId);
  assert.equal(adopted.makeupAdoption.requestUpdatedAt, f.request.updated_at);
  const query = api.calls.find(c => c.name === 'get_makeup_approval_collision_context_v1');
  assert.deepEqual(query.args.p_slots[0].requestIds, [f.request.id]);
  assert.equal(query.retry, false);
});

test('actual approve route preserves fail-closed collisions and refuses incomplete pair ownership', async t => {
  serverEnvironment(t);
  const f = legacyPairFixture();
  for (const [label, options] of [
    ['missing proof', { bindings: [] }],
    ['stale generation', { bindings: [{ ...f.binding, requestUpdatedAt: '2050-09-30T00:00:00.123457+00:00' }] }],
    ['different class', { occupancies: [f.occupancy, { ...f.occupancy, id: 'synthetic-other-class', classId: legacyId(40) }] }],
    ['same class separate lesson', { occupancies: [f.occupancy, { ...f.occupancy, id: 'synthetic-separate-lesson' }] }],
    ['duplicate proof', { bindings: [f.binding, f.binding] }],
    ['wrong proof identity', { bindings: [{ ...f.binding, requestId: legacyId(50) }] }],
    ['uncertain row', { occupancies: [{ ...f.occupancy, uncertain: true }] }],
  ]) {
    const api = routeFixture(f, options), result = await api.run();
    assert.notEqual(result.status, 200, label);
    assert.equal(api.calls.filter(c => c.name === 'transition_makeup_request_v2').length, 1, `${label}: only receipt lookup, no effects-bearing writer call`);
  }
  const changed = clone(f); changed.plan.sessions[1].originalSessionId = 'wrong-origin';
  const mismatch = routeFixture(changed), result = await mismatch.run();
  assert.equal(result.status, 409); assert.match((await result.json()).error, /휴강 회차/);
  assert.equal(mismatch.calls.filter(c => c.name === 'transition_makeup_request_v2').length, 1);
  const multi = clone(f); multi.request.makeup_slots.push({ ...f.slot, endAt: '2050-10-06T12:00:00Z' });
  const ambiguous = routeFixture(multi);
  assert.notEqual((await ambiguous.run()).status, 200);
  assert.equal(ambiguous.calls.filter(c => c.name === 'transition_makeup_request_v2').length, 1, 'single binding cannot authorize a multi-slot reuse');
});

test('actual approve route retains writer rejection and receipt replay semantics', async t => {
  serverEnvironment(t);
  const f = legacyPairFixture();
  const stale = routeFixture(f, { writerError: { code: '22023', message: 'makeup_request_source_changed' } });
  const failed = await stale.run(); assert.notEqual(failed.status, 200); assert.match((await failed.json()).error, /수업 정보가 변경/);
  assert.equal(stale.calls.filter(c => c.name === 'transition_makeup_request_v2').length, 2, 'writer error is not retried');
  for (const message of ['makeup_legacy_pair_stale', 'makeup_legacy_pair_invalid']) {
    const conflict = routeFixture(f, { writerError: { code: 'P0001', message } });
    assert.equal((await conflict.run()).status, 409, `${message} is a known domain conflict, not a transport failure`);
    assert.equal(conflict.calls.filter(c => c.name === 'transition_makeup_request_v2').length, 2, 'domain rejection is not retried');
  }
  const replay = routeFixture(f, { replay: true, bindings: [], occupancies: [] });
  assert.equal((await replay.run()).status, 200);
  assert.equal(replay.calls.some(c => c.name === 'get_makeup_approval_collision_context_v1' || c.name === 'get_makeup_effective_occupancy_v1' || c.table === 'classes'), false, 'successful receipt replays before fresh adoption work');
});
