import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { actionFixture, id, loadActionService } from './makeup-action-fixture.mjs';

export const resubmitCase = {
  method: 'resubmitMakeupRequest', command: 'resubmit',
  before: 'revision_requested', after: 'approval_pending',
};

// Actual service and existing wire consumers; only database/session/notification
// transport is synthetic. All callbacks remain inside this fixture.
export function resubmitFixture(options = {}) {
  const fixture = actionFixture(resubmitCase, options);
  fixture.tables.profiles[0].role = options.actorRole ?? 'teacher';
  fixture.tables.profiles.find(profile => profile.id === id(804)).name = '정보영';
  fixture.tables.teacher_catalogs.find(teacher => teacher.id === id(904)).name = '정보영';
  fixture.tables.classes = fixture.tables.classes.map(row => ({ ...row, grade: '고2' }));
  Object.assign(fixture.tables, options.tables);
  const input = {
    requestKind: 'cancel_makeup', classId: id(600), reason: '합성 보완 재상신',
    cancelDate: '2026-10-08', originalLessonSessionId: '',
    makeupClassroom: 'A',
    makeupSlots: [{ startAt: '2026-10-09T06:00:00.000Z', endAt: '2026-10-09T07:00:00.000Z', classroom: 'A' }],
    approverTeacherCatalogId: id(904), ...options.input,
  };
  const prepare = source => {
    const service = loadActionService(fixture.client, source);
    return async () => {
      const previousFetch = globalThis.fetch;
      globalThis.fetch = async (...args) => {
        const response = await fixture.fetch(...args);
        if (options.notificationGate) await options.notificationGate;
        return response;
      };
      try {
        return await service.resubmitMakeupRequest(id(1), input, options.actorId ?? id(801));
      } finally {
        globalThis.fetch = previousFetch;
      }
    };
  };
  return { ...fixture, input, prepare, run: source => prepare(source)() };
}

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function resubmitEvidence(fixture, result, durationMs) {
  const reads = fixture.calls.filter(call => call.kind === 'table' || call.name === 'get_makeup_detail_v1');
  const mutations = fixture.calls.filter(call => call.name === 'transition_makeup_request_v2');
  const mutationPayload = mutations.map(call => ({ ...call.args, p_request_id: '<request-uuid>' }));
  return {
    durationMs: Number(durationMs.toFixed(2)), reads: reads.length,
    readResponseBytes: reads.reduce((sum, call) => sum + call.responseBytes, 0),
    readOperations: reads.map(call => call.table ? call.table + (call.single ? ':single' : '') : call.name),
    mutations: mutations.length,
    notifications: fixture.calls.filter(call => call.kind === 'notification').length,
    mutationPayload, mutationPayloadSha256: hash(mutationPayload),
    result, resultSha256: hash(result),
  };
}

export async function measureResubmit(source, { samples = 5, delayMs = 40 } = {}) {
  const runs = [];
  for (let index = 0; index < samples; index++) {
    const fixture = resubmitFixture({ delayMs });
    const run = fixture.prepare(source);
    const start = performance.now();
    const result = await run();
    runs.push(resubmitEvidence(fixture, result, performance.now() - start));
  }
  const durations = runs.map(run => run.durationMs).sort((a, b) => a - b);
  return { samples, delayMs, medianMs: durations[Math.floor(samples / 2)], runs };
}

export { id };
