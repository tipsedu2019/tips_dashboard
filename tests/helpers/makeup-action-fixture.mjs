import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { modules, id, row, stamp } from './makeup-numbered-harness.mjs';

export const actionServicePath = 'src/features/makeup-requests/makeup-request-service.ts';
export const actionCases = [
  { method: 'requestMakeupRequestRevision', command: 'revision_requested', before: 'approval_pending', after: 'revision_requested' },
  { method: 'rejectMakeupRequest', command: 'reject', before: 'approval_pending', after: 'rejected' },
  { method: 'cancelCompletedMakeupRequest', command: 'approval_canceled', before: 'completed', after: 'canceled' },
];

// Transpile the actual service, optionally from a pinned Git revision, while
// injecting all transport. No Supabase client or real notification is used.
export function loadActionService(client, source) {
  const root = path.resolve(import.meta.dirname, '../..');
  const filename = path.join(root, actionServicePath);
  const load = modules(client);
  const code = ts.transpileModule(source ?? readFileSync(filename, 'utf8'), {
    fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const runtime = { exports: {} };
  const require = (specifier) => {
    if (specifier === '@/lib/supabase') return { supabase: client };
    const base = specifier.startsWith('@/') ? `src/${specifier.slice(2)}` : path.posix.join(path.posix.dirname(actionServicePath), specifier);
    const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`];
    for (const file of candidates) {
      try { readFileSync(path.join(root, file)); } catch { continue; }
      return load(file);
    }
    throw new Error(`Unexpected service import: ${specifier}`);
  };
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename })(require, runtime, runtime.exports);
  return runtime.exports;
}

export function actionFixture(testCase, options = {}) {
  const detail = row(1, {
    status: testCase.before, requesterId: id(801), teacherCatalogId: id(901), teacherProfileId: id(802),
    approverTeacherCatalogId: id(904), approverProfileId: id(804), classId: id(600),
    requesterLabel: '합성 신청자', teacherLabel: '합성 교사', approverLabel: '합성 결재자',
    approvedBy: testCase.before === 'completed' ? id(804) : '', approvedByLabel: testCase.before === 'completed' ? '합성 결재자' : '',
    completedBy: testCase.before === 'completed' ? id(805) : '', completedByLabel: testCase.before === 'completed' ? '합성 관리자' : '',
    schedulePlanBefore: { sessions: [{ id: 'original', date: '2026-10-08' }] },
    schedulePlanAfter: { sessions: [{ id: 'makeup', date: '2026-10-09' }] },
    makeupAcademicEventIds: [id(750)],
    events: [{ id: id(950), requestId: id(1), actorId: id(804), actorLabel: '합성 결재자', eventType: 'submitted', fieldName: '', beforeValue: '', afterValue: '', note: '합성 이력', createdAt: stamp }],
    ...options.detail,
  });
  const raw = {
    id: detail.id, status: detail.status, subject: detail.subject, approval_group: detail.approvalGroup,
    requester_id: detail.requesterId, teacher_catalog_id: detail.teacherCatalogId, teacher_profile_id: detail.teacherProfileId,
    class_id: detail.classId, class_name: detail.className, request_kind: detail.requestKind, reason: detail.reason,
    cancel_date: detail.cancelDate, makeup_start_at: detail.makeupStartAt, makeup_end_at: detail.makeupEndAt,
    makeup_classroom: detail.makeupClassroom, makeup_slots: detail.makeupSlots,
    approver_teacher_catalog_id: detail.approverTeacherCatalogId, approver_profile_id: detail.approverProfileId,
    returned_reason: '', rejected_reason: '', final_note: detail.finalNote, approved_by: detail.approvedBy,
    approved_at: detail.approvedAt, completed_by: detail.completedBy, completed_at: detail.completedAt,
    canceled_by: detail.canceledBy, canceled_at: detail.canceledAt, schedule_plan_before: detail.schedulePlanBefore,
    schedule_plan_after: detail.schedulePlanAfter, cancel_academic_event_id: detail.cancelAcademicEventId,
    makeup_academic_event_id: detail.makeupAcademicEventId, makeup_academic_event_ids: detail.makeupAcademicEventIds,
    created_at: detail.createdAt, updated_at: detail.updatedAt,
  };
  const profiles = [[801, '합성 신청자'], [802, '합성 교사'], [804, '합성 결재자'], [805, '합성 관리자']]
    .map(([n, name]) => ({ id: id(n), name, role: 'teacher', email: `fixture-${n}@example.invalid`, login_id: `fixture-${n}`, teacher_catalog_id: '' }));
  const tables = {
    profiles, teacher_catalogs: [{ id: id(901), name: '합성 교사', profile_id: id(802) }, { id: id(904), name: '합성 결재자', profile_id: id(804) }],
    classes: Array.from({ length: 12 }, (_, i) => ({ id: id(600 + i), name: `합성 수업 ${i}`, subject: '영어', grade: '고1', teacher: '합성 교사', room: 'A', schedule: '목 15:00-16:00', schedule_storage_mode: 'legacy', textbook_ids: [] })),
    classroom_catalogs: [{ id: id(701), name: 'A' }],
    academic_events: [{ id: id(750), title: '합성 보강', date: '2026-10-09', note: '' }],
    makeup_requests: Array.from({ length: 20 }, (_, i) => ({ ...raw, id: id(i + 1), class_name: `합성 수업 ${i}` })),
    class_lesson_sessions: Array.from({ length: 24 }, (_, i) => ({ id: id(1000 + i), class_id: id(600 + i % 12), session_date: '2026-10-08', schedule_state: 'active' })),
    makeup_request_events: Array.from({ length: 40 }, (_, i) => ({ id: id(2000 + i), request_id: id(1 + i % 20), actor_id: id(804), event_type: 'submitted', field_name: '', before_value: '', after_value: '', note: '합성 이력', created_at: stamp })),
  };
  const calls = [];
  const delay = options.delayMs ?? 0;
  const wait = () => delay ? new Promise(resolve => setTimeout(resolve, delay)) : Promise.resolve();
  async function finish(call, response) {
    calls.push(call); call.startedAt = performance.now();
    await wait();
    call.endedAt = performance.now(); call.responseBytes = Buffer.byteLength(JSON.stringify(response));
    return response;
  }
  function chain(metadata, resolveResponse) {
    let started;
    const query = { then(yes, no) { started ??= finish(metadata, resolveResponse()); return started.then(yes, no); },
      select(columns) { metadata.select = columns; return this; }, eq(key, value) { metadata.eq = [key, value]; return this; },
      single() { metadata.single = true; return this; }, abortSignal(signal) { metadata.signal = signal; return this; }, retry(value) { metadata.retry = value; return this; } };
    return query;
  }
  const client = {
    from(table) {
      assert.ok(table in tables, `Unexpected table ${table}`);
      const call = { kind: 'table', table };
      return chain(call, () => {
        const error = call.single ? options.singleError : options.tableErrors?.[table];
        if (error) return { data: null, error };
        let data = call.single ? raw : tables[table];
        if (call.select !== '*' && !call.single) data = data.map(row => Object.fromEntries(call.select.split(',').filter(key => key in row).map(key => [key, row[key]])));
        return { data, error: null };
      });
    },
    rpc(name, args) {
      assert.ok(['get_makeup_detail_v1', 'transition_makeup_request_v2'].includes(name), `Unexpected RPC ${name}`);
      const call = { kind: 'rpc', name, args: structuredClone(args) };
      return chain(call, () => {
        if (name === 'get_makeup_detail_v1') return { data: options.missing ? null : detail, error: options.detailError ?? null };
        if (options.mutationError) return { data: null, error: options.mutationError };
        assert.equal(args.p_command, testCase.command);
        assert.equal(args.p_expected_status, detail.status);
        const request = { ...raw, status: testCase.after,
          ...(testCase.command === 'revision_requested' ? { returned_reason: args.p_patch.note } : {}),
          ...(testCase.command === 'reject' ? { rejected_reason: args.p_patch.note } : {}),
          ...(testCase.command === 'approval_canceled' ? { canceled_by: detail.approverProfileId, canceled_at: '2026-10-08T16:00:00Z' } : {}),
          ...options.committed,
        };
        return { data: options.wire ?? { request, sourceEventId: id(999) }, error: null };
      });
    },
    auth: { getSession: () => finish({ kind: 'session' }, { data: { session: { access_token: 'synthetic-no-network' } }, error: null }) },
  };
  async function fetch(url, init) {
    assert.equal(url, '/api/notifications/legacy/makeup');
    assert.equal(JSON.parse(init.body).sourceEventId, id(999));
    const body = options.notificationBody ?? { ok: true, sent: 1, deduped: 0, failed: 0 };
    await finish({ kind: 'notification', url }, body);
    if (options.notificationThrow) throw new Error('synthetic notification unavailable');
    return Response.json(body, { status: options.notificationStatus ?? 200 });
  }
  return { client, fetch, calls, detail, raw, tables };
}

export { id, stamp };
