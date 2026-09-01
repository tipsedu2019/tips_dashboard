import test from 'node:test';
import assert from 'node:assert/strict';
import { createAcademicReadService } from '../src/features/academic/academic-read-service.js';
import { createOperationsReadService } from '../src/features/operations/operations-read-service.js';

const id = 'ab000000-0000-4000-8000-000000000001';
const groupId = 'ab000000-0000-4000-8000-000000000002';
const academicFilters = { periodId: null, search: '', status: null, subject: null, grade: null, teacher: null, classroom: null, viewMode: 'all' };
const operationsFilters = { termId: null, search: '', subject: null, grade: null, teacher: null, syncGroupId: null };
const academicRow = {
  id, title: '수업 10', fullTitle: '[가] 수업 10', subject: '수학', subjectAreaKey: '', grade: '고1', term: '',
  teacherNames: ['', '교사', '교사'], teacherSummary: '교사', classroomNames: [''], classroomSummary: '', schedule: '',
  status: '수강', statusFilter: '수강', classGroupIds: [groupId], classGroupNames: ['동일', '동일'], classGroupLabel: '동일',
  textbookCount: 1, textbookCatalog: [], textbookTitles: [], textbookSummary: '1권 연결', textbookOverflowCount: 0, textbookScopeLabels: [],
  totalSessions: 1, completedSessions: 2, updatedSessions: 2, delayedSessions: 0, plannedSessions: 2, progressTargetSessions: 1,
  delayedProgressSessions: 0, plannedProgressSessions: 2, progressPercent: 200, progressTargetPercent: 200,
  lastUpdatedAt: '2026-08-31 10:00:00+09', stateLabel: '계획 완료', latestNoteSummary: '', latestNoteSessionLabel: '',
  pendingSessionLabels: [], nextSession: null, sessionSummaries: [], searchText: '수업 10',
};
const nextSession = {
  sessionId: id, sessionKey: 'stored-key', sessionOrder: 0, label: '2026-08-31', progressStatus: 'pending',
  hasActualContent: false, updatedAt: '', noteSummary: '', dateValue: '2026-08-31', dateLabel: '2026-08-31',
  periodLabel: '', scheduleState: 'active', scheduleMemo: '', makeupMemo: '', makeupDate: '', hasPlanContent: false,
  planSummary: '', textbookEntryCount: 0, textbookEntries: [],
};
const academicStats = { total: 260, managedClassCount: 260, totalSessions: 260, completedSessions: 520, pendingSessions: 0,
  linkedTextbooks: 260, unlinkedClassCount: 0, noScheduleClassCount: 0, updateNeededClassCount: 0, completedClassCount: 260,
  viewModeCounts: { all: 270, unlinked: 10, unscheduled: 0, update: 0, done: 260 } };
const academicOptions = { periods: [{ value: groupId, label: '학기 별칭', isDefault: true }], statuses: ['수강', '개강 준비', '종강'], subjects: ['수학'], grades: ['고1'], teachers: ['교사'], classrooms: [] };
const operationsRow = { id, name: '[가] 수업 10', subject: '수학', grade: '고1', schedule: '', termId: null,
  teacherName: null, termName: null, syncGroupId: null, syncGroupName: null, status: '', updatedAt: null };
const operationsOptions = { terms: [], subjects: ['수학'], grades: ['고1'], teachers: [], syncGroups: [{ value: groupId, label: '그룹' }] };
const domains = [
  { name: 'academic', factory: createAcademicReadService, method: 'readCurriculumNumberedPage', rpc: 'get_academic_curriculum_numbered_page_v1', filters: academicFilters,
    response: { rows: [academicRow], page: 11, pageSize: 10, totalCount: 260, resolvedPeriodId: groupId, stats: academicStats, filterOptions: academicOptions } },
  { name: 'operations', factory: createOperationsReadService, method: 'readClassScheduleNumberedPage', rpc: 'get_operations_class_schedule_numbered_page_v1', filters: operationsFilters,
    response: { rows: [operationsRow], page: 11, pageSize: 10, totalCount: 260, stats: { total: 260, active: 200, draft: 60 }, filterOptions: operationsOptions,
      syncGroupCounts: [{ groupId, memberCount: 260, representativeClassId: groupId }] } },
];

