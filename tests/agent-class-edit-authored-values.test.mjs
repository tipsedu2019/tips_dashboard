import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classWorkspace, compileClassEdit } from '../src/features/agent-api/server/class-edit-compiler.mjs';
import { createAgentEditApiHandler } from '../src/features/agent-api/server/http-v2.ts';
import { id, window, timing, monday, fixture } from './fixtures/agent-class-edit-fixture.mjs';

// Captured by the independent P4 review from an isolated synthetic database.
// Reusing its actual producer DTOs is a consumer regression, not a new DB run.
const cases = JSON.parse(readFileSync(new URL('./fixtures/agent-class-edit-authored-db-contexts.json', import.meta.url), 'utf8'));
for (const c of cases) {
  test(`real SQL context -> API must preserve ${c.case}`, () => {
    const result = classWorkspace(c.context, { from: '2026-10-21', to: '2026-10-21' });
    const lesson = result.lessons.find(row => row.id === 'ordinary');
    const operating = [...c.operating.dated, ...c.operating.unresolved][0];
    assert.ok(lesson && operating, 'real DB context and real operating row must both exist');
    const field = c.case === 'explicit-null-room' ? 'classroomId' : 'teacherId';
    assert.equal(lesson[field], operating[field]);
  });
}

const fields = { startTime: 'startMinute', endTime: 'endMinute', teacherCatalogId: 'teacherId', classroomCatalogId: 'classroomId' };
const mapValues = { startTime: '12:00', endTime: '13:00', teacherCatalogId: id(7), classroomCatalogId: id(8) };
const projectedMap = { startMinute: 720, endMinute: 780, teacherId: id(7), classroomId: id(8) };
function authored() {
  const context = fixture();
  context.catalogs.teachers.push({ id: id(7), name: 'Map teacher', isVisible: true });
  context.catalogs.classrooms.push({ id: id(8), name: 'Map room', isVisible: true });
  context.plan.sessionSchedules[monday[0]] = { ...mapValues };
  return context;
}
const lesson = context => classWorkspace(context, window).lessons.find(row => row.date === monday[0]);
for (const [raw, dto] of Object.entries(fields)) {
  for (const empty of [null, '']) test(`${raw} explicit ${JSON.stringify(empty)} suppresses map and basic inheritance`, () => {
    const context = authored(), before = structuredClone(context);
    context.plan.sessions[0][raw] = empty;
    const input = structuredClone(context);
    assert.equal(lesson(context)[dto], null);
    assert.deepEqual(context, input, 'projection must not change authored JSON');
    delete context.plan.sessions[0][raw];
    assert.equal(lesson(context)[dto], projectedMap[dto], 'absent fields inherit the date map');
    delete context.plan.sessionSchedules[monday[0]];
    assert.equal(lesson(context)[dto], timing[dto], 'absence of both fields inherits the basic slot');
    assert.deepEqual(context, { ...before, plan: { ...before.plan, sessionSchedules: {} } });
  });
}
test('resource IDs and names use the same map/group precedence as the lesson editor', () => {
  const context = authored(), row = context.plan.sessions[0];
  row.teacherName = 'T'; row.classroomName = 'R';
  assert.equal(lesson(context).teacherId, id(7)); assert.equal(lesson(context).classroomId, id(8));
  context.plan.sessionSchedules[monday[0]] = { teacherName: '', classroomName: null };
  assert.equal(lesson(context).teacherId, null); assert.equal(lesson(context).classroomId, null);
  context.plan.sessionSchedules[monday[0]] = { teacherName: 'Map teacher', classroomName: 'Map room' };
  assert.equal(lesson(context).teacherId, id(7)); assert.equal(lesson(context).classroomId, id(8));
  row.teacherCatalogId = ''; row.classroomCatalogId = null;
  assert.equal(lesson(context).teacherId, null); assert.equal(lesson(context).classroomId, null);
  delete row.teacherCatalogId; delete row.classroomCatalogId;
  context.plan.sessionSchedules[monday[0]] = { memo: 'not a resource override' };
  assert.equal(lesson(context).teacherId, id(1)); assert.equal(lesson(context).classroomId, id(2));
  delete context.plan.sessionSchedules[monday[0]];
  row.teacherName = 'unknown'; row.classroomName = 'unknown';
  assert.equal(lesson(context).teacherId, null); assert.equal(lesson(context).classroomId, null);
});
test('shared date fallback preserves separate IDs and explicit empty resources', () => {
  const context = authored(), first = context.plan.sessions[0];
  first.classroomCatalogId = null;
  context.plan.sessions.push({ ...first, id: id(99), classroomCatalogId: id(2), teacherCatalogId: '' });
  const rows = classWorkspace(context, window).lessons.filter(row => row.date === first.date);
  assert.equal(rows.length, 2);
  assert.equal(rows.find(row => row.id === first.id).classroomId, null);
  assert.equal(rows.find(row => row.id === id(99)).classroomId, id(2));
  assert.equal(rows.find(row => row.id === id(99)).teacherId, null);
});
test('cancelled, skipped and undecided display keeps authored timing without reviving occupancy', () => {
  for (const state of ['exception', 'skipped', 'tbd']) {
    const context = authored(), row = context.plan.sessions[0];
    Object.assign(row, { state, scheduleState: state, classroomCatalogId: null });
    const result = lesson(context);
    assert.equal(result.state, { exception: 'cancelled', skipped: 'skipped', tbd: 'undecided' }[state]);
    assert.equal(result.startMinute, 720); assert.equal(result.endMinute, 780); assert.equal(result.classroomId, null);
    assert.equal(row.state, state);
  }
});
test('state-only edits preserve own empty values and omitted fields, maps, IDs and private content', () => {
  for (const empty of [null, '']) {
    const context = authored(), row = context.plan.sessions[0];
    Object.assign(row, { endTime: empty, teacherCatalogId: empty, classroomCatalogId: empty });
    const before = structuredClone(context.plan);
    const command = compileClassEdit(context, { expectedVersion: context.version, window, reason: 'preservation', lessons: [{ date: row.date, state: 'cancelled' }] });
    const after = command.patch.schedule_plan.sessions.find(item => item.id === row.id);
    for (const key of [...Object.keys(fields), 'teacherName', 'classroomName']) {
      assert.equal(Object.hasOwn(after, key), Object.hasOwn(row, key), `presence of ${key}`);
      assert.equal(after[key], row[key], `value of ${key}`);
    }
    assert.equal(after.teacherNote, row.teacherNote); assert.equal(after.state, 'exception');
    assert.deepEqual(command.patch.schedule_plan.sessionSchedules, before.sessionSchedules);
    for (const other of before.sessions.slice(1)) assert.deepEqual(command.patch.schedule_plan.sessions.find(item => item.id === other.id), other);
    assert.deepEqual(context.plan, before);
  }
});
test('an explicit timing edit replaces only the requested lesson timing', () => {
  const context = authored(), row = context.plan.sessions[0];
  Object.assign(row, { teacherCatalogId: '', classroomCatalogId: null });
  const command = compileClassEdit(context, { expectedVersion: context.version, window, reason: 'explicit timing', lessons: [{ date: row.date, state: 'scheduled', timing }] });
  const after = { ...context, plan: command.patch.schedule_plan };
  for (const [key, value] of Object.entries(timing)) assert.equal(lesson(after)[key], value);
  assert.equal(after.plan.sessions.find(item => item.id === row.id).teacherNote, row.teacherNote);
});

