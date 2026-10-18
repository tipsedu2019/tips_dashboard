import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { classRow } from './management-detail-fixture.mjs';
const repo = new URL('../../', import.meta.url);

export const snapshotClassId = '10000000-0000-4000-8000-000000000001';
export const snapshotStudentId = index => `20000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const classId = snapshotClassId;
const studentId = snapshotStudentId;

// Extract existing function bodies, rather than implementing detail conversion or
// relation read behavior in this fixture. The full records hook is not mounted.
function bindHookParts(load, readService) {
  const url = new URL('src/features/management/use-management-records.ts', repo);
  const source = readFileSync(url, 'utf8');
  const parsed = ts.createSourceFile(url.pathname, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const wanted = new Set(['textValue', 'relationRows', 'relationPage', 'detailToSourceRow', 'normalizeManagementRows', 'loadDetail', 'loadRelationPage']);
  const bodies = new Map();
  function visit(node) {
    const name = node.name?.getText(parsed);
    if (wanted.has(name) && ts.isFunctionDeclaration(node)) bodies.set(name, node.getText(parsed));
    if (wanted.has(name) && ts.isVariableDeclaration(node)) {
      assert.ok(ts.isCallExpression(node.initializer));
      assert.equal(node.initializer.expression.getText(parsed), 'useCallback');
      bodies.set(name, `const ${name} = ${node.initializer.arguments[0].getText(parsed)};`);
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  assert.equal(bodies.size, wanted.size);
  const records = load(new URL('src/features/management/records.js', repo));
  const serviceModule = load(new URL('src/features/management/management-service.js', repo));
  const owner = {};
  const context = {
    module: { exports: {} }, kind: 'classes', owner,
    detailAuthorizationRef: { current: { owner } }, readService,
    getAssignedClassTextbookIds: serviceModule.getAssignedClassTextbookIds,
    CONFIG: { classes: { normalize: records.normalizeClassManagementRecord } },
  };
  const program = [...bodies.values()].join('\n') + '\nmodule.exports = { loadDetail, loadRelationPage };';
  const compiled = ts.transpileModule(program, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(compiled, context, { filename: url.pathname + ':extracted-existing-callbacks' });
  return context.module.exports;
}

export function configureSnapshotFixture(fixture) {
  const initialStudents = Array.from({ length: 90 }, (_, offset) => ({
    id: studentId(offset + 1), name: `합성 학생 ${String(offset + 1).padStart(3, '0')}`,
    school: '합성중학교', grade: '중1', studentContact: '', parentContact: '',
  }));
  let roster = structuredClone(initialStudents);
  const state = { trace: [], relationReads: [], writes: [], detailReads: [], initialStudents, roster: () => roster };
  fixture.snapshotState = state;
  fixture.rows.splice(0, fixture.rows.length, classRow(classId, '합성 경합 수업'));
  fixture.records.totalCount = 1;
  const record = {
    id: classId, name: '합성 경합 수업', subject: '영어', grade: '중1', status: '수강',
    schedule_storage_mode: 'normalized', schedule: '월 16:00-18:00', teacher: '영어교사', classroom: '본관 2강',
  };
  const pageAfter = cursorId => {
    const afterIndex = cursorId ? roster.findIndex(row => row.id === cursorId) + 1 : 0;
    assert.ok(!cursorId || afterIndex > 0, 'cursor row remains in this single deletion scenario');
    const rows = structuredClone(roster.slice(afterIndex, afterIndex + 30));
    const hasMore = afterIndex + 30 < roster.length;
    return { rows, hasMore, nextCursor: hasMore ? { sortValue: rows.at(-1).name, id: rows.at(-1).id } : null };
  };
  const wrap = (promise, request) => ({
    abortSignal(signal) { if (request) request.signal = signal; return this; },
    retry(value) { assert.equal(value, false); return promise; },
  });
  const client = {
    from(table) {
      assert.ok(['students', 'classes'].includes(table), `unexpected table ${table}`);
      return { select(columns) {
        const expected = table === 'students' ? 'id,name,status,class_ids,waitlist_class_ids' : 'id,name,status,student_ids,waitlist_ids';
        assert.equal(columns, expected);
        let requestedId;
        const query = {
          eq(column, id) { assert.equal(column, 'id'); requestedId = id; return query; },
          maybeSingle() { return query; }, abortSignal() { return query; },
          retry(value) {
            assert.equal(value, false);
            state.trace.push({ event: 'mutation-preread', table, id: requestedId });
            if (table === 'students') {
              const row = roster.find(item => item.id === requestedId);
              assert.ok(row);
              return Promise.resolve({ data: { id: row.id, name: row.name, status: '재원', class_ids: [classId], waitlist_class_ids: [] }, error: null });
            }
            assert.equal(requestedId, classId);
            return Promise.resolve({ data: { id: classId, name: record.name, status: '수강', student_ids: roster.map(row => row.id), waitlist_ids: [] }, error: null });
          },
        };
        return query;
      } };
    },
    rpc(name, args) {
      state.trace.push({ event: 'rpc-start', name, args: structuredClone(args) });
      if (name === 'get_management_detail_v1') {
        assert.equal(args.p_kind, 'classes'); assert.equal(args.p_id, classId);
        const data = { kind: 'classes', record: structuredClone(record), registeredCount: roster.length, waitlistCount: 0,
          registeredStudents: pageAfter(null), waitlistedStudents: { rows: [], hasMore: false, nextCursor: null }, textbooks: [] };
        state.detailReads.push(structuredClone(data));
        return wrap(Promise.resolve({ data, error: null }));
      }
      if (name === 'list_management_detail_relation_page_v1') {
        assert.equal(args.p_kind, 'classes'); assert.equal(args.p_id, classId);
        assert.equal(args.p_relation_kind, 'registered_students'); assert.equal(args.p_limit, 30);
        const cursor = roster.find(row => row.id === args.p_cursor_id);
        assert.equal(cursor?.name, args.p_cursor_sort_key);
        const frozenPage = pageAfter(args.p_cursor_id);
        const deferred = Promise.withResolvers();
        const request = { args: structuredClone(args), frozenPage, ...deferred };
        state.relationReads.push(request);
        return wrap(deferred.promise, request);
      }
      if (name === 'set_student_class_roster_mode') {
        assert.equal(args.p_class_id, classId); assert.equal(args.p_student_id, studentId(1));
        assert.equal(args.p_next_mode, 'removed'); assert.equal(args.p_expected_mode, 'enrolled');
        assert.equal(args.p_memo, 'management_roster');
        const deferred = Promise.withResolvers();
        state.writes.push({ args: structuredClone(args), ...deferred });
        return deferred.promise;
      }
      throw new Error(`Unexpected synthetic RPC ${name}`);
    },
  };
  state.finishPage = index => {
    const request = state.relationReads[index];
    state.trace.push({ event: 'relation-response', index, ids: request.frozenPage.rows.map(row => row.id), hasMore: request.frozenPage.hasMore });
    request.resolve({ data: { kind: 'classes', id: classId, relationKind: 'registered_students', page: structuredClone(request.frozenPage) }, error: null });
  };
  state.finishWrite = success => {
    assert.equal(state.writes.length, 1);
    if (!success) {
      state.trace.push({ event: 'synthetic-write-rejected' });
      state.writes[0].resolve({ data: null, error: new Error('합성 수강 해제 실패') });
      return;
    }
    roster = roster.filter(row => row.id !== studentId(1));
    state.trace.push({ event: 'synthetic-write-committed', remaining: roster.length });
    state.writes[0].resolve({ data: {
      studentId: studentId(1), classId, previousMode: 'enrolled', nextMode: 'removed', changed: true,
      studentClassIds: [], studentWaitlistClassIds: [], classStudentIds: roster.map(row => row.id), classWaitlistIds: [],
    }, error: null });
  };
  fixture.records.refresh = async () => { state.trace.push({ event: 'list-refresh' }); };
  fixture.bindProduction = load => {
    const serviceModule = load(new URL('src/features/management/management-service.js', repo));
    const readService = serviceModule.createManagementReadService({ supabase: client });
    Object.assign(fixture.records, bindHookParts(load, readService));
    fixture.service.removeStudentFromClass = serviceModule.createManagementService({
      supabase: client, probeRegistrationRuntime: async () => ({ mode: 'ready', version: 1 }),
    }).removeStudentFromClass;
  };
}