function setup(domain, data, error = null, pending = false) {
  if (arguments.length < 2) data = structuredClone(domain.response);
  const calls = [];
  const service = domain.factory({ actorScope: 'test-actor:admin', supabase: {
    rpc(name, args) {
      const call = { name, args }; calls.push(call);
      return {
        abortSignal(signal) { call.signal = signal; return this; },
        retry(value) { call.retry = value; return pending ? new Promise((resolve, reject) => {
          if (call.signal.aborted) reject(call.signal.reason);
          else call.signal.addEventListener('abort', () => reject(call.signal.reason), { once: true });
        }) : Promise.resolve({ data, error }); },
      };
    },
    from() { throw new Error('unbounded table fallback'); },
  } });
  return { calls, read: (request = {}) => service[domain.method]({ filters: domain.filters, page: 11, pageSize: 10, ...request }) };
}

for (const domain of domains) {
  test(`${domain.name}: page11 is one exact RPC, flat DTO, no fallback, deadline and retryfalse`, async () => {
    const { calls, read } = setup(domain);
    const result = await read();
    assert.equal(result.totalCount, 260);
    assert.equal(result.page, 11);
    assert.deepEqual(result.rows, domain.response.rows);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, domain.rpc);
    assert.deepEqual(calls[0].args, { p_filters: domain.filters, p_page: 11, p_page_size: 10,
      ...(domain.name === 'academic' ? { p_include_scope_metadata: true } : {}) });
    assert.equal(calls[0].retry, false);
    assert.ok(calls[0].signal instanceof AbortSignal);
  });
  test(`${domain.name}: rejects invalid page, size and raw filters before RPC`, async () => {
    const { calls, read } = setup(domain);
    for (const page of [0, -1, 1.5, NaN, '11', null, 2147483648]) await assert.rejects(() => read({ page }));
    for (const pageSize of [5, 30, '10', null]) await assert.rejects(() => read({ pageSize }));
    for (const filters of [null, [], {}, { ...domain.filters, unknown: 'x' }, { ...domain.filters, search: null }, { ...domain.filters, teacher: true }]) await assert.rejects(() => read({ filters }));
    assert.equal(calls.length, 0);
  });
  test(`${domain.name}: accepts all approved sizes and preserves an empty out-of-range count`, async () => {
    for (const pageSize of [10, 15, 20]) {
      const response = { ...structuredClone(domain.response), rows: [], page: 100, pageSize };
      const { read } = setup(domain, response);
      assert.deepEqual((await read({ page: 100, pageSize })).rows, []);
    }
  });
  test(`${domain.name}: rejects malformed envelope, IDs, metadata and detail payloads`, async () => {
    const invalid = [null, undefined, [], {}, { ...domain.response, rows: null }, { ...domain.response, page: '11' },
      { ...domain.response, page: 12 }, { ...domain.response, pageSize: 15 }, { ...domain.response, totalCount: -1 },
      { ...domain.response, totalCount: '260' }, { ...domain.response, totalCount: 0 }, { ...domain.response, stats: null },
      { ...domain.response, stats: { total: 260 } }, { ...domain.response, filterOptions: {} },
      { ...domain.response, rows: Array(11).fill(domain.response.rows[0]) },
      { ...domain.response, rows: [{ ...domain.response.rows[0], id: 'not-id' }] },
      { ...domain.response, rows: [{ id }] }, { ...domain.response, rows: [{ ...domain.response.rows[0], schedule_plan: {} }] },
      { ...domain.response, rows: [{ ...domain.response.rows[0], progressRows: [] }] },
      { ...domain.response, rows: [{ ...domain.response.rows[0], status: null }] },
      { ...domain.response, stats: { ...domain.response.stats, total: 1 } }];
    for (const response of invalid) {
      const { calls, read } = setup(domain, response);
      await assert.rejects(() => read(), undefined, JSON.stringify(response));
      assert.equal(calls.length, 1);
    }
    for (const code of ['22023','PGRST202','42883']) {
      const { read, calls } = setup(domain, null, Object.assign(new Error('RPC failed'), { code }));
      await assert.rejects(() => read(), { code });
      assert.equal(calls.length, 1);
    }
  });
  test(`${domain.name}: real caller cancellation and 8000ms deadline both abort the issued RPC`, async () => {
    const original = AbortSignal.timeout;
    const timeoutController = new AbortController();
    const durations = [];
    AbortSignal.timeout = (duration) => { durations.push(duration); return timeoutController.signal; };
    try {
      const caller = new AbortController();
      const first = setup(domain, domain.response, null, true);
      const promise = first.read({ signal: caller.signal });
      caller.abort(new Error('caller cancelled'));
      await assert.rejects(promise, /caller cancelled/);
      assert.equal(first.calls[0].signal.aborted, true);
      const second = setup(domain, domain.response, null, true);
      const next = second.read({ signal: new AbortController().signal });
      timeoutController.abort(new Error('deadline'));
      await assert.rejects(next, /deadline/);
      assert.deepEqual(durations, [8000, 8000]);
      assert.equal(second.calls[0].retry, false);
    } finally { AbortSignal.timeout = original; }
  });
  test(`${domain.name}: every required row field is validated and valid SQL wrappers are unwrapped`, async () => {
    for (const key of Object.keys(domain.response.rows[0])) {
      const response = structuredClone(domain.response);
      delete response.rows[0][key];
      await assert.rejects(() => setup(domain, response).read(), undefined, `missing ${key}`);
    }
    const wrapped = structuredClone(domain.response);
    wrapped.rows = [{ id, sort_key: '수업 10', row_data: wrapped.rows[0] }];
    const result = await setup(domain, wrapped).read();
    assert.deepEqual(result.rows, domain.response.rows);
    assert.equal(Object.hasOwn(result.rows[0], 'row_data'), false);
  });
}

