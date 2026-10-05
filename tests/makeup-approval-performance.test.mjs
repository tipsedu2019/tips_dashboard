import assert from 'node:assert/strict';
import test from 'node:test';
import { modules, id, row, stamp } from './helpers/makeup-numbered-harness.mjs';

test('approval reads exact detail and preserves labels without loading workspace tables', async t => {
  const calls = [], sends = [], previous = globalThis.fetch;
  const detail = row(1, { approverProfileId: id(804), requesterLabel: '신청자 이름', approverLabel: '결재자 이름' });
  const client = {
    from(table) { throw Error(`unexpected whole table ${table}`); },
    rpc(name, args) { calls.push({ name, args }); return { abortSignal() { return this; }, retry() { return Promise.resolve({ data: detail, error: null }); } }; },
    auth: { getSession: async () => ({ data: { session: { access_token: 'fixture' } } }) },
  };
  globalThis.fetch = async (url, init) => {
    sends.push({ url, body: JSON.parse(init.body) });
    if (url === '/api/makeup-requests/approve') return Response.json({ request: { id: id(1), status: 'makeup_pending', request_kind: 'cancel_only', requester_id: detail.requesterId, approver_profile_id: id(804), approved_by: id(804), created_at: stamp, updated_at: stamp }, sourceEventId: id(999) });
    if (url === '/api/notifications/legacy/makeup') return Response.json({ ok: true });
    throw Error('unexpected transport');
  };
  t.after(() => { globalThis.fetch = previous; });
  const result = await modules(client)('src/features/makeup-requests/makeup-request-service.ts').approveMakeupRequest(id(1), id(804));
  assert.equal(calls.length, 1); assert.equal(calls[0].name, 'get_makeup_detail_v1');
  assert.equal(result.requesterLabel, '신청자 이름'); assert.equal(result.approvedByLabel, '결재자 이름');
  assert.equal(sends[0].body.expectedStatus, 'approval_pending');
  assert.deepEqual(sends.map(s => s.url), ['/api/makeup-requests/approve', '/api/notifications/legacy/makeup']);
});

