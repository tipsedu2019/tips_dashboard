import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import { api } from '../scripts/qa/class-workflow-fixture-server.mjs';

async function request(path, args = {}) {
  const req = Readable.from([JSON.stringify(args)]);
  Object.assign(req, { url: path, method: 'POST' });
  let status;
  let body;
  await api(req, {
    writeHead(value) { status = value; },
    end(value) { body = JSON.parse(value); },
  });
  return { status, body };
}

test('independent fixture scenarios restore initial classes and reset save failure attempts', async () => {
  const classId = '00000000-0000-4000-8000-000000000201';
  const detail = () => request('/rest/v1/rpc/get_management_detail_v1', { p_kind: 'classes', p_id: classId });
  await request('/__control', { mode: 'normal' });
  const initial = (await detail()).body.record;
  assert.equal(initial.name, '합성긴수업명'.repeat(10));
  assert.equal((await request('/rest/v1/classes', { id: classId, name: '이전 시나리오', fee: 1, staleField: true })).status, 200);
  assert.equal((await detail()).body.record.name, '이전 시나리오');

  await request('/__control', { mode: 'partial' });
  const partial = (await detail()).body;
  assert.deepEqual(partial.record, initial, 'a new scenario restores every field and removes prior extra fields');
  assert.equal(partial.registeredStudents.rows.length, 2);
  assert.equal((await request('/__evidence')).body.saveAttempts, 0);

  await request('/__control', { mode: 'save-error' });
  assert.equal((await request('/rest/v1/classes', { id: classId, name: '재시도' })).status, 500);
  assert.deepEqual((await detail()).body.record, initial);
  assert.equal((await request('/rest/v1/classes', { id: classId, name: '재시도' })).status, 200);
  assert.equal((await detail()).body.record.name, '재시도');

  await request('/__control', { mode: 'save-error' });
  assert.deepEqual((await detail()).body.record, initial);
  assert.equal((await request('/rest/v1/classes', { id: classId, name: '새 시나리오' })).status, 500);
});
