import assert from 'node:assert/strict';
import test from 'node:test';
import { modules, id, row, stamp, transport, servicePath } from './helpers/makeup-numbered-harness.mjs';
import { actionCases, actionFixture, loadActionService } from './helpers/makeup-action-fixture.mjs';
import { resubmitFixture } from './helpers/makeup-resubmit-fixture.mjs';

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

function routeFixture({ role = "admin", approverId = id(804), kind = 'cancel_only', collision = false, denied = false, contextError = null, invalidContext = false, transitionError = null, missingTeacher = false, makeupSlots, effectiveRead } = {}) {
  const calls = [], request = { id: id(1), status: 'approval_pending', approver_profile_id: approverId, class_id: id(600), class_name: '수업', subject: '영어', request_kind: kind, cancel_date: '2026-10-01', makeup_start_at: '2026-10-02T09:00:00+09:00', makeup_end_at: '2026-10-02T10:00:00+09:00', makeup_classroom: 'A', teacher_catalog_id: id(802) };
  if (makeupSlots) request.makeup_slots = makeupSlots;
  let attempts = 0, effectiveCalls = 0;
  function query(table) {
    const call = { table, steps: [] }; calls.push(call);
    const chain = {};
    for (const method of ['select','eq','in','like','order','range','abortSignal','retry','single','maybeSingle']) chain[method] = (...args) => { call.steps.push({ method, args }); return chain; };
    chain.then = (resolve, reject) => Promise.resolve().then(() => {
      const byId = call.steps.some(s => s.method === 'eq' && s.args[0] === 'id');
      const data = table === 'teacher_catalogs' ? (missingTeacher ? null : { id: id(802), name: '요청 교사' }) : table === 'classroom_catalogs' ? [{ id: id(803), name: 'A' }] : table === 'profiles' ? { role: denied ? 'assistant' : role } : table === 'makeup_request_events' ? []
        : table === 'makeup_requests' && byId ? request : table === 'classes' && byId ? { id: id(600), name: '수업', subject: '영어', schedule_plan: {} }
        : table === 'classes' && collision ? [{ id: id(601), name: '다른 반', schedule: '금 09:00-10:00', classroom: 'A' }] : [];
      return { data, error: null };
    }).then(resolve, reject);
    return chain;
  }
  const client = { auth: { getUser: async () => ({ data: { user: { id: id(804) } }, error: null }) }, from: query,
    rpc(name, args) {
      const call = { name, args }; calls.push(call);
      if (name === 'get_makeup_effective_occupancy_v1') return {
        abortSignal(signal) { call.signal = signal; return this; },
        retry(value) { call.retry = value; return Promise.resolve(effectiveRead ? effectiveRead(args.p_slots, ++effectiveCalls) : { error: null, data: { version: 1, occupancies: collision ? [{ id: 'weekly', classId: id(601), className: '다른 반', date: '2026-10-02', startMinute: 540, endMinute: 600, classroom: 'A', uncertain: false, allRooms: false }] : [] } }); },
      };
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

const effectivePath = 'src/features/makeup-requests/makeup-effective-occupancy.ts';
const daySlot = (date, start = '09:00', end = '10:00') => ({ startAt: `${date}T${start}:00+09:00`, endAt: `${date}T${end}:00+09:00`, classroom: 'A' });
const occupancy = (date, patch = {}) => ({ id: 'same-weekly-id', classId: id(601), className: '다른 반', date, startMinute: 540, endMinute: 600, classroom: 'A', uncertain: false, allRooms: false, ...patch });
const spanSlots = () => Array.from({ length: 29 }, (_, i) => daySlot(new Date(Date.UTC(2026, 9, 1 + i)).toISOString().slice(0, 10)));

test('effective reads preserve arbitrary total slots, 14-day boundaries, duplicates and next-midnight/month crossings', () => {
  const { makeupEffectiveBatches: batches } = modules(null)(effectivePath);
  const makeupEffectiveBatches = slots => [...batches(slots)];
  const many = [...spanSlots(), ...Array.from({length: 2100}, () => daySlot('2026-10-01'))];
  assert.deepEqual(makeupEffectiveBatches(many).map(batch => batch.length), [14,14,1]);
  assert.deepEqual(makeupEffectiveBatches([daySlot('2026-10-01'),daySlot('2026-10-14')]).map(b => b.length), [2]);
  assert.deepEqual(makeupEffectiveBatches([daySlot('2026-10-01'),daySlot('2026-10-15')]).map(b => b.length), [1,1]);
  assert.deepEqual(makeupEffectiveBatches([{startAt:'2026-10-31T23:00:00+09:00',endAt:'2026-11-02T00:00:00+09:00'},daySlot('2026-11-01','13:00','14:00')]), [[
    {startAt:'2026-10-31T14:00:00.000Z',endAt:'2026-10-31T15:00:00.000Z'},
    {startAt:'2026-10-31T15:00:00.000Z',endAt:'2026-11-01T15:00:00.000Z'},
  ]]);
  assert.deepEqual(makeupEffectiveBatches([]), []);
  assert.equal(batches([{startAt:'1000-01-01T00:00:00.000Z',endAt:'9000-01-01T00:00:00.000Z'}]).next().value.length,14,'long supported intervals materialize only their first read batch');
  assert.throws(() => makeupEffectiveBatches([{startAt:'bad',endAt:'bad'}]), /window_invalid/);
});

test('effective batch union deduplicates exact rows while retaining weekly identities on different dates', async () => {
  const { readMakeupEffectiveSchedule } = modules(null)(effectivePath), calls = [];
  const result = await readMakeupEffectiveSchedule({ slots: [daySlot('2026-10-01'),daySlot('2026-10-15')], signal: new AbortController().signal,
    readBatch: async batch => { calls.push(batch); const date = calls.length === 1 ? '2026-10-01' : '2026-10-15'; return {data:{version:1,occupancies:[occupancy(date),occupancy(date)]},error:null}; },
  });
  assert.equal(calls.length,2); assert.deepEqual(result.occupancies.map(r=>r.date),['2026-10-01','2026-10-15']);
  for (const rows of [[occupancy('2026-10-02')],Array.from({length:2001},()=>occupancy('2026-10-01'))]) {
    await assert.rejects(readMakeupEffectiveSchedule({slots:[daySlot('2026-10-01')],signal:new AbortController().signal,readBatch:async()=>({data:{version:1,occupancies:rows},error:null})}),/response_invalid/);
  }
});

test('reservation context waits for every sequential chunk; partial failure or abort never publishes availability', async () => {
  for (const abort of [false,true]) {
    const io=transport({deferEffective:true}), service=modules(io.supabase)(servicePath), controller=new AbortController();
    const pending=service.readMakeupReservationContext({slots:spanSlots(),eventRequestIds:[id(900)],signal:controller.signal});
    let settled=false; pending.then(()=>{settled=true},()=>{settled=true});
    io.requests[0].resolve({data:{reservations:[],activeEventRequestIds:[id(900)]},error:null});
    const first=await io.waitFor('get_makeup_effective_occupancy_v1');
    assert.equal(io.requests.filter(r=>r.name==='get_makeup_effective_occupancy_v1').length,1);
    first.resolve({data:{version:1,occupancies:[]},error:null});
    const second=await io.waitFor('get_makeup_effective_occupancy_v1',2);
    assert.equal(settled,false); assert.equal(second.signal,first.signal); assert.equal(second.retry,false);
    if(abort)controller.abort();
    second.resolve({data:abort?{version:1,occupancies:[]}:null,error:abort?null:{code:'57014',message:'synthetic chunk failure'}});
    await assert.rejects(pending,error=>abort?error.name==='AbortError':error.code==='57014'&&error.message==='synthetic chunk failure');
    assert.equal(io.requests.filter(r=>r.name==='get_makeup_reservation_context_v1').length,1);
    assert.equal(io.requests.filter(r=>r.name==='get_makeup_effective_occupancy_v1').length,2,'no later chunk or retry');
  }
});

test('effective collision consumer rechecks envelope gaps, later days, fractional boundaries and unknown basics', () => {
  const {buildRoomAvailability}=modules(null)('src/features/makeup-requests/makeup-request-model.js');
  const check=(slots,rows)=>buildRoomAvailability({classrooms:[{name:'A'}],classes:[],requests:[],academicEvents:[],slots,effectiveSchedule:{version:1,occupancies:rows}})[0];
  assert.equal(check([daySlot('2026-10-01','09:00','10:00'),daySlot('2026-10-01','12:00','13:00')],[occupancy('2026-10-01',{startMinute:630,endMinute:660})]).available,true);
  assert.equal(check([{startAt:'2026-10-01T23:00:00+09:00',endAt:'2026-10-02T12:00:00+09:00'}],[occupancy('2026-10-02')]).available,false);
  assert.equal(check([{startAt:'2026-10-01T09:59:59.500+09:00',endAt:'2026-10-01T09:59:59.900+09:00'}],[occupancy('2026-10-01')]).available,false);
  assert.equal(check([daySlot('2026-10-01','10:00','11:00')],[occupancy('2026-10-01')]).available,true);
  assert.equal(check([daySlot('2026-10-01')],[occupancy('2026-10-01',{startMinute:null,endMinute:null,classroom:null,uncertain:true,allRooms:true})]).available,false);
});

test('approval keeps one request-context read and never saves after a late batch failure or true late-date conflict', async t => {
  const keys=['NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY'],previous=keys.map(key=>process.env[key]);
  keys.forEach(key=>process.env[key]=key.includes('URL')?'https://fixture.invalid':'fixture');
  t.after(()=>keys.forEach((key,i)=>previous[i]===undefined?delete process.env[key]:process.env[key]=previous[i]));
  for (const fail of [true,false]) {
    const fixture=routeFixture({kind:'makeup_only',makeupSlots:spanSlots(),effectiveRead:(_batch,n)=> n===2&&fail
      ? {data:null,error:{code:'57014',message:'synthetic chunk failure'}}
      : {data:{version:1,occupancies:n===3?[occupancy('2026-10-29')]:[]},error:null}});
    assert.notEqual((await fixture.run()).status,200);
    assert.equal(fixture.calls.filter(c=>c.name==='get_makeup_approval_collision_context_v1').length,1);
    assert.equal(fixture.calls.filter(c=>c.name==='get_makeup_effective_occupancy_v1').length,fail?2:3);
    assert.equal(fixture.calls.filter(c=>c.name==='transition_makeup_request_v2').length,1,'only initial idempotent replay probe; no save');
  }
});


test('completed request display excludes only its exact approved slots', async t => {
  const { hasMakeupRequestRoomCollision } = modules(null, { '@/providers/auth-provider': { useAuth: () => null } })('src/features/makeup-requests/makeup-request-workspace.tsx');
  const requestId = id(701), classId = id(702), otherRequestId = id(703), otherClassId = id(704);
  const room = 'Synthetic room';
  const slot = (date = '2026-10-15', start = '15:00', end = '17:00') => ({
    id: 'slot-1', startAt: `${date}T${start}:00+09:00`, endAt: `${date}T${end}:00+09:00`, classroom: room,
  });
  const request = (slots = [slot()]) => ({ id: requestId, classId, status: 'completed', makeupSlots: slots });
  const occupancy = (patch = {}) => ({
    id: `legacy-session:${classId}:makeup-request:${requestId}:0`,
    classId, className: 'Synthetic class', date: '2026-10-15',
    startMinute: 900, endMinute: 1020, classroom: room, uncertain: false, allRooms: false, ...patch,
  });
  const collision = (rows, { currentRequest = request(), reservations = [request()], academicEvents = [], ...options } = {}) => {
    const data = {
      classrooms: [{ name: room }], classes: [], requests: [currentRequest], academicEvents, collisionContextReady: true,
      reservationContext: { reservations, activeEventRequestIds: reservations.map(r => r.id), effectiveSchedule: { version: 1, occupancies: rows } },
      ...options,
    };
    const before = structuredClone(data);
    const result = hasMakeupRequestRoomCollision(currentRequest, data);
    assert.deepEqual(data, before, 'display filtering does not mutate the shared occupancy context');
    return result;
  };

  await t.test('completed display excludes its own exact lesson, request reservation, and calendar event', () => {
    for (const [date, start, end, startMinute, endMinute] of [
      ['2026-10-15', '15:00', '17:00', 900, 1020],
      ['2026-10-02', '21:30', '23:30', 1290, 1410],
      ['2026-10-03', '18:00', '20:00', 1080, 1200],
    ]) {
      const slots = [slot(date, start, end)];
      const ownEvent = { id: 'own-calendar', note: '[[TIPS_MAKEUP]] ' + JSON.stringify({
        kind: 'makeup', requestId, classroom: room, startAt: slots[0].startAt, endAt: slots[0].endAt,
      }) };
      assert.equal(collision([occupancy({ date, startMinute, endMinute })], {
        currentRequest: request(slots), reservations: [request(slots)], academicEvents: [ownEvent],
      }), false);
    }
  });

  await t.test('pending states, stale status, and missing class or reservation context retain blockers', () => {
    for (const status of ['approval_pending', 'makeup_pending', 'manager_pending', 'canceled']) {
      assert.equal(collision([occupancy()], { currentRequest: { ...request(), status } }), true, status);
      assert.equal(collision([occupancy()], { reservations: [{ ...request(), status }] }), true, `reservation ${status}`);
    }
    assert.equal(collision([occupancy()], { reservations: [] }), true);
    assert.equal(collision([occupancy()], { currentRequest: { ...request(), classId: '' } }), true);
    assert.equal(collision([occupancy()], { currentRequest: { ...request(), id: '' } }), true);
  });

  await t.test('every independent foreign lesson, request, and event still reports a conflict', () => {
    const foreign = occupancy({ id: `legacy-session:${classId}:makeup-request:${otherRequestId}:0` });
    const regular = occupancy({ id: `legacy-session:${classId}:ordinary-lesson` });
    const copiedToOtherClass = occupancy({ classId: otherClassId, id: `legacy-session:${otherClassId}:makeup-request:${requestId}:0` });
    for (const row of [foreign, regular, copiedToOtherClass]) {
      assert.equal(collision([occupancy(), row]), true, row.id);
    }
    const otherReservation = { ...request(), id: otherRequestId, status: 'approval_pending' };
    assert.equal(collision([occupancy()], { reservations: [request(), otherReservation] }), true);
    const otherEvent = { id: 'other-calendar-event', note: '[[TIPS_MAKEUP]] ' + JSON.stringify({
      kind: 'makeup', requestId: otherRequestId, classroom: room, startAt: slot().startAt, endAt: slot().endAt,
    }) };
    assert.equal(collision([occupancy()], { reservations: [request(), { ...otherReservation, makeupSlots: [] }], academicEvents: [otherEvent] }), true);
  });

  await t.test('uncertain, changed, or unbound lesson metadata stays a collision', () => {
    for (const patch of [
      { uncertain: true }, { allRooms: true }, { startMinute: null },
      { startMinute: 899 }, { endMinute: 1021 },
      { id: `legacy-session:${classId}:makeup-request:${requestId}:0:extra` },
      { id: `legacy-session:${classId}:makeup-request:${requestId}:00` },
      { id: `legacy-session:${classId}:makeup-request:${requestId}:1` },
      { id: `legacy-session:other-class:makeup-request:${requestId}:0` },
      { id: 'session:unbound-normalized-lesson' },
    ]) assert.equal(collision([occupancy(patch)]), true, JSON.stringify(patch));
    const moved = slot('2026-10-16');
    assert.equal(collision([occupancy()], { currentRequest: request([moved]), reservations: [request([moved])],
      reservationContext: { reservations: [request([moved])], activeEventRequestIds: [], effectiveSchedule: { version: 1, occupancies: [occupancy({ date: '2026-10-16', startMinute: 899 })] } },
    }), true);
  });

  await t.test('exact multi-slot identity and midnight work while the shared approval model remains conservative', () => {
    const slots = [slot(), { id: 'slot-2', startAt: '2026-10-16T14:00:00Z', endAt: '2026-10-16T15:00:00Z', classroom: room }];
    const rows = [occupancy(), occupancy({ id: `legacy-session:${classId}:makeup-request:${requestId}:1`, date: '2026-10-16', startMinute: 1380, endMinute: 1440 })];
    assert.equal(collision(rows, { currentRequest: request(slots), reservations: [request(slots)] }), false);
    const { buildRoomAvailability } = modules(null)('src/features/makeup-requests/makeup-request-model.js');
    assert.equal(buildRoomAvailability({ classrooms: [{ name: room }], requests: [request()], slots: [slot()], currentRequestId: requestId,
      effectiveSchedule: { version: 1, occupancies: [occupancy()] },
    })[0].available, false, 'API/shared model receives no display-only exclusion');
  });
});

function setup(t, testCase, options) {
  const fixture = actionFixture(testCase, options), previous = globalThis.fetch;
  globalThis.fetch = fixture.fetch;
  t.after(() => { globalThis.fetch = previous; });
  const service = loadActionService(fixture.client);
  return { ...fixture, run: (actor = id(804), note = '  합성 처리 메모  ') => service[testCase.method](id(1), actor, note) };
}
const mutations = fixture => fixture.calls.filter(call => call.name === 'transition_makeup_request_v2');
const notifications = fixture => fixture.calls.filter(call => call.kind === 'notification');

for (const testCase of actionCases) {
  test(`${testCase.method}: one authorized detail read preserves the committed response and labels`, async t => {
    const fixture = setup(t, testCase, { detail: { finalNote: '기존 처리 메모' }, committed: {
      schedule_plan_before: { sessions: [{ id: 'committed-original' }] },
      schedule_plan_after: { sessions: [{ id: 'committed-makeup' }] },
      makeup_academic_event_ids: [id(751), id(752)], updated_at: '2026-10-08T16:00:00Z',
    } });
    const result = await fixture.run();
    assert.equal(result.id, id(1)); assert.equal(result.status, testCase.after);
    assert.deepEqual(fixture.calls.map(call => call.name ?? call.kind), ['get_makeup_detail_v1', 'transition_makeup_request_v2', 'session', 'notification']);
    assert.equal(fixture.calls[0].retry, false); assert.ok(fixture.calls[0].signal instanceof AbortSignal);
    assert.deepEqual(fixture.calls[0].args, { p_id: id(1) });
    const [mutation] = mutations(fixture);
    assert.equal(mutation.args.p_makeup_request_id, id(1)); assert.equal(mutation.args.p_expected_status, testCase.before);
    assert.equal(mutation.args.p_command, testCase.command); assert.deepEqual(mutation.args.p_patch, { note: '합성 처리 메모' });
    assert.match(mutation.args.p_request_id, /^[0-9a-f-]{36}$/);
    assert.equal(result.requesterLabel, '합성 신청자'); assert.equal(result.teacherLabel, '합성 교사'); assert.equal(result.approverLabel, '합성 결재자');
    assert.deepEqual(result.schedulePlanBefore, { sessions: [{ id: 'committed-original' }] });
    assert.deepEqual(result.schedulePlanAfter, { sessions: [{ id: 'committed-makeup' }] });
    assert.deepEqual(result.makeupAcademicEventIds, [id(751), id(752)]); assert.equal(result.updatedAt, '2026-10-08T16:00:00Z');
    assert.equal(result.finalNote, '기존 처리 메모', 'these commands do not replace the existing final note');
    assert.deepEqual(result.events, [], 'mutation receipts retain the existing event contract; stale detail history is not copied');
    assert.equal(result.notificationWarning, undefined);
    if (testCase.command === 'approval_canceled') {
      assert.equal(result.canceledBy, id(804)); assert.equal(result.canceledByLabel, '합성 결재자');
      assert.equal(result.completedByLabel, '합성 관리자'); assert.equal(result.canceledAt, '2026-10-08T16:00:00Z');
    }
  });

  test(`${testCase.method}: fresh status and detail failures prevent every write and notification`, async t => {
    for (const options of [
      { detail: { status: 'rejected' } },
      { missing: true },
      { detail: { id: id(2) } },
      { detail: { events: null } },
      { detailError: { code: '42501', message: 'synthetic permission denied' } },
      { detailError: new DOMException('synthetic canceled read', 'AbortError') },
      ...(testCase.command === 'approval_canceled' ? [{ detail: { classId: '' } }] : []),
    ]) {
      await t.test(JSON.stringify(options), async t => {
        const fixture = setup(t, testCase, options);
        await assert.rejects(fixture.run());
        assert.equal(mutations(fixture).length, 0); assert.equal(notifications(fixture).length, 0);
        assert.equal(fixture.calls.filter(call => call.kind === 'table').length, 0, 'no broad fallback on denied or malformed detail');
      });
    }
  });

  test(`${testCase.method}: database rejection and invalid mutation receipts remain failures`, async t => {
    for (const options of [
      { mutationError: { code: '42501', message: 'synthetic authorization changed' } },
      { mutationError: { code: '23505', message: 'synthetic duplicate command' } },
      { mutationError: { code: 'P0001', message: 'synthetic stale state' } },
      { wire: { request: {}, sourceEventId: id(999) } },
      { wire: { request: { id: id(1) }, sourceEventId: '' } },
    ]) {
      await t.test(JSON.stringify(options), async t => {
        const fixture = setup(t, testCase, options);
        await assert.rejects(fixture.run(), options.mutationError ? error => error === options.mutationError : /저장 결과/);
        assert.equal(mutations(fixture).length, 1); assert.equal(notifications(fixture).length, 0);
      });
    }
  });

  test(`${testCase.method}: notification failures preserve the committed state and existing warning`, async t => {
    t.mock.method(console, 'warn', () => {});
    for (const options of [
      { notificationStatus: 503 }, { notificationThrow: true },
      { notificationBody: { ok: true, sent: 0, deduped: 0, failed: 1 } },
      { notificationBody: { ok: true } },
    ]) {
      await t.test(JSON.stringify(options), async t => {
        const fixture = setup(t, testCase, options), result = await fixture.run();
        assert.equal(result.status, testCase.after); assert.match(result.notificationWarning, /저장은 완료/);
        assert.equal(mutations(fixture).length, 1); assert.equal(notifications(fixture).length, 1);
      });
    }
  });

  test(`${testCase.method}: a repeated completed action rechecks state before writing`, async t => {
    const fixture = setup(t, testCase), first = await fixture.run();
    fixture.detail.status = first.status;
    await assert.rejects(fixture.run());
    assert.equal(fixture.calls.filter(call => call.name === 'get_makeup_detail_v1').length, 2);
    assert.equal(mutations(fixture).length, 1); assert.equal(notifications(fixture).length, 1);
  });

  test(`${testCase.method}: optional owners and shared profile identities keep display metadata separate`, async t => {
    for (const detail of [
      { requesterId: '', teacherProfileId: '', teacherCatalogId: '', approverTeacherCatalogId: '', approvedBy: '', completedBy: '', canceledBy: '' },
      { requesterId: id(804), teacherProfileId: id(804), teacherCatalogId: '', approverTeacherCatalogId: '' },
    ]) {
      await t.test(JSON.stringify(detail), async t => {
        const fixture = setup(t, testCase, { detail }), result = await fixture.run();
        assert.equal(result.requesterId, detail.requesterId); assert.equal(result.teacherProfileId, detail.teacherProfileId);
        assert.equal(result.requesterLabel, '합성 신청자'); assert.equal(result.teacherLabel, '합성 교사'); assert.equal(result.approverLabel, '합성 결재자');
        assert.equal(result.status, testCase.after);
      });
    }
  });
}

// Resubmit retains fresh form validation while narrowing its preflight reads.
test('resubmit reads exact detail and fresh validation catalogs without the full workspace', async () => {
  const fixture = resubmitFixture();
  const result = await fixture.run();
  assert.equal(result.status, 'approval_pending');
  const reads = fixture.calls.filter(call => call.kind === 'table' || call.name === 'get_makeup_detail_v1');
  assert.equal(reads.length, 5);
  assert.deepEqual(fixture.calls.filter(call => call.kind === 'table').map(call => call.table).sort(),
    ['class_lesson_sessions', 'classes', 'profiles', 'teacher_catalogs']);
  assert.equal(fixture.calls.filter(call => call.name === 'get_makeup_detail_v1').length, 1);
  assert.equal(mutations(fixture).length, 1);
  assert.equal(notifications(fixture).length, 1);
  const args = mutations(fixture)[0].args;
  assert.equal(args.p_command, 'resubmit');
  assert.equal(args.p_expected_status, 'revision_requested');
  assert.match(args.p_request_id, /^[a-f0-9-]{36}$/);
  assert.equal('status' in args.p_patch, false);
  assert.equal('requester_id' in args.p_patch, false);
  assert.equal(args.p_patch.approver_profile_id, id(804));
});

for (const status of ['revision_requested', 'makeup_pending']) {
  test('resubmit preserves the allowed requester transition from ' + status, async () => {
    const fixture = resubmitFixture({ detail: { status } });
    await fixture.run();
    assert.equal(mutations(fixture).length, 1);
    assert.equal(mutations(fixture)[0].args.p_expected_status, status);
    assert.equal(notifications(fixture).length, 1);
  });
}

for (const options of [
  ...['approval_pending', 'completed', 'rejected', 'canceled'].map(status => ({ detail: { status } })),
]) test('resubmit rejects an invalid processing state before mutation: ' + JSON.stringify(options), async () => {
  const fixture = resubmitFixture(options);
  await assert.rejects(fixture.run(), /재상신 권한/);
  assert.equal(mutations(fixture).length, 0);
  assert.equal(notifications(fixture).length, 0);
});

for (const table of ['profiles', 'teacher_catalogs', 'classes', 'class_lesson_sessions']) {
  test('resubmit stops on a failed fresh ' + table + ' read', async () => {
    const fixture = resubmitFixture({ tableErrors: { [table]: { code: '57014', message: 'synthetic read unavailable' } } });
    await assert.rejects(fixture.run(), /서버 응답이 지연되었습니다/);
    assert.equal(mutations(fixture).length, 0);
    assert.equal(notifications(fixture).length, 0);
  });
}

test('resubmit stops on failed or missing target detail', async () => {
  for (const options of [
    { detailError: { code: '57014', message: 'synthetic detail unavailable' }, singleError: { code: '57014', message: 'synthetic detail unavailable' } },
    { missing: true, singleError: { code: 'PGRST116', message: 'synthetic target missing' } },
  ]) {
    const fixture = resubmitFixture(options);
    await assert.rejects(fixture.run());
    assert.equal(mutations(fixture).length, 0);
    assert.equal(notifications(fixture).length, 0);
  }
});

test('resubmit validates the request creation year and the fresh actor role', async () => {
  const future = { detail: { createdAt: '2027-07-11T00:00:00.000Z' } };
  const teacher = resubmitFixture(future);
  await assert.rejects(teacher.run(), /선택할 수 없는 결재자/);
  assert.equal(mutations(teacher).length, 0);
  const manager = resubmitFixture({ ...future, actorRole: 'admin' });
  await manager.run();
  assert.equal(mutations(manager).length, 1);
  const originalYear = resubmitFixture({ detail: { createdAt: '2026-07-11T00:00:00.000Z' } });
  await originalYear.run();
  assert.equal(mutations(originalYear).length, 1);
});

for (const kind of ['teacherLink', 'approverLink', 'class', 'lessonSession']) {
  test('resubmit keeps fresh form validation before mutation: ' + kind, async () => {
    const fixture = resubmitFixture();
    if (kind === 'teacherLink') fixture.tables.teacher_catalogs[0].profile_id = '';
    if (kind === 'approverLink') fixture.tables.teacher_catalogs[1].profile_id = '';
    if (kind === 'class') fixture.input.classId = id(9999);
    if (kind === 'lessonSession') {
      fixture.tables.classes[0].schedule_storage_mode = 'normalized';
      fixture.input.originalLessonSessionId = id(9999);
    }
    await assert.rejects(fixture.run(), /계정 연결|수업을 선택|실제 수업 회차/);
    assert.equal(mutations(fixture).length, 0);
    assert.equal(notifications(fixture).length, 0);
  });
}

test('resubmit accepts the selected actual lesson session from fresh catalogs', async () => {
  const fixture = resubmitFixture();
  fixture.tables.classes[0].schedule_storage_mode = 'normalized';
  fixture.input.originalLessonSessionId = id(1000);
  await fixture.run();
  assert.equal(mutations(fixture)[0].args.p_patch.original_lesson_session_id, id(1000));
});

test('resubmit maps the committed receipt using fresh changed participant labels', async () => {
  const fixture = resubmitFixture({
    actorRole: 'admin', input: { classId: id(601), approverTeacherCatalogId: id(905) },
    committed: {
      class_id: id(601), class_name: '서버 확정 수업', teacher_catalog_id: id(902),
      teacher_profile_id: id(806), approver_teacher_catalog_id: id(905),
      approver_profile_id: id(807), updated_at: '2026-10-17T01:02:03Z',
    },
  });
  fixture.tables.profiles.push(
    { id: id(806), name: '변경 교사', role: 'teacher' },
    { id: id(807), name: '변경 결재자', role: 'teacher' },
  );
  fixture.tables.teacher_catalogs.push(
    { id: id(902), name: '변경 교사', profile_id: id(806) },
    { id: id(905), name: '변경 결재자', profile_id: id(807) },
  );
  fixture.tables.classes[1].teacher = '변경 교사';
  const result = await fixture.run();
  assert.equal(result.className, '서버 확정 수업');
  assert.equal(result.teacherProfileId, id(806));
  assert.equal(result.teacherLabel, '변경 교사');
  assert.equal(result.approverProfileId, id(807));
  assert.equal(result.approverLabel, '변경 결재자');
  assert.equal(result.updatedAt, '2026-10-17T01:02:03Z');
  assert.equal(mutations(fixture).length, 1);
  assert.equal(notifications(fixture).length, 1);
});

test('resubmit waits for notification completion without repeating the mutation', async () => {
  const gate = Promise.withResolvers();
  const fixture = resubmitFixture({ notificationGate: gate.promise });
  let settled = false;
  const pending = fixture.run().then(result => { settled = true; return result; });
  try {
    for (let tick = 0; tick < 20 && notifications(fixture).length === 0; tick++) {
      await new Promise(resolve => setImmediate(resolve));
    }
    assert.equal(notifications(fixture).length, 1);
    assert.equal(mutations(fixture).length, 1);
    assert.equal(settled, false);
  } finally {
    gate.resolve();
  }
  await pending;
  assert.equal(settled, true);
});

test('resubmit keeps the committed result and warning when notification fails', async () => {
  const fixture = resubmitFixture({ notificationStatus: 503 });
  const previous = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args);
  try {
    const result = await fixture.run();
    assert.equal(result.status, 'approval_pending');
    assert.match(result.notificationWarning, /저장은 완료/);
    assert.equal(warnings.length, 1);
    assert.equal(mutations(fixture).length, 1);
    assert.equal(notifications(fixture).length, 1);
  } finally {
    console.warn = previous;
  }
});

test('resubmit propagates a mutation conflict without notification or retry', async () => {
  const fixture = resubmitFixture({ mutationError: { code: 'P0001', message: 'makeup_request_stale_status' } });
  await assert.rejects(fixture.run(), error => error.code === 'P0001');
  assert.equal(mutations(fixture).length, 1);
  assert.equal(notifications(fixture).length, 0);
});

for (const role of ['teacher', 'assistant', 'viewer']) test(`operational approval rejects ${role} before replay, service reads or effects`, async t => {

 const keys=['NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY'];
 const before=keys.map(k=>process.env[k]);
 for(const key of keys) process.env[key]=key.includes('URL')?'https://fixture.invalid':'fixture';
 t.after(()=>keys.forEach((k,i)=>before[i]===undefined?delete process.env[k]:process.env[k]=before[i]));
 const p=routeFixture({role});
 const response=await p.run();
 assert.equal(response.status,403);
 assert.deepEqual(p.calls.map(c=>c.table||c.name),['profiles']);
});
for (const role of ['admin', 'staff']) test(`management ${role} processes another assigned approver without rewriting assignment`, async t => {

 const keys=['NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY'];
 const before=keys.map(k=>process.env[k]);
 for(const key of keys) process.env[key]=key.includes('URL')?'https://fixture.invalid':'fixture';
 t.after(()=>keys.forEach((k,i)=>before[i]===undefined?delete process.env[k]:process.env[k]=before[i]));
 const p=routeFixture({role,approverId:id(805)});
 const response=await p.run();
 assert.equal(response.status,200);
 const commands=p.calls.filter(c=>c.name==='transition_makeup_request_v2');
 assert.ok(commands.length>0);
 assert.equal(commands.at(-1).args.p_patch.actor_profile_id,id(804));
 assert.equal('approver_profile_id' in commands.at(-1).args.p_patch,false);
});

for (const testCase of actionCases) for (const approverProfileId of [id(806), '']) test(`${testCase.method}: server authorization still rejects a denied command after management state preflight`, async t => {
 const fixture=setup(t,testCase,{detail:{approverProfileId},mutationError:{code:'42501',message:'synthetic actual server role denied'}});
 await assert.rejects(fixture.run());
 assert.equal(mutations(fixture).length,1);
 assert.equal(notifications(fixture).length,0);
 assert.equal('approver_profile_id' in mutations(fixture)[0].args.p_patch,false);
});
test('management resubmission can keep the original requester instead of impersonating it', async()=>{
 const fixture=resubmitFixture({actorId:id(805),actorRole:'staff'});
 await fixture.run();
 assert.equal(mutations(fixture).length,1);
 assert.equal('requester_id' in mutations(fixture)[0].args.p_patch,false);
});

for (const role of ['teacher', 'assistant', 'viewer']) test(`legacy makeup follow-up rejects ${role} before service construction and body parsing`, async t => {
  const keys = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
  const before = keys.map(key => process.env[key]);
  keys.forEach(key => process.env[key] = key.includes('URL') ? 'https://fixture.invalid' : 'fixture');
  t.after(() => keys.forEach((key, index) => before[index] === undefined ? delete process.env[key] : process.env[key] = before[index]));
  const calls = [];
  const client = { auth: { getUser: async () => ({ data: { user: { id: id(804) } }, error: null }) },
    from(table) { calls.push(table); assert.equal(table, 'profiles'); return { select(value) { assert.equal(value, 'role'); return this; }, eq(key, value) { assert.equal(key, 'id'); assert.equal(value, id(804)); return this; }, single: async () => ({ data: { role }, error: null }) }; },
  };
  let constructions = 0;
  const { POST } = modules(null, { '@supabase/supabase-js': { createClient() { constructions++; assert.equal(constructions, 1, 'no service client before rejecting role'); return client; } } })('src/app/api/notifications/legacy/makeup/route.ts');
  const response = await POST(new Request('https://fixture.invalid/api/notifications/legacy/makeup', { method: 'POST', headers: { authorization: 'Bearer fixture' }, body: '{invalid-json' }));
  assert.equal(response.status, 403); assert.equal(constructions, 1); assert.deepEqual(calls, ['profiles']);
});
