import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { validatePageSize } from '../src/lib/numbered-pagination.ts';

// Load the real pure declarations, not substituted mapper/filter implementations.
// The existing service module also initializes unrelated browser/global clients.
const legacy = await readFile(new URL('../src/features/tasks/ops-task-service.ts', import.meta.url), 'utf8');
const syntax = ts.createSourceFile('legacy.ts', legacy, ts.ScriptTarget.Latest, true);
const names = new Set(['text', 'canonicalJson', 'assertOpsTaskPageFilters', 'createDefaultOpsTaskPageFilters', 'mapOpsTaskPageRow', 'normalizeType', 'normalizeStatus', 'normalizePriority', 'OPS_TASK_STATUS_VALUES']);
const declarations = syntax.statements.filter((node) => names.has(node.name?.text)
  || (ts.isVariableStatement(node) && node.declarationList.declarations.some((item) => names.has(item.name.getText(syntax))))).map((node) => node.getText(syntax)).join('\n');
function compile(source, require = () => { throw new Error('unexpected import'); }) {
  const sandboxModule = { exports: {} };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module: sandboxModule, exports: sandboxModule.exports, require, AbortSignal, Error, RangeError, Date, Set, Object, Number });
  return sandboxModule.exports;
}
const shared = compile(`${declarations}\nmodule.exports={assertOpsTaskPageFilters,createDefaultOpsTaskPageFilters,mapOpsTaskPageRow};`);
let serviceSource = '';
try { serviceSource = await readFile(new URL('../src/features/tasks/ops-task-numbered-service.ts', import.meta.url), 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const serviceModule = serviceSource ? compile(serviceSource, (path) => {
  if (path.includes('numbered-pagination')) return { validatePageSize };
  if (path.includes('ops-task-service')) return shared;
  throw new Error(`unexpected import ${path}`);
}) : {};
const createService = (...args) => {
  assert.equal(typeof serviceModule.createOpsTaskNumberedReadService, 'function', 'numbered read service is implemented');
  return serviceModule.createOpsTaskNumberedReadService(...args);
};
const id = (n) => `91000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const parent = (n = 1) => ({
  id: id(n), title: '업무', type: 'general', status: 'requested', priority: 'normal',
  requestedById: null, requestedByLabel: '', requestedTeam: '', assigneeId: null, assigneeLabel: '', assigneeTeam: '',
  secondaryAssigneeId: null, secondaryAssigneeLabel: '', studentId: null, studentName: '', classId: null, className: '',
  textbookId: null, textbookTitle: '', campus: '', subject: '', startAt: null, dueAt: null, completedAt: null,
  completedById: null, completedByLabel: '', memo: '', createdAt: '2026-08-31T00:00:00+00:00', updatedAt: '2026-08-31T00:00:00+00:00', summaryFlags: [],
});
const filters = shared.createDefaultOpsTaskPageFilters('general', 'viewer-a');
const request = (overrides = {}) => ({ filters, page: 11, pageSize: 10, viewerId: 'viewer-a', ...overrides });
const envelope = (overrides = {}) => ({ rows: Array.from({ length: 10 }, (_, i) => parent(i + 101)), page: 11, pageSize: 10, totalCount: 260, ...overrides });
function wire(response, onSignal = () => {}) {
  const calls = [];
  return { calls, supabase: {
    from() { assert.fail('numbered list never hydrates tables'); },
    rpc(name, args) {
      calls.push({ name, args });
      return { abortSignal(signal) { onSignal(signal); return { retry(value) { assert.equal(value, false); return typeof response === 'function' ? response(signal) : Promise.resolve(response); } }; } };
    },
  } };
}
test('page 11 is one literal numbered RPC and maps stored actors without hydration', async () => {
  const data = envelope(); data.rows[0].completedById = id(900); data.rows[0].completedByLabel = '저장된 처리자';
  const transport = wire({ data, error: null });
  const result = await createService(transport).readPage(request());
  assert.deepEqual(JSON.parse(JSON.stringify(transport.calls)), [{ name: 'list_ops_task_numbered_page_v1', args: { p_type: 'general', p_filters: JSON.parse(JSON.stringify(filters)), p_page: 11, p_page_size: 10 } }]);
  assert.equal(result.totalCount, 260); assert.equal(result.page, 11); assert.equal(result.pageSize, 10);
  assert.equal(result.rows[0].id, id(101)); assert.equal(result.rows[0].completedBy, id(900)); assert.equal(result.rows[0].completedByLabel, '저장된 처리자');
  for (const row of result.rows) for (const field of ['comments', 'events', 'attachments']) assert.equal(row[field].length, 0);
});
for (const [label, patch] of [
  ['size 5', { pageSize: 5 }], ['size 30', { pageSize: 30 }], ['zero page', { page: 0 }], ['null page', { page: null }],
  ['page integer overflow', { page: 2147483648 }], ['missing viewer', { viewerId: '' }], ['blank viewer', { viewerId: '  ' }],
  ['null enum', { filters: { ...filters, queue: null } }], ['unknown filter', { filters: { ...filters, extra: true } }],
  ['array taskType', { filters: { ...filters, taskType: ['general'] } }],
]) test(`rejects ${label} before transport`, async () => {
  const transport = wire({ data: envelope(), error: null });
  await assert.rejects(() => createService(transport).readPage(request(patch)), /invalid/);
  assert.equal(transport.calls.length, 0);
});
for (const patch of [
  { period: ['all'] },
  { sortColumn: 'status', sortDirection: 'up' }, { period: 'all', dateFrom: '2026-08-31' },
  { period: 'custom', dateFrom: '2026-02-30', dateTo: '2026-03-01' },
  { period: 'custom', dateFrom: '2026-09-01', dateTo: '2026-08-31' },
]) test(`rejects malformed filter ${JSON.stringify(patch)}`, async () => {
  const transport = wire({ data: envelope(), error: null });
  await assert.rejects(() => createService(transport).readPage(request({ filters: { ...shared.createDefaultOpsTaskPageFilters('withdrawal', 'viewer-a'), ...patch } })), /invalid/);
  assert.equal(transport.calls.length, 0);
});
for (const [label, patch] of [
  ['missing rows', { rows: null }], ['negative count', { totalCount: -1 }], ['string count', { totalCount: '260' }],
  ['fractional count', { totalCount: 260.5 }], ['wrong page', { page: 10 }], ['wrong size', { pageSize: 15 }],
  ['short page', { rows: [parent()] }], ['duplicate parents', { rows: Array.from({ length: 10 }, () => parent()) }],
]) test(`rejects malformed envelope: ${label}`, async () => {
  const transport = wire({ data: envelope(patch), error: null });
  await assert.rejects(() => createService(transport).readPage(request()), /response_invalid/);
  assert.equal(transport.calls.length, 1);
});
for (const patch of [
  { id: '' }, { id: 123 }, { type: 'invalid' }, { type: 'registration' }, { status: 'invalid' }, { priority: 'invalid' },
  { title: 1 }, { completedById: {} }, { completedByLabel: null }, { dueAt: false }, { summaryFlags: [1] },
  { row_data: parent() }, { comments: [] },
]) test(`rejects malformed flat row ${JSON.stringify(patch)}`, async () => {
  const data = envelope(); Object.assign(data.rows[0], patch);
  await assert.rejects(() => createService(wire({ data, error: null })).readPage(request()), /response_invalid/);
});
test('general accepts textbook and off-end total survives without clamping', async () => {
  const data = envelope({ rows: [parent()], totalCount: 101 }); data.rows[0].type = 'textbook';
  assert.equal((await createService(wire({ data, error: null })).readPage(request())).rows[0].type, 'textbook');
  const empty = await createService(wire({ data: envelope({ rows: [], page: 12, totalCount: 101 }), error: null })).readPage(request({ page: 12 }));
  assert.equal(empty.page, 12); assert.equal(empty.totalCount, 101); assert.equal(empty.rows.length, 0);
});
test('caller abort and eight-second timeout propagate without retry', async (t) => {
  const timeout = new AbortController();
  t.mock.method(AbortSignal, 'timeout', (ms) => { assert.equal(ms, 8000); return timeout.signal; });
  for (const cause of ['caller', 'timeout']) {
    const caller = new AbortController(); const reason = new Error(cause);
    const transport = wire(async () => { (cause === 'caller' ? caller : timeout).abort(reason); return { data: envelope(), error: null }; });
    await assert.rejects(() => createService(transport).readPage(request({ signal: caller.signal })), (error) => error === reason);
    assert.equal(transport.calls.length, 1);
  }
});
test('already aborted caller makes no RPC', async () => {
  const caller = new AbortController(); caller.abort(new Error('cancelled'));
  const transport = wire({ data: envelope(), error: null });
  await assert.rejects(() => createService(transport).readPage(request({ signal: caller.signal })), /cancelled/);
  assert.equal(transport.calls.length, 0);
});
for (const code of ['PGRST202', '42883', '42501', '22023']) test(`RPC ${code} never retries or falls back`, async () => {
  const error = { code, message: 'failed' }; const transport = wire({ data: null, error });
  await assert.rejects(() => createService(transport).readPage(request()), (result) => ['PGRST202', '42883'].includes(code) ? result.code === 'ops_task_numbered_rpc_unavailable' : result === error);
  assert.equal(transport.calls.length, 1);
});

const registration = {
  pipelineStatus: 'inquiry', schoolGrade: '', schoolName: '', parentPhone: '', studentPhone: '', levelTestResult: '', levelTestPlace: '', levelTestMaterialLink: '', counselor: '', classStartSession: '', requestNote: '',
  inquiryAt: null, levelTestAt: null, levelTestCompletedAt: null, phoneConsultationAt: null, visitConsultationAt: null, consultationAt: null, classStartDate: null,
};
const track = {
  id: id(901), taskId: id(1), subject: '영어', status: 'inquiry', workflowStatus: 'inquiry', workflowRevision: 1,
  workflowStatusEnteredAt: '2026-08-31T00:00:00Z', stageEnteredAt: '2026-08-31T00:00:00Z', legacy: false,
  directorProfileId: null, directorName: '', directorAssignmentSource: '', directorAssignmentRuleKey: '',
  waitingKind: '', waitingDetailKind: '', waitingDetailClassId: null, waitingDetailRetakeDecision: '', enrollmentDetailRows: [], levelTestRetakeDecision: '', migrationReviewRequired: false,
  phoneReadyAt: null, phoneReadySource: null, levelTestScheduledAt: null, levelTestPlace: null, visitScheduledAt: null, visitPlace: null,
  observationAttemptCount: null, observationCurrentId: null, observationCurrentStatus: null, observationCurrentAppointmentId: null, observationNearestScheduledAt: null, observationNearestPlace: null,
  observationNotificationRevision: null, observationRevision: null, observationFeedbackRevision: null, observationSummaryVisible: false,
};
const withdrawal = {
  inlineState: { teacherName: '', withdrawalDate: null, withdrawalSession: '', customerReason: '', teacherOpinion: '', undistributedTextbooks: '', completedLessonHours: 2, fourWeekLessonHours: 8, makeeduWithdrawalDone: false, feeProcessed: false, textbookFeeProcessed: false },
  displayValues: { status: '신청', subject: '-', teacher: '미지정', className: '-', student: '-', withdrawalDate: '-', withdrawalSession: '-', completedLessonHours: '2', fourWeekLessonHours: '8', progress: '25%', customerReason: '-', teacherOpinion: '-', undistributedTextbooks: '-', operationsChecklist: '0/3' },
};
const transfer = {
  inlineState: { fromClassId: null, toClassId: null, fromTeacherName: '', toTeacherName: '', fromClassName: '', toClassName: '', fromClassEndDate: null, fromClassEndSession: '', toClassStartDate: null, toClassStartSession: '', transferReason: '', fromUndistributedTextbooks: '', toUndistributedTextbooks: '', makeeduTransferDone: false, feeProcessed: false, textbookFeeProcessed: false },
  displayValues: { status: '신청', subject: '-', fromTeacher: '미지정', fromClassName: '-', student: '-', transferReason: '-', fromUndistributedTextbooks: '-', fromClassEndDate: '-', fromClassEndSession: '-', toTeacher: '미지정', toClassName: '-', toClassStartDate: '-', toClassStartSession: '-', toUndistributedTextbooks: '-', operationsChecklist: '0/3' },
};
const retest = {
  inlineState: { retryOfTaskId: null, retryTaskId: null, branch: '본관', teacherId: null, teacherName: '', className: '', studentName: '', testAt: null, expectedRetestAt: null, textbookName: '', unit: '', requestNote: '', totalQuestionCount: null, cutoffQuestionCount: null, firstScore: null, secondScore: null, thirdScore: null, retestStatus: 'not_started' },
  displayValues: { status: '시작 전', testAt: '', expectedRetestAt: '', teacher: '미지정', class: '미지정', student: '미지정', textbook: '미지정', unit: '미지정', note: '', total: '', cutoff: '', score: '', result: '미정' },
};
const typedRow = (type) => ({ ...parent(), type, ...({ registration: { registration, registrationTracks: [track] }, withdrawal, transfer, word_retest: retest }[type]) });
async function readTyped(type, row) {
  const transport = wire({ data: { rows: [row], page: 1, pageSize: 10, totalCount: 1 }, error: null });
  return createService(transport).readPage(request({ page: 1, filters: shared.createDefaultOpsTaskPageFilters(type, 'viewer-a') }));
}
const correctionEnrollment = {
  id: null, classId: id(910), textbookId: null, classStartDate: null, classStartSessionKey: null,
  classStartLessonSessionId: null, classStartSession: null, classStartSourceObservationId: null, sortOrder: -1,
};
const canonicalEnrollment = {
  ...correctionEnrollment, id: id(911), trackId: track.id, studentId: null, admissionBatchId: null,
  status: 'planned', makeeduRegistered: false, rosterActive: false, rosterReleasedAt: null,
  rosterReleaseReason: null, rosterReleaseSourceTaskId: null, rosterReleaseKind: null,
};
async function readEnrollment(enrollment) {
  const row = structuredClone(typedRow('registration'));
  row.registrationTracks[0].enrollmentDetailRows = [enrollment];
  return readTyped('registration', row);
}
for (const [label, enrollment] of [
  ['canonical planned response', canonicalEnrollment],
  ['canonical populated class-close response', {
    ...canonicalEnrollment, studentId: id(912), admissionBatchId: id(913), textbookId: id(914),
    classStartDate: '2026-08-31', classStartSessionKey: '2026-08-31:1', classStartLessonSessionId: id(915),
    classStartSession: '1교시', classStartSourceObservationId: id(916), status: 'canceled',
    makeeduRegistered: true, rosterActive: false, rosterReleasedAt: '2026-08-31T10:00:00+09:00',
    rosterReleaseReason: '반 종료', rosterReleaseSourceTaskId: id(917), rosterReleaseKind: 'class_close',
  }],
  ['normalized external correction with null ID', correctionEnrollment],
  ['normalized external correction with UUID', { ...correctionEnrollment, id: id(911) }],
  ['historic nullable ID', { id: null, classId: id(910), sortOrder: 0 }],
  ...[-2147483648, -1, 2147483647].map((sortOrder) => [`historic signed int32 ${sortOrder}`, { classId: id(910), sortOrder }]),
  ...['waitlisted', 'enrolled'].map((status) => [`canonical ${status}`, { ...canonicalEnrollment, status }]),
  ...['withdrawal', 'transfer'].map((rosterReleaseKind) => [`canonical release ${rosterReleaseKind}`, { ...canonicalEnrollment, rosterReleaseKind }]),
]) test(`registration preserves ${label} enrollment metadata`, async () => {
  const result = await readEnrollment(enrollment);
  assert.deepEqual(JSON.parse(JSON.stringify(result.rows[0].registrationTracks[0].enrollmentDetailRows)), [enrollment]);
});
for (const patch of [
  { id: null }, { id: 'bad' }, { trackId: null }, { classId: null }, { studentId: 1 }, { admissionBatchId: false },
  { textbookId: {} }, { classStartDate: '2026-02-30' }, { classStartSessionKey: 1 },
  { classStartLessonSessionId: 'bad' }, { classStartSession: false }, { classStartSourceObservationId: [] },
  { status: 'registered' }, { makeeduRegistered: 'false' }, { rosterActive: 0 },
  { rosterReleasedAt: '2026-08-31' }, { rosterReleaseReason: {} }, { rosterReleaseSourceTaskId: 'bad' },
  { rosterReleaseKind: 'class_closed' }, { sortOrder: -2147483649 }, { sortOrder: 2147483648 },
  { sortOrder: 0.5 }, { sortOrder: '-1' }, { unexpected: true },
]) test(`registration rejects malformed canonical enrollment ${JSON.stringify(patch)}`, async () => {
  await assert.rejects(() => readEnrollment({ ...canonicalEnrollment, ...patch }), /response_invalid/);
});
test('registration rejects incomplete canonical metadata and malformed historic IDs', async () => {
  const incomplete = { ...canonicalEnrollment }; delete incomplete.status;
  await assert.rejects(() => readEnrollment(incomplete), /response_invalid/);
  await assert.rejects(() => readEnrollment({ ...correctionEnrollment, id: 'bad' }), /response_invalid/);
});
for (const type of ['registration', 'withdrawal', 'transfer', 'word_retest']) test(`${type}: validates full flat DTO then retains narrow list details`, async () => {
  const result = await readTyped(type, typedRow(type));
  assert.equal(result.rows[0].type, type); assert.equal(result.rows[0].comments.length, 0);
  assert.ok(result.rows[0][{ registration: 'registration', withdrawal: 'withdrawal', transfer: 'transfer', word_retest: 'wordRetest' }[type]]);
});
for (const type of ['withdrawal', 'transfer', 'word_retest']) for (const mutation of ['inlineArray', 'missingInline', 'displayNumber', 'badDetail']) test(`${type} rejects ${mutation}`, async () => {
  const row = structuredClone(typedRow(type));
  if (mutation === 'inlineArray') row.inlineState = [];
  if (mutation === 'missingInline') delete row.inlineState;
  if (mutation === 'displayNumber') row.displayValues.status = 1;
  if (mutation === 'badDetail') row.inlineState[type === 'word_retest' ? 'firstScore' : 'feeProcessed'] = 'false';
  await assert.rejects(() => readTyped(type, row), /response_invalid/);
});
for (const patch of [{ taskId: id(2) }, { subject: '국어' }, { workflowRevision: '1' }, { legacy: true }, { observationAttemptCount: '0' }, { enrollmentDetailRows: [{}] }]) test(`registration rejects malformed track ${JSON.stringify(patch)}`, async () => {
  const row = structuredClone(typedRow('registration')); Object.assign(row.registrationTracks[0], patch);
  await assert.rejects(() => readTyped('registration', row), /response_invalid/);
});
test('registration accepts empty tracks and concealed observation nulls without fabricating counts', async () => {
  const result = await readTyped('registration', typedRow('registration'));
  assert.equal(result.rows[0].registrationTracks[0].observationAttemptCount, null);
  assert.equal(result.rows[0].registrationTracks[0].observationSummaryVisible, false);
  const row = typedRow('registration'); row.registrationTracks = [];
  assert.equal((await readTyped('registration', row)).rows[0].registrationTracks.length, 0);
});
test('maximum int page remains a valid empty result and all strict sizes work', async () => {
  for (const pageSize of [10, 15, 20]) {
    const page = 2147483647;
    const result = await createService(wire({ data: envelope({ rows: [], page, pageSize, totalCount: 101 }), error: null })).readPage(request({ page, pageSize }));
    assert.equal(result.totalCount, 101); assert.equal(result.page, page);
  }
});
