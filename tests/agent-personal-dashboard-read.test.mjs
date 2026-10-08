import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { createPersonalDashboardReadHandler, isPersonalDashboardReadAuthorization } from '../src/features/agent-api/server/personal-dashboard-read.ts';
import { createAgentEditApiHandler } from '../src/features/agent-api/server/http-v2.ts';
import { fixture, window } from './fixtures/agent-class-edit-fixture.mjs';
import { authenticateAiAgent } from '../src/features/ai-agent/server/ai-agent-auth.ts';

const id = value => `b5100000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const token = 'tips_dashboard_personal_' + 'd'.repeat(64);
const classId = id(10), schoolId = id(20), ownerId = id(2);
const request = (path, method = 'GET', bearer = token) => new Request('https://synthetic.invalid/api/agent/v2/' + path, { method, headers: { authorization: 'Bearer ' + bearer } });
const classPath = () => `classes/${classId}?from=2099-10-01&to=2099-10-07`;
function classContext() {
  return { id: classId, version: 'a'.repeat(64), basic: { name: '합성 본인 수업', classType: '정규', subject: '영어', subjectAreaKey: null, grade: '중1' },
    storageMode: 'normalized', schedule: '', weeklySlots: [{ id: id(30), weekday: 1, startMinute: 600, endMinute: 660, teacherId: id(3), classroomId: id(4), sortOrder: 0 }],
    plan: {}, sessions: [], catalogs: { teachers: [], classrooms: [] }, weeklyScheduleComplete: true };
}
function harness() {
  const state = { ownerId, ownerRole: 'teacher', ownerDeleted: false, ownerBanned: false, issuerRole: 'admin', issuerActive: true,
    assignedOwner: ownerId, reciprocal: true, scopes: ['class-details:read', 'calendar:read'], classIds: [classId], schoolIds: [schoolId] };
  const calls = [];
  // Synthetic producer, separate from the draft SQL. Mutable current authority
  // verifies fresh HTTP dispatch/retry contracts; it is not actual RLS evidence.
  const rpc = async (name, args) => {
    calls.push({ name, args: structuredClone(args) });
    assert.equal(name, 'agent_personal_dashboard_read_v1');
    assert.equal(args.p_token_hash, createHash('sha256').update(token).digest('hex'));
    const forbidden = message => ({ data: null, error: { code: '42501', message } });
    if (!state.ownerId || state.ownerRole !== 'teacher' || state.ownerDeleted || state.ownerBanned || !state.reciprocal || state.issuerRole !== 'admin' || !state.issuerActive) return forbidden('agent_forbidden');
    const action = args.p_action;
    const scope = action === 'class_context' ? 'class-details:read' : 'calendar:read';
    if (!state.scopes.includes(scope)) return forbidden('agent_scope_forbidden');
    let resource, context;
    if (action === 'class_context') {
      if (!state.classIds.includes(args.p_input.classId) || state.assignedOwner !== state.ownerId) return forbidden('agent_scope_forbidden');
      resource = { kind: 'class', id: args.p_input.classId }; context = classContext();
    } else if (action === 'calendar_context') {
      if (!state.schoolIds.includes(args.p_input.schoolId)) return forbidden('agent_scope_forbidden');
      resource = { kind: 'calendar', id: args.p_input.schoolId, schoolYear: args.p_input.schoolYear };
      context = { school: { id: schoolId, name: '합성 학교', category: '중학교' }, schoolYear: args.p_input.schoolYear, version: 'a'.repeat(64), scienceAreas: [],
        events: [{ id: id(21), title: '공용 학사 일정', type: '시험기간', date: '2099-10-04', grade: 'all' }] };
    } else {
      assert.equal(action, 'schools'); resource = { kind: 'schools' };
      context = { items: state.schoolIds.length ? [{ id: schoolId, name: '합성 학교', category: '중학교' }] : [], total: state.schoolIds.length ? 1 : 0, page: args.p_input.page, pageSize: 20 };
    }
    return { error: null, data: { data: { authorization: { credentialId: id(1), credentialKind: 'personal_dashboard_read', ownerProfileId: state.ownerId, ownerRole: state.ownerRole, scope }, resource, context } } };
  };
  return { state, calls, rpc, run: createPersonalDashboardReadHandler({ enabled: () => true, rpc }) };
}
test('separate personal family reads an assigned class without owner override, students, or write capabilities', async () => {
  const h = harness(), res = await h.run(request(classPath()), ['classes', classId]);
  assert.equal(res.status, 200); assert.match(res.headers.get('cache-control'), /no-store/);
  const data = (await res.json()).data;
  assert.equal(data.id, classId); assert.equal(data.capabilities.readOnly, true); assert.equal(data.capabilities.basic, false);
  assert.equal(data.capabilities.existingWeeklySlots, false); assert.equal(data.capabilities.datedLessons, false);
  assert.ok(!('authorization' in data) && !('plan' in data) && !('catalogs' in data));
  assert.deepEqual(h.calls[0].args.p_input, { classId });
  assert.ok(!JSON.stringify(data).includes(ownerId));
});
test('shared school metadata requires a separate calendar scope and explicit school grant', async () => {
  const h = harness();
  let res = await h.run(request(`calendar/schools/${schoolId}?schoolYear=2099`), ['calendar', 'schools', schoolId]);
  assert.equal(res.status, 200);
  const data = (await res.json()).data;
  assert.equal(data.capabilities.readOnly, true); assert.equal(data.capabilities.commit, false); assert.equal(data.events[0].source, null);
  assert.ok(!('note' in data.events[0]));
  h.state.schoolIds = []; res = await h.run(request(`calendar/schools/${schoolId}?schoolYear=2099`), ['calendar', 'schools', schoolId]);
  assert.equal(res.status, 403); assert.equal((await res.json()).data, null);
});
test('school listing retains bounded page identity and exposes only granted school metadata', async () => {
  const h = harness(), res = await h.run(request('calendar/schools?search=합성&page=1'), ['calendar', 'schools']);
  assert.equal(res.status, 200); assert.deepEqual((await res.json()).data, { items: [{ id: schoolId, name: '합성 학교', category: '중학교' }], total: 1, page: 1, pageSize: 20 });
});
for (const [label, change] of [
  ['other teacher assignment', state => { state.assignedOwner = id(99); }],
  ['removed assignment', state => { state.assignedOwner = null; }],
  ['role loss', state => { state.ownerRole = 'viewer'; }],
  ['promotion is not inferred authority', state => { state.ownerRole = 'admin'; }],
  ['deleted owner', state => { state.ownerDeleted = true; }],
  ['banned owner', state => { state.ownerBanned = true; }],
  ['missing stored owner', state => { state.ownerId = null; }],
  ['broken reciprocal catalog link', state => { state.reciprocal = false; }],
  ['issuer downgrade', state => { state.issuerRole = 'teacher'; }],
  ['inactive issuer', state => { state.issuerActive = false; }],
  ['removed class grant', state => { state.classIds = []; }],
  ['removed scope', state => { state.scopes = ['ai-requests:read']; }],
]) test('fresh read retry denies ' + label + ' without replaying accepted data', async () => {
  const h = harness(); assert.equal((await h.run(request(classPath()), ['classes', classId])).status, 200);
  change(h.state); const res = await h.run(request(classPath()), ['classes', classId]);
  assert.equal(res.status, 403); assert.equal((await res.json()).data, null); assert.equal(h.calls.length, 2);
});
test('another class UUID cannot use an issuing administrator or a grant for the original class', async () => {
  const h = harness(); const res = await h.run(request(`classes/${id(99)}?from=2099-10-01&to=2099-10-07`), ['classes', id(99)]);
  assert.equal(res.status, 403); assert.equal((await res.json()).data, null);
});
test('personal family writes and unrelated APIs reject before any RPC', async () => {
  const h = harness();
  for (const [path, parts, method] of [
    [`classes/${classId}/changes/preview`, ['classes', classId, 'changes', 'preview'], 'POST'],
    [`classes/${classId}/catalogs`, ['classes', classId, 'catalogs'], 'GET'],
    ['operations', ['operations'], 'POST'], ['operations/' + id(8), ['operations', id(8)], 'GET'],
    ['calendar/changes/preview', ['calendar', 'changes', 'preview'], 'POST'], ['ai-agent/requests', ['ai-agent', 'requests'], 'GET'],
    ['chat/send', ['chat', 'send'], 'POST'], ['students/' + id(9), ['students', id(9)], 'GET'], ['health', ['health'], 'GET'],
  ]) assert.equal((await h.run(request(path, method), parts)).status, 403);
  assert.equal(h.calls.length, 0);
});
test('caller identity, query duplication, invalid dates and unknown fields never reach RPC', async () => {
  const h = harness();
  for (const tail of ['&ownerProfileId=' + id(99), '&issuerProfileId=' + id(99), '&classIds=' + classId, '&from=2099-10-01', '&unknown=x']) {
    assert.equal((await h.run(request(classPath() + tail), ['classes', classId])).status, 400);
  }
  assert.equal((await h.run(request(`classes/${classId}?from=2099-12-01&to=2099-10-01`), ['classes', classId])).status, 400);
  assert.equal(h.calls.length, 0);
});
test('central and inbox key strings cannot be silently converted; malformed personal family stays on the personal dispatch', async () => {
  const h = harness();
  for (const bearer of ['tips_agent_' + 'd'.repeat(64), 'tips_dashboard_personal_bad', 'tips_dashboard_personal_' + 'D'.repeat(64)]) {
    assert.equal((await h.run(request(classPath(), 'GET', bearer), ['classes', classId])).status, 401);
  }
  assert.equal(h.calls.length, 0);
  assert.equal(isPersonalDashboardReadAuthorization(request(classPath(), 'GET', 'tips_dashboard_personal_bad')), true);
  assert.equal(isPersonalDashboardReadAuthorization(request(classPath(), 'GET', 'tips_agent_' + 'd'.repeat(64))), false);
});
test('general personal keys are rejected locally by the inbox auth boundary without reaching Auth or bot RPC', async () => {
  let calls = 0;
  const dependencies = { employeeClient: () => { calls++; throw new Error('unexpected Auth dispatch'); }, botRpc: async () => { calls++; } };
  for (const bearer of [token, 'tips_dashboard_personal_bad']) {
    await assert.rejects(authenticateAiAgent(request(classPath(), 'GET', bearer), dependencies), error => error.status === 401);
  }
  assert.equal(calls, 0);
});
for (const [label, mutate] of [
  ['wrong producer kind', data => { data.kind = 'central'; }],
  ['central credential proof', data => { data.authorization.credentialKind = 'central'; }],
  ['inbox credential proof', data => { data.authorization.credentialKind = 'personal'; }],
  ['missing owner proof', data => { delete data.authorization.ownerProfileId; }],
  ['issuer proof injection', data => { data.authorization.issuerProfileId = id(98); }],
  ['admin identity proof', data => { data.authorization.ownerRole = 'admin'; }],
  ['scope mismatch', data => { data.authorization.scope = 'calendar:read'; }],
  ['resource mismatch', data => { data.resource.id = id(99); }],
  ['missing resource kind', data => { delete data.resource.kind; }],
  ['wrong resource kind', data => { data.resource.kind = 'central'; }],
  ['class context mismatch', data => { data.context.id = id(99); }],
  ['student in basic', data => { data.context.basic.student = 'SYNTHETIC_PRIVATE_STUDENT'; }],
  ['roster in context', data => { data.context.student_ids = ['SYNTHETIC_PRIVATE_STUDENT']; }],
  ['private plan', data => { data.context.plan.privateNote = 'SYNTHETIC_PRIVATE_STUDENT'; }],
]) test('strict producer rejects ' + label + ' without private data in the response', async () => {
  const h = harness(); const run = createPersonalDashboardReadHandler({ enabled: () => true, rpc: async (...args) => {
    const result = await h.rpc(...args); mutate(result.data.data); return result;
  } });
  const res = await run(request(classPath()), ['classes', classId]); assert.equal(res.status, 503);
  const body = await res.text(); assert.ok(!body.includes('SYNTHETIC_PRIVATE_STUDENT') && !body.includes(token));
});
test('calendar year, source and raw note producer drift are rejected', async () => {
  for (const mutate of [data => { data.resource.schoolYear++; }, data => { data.context.schoolYear++; },
    data => { data.context.events[0].note = 'SYNTHETIC_PRIVATE_STUDENT'; }, data => { data.context.events[0].source = { student: 'SYNTHETIC_PRIVATE_STUDENT' }; }]) {
    const h = harness(), run = createPersonalDashboardReadHandler({ enabled: () => true, rpc: async (...args) => { const result = await h.rpc(...args); mutate(result.data.data); return result; } });
    const res = await run(request(`calendar/schools/${schoolId}?schoolYear=2099`), ['calendar', 'schools', schoolId]);
    assert.equal(res.status, 503); assert.ok(!(await res.text()).includes('SYNTHETIC_PRIVATE_STUDENT'));
  }
});
test('unknown database and transport errors are redacted; disabled handler does not call RPC', async () => {
  let calls = 0;
  for (const rpc of [async () => { throw new Error('SYNTHETIC_PRIVATE_STUDENT'); }, async () => ({ data: null, error: { code: 'XX000', message: 'SYNTHETIC_PRIVATE_STUDENT' } })]) {
    const res = await createPersonalDashboardReadHandler({ enabled: () => true, rpc })(request(classPath()), ['classes', classId]);
    assert.equal(res.status, 503); assert.ok(!(await res.text()).includes('SYNTHETIC_PRIVATE_STUDENT'));
  }
  assert.equal((await createPersonalDashboardReadHandler({ enabled: () => false, rpc: async () => { calls++; } })(request(classPath()), ['classes', classId])).status, 503);
  assert.equal(calls, 0);
});
test('typed current authorization, rate and input faults retain private no-store HTTP responses', async () => {
  for (const [code, message, status] of [['28000', 'agent_unauthorized', 401], ['42501', 'agent_forbidden', 403], ['54000', 'agent_rate_limited', 429], ['22023', 'invalid private detail', 422]]) {
    const run = createPersonalDashboardReadHandler({ enabled: () => true, rpc: async () => ({ data: null, error: { code, message } }) });
    const res = await run(request(classPath()), ['classes', classId]); assert.equal(res.status, status);
    assert.match(res.headers.get('cache-control'), /no-store/); assert.ok(!(await res.text()).includes('invalid private detail'));
    if (status === 429) assert.equal(res.headers.get('retry-after'), '60');
  }
});
test('legacy central class handler continues to use its own RPC and projection', async () => {
  const context = fixture('normalized'), calls = [];
  const run = createAgentEditApiHandler({ enabled: () => true, rpc: async (name, args) => { calls.push({ name, args }); return { error: null, data: { data: context } }; } });
  const res = await run(request(`classes/${context.id}?from=${window.from}&to=${window.to}`, 'GET', 'tips_agent_' + 'c'.repeat(64)), ['classes', context.id]);
  assert.equal(res.status, 200); assert.equal(calls[0].name, 'agent_api_v2'); assert.equal(calls[0].args.p_action, 'context');
});
