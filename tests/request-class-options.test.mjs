import test from 'node:test';
import assert from 'node:assert/strict';
import { loadNotificationComponent } from './helpers/notification-component-loader.mjs';

const rows = [
  { id: 'active', name: '가상 진행 수업', status: '수강' },
  { id: 'ended', name: '가상 종강 수업', status: '종강', start_date: '1999-01-01', end_date: '2000-01-01' },
  { id: 'ready', name: '가상 준비 수업', status: '개강 예정' },
  { id: 'unknown', name: '가상 기존 수업' },
];
test('request choices exclude only known ended status and preserve selected identity without mutating catalogs', () => {
  const { requestClassOptions } = loadNotificationComponent('src/lib/request-class-options.ts');
  const before = structuredClone(rows);
  assert.deepEqual(requestClassOptions(rows).map(item => item.id), ['active', 'ready', 'unknown']);
  assert.deepEqual(requestClassOptions(rows, 'ended'), rows);
  assert.equal(requestClassOptions(rows, 'ended')[1], rows[1]);
  assert.deepEqual(requestClassOptions([{ id: 'trim', status: ' 종강 ' }]), []);
  assert.deepEqual(rows, before);
});
function client() {
  const calls = [];
  return { calls, from(table) {
    const call = { table, select: '' }; calls.push(call);
    const result = Promise.resolve({ data: table === 'classes' ? structuredClone(rows) : [], error: null });
    const query = { then: result.then.bind(result), select(columns) { call.select = columns; return query; } };
    for (const name of ['order', 'abortSignal', 'retry', 'in', 'eq', 'limit']) query[name] = () => query;
    return query;
  } };
}
for (const domain of ['ops', 'makeup']) test(`${domain} authorized catalog preserves status and retains ended rows for history`, async () => {
  const supabase = client();
  const path = domain === 'ops' ? 'src/features/tasks/ops-task-service.ts' : 'src/features/makeup-requests/makeup-request-service.ts';
  const api = loadNotificationComponent(path, new Map([['@/lib/supabase', { supabase }]]));
  const result = domain === 'ops' ? await api.loadOpsTaskWorkspaceOptionData({ viewerRole: 'admin', taskType: 'withdrawal', force: true }) : await api.loadMakeupFormCatalogs();
  assert.deepEqual(result.classes.map(item => [item.id, item.status]), rows.map(item => [item.id, item.status || '']));
  assert.equal(result.classes[1].startDate, '1999-01-01'); assert.equal(result.classes[1].endDate, '2000-01-01');
  assert.ok(supabase.calls.filter(call => call.table === 'classes').every(call => call.select.split(',').includes('status')));
});

test('date-derived request status matches class management without overriding explicit state', () => {
  const { requestClassOptions } = loadNotificationComponent('src/lib/request-class-options.ts');
  const { normalizeClassManagementRecord } = loadNotificationComponent('src/features/management/records.js');
  const examples = [
    { id: 'past', status: '', end_date: '2000-01-01' },
    { id: 'legacy', status: 'unknown', end_date: '2000-01-01' },
    { id: 'future', status: '', start_date: '2100-01-01', end_date: '2000-01-01' },
    { id: 'explicit', status: '수강', end_date: '2000-01-01' },
  ];
  const dto = examples.map(item => ({ ...item, startDate: item.start_date, endDate: item.end_date }));
  const expected = examples.filter(item => normalizeClassManagementRecord(item).status !== '종강').map(item => item.id);
  assert.deepEqual(requestClassOptions(dto).map(item => item.id), expected);
  assert.deepEqual(expected, ['future', 'explicit']);
  assert.ok(requestClassOptions(dto, 'past').some(item => item.id === 'past'));
});
