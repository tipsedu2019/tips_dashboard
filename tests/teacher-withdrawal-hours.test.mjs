import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement, useLayoutEffect, useState } from 'react';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { setup, button, id } from './helpers/textbook-numbered-harness.mjs';
import { teacherAuth, teacherActor, inputs, ownDetail, ownSummary, page } from './helpers/teacher-own-request-fixtures.mjs';
import { loadNotificationComponent } from './helpers/notification-component-loader.mjs';
import * as withdrawalSchedule from '../src/features/tasks/withdrawal-schedule-metrics.js';
import { toDateKey } from '../src/features/tasks/ops-task-model.js';

// Use the existing management functions without exporting product internals.
// The same AST extraction pattern is already used by withdrawal-schedule-metrics.test.mjs.
const workspacePath = new URL('../src/features/tasks/ops-task-workspace.tsx', import.meta.url);
const workspaceSource = fs.readFileSync(workspacePath, 'utf8');
const workspaceAst = ts.createSourceFile(String(workspacePath), workspaceSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const helperStart = workspaceAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'stringValue').getStart(workspaceAst);
const helperEnd = workspaceAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'getWithdrawalScheduleMetrics').end;
const helperJs = ts.transpileModule(workspaceSource.slice(helperStart, helperEnd) + '\nglobalThis.actualMetrics = { getWithdrawalClassScheduleItems, getWithdrawalScheduleMetrics };', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const helperContext = vm.createContext({ ...withdrawalSchedule, toDateKey, Date, Intl, Map, Set });
vm.runInContext(helperJs, helperContext);
const actualMetrics = helperContext.actualMetrics;

const names = { list: 'get_operations_class_schedule_numbered_page_v1', detail: 'get_operations_class_lesson_design_detail_v1', schedule: 'get_class_schedule_v1', write: 'mutate_teacher_own_request_v1' };
const calls = (h, name) => h.requests.filter(request => request.name === name);
const latest = (h, name) => calls(h, name).at(-1);
const click = async (h, label) => { const node = button(label); assert.ok(node, label); await h.act(() => node.click()); };
const submit = async h => { const form = document.querySelector('form'); assert.ok(form, 'withdrawal edit form'); await h.act(() => form[Object.keys(form).find(key => key.startsWith('__reactProps$'))].onSubmit({ preventDefault() {} })); };
const change = async (h, node, value) => { assert.ok(node); await h.act(() => node[Object.keys(node).find(key => key.startsWith('__reactProps$'))].onChange({ target: { value } })); };

function classRow(n = 20) {
  return { id: id(n), name: n === 20 ? '합성 기존 반' : '합성 새 반', subject: '영어', grade: '중2', teacher: '합성 교사', schedule: '월수 19:30~21:30', room: '합성 교실', status: '수강', scheduleStorageMode: 'normalized', schedulePlan: {
    selectedDays: [1, 3], billingPeriods: [{ id: 'same-cycle', label: '11월', startDate: '2026-10-28', endDate: '2026-11-25' }],
    sessions: ['2026-10-28', '2026-11-02', '2026-11-04'].map((date, index) => ({ id: `saved-${index + 1}`, date, scheduleState: 'active', sessionNumber: index + 1, startTime: '19:30', endTime: '21:30', billingId: 'same-cycle', billingLabel: '11월' })),
  } };
}
const monthlySchedule = () => ({ authoritativeSource: 'normalized', scheduleRevision: 1, hasMoreBefore: true, hasMoreAfter: false, sessions: ['2026-11-02', '2026-11-04'].map((date, index) => ({ id: id(31 + index), session_key: `saved-${index + 2}`, session_date: date, schedule_state: 'active', start_time: '19:30:00', end_time: '21:30:00', legacy_billing_id: 'same-cycle', legacy_billing_label: '11월' })) });
function catalog(request) {
  return { page: request.args.p_page, pageSize: 15, totalCount: 2, rows: [20, 21].map(n => ({ id: id(n), name: classRow(n).name, subject: '영어', grade: '중2', schedule: '월수', status: '수강', teacherName: '합성 교사', termId: null, termName: null, syncGroupId: null, syncGroupName: null, updatedAt: null })), stats: { total: 2, active: 2, draft: 0 }, filterOptions: { terms: [], subjects: ['영어'], grades: ['중2'], teachers: ['합성 교사'], syncGroups: [] }, syncGroupCounts: [] };
}
async function settleClass(h) {
  for (const request of calls(h, names.detail)) await h.resolve(request, { classItem: classRow(request.args.p_class_id === id(21) ? 21 : 20) });
  for (const request of calls(h, names.schedule)) await h.resolve(request, monthlySchedule());
}
async function mount(t) {
  t.mock.method(globalThis, 'fetch', () => assert.fail('withdrawal hours regressions must not access a real network'));
  const props = { domain: 'withdrawal', onChanged() {} };
  const h = await setup(t, { auth: teacherAuth, component: { file: 'src/features/teacher-requests/teacher-request-actions.tsx', name: 'TeacherRequestActions' }, props });
  props.Fields = h.load('src/features/tasks/ops-task-workspace.tsx').TeacherTransitionRequestFields;
  await h.render();
  return h;
}
async function showDetail(t, input = inputs.withdrawal) {
  const h = await mount(t), record = ownDetail('withdrawal', { input });
  await click(h, '내 신청');
  await h.resolve(latest(h, 'get_teacher_own_requests_v1'), page([ownSummary(record)]));
  await click(h, record.title);
  await h.resolve(latest(h, 'get_teacher_own_request_v1'), record);
  return h;
}
async function edit(t, input = inputs.withdrawal) {
  const h = await showDetail(t, input);
  await click(h, '신청 수정');
  await settleClass(h);
  return h;
}

test('teacher withdrawal uses the complete saved billing cycle while calendar labels remain month scoped', async t => {
  const management = actualMetrics.getWithdrawalScheduleMetrics(actualMetrics.getWithdrawalClassScheduleItems(classRow()), '2026-11-04', classRow());
  assert.equal(management.completedLessonHours, '6'); assert.equal(management.fourWeekLessonHours, '16');
  const h = await edit(t);
  const day = [...document.querySelectorAll('button')].find(node => (node.getAttribute('aria-label') || '').includes('2026-11-04') && !node.disabled);
  assert.ok(day, 'real normalized November calendar date');
  await h.act(() => day.click());
  assert.equal(calls(h, names.write).length, 0, 'selection never saves automatically');
  await submit(h); await submit(h);
  const write = latest(h, names.write);
  assert.ok(write); assert.equal(calls(h, names.write).length, 1, 'duplicate submit has one request');
  assert.equal(write.args.p_input.withdrawal_date, '2026-11-04');
  assert.equal(write.args.p_input.withdrawal_session, '11월 2회차', 'calendar display ordinal is unchanged');
  assert.equal(write.args.p_input.completed_lesson_hours, management.completedLessonHours, 'October 28 is part of the same saved billing cycle, so November-only four hours is incomplete');
  assert.equal(write.args.p_input.four_week_lesson_hours, management.fourWeekLessonHours);
  assert.equal(calls(h, names.schedule).length, 1, 'calculation snapshot needs no extra schedule read');
  assert.equal(h.requests.some(request => request.table), false);
  await h.reject(write, { code: '23514', message: 'teacher_request_stale' });
  await click(h, '닫기'); await click(h, '계속 편집');
  assert.equal(calls(h, names.write).length, 1, 'canceling discard does not save');
  await submit(h);
  const retry = latest(h, names.write);
  assert.deepEqual(retry.args.p_input, write.args.p_input, 'definitive failure and canceled discard retain the exact hours snapshot');
  await h.reject(retry, { code: '42501', message: 'synthetic_permission_loss' });
  assert.equal(document.querySelector('form'), null, 'permission loss clears the draft instead of keeping private input');
});

test('teacher withdrawal reason-only edit preserves explicit string zero without recalculating the saved snapshot', async t => {
  const input = { ...inputs.withdrawal, completed_lesson_hours: '0', four_week_lesson_hours: '16' };
  const h = await edit(t, input);
  await change(h, [...document.querySelectorAll('textarea')].at(-1), '시수 변경 없는 합성 메모');
  await submit(h);
  const write = latest(h, names.write); assert.ok(write);
  assert.deepEqual(write.args.p_input, { ...input, memo: '시수 변경 없는 합성 메모' });
  await h.reject(write, { code: '23514', message: 'teacher_request_stale' });
});

for (const [completed, total, progress] of [['0', '16', '0%'], ['6', '16', '38%']]) test(`teacher own withdrawal summary labels saved hours and displays ${progress}`, async t => {
  await showDetail(t, { ...inputs.withdrawal, completed_lesson_hours: completed, four_week_lesson_hours: total });
  const value = label => [...document.querySelectorAll('dt')].find(node => node.textContent === label)?.nextElementSibling?.textContent;
  assert.equal(value('진행 수업시수'), completed);
  assert.equal(value('4주 기준 수업시수'), total);
  assert.equal(value('수업진행률'), progress);
});

test('selected synthetic zero hours remain zero while no selected schedule remains missing', () => {
  const items = [{ sessionId: 'zero-session', sourceIndex: 0, dateKey: '2026-11-02', label: '1회차', state: 'active', stateLabel: '정상', sessionNumber: 1, lessonHours: 0, billingId: 'zero-cycle', billingLabel: '11월', billingColor: '' }];
  const before = structuredClone(items);
  const selected = actualMetrics.getWithdrawalScheduleMetrics(items, '2026-11-02', { schedule: '', schedulePlan: {} });
  assert.equal(selected.completedLessonHours, '0');
  assert.equal(selected.fourWeekLessonHours, '0');
  const missing = actualMetrics.getWithdrawalScheduleMetrics([], '', { schedule: '', schedulePlan: {} });
  assert.equal(missing.completedLessonHours, ''); assert.equal(missing.fourWeekLessonHours, '');
  assert.deepEqual(items, before);
});

test('teacher withdrawal changing its source class clears the previous hours snapshot with its date and session', async t => {
  const h = await mount(t), Fields = h.load('src/features/tasks/ops-task-workspace.tsx').TeacherTransitionRequestFields;
  let observed;
  function Probe() {
    const [input, setInput] = useState({ ...inputs.withdrawal, completed_lesson_hours: '6', four_week_lesson_hours: '16' });
    useLayoutEffect(() => { observed = input; }, [input]);
    return createElement(Fields, { domain: 'withdrawal', input, onChange: setInput, editing: false, labels: {}, references: null, disabled: false, month: '2026-11', onMonthChange() {}, onPermissionDenied() { assert.fail('unexpected denial'); } });
  }
  await h.mountTestComponent(Probe, {});
  for (const request of calls(h, names.list)) await h.resolve(request, catalog(request));
  await settleClass(h);
  const selector = [...document.querySelectorAll('button[aria-labelledby]')].find(node => document.getElementById(node.getAttribute('aria-labelledby'))?.textContent.replace(/필수 입력|필수입력|\*/g, '').trim() === '수업');
  assert.ok(selector); await h.act(() => selector.click());
  const option = [...document.querySelectorAll('[role="option"]')].find(node => node.textContent.trim() === '합성 새 반');
  assert.ok(option); await h.act(() => option.click());
  assert.equal(observed.class_id, id(21));
  assert.equal(observed.withdrawal_date, null); assert.equal(observed.withdrawal_session, '');
  assert.ok(observed.completed_lesson_hours == null || observed.completed_lesson_hours === '', 'completed hours cannot remain from the old class');
  assert.ok(observed.four_week_lesson_hours == null || observed.four_week_lesson_hours === '', 'four-week hours cannot remain from the old class');
  assert.equal(calls(h, names.write).length, 0);
});

function clientApi() {
  const requests = [];
  let response;
  const api = loadNotificationComponent('src/features/teacher-requests/teacher-request-service.ts', new Map([['@/lib/supabase', { supabase: { rpc(name, args) { requests.push({ name, args }); return { abortSignal() { return this; }, retry() { return Promise.resolve({ data: response, error: null }); } }; } } }]]));
  return { api, requests, respond(value) { response = value; } };
}
for (const action of ['create', 'update']) test(`teacher withdrawal ${action} and own read accept valid hours and preserve string zero`, async () => {
  const { api, requests, respond } = clientApi();
  const input = { ...inputs.withdrawal, completed_lesson_hours: '0', four_week_lesson_hours: '16' };
  respond(ownDetail('withdrawal', { input, revision: 'revision-b' }));
  const result = await api.mutateOwnRequest(teacherActor, { domain: 'withdrawal', id: action === 'create' ? null : id(600), action, input, revision: action === 'create' ? null : 'revision-a', requestId: id(998) });
  assert.deepEqual(requests[0].args.p_input, input); assert.deepEqual(result.input, input);
  const read = await api.readOwnRequest('withdrawal', teacherActor, id(600), new AbortController().signal);
  assert.deepEqual(read.input, input);
  assert.deepEqual(requests.map(request => request.name), [names.write, 'get_teacher_own_request_v1']);
  assert.deepEqual(api.parseRequestInput('withdrawal', inputs.withdrawal), inputs.withdrawal, 'legacy snapshots without new fields still load');
});

test('teacher withdrawal rejects invalid hour values and unrelated extra keys before mutation', async () => {
  const { api, requests } = clientApi();
  const valid = { ...inputs.withdrawal, completed_lesson_hours: '2.5', four_week_lesson_hours: '16' };
  for (const field of ['completed_lesson_hours', 'four_week_lesson_hours']) for (const value of ['-1', 'NaN', 'Infinity', 'not hours', '1e3', '1000000', '2.555', 4, {}, []]) {
    await assert.rejects(api.mutateOwnRequest(teacherActor, { domain: 'withdrawal', id: null, action: 'create', input: { ...valid, [field]: value }, revision: null, requestId: id(998) }), error => error.code === '22023');
  }
  await assert.rejects(api.mutateOwnRequest(teacherActor, { domain: 'withdrawal', id: null, action: 'create', input: { ...valid, fee_processed: true }, revision: null, requestId: id(998) }), error => error.code === '22023');
  assert.equal(requests.length, 0);
});

test('teacher withdrawal hours accept the approved decimal boundary and missing pair without widening unrelated DTO keys', () => {
  const { api } = clientApi();
  for (const [completed_lesson_hours, four_week_lesson_hours] of [['999999.99', '0'], ['', '']]) {
    const input = { ...inputs.withdrawal, completed_lesson_hours, four_week_lesson_hours };
    assert.deepEqual(api.parseRequestInput('withdrawal', input), input);
  }
  for (const field of ['completed_lesson_hours', 'four_week_lesson_hours']) assert.throws(() => api.parseRequestInput('withdrawal', { ...inputs.withdrawal, [field]: '2' }));
  assert.deepEqual(api.parseRequestInput('withdrawal', inputs.withdrawal), inputs.withdrawal);
});

async function editWithClass(t, row, input = inputs.withdrawal) {
  const h = await showDetail(t, input);
  await click(h, '신청 수정');
  await h.resolve(latest(h, names.detail), { classItem: row });
  await h.resolve(latest(h, names.schedule), monthlySchedule());
  return h;
}
async function selectNovemberFourth(h) {
  const day = [...document.querySelectorAll('button')].find(node => (node.getAttribute('aria-label') || '').includes('2026-11-04') && !node.disabled);
  assert.ok(day); await h.act(() => day.click());
}

test('teacher withdrawal never substitutes a partial monthly total for a missing full calculation snapshot', async t => {
  const row = classRow(); row.schedulePlan.sessions = [];
  const h = await editWithClass(t, row);
  await selectNovemberFourth(h); await submit(h);
  const write = latest(h, names.write); assert.ok(write);
  assert.equal(write.args.p_input.withdrawal_date, '2026-11-04');
  assert.equal(write.args.p_input.completed_lesson_hours, '', 'monthly four hours must not stand in for unknown full-cycle hours');
  await h.reject(write, { code: '23514', message: 'teacher_request_stale' });
});

test('teacher withdrawal keeps saved hours when browsing another month fails and is retried', async t => {
  const input = { ...inputs.withdrawal, completed_lesson_hours: '6', four_week_lesson_hours: '16' };
  const h = await edit(t, input);
  const nextMonth = document.querySelector('button[aria-label="다음 달"]'); assert.ok(nextMonth);
  await h.act(() => nextMonth.click());
  await h.reject(latest(h, names.detail), { code: '57014', message: 'synthetic_schedule_timeout' });
  assert.ok(document.querySelector('form'));
  assert.equal(calls(h, names.write).length, 0);
  await click(h, '일정 다시 조회');
  await h.resolve(latest(h, names.detail), { classItem: classRow() });
  await h.resolve(latest(h, names.schedule), { authoritativeSource: 'normalized', scheduleRevision: 1, hasMoreBefore: true, hasMoreAfter: false, sessions: [] });
  await change(h, [...document.querySelectorAll('textarea')].at(-1), '조회 실패 후에도 보존할 합성 메모');
  await submit(h);
  const write = latest(h, names.write); assert.ok(write);
  assert.deepEqual(write.args.p_input, { ...input, memo: '조회 실패 후에도 보존할 합성 메모' });
  await h.reject(write, { code: '23514', message: 'teacher_request_stale' });
});

test('uncertain teacher withdrawal save retries the identical hours snapshot and request key once per gesture', async t => {
  const input = { ...inputs.withdrawal, completed_lesson_hours: '6', four_week_lesson_hours: '16' };
  const h = await edit(t, input);
  await change(h, [...document.querySelectorAll('textarea')].at(-1), '불확실 저장 합성 메모');
  await submit(h);
  const first = latest(h, names.write); assert.ok(first);
  await h.reject(first, { code: '57014', message: 'synthetic_uncertain_save' });
  assert.equal(button('닫기').disabled, true);
  const retryButton = button('저장 결과 확인'); assert.ok(retryButton);
  await h.act(() => { retryButton.click(); retryButton.click(); });
  assert.equal(calls(h, names.write).length, 2);
  const retry = latest(h, names.write);
  assert.deepEqual(retry.args, first.args, 'unknown outcome keeps the exact request ID, revision, and decimal strings');
  await h.reject(retry, { code: '23514', message: 'teacher_request_stale' });
});

test('teacher withdrawal rejects a partial hours-key contract before writes and when reading an own snapshot', async () => {
  const { api, requests, respond } = clientApi();
  for (const field of ['completed_lesson_hours', 'four_week_lesson_hours']) {
    const input = { ...inputs.withdrawal, [field]: '2' };
    for (const action of ['create', 'update']) await assert.rejects(api.mutateOwnRequest(teacherActor, { domain: 'withdrawal', id: action === 'create' ? null : id(600), action, input, revision: action === 'create' ? null : 'revision-a', requestId: id(998) }), error => error.code === '22023');
    respond(ownDetail('withdrawal', { input }));
    await assert.rejects(api.readOwnRequest('withdrawal', teacherActor, id(600), new AbortController().signal), /신청 데이터 형식/);
  }
  assert.equal(requests.some(request => request.name === names.write), false);
});

for (const [description, hours, expected] of [
  ['legacy missing', {}, ['계산된 값 없음', '계산된 값 없음', '계산된 값 없음']],
  ['missing completed', { completed_lesson_hours: '', four_week_lesson_hours: '16' }, ['계산된 값 없음', '16', '계산된 값 없음']],
  ['missing base', { completed_lesson_hours: '6', four_week_lesson_hours: '' }, ['6', '계산된 값 없음', '계산된 값 없음']],
  ['zero base', { completed_lesson_hours: '0', four_week_lesson_hours: '0' }, ['0', '0', '계산된 값 없음']],
]) test(`teacher own withdrawal summary keeps ${description} distinct from a zero percent result`, async t => {
  await showDetail(t, { ...inputs.withdrawal, ...hours });
  const values = ['진행 수업시수', '4주 기준 수업시수', '수업진행률'].map(label => [...document.querySelectorAll('dt')].find(node => node.textContent === label)?.nextElementSibling?.textContent);
  assert.deepEqual(values, expected);
});

test('teacher withdrawal preserves management fractional hours and legacy numeric-string minute overrides', async t => {
  const row = classRow();
  row.schedulePlan.sessions[0].lessonHours = '1.5';
  row.schedulePlan.sessions[1].duration_minutes = '90';
  row.schedulePlan.sessions[2].session_hours = '1.5';
  const management = actualMetrics.getWithdrawalScheduleMetrics(actualMetrics.getWithdrawalClassScheduleItems(row), '2026-11-04', row);
  assert.equal(management.completedLessonHours, '4.5'); assert.equal(management.fourWeekLessonHours, '16');
  const h = await editWithClass(t, row);
  await selectNovemberFourth(h); await submit(h);
  const write = latest(h, names.write); assert.ok(write);
  assert.equal(write.args.p_input.completed_lesson_hours, management.completedLessonHours);
  assert.equal(write.args.p_input.four_week_lesson_hours, management.fourWeekLessonHours);
  assert.equal(calls(h, names.schedule).length, 1);
  await h.reject(write, { code: '23514', message: 'teacher_request_stale' });
});

test('teacher withdrawal keeps its calendar usable but never fabricates hours when the safe calculation projection is unavailable', async t => {
  const row = classRow();
  row.schedulePlan.withdrawalHoursUnavailable = true;
  const h = await editWithClass(t, row);
  await selectNovemberFourth(h);
  assert.equal(calls(h, names.write).length, 0, 'calendar selection does not save or send');
  await submit(h);
  const write = latest(h, names.write); assert.ok(write);
  assert.equal(write.args.p_input.withdrawal_date, '2026-11-04');
  assert.equal(write.args.p_input.withdrawal_session, '11월 2회차');
  assert.equal(write.args.p_input.completed_lesson_hours, '', 'the untrusted full-plan duration cannot become a fallback total');
  assert.equal(write.args.p_input.four_week_lesson_hours, '', 'even the class weekly schedule must not fabricate a trusted snapshot');
  assert.equal(calls(h, names.detail).length, 1);
  assert.equal(calls(h, names.schedule).length, 1);
  assert.equal(calls(h, names.write).length, 1);
  assert.equal(h.requests.some(request => request.table || /notification|send|solapi/.test(request.name)), false);
  await h.reject(write, { code: '23514', message: 'teacher_request_stale' });
});