function routeFixture({ kind = 'cancel_only', collision = false, denied = false, contextError = null, invalidContext = false, transitionError = null, missingTeacher = false } = {}) {
  const calls = [], request = { id: id(1), status: 'approval_pending', approver_profile_id: id(804), class_id: id(600), class_name: '수업', subject: '영어', request_kind: kind, cancel_date: '2026-10-01', makeup_start_at: '2026-10-02T09:00:00+09:00', makeup_end_at: '2026-10-02T10:00:00+09:00', makeup_classroom: 'A', teacher_catalog_id: id(802) };
  let attempts = 0;
  function query(table) {
    const call = { table, steps: [] }; calls.push(call);
    const chain = {};
    for (const method of ['select','eq','in','like','order','range','abortSignal','retry','single','maybeSingle']) chain[method] = (...args) => { call.steps.push({ method, args }); return chain; };
    chain.then = (resolve, reject) => Promise.resolve().then(() => {
      const byId = call.steps.some(s => s.method === 'eq' && s.args[0] === 'id');
      const data = table === 'teacher_catalogs' ? (missingTeacher ? null : { id: id(802), name: '요청 교사' }) : table === 'classroom_catalogs' ? [{ id: id(803), name: 'A' }] : table === 'profiles' ? { role: denied ? 'assistant' : 'admin' } : table === 'makeup_request_events' ? []
        : table === 'makeup_requests' && byId ? request : table === 'classes' && byId ? { id: id(600), name: '수업', subject: '영어', schedule_plan: {} }
        : table === 'classes' && collision ? [{ id: id(601), name: '다른 반', schedule: '금 09:00-10:00', classroom: 'A' }] : [];
      return { data, error: null };
    }).then(resolve, reject);
    return chain;
  }
  const client = { auth: { getUser: async () => ({ data: { user: { id: id(804) } }, error: null }) }, from: query,
    rpc(name, args) {
      const call = { name, args }; calls.push(call);
      if (name === 'get_makeup_approval_collision_context_v1') return {
        abortSignal(signal) { call.signal = signal; return this; },
        retry(value) { call.retry = value; return Promise.resolve({ error: contextError, data: invalidContext ? {} : {
          classes: collision ? [{ id: id(601), name: '다른 반', schedule: '금 09:00-10:00', room: 'A' }] : [], requests: [], academicEvents: [],
        } }); },
      };
      attempts++;
      if (attempts === 1) return Promise.resolve({ data: null, error: { code: '22023', message: 'makeup_calendar_effects_invalid' } });
      return Promise.resolve({ data: transitionError ? null : { request, sourceEventId: id(999) }, error: transitionError });
    } };
  const handler = modules(null, { '@supabase/supabase-js': { createClient: () => client } })('src/app/api/makeup-requests/approve/route.ts').POST;
  return { calls, run: () => handler(new Request('https://fixture.invalid/api/makeup-requests/approve', { method: 'POST', headers: { authorization: 'Bearer fixture' }, body: JSON.stringify({ requestId: id(1), mutationRequestId: id(2), expectedStatus: 'approval_pending', note: '' }) })) };
}
for (const kind of ['cancel_only', 'cancel_makeup']) test(`server ${kind} keeps collision checks and only reads required projections`, async t => {
  const keys = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
  const previous = keys.map(key => process.env[key]);
  keys.forEach(key => process.env[key] = key.includes('URL') ? 'https://fixture.invalid' : 'fixture');
  t.after(() => keys.forEach((key, i) => previous[i] === undefined ? delete process.env[key] : process.env[key] = previous[i]));
  const fixture = routeFixture({ kind });
  assert.equal((await fixture.run()).status, 200);
  const collections = fixture.calls.filter(c => c.table && !c.steps.some(s => s.method === 'eq'));
  if (kind === 'cancel_only') assert.equal(collections.length, 0);
  else {
    assert.equal(collections.length, 1, 'only the bounded room-name lookup');
    assert.equal(collections[0].table, 'classroom_catalogs');
    assert.deepEqual(collections[0].steps.find(step => step.method === 'in').args, ['name', ['A']]);
    const context = fixture.calls.filter(c => c.name === 'get_makeup_approval_collision_context_v1');
    assert.equal(context.length, 1);
    assert.equal(context[0].args.p_slots[0].startAt, '2026-10-02T09:00:00+09:00');
    assert.ok(context[0].signal instanceof AbortSignal);
    assert.equal(context[0].retry, false);
    const conflicting = routeFixture({ kind, collision: true });
    assert.notEqual((await conflicting.run()).status, 200);
    assert.equal(conflicting.calls.filter(c => c.name === 'transition_makeup_request_v2').length, 1, 'no approval write after collision');
    for (const failure of [{ contextError: { message: 'timeout', code: '57014' } }, { invalidContext: true }]) {
      const failed = routeFixture({ kind, ...failure });
      assert.notEqual((await failed.run()).status, 200);
      assert.equal(failed.calls.filter(c => c.name === 'transition_makeup_request_v2').length, 1, 'failed collision read never permits approval');
    }
  }
  const denied = routeFixture({ denied: true }); assert.equal((await denied.run()).status, 403);
  assert.equal(denied.calls.filter(c => c.name).length, 0);
});

test('approval distinguishes incomplete metadata, protected conflicts and query cancellation without retrying writes', async t => {
  const keys=['NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY'];
  const previous=keys.map(key=>process.env[key]);
  keys.forEach(key=>process.env[key]=key.includes('URL')?'https://fixture.invalid':'fixture');
  t.after(()=>keys.forEach((key,i)=>previous[i]===undefined?delete process.env[key]:process.env[key]=previous[i]));
  for (const [options,status,message,attempts] of [
    [{missingTeacher:true},409,/신청된 보강 시간/,1],
    [{transitionError:{code:'23P01',message:'timetable_resource_conflict'}},409,/충돌하거나 확인되지 않은/,2],
    [{transitionError:{code:'57014',message:'canceling statement due to statement timeout'}},503,/승인을 완료하지 못했습니다/,2],
  ]) {
    const fixture=routeFixture({kind:'cancel_makeup',...options});
    const response=await fixture.run(); assert.equal(response.status,status);
    assert.match((await response.json()).error,message);
    assert.equal(fixture.calls.filter(c=>c.name==='transition_makeup_request_v2').length,attempts);
  }
});