const token = 'tips_agent_' + 'c'.repeat(64);
function req(path, body, headers = {}) {
  return new Request('https://tips.test/api/v2/' + path, { method: body ? 'POST' : 'GET', headers: { authorization: 'Bearer ' + token, ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
}
for (const c of cases) test(`HTTP GET/preview/commit/re-read retain ${c.case}`, async () => {
  const context = structuredClone(c.context), w = { from: '2026-10-21', to: '2026-10-21' }, calls = [];
  context.plan.privateNote = 'SECRET';
  const after = { ...context, version: 'b'.repeat(64), basic: { ...context.basic, name: 'Edited basic name' } };
  const run = createAgentEditApiHandler({ enabled: () => true, rpc: async (_name, input) => {
    calls.push(input.p_action);
    if (input.p_action === 'preview') assert.deepEqual(input.p_input.command.patch, { name: after.basic.name }, 'a basic edit must not regenerate lessons');
    return { error: null, data: { data: input.p_action === 'context' ? context : input.p_action === 'preview'
      ? { previewToken: id(10), expiresAt: '2099-10-01', beforeContext: context, afterContext: after, window: w }
      : { operationId: id(11), state: 'applied', classContext: after, window: w } } };
  } });
  const query = `classes/${context.id}?from=${w.from}&to=${w.to}`;
  const get = await run(req(query), ['classes', context.id]); assert.equal(get.status, 200); const getData = (await get.json()).data;
  const preview = await run(req(`classes/${context.id}/changes/preview`, { expectedVersion: context.version, window: w, reason: 'synthetic basic edit', basic: { name: after.basic.name } }), ['classes', context.id, 'changes', 'preview']);
  assert.equal(preview.status, 200); const previewData = (await preview.json()).data;
  const commit = await run(req('operations', { previewToken: id(10) }, { 'Idempotency-Key': id(11) }), ['operations']);
  assert.equal(commit.status, 200); const commitData = (await commit.json()).data;
  const reread = await run(req('operations/' + id(11)), ['operations', id(11)]); assert.equal(reread.status, 200); const rereadData = (await reread.json()).data;
  const field = c.case === 'explicit-null-room' ? 'classroomId' : 'teacherId';
  for (const workspace of [getData, previewData.before, previewData.after, commitData.class, rereadData.class]) {
    assert.equal(workspace.lessons.find(row => row.id === 'ordinary')[field], null);
    assert.doesNotMatch(JSON.stringify(workspace), /SECRET|Context|catalogs|"plan"/);
  }
  assert.equal(getData.verificationHash, previewData.before.verificationHash);
  assert.equal(previewData.after.verificationHash, commitData.class.verificationHash);
  assert.equal(commitData.class.verificationHash, rereadData.class.verificationHash);
  assert.deepEqual(calls, ['context', 'context', 'preview', 'commit', 'operation']);
});