test('numbered rows accept the full canonical PostgreSQL UUID domain, not only legacy v1-v5 IDs', async () => {
  for (const domain of domains) {
    const response = structuredClone(domain.response);
    response.rows[0].id = 'ab000000-0000-7000-8000-000000000007';
    const result = await setup(domain, response).read();
    assert.equal(result.rows[0].id, 'ab000000-0000-7000-8000-000000000007');
  }
});

test('academic: keeps alias, sessionKey and >100 percent; metadata=false is explicit null without cache reads', async () => {
  const response = { ...structuredClone(domains[0].response), resolvedPeriodId: '학기 별칭', rows: [{ ...academicRow, nextSession }] };
  const { read } = setup(domains[0], response);
  const result = await read({ filters: { ...academicFilters, periodId: '학기 별칭', viewMode: 'done' } });
  assert.equal(result.resolvedPeriodId, '학기 별칭');
  assert.equal(result.rows[0].nextSession.sessionKey, 'stored-key');
  assert.equal(result.rows[0].progressPercent, 200);
  const noMetadata = setup(domains[0], { ...response, stats: null, filterOptions: null });
  assert.equal((await noMetadata.read({ filters: { ...academicFilters, periodId: '학기 별칭' }, includeScopeMetadata: false })).stats, null);
  assert.equal(noMetadata.calls.length, 1);
  await assert.rejects(() => read({ includeScopeMetadata: null }));
  await assert.rejects(() => read({ filters: { ...academicFilters, status: 'draft' } }));
  await assert.rejects(() => read({ filters: { ...academicFilters, viewMode: 'bogus' } }));
  await assert.rejects(() => read({ filters: { ...academicFilters, periodId: 'wrong alias' } }));
});

test('operations: group representatives may be outside page, but counts and catalog membership must be valid', async () => {
  for (const syncGroupCounts of [null, [{ groupId, memberCount: 0, representativeClassId: id }],
    [{ groupId, memberCount: 2, representativeClassId: 'bad' }], [{ groupId: id, memberCount: 2, representativeClassId: id }]]) {
    await assert.rejects(() => setup(domains[1], { ...domains[1].response, syncGroupCounts }).read());
  }
  await assert.rejects(() => setup(domains[1]).read({ filters: { ...operationsFilters, termId: 'not-uuid' } }));
});

test('academic absent-period responses must resolve to a UUID or null, never an invented alias', async () => {
  await assert.rejects(() => setup(domains[0], { ...domains[0].response, resolvedPeriodId: 'invented-default-alias' }).read());
});
