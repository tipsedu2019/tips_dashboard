import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { setup, button, id } from './helpers/textbook-numbered-harness.mjs';
import { loadNotificationComponent } from './helpers/notification-component-loader.mjs';
import { bundle, envelope, ids as producerIds } from './helpers/registration-teacher-detail-fixtures.mjs';

const at = '2026-10-29T03:00:00Z';
function managementFunction(file, name) {
  const source = readFileSync(new URL(`../src/features/tasks/${file}`, import.meta.url), 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const node = ast.statements.find(item => ts.isFunctionDeclaration(item) && item.name?.text === name);
  assert.ok(node);
  const script = ts.transpileModule(source.slice(node.getStart(ast), node.end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return vm.runInNewContext(`${script}\n${name}`);
}
const managementReminderLabel = managementFunction('registration-appointment-editor.tsx', 'registrationCustomerReminderHistoryLabel');
const managementEnrollmentLabel = managementFunction('registration-enrollment-editor.tsx', 'enrollmentHistoryLabel');
const managementMutableEnrollment = managementFunction('registration-enrollment-editor.tsx', 'isMutableDraft');
const track = (n, subject) => ({ id: id(n), taskId: id(1), subject, status: 'waiting', workflowStatus: 'waiting_current_class', workflowRevision: 1, workflowStatusEnteredAt: at, stageEnteredAt: at, legacy: false, directorProfileId: id(20), directorName: '합성 책임자', directorAssignmentSource: 'manual', directorAssignmentRuleKey: '', waitingKind: 'current_class', waitingDetailKind: 'current_class', waitingDetailClassId: id(30), waitingDetailRetakeDecision: 'required', levelTestRetakeDecision: 'required', enrollmentDetailRows: [], migrationReviewRequired: false, phoneReadyAt: at, phoneReadySource: 'inquiry', observationSummaryVisible: true, observationAttemptCount: 1, observationCurrentId: id(50), observationCurrentStatus: 'completed', observationCurrentAppointmentId: id(51), observationNearestScheduledAt: at, observationNearestPlace: '본관', observationNotificationRevision: 1, observationRevision: 1, observationFeedbackRevision: 1 });
function fixture(taskId = id(1), name = '합성 학생') {
  const tracks = [track(2, '영어'), track(3, '수학')].map(t => ({ ...t, taskId }));
  tracks[0].enrollmentDetailRows = [{ classId: id(30), textbookIds: [id(40), id(41)], classStartDate: '2026-11-02', classStartSession: '11월 1회차' }];
  return { detail: { task: { id: taskId, type: 'registration', title: '등록 문의', studentName: name, campus: '본관', priority: 'normal', status: 'in_progress', memo: '', comments: [], attachments: [], events: [], registration: { schoolGrade: '중2', schoolName: '합성중', parentPhone: '010-0000-1111', studentPhone: '010-0000-2222', inquiryAt: at, requestNote: '합성 문의 메모' } }, commonRevision: 1, tracks,
    appointments: [{ id: id(4), taskId, kind: 'level_test', scheduledAt: at, place: '본관 2강', status: 'completed', notificationRevision: 1 }, { id: id(5), taskId, kind: 'visit_consultation', scheduledAt: at, place: '별관', status: 'completed', notificationRevision: 1 }],
    levelTests: [{ id: id(6), trackId: id(2), appointmentId: id(4), attemptNumber: 1, status: 'completed', startedAt: at, completedAt: at, materialLink: 'https://example.invalid/synthetic-result' }],
    consultations: [{ id: id(7), trackId: id(2), appointmentId: id(5), mode: 'visit', status: 'completed', directorProfileId: id(20), readyAt: at, readySource: 'inquiry', completedAt: at, outcome: 'waiting', note: '합성 영어 상담 내용', createdAt: at, updatedAt: at }, { id: id(8), trackId: id(3), appointmentId: null, mode: 'phone', status: 'completed', directorProfileId: id(20), readyAt: at, completedAt: at, outcome: 'enrollment', note: '합성 수학 상담 내용', createdAt: at, updatedAt: at }],
    enrollments: [{ id: id(9), trackId: id(2), classId: id(30), textbookId: id(40), textbookIds: [id(40), id(41)], classStartDate: '2026-11-02', classStartSession: '11월 1회차', classStartSessionKey: 'saved-1', status: 'enrolled', rosterActive: true, sortOrder: 0, createdAt: at, updatedAt: at }], admissionBatches: [], admissionChecklist: { applicationSent: true, makeeduRegistered: true, invoiceSent: false, paymentConfirmed: false, registrationCompleted: false }, admissionApplicationMessageId: null, admissionApplicationMessageStatus: '', admissionApplicationMessageClaimActive: false, admissionApplicationMessageUpdatedAt: null, admissionApplicationAccepted: false, comments: [], attachments: [], events: [{ id: id(70), taskId, trackId: id(2), subject: '영어', eventType: 'case_created', actorId: id(20), actorKind: 'user', occurredAt: at, payloadVersion: 2, metadata: {} }], migrationLegacy: null,
    collectionWindows: { scheduledAppointments: { loadedCount: 0, totalCount: 0, overflow: false }, currentEnrollments: { loadedCount: 1, totalCount: 1, overflow: false } } },
    profiles: [{ id: id(20), name: '합성 책임자' }], classes: [{ id: id(30), name: '합성 영어반' }], textbooks: [{ id: id(40), title: '합성 교재 1' }, { id: id(41), title: '합성 교재 2' }] };
}
const attempt = (taskId = id(1), trackId = id(2), label = '합성 청강반') => ({ observationId: id(50), taskId, trackId, appointmentId: id(51), appointmentStatus: 'completed', classId: id(30), className: label, subject: '영어', sessionDate: '2026-10-29', startsAt: at, endsAt: '2026-10-29T05:00:00Z', teacherName: '합성 청강 교사', classroomName: '합성 강의실', campus: '본관', textbooks: [{ id: id(40), title: '합성 청강 교재' }], progress: '합성 진도', status: 'completed', attendance: 'attended', suitabilityResult: 'fit', decisionKind: 'enrollment', revision: 1, feedbackRevision: 1 });
const manager = (taskId = id(1), trackId = id(2), label) => ({ track: { taskId, trackId, subject: '영어', workflowStatus: 'waiting_current_class' }, currentObservation: attempt(taskId, trackId, label), attempts: [attempt(taskId, trackId, label)], latestEnrollmentDecisionObservationId: id(50), latestDecisionObservation: { observationId: id(50), decisionKind: 'enrollment' }, classes: [] });
const feedback = (taskId = id(1), trackId = id(2)) => ({ ...attempt(taskId, trackId), feedbackReason: '합성 청강 피드백', proxySubmitted: true, feedbackSubmittedByName: '합성 대리 입력자', feedbackSubmittedAt: at });
function readers() {
  const calls = [];
  const pending = (kind, input, signal) => { const d = Promise.withResolvers(); calls.push({ kind, input, signal, ...d }); return d.promise; };
  return { calls, loadObservationDetail: (input, signal) => pending('detail', input, signal), loadObservationAttempt: (input, signal) => pending('attempt', input, signal), loadFeedback: (input, signal) => pending('feedback', input, signal) };
}
async function mount(t, patch = {}) {
  t.mock.method(globalThis, 'fetch', () => assert.fail('no real/provider requests'));
  const io = readers(), history = [];
  const deny = () => assert.fail('no mutation or provider calls');
  const props = { data: fixture(), viewerKey: 'teacher-a', enabled: true, readers: io, customerHistoryClient: { preview: deny, send: deny, check: deny, checkDelivery: deny, listCaseHistory: async input => { history.push(input); return { ok: true, page: input.page, pageSize: input.pageSize, totalCount: 0, history: [] }; } }, closeAction: '닫기', ...patch };
  const h = await setup(t, { component: { file: 'src/features/tasks/registration-teacher-detail.tsx', name: 'RegistrationTeacherDetail' }, props });
  t.after(() => { assert.equal(h.requests.length, 0, 'UI must not read raw relations, global catalogs, or any product service directly'); });
  return { ...h, io, props, history, async update(next) { Object.assign(props, next); await h.render(); } };
}
const findButton = label => [...document.querySelectorAll('button')].find(node => node.textContent.includes(label) || node.getAttribute('aria-label') === label);
const section = key => document.querySelector(`[data-registration-application-section="${key}"]`);
async function click(h, label) { const node = findButton(label); assert.ok(node, label); await h.act(() => node.click()); }

test('teacher case uses shared sections and preserves the saved management-visible values without edit controls', async t => {
  const h = await mount(t);
  assert.ok(document.querySelector('[data-registration-application-mode="detail"]'));
  for (const value of ['합성 학생', '합성중', '중2', '010-0000-1111', '010-0000-2222', '합성 문의 메모']) assert.ok(section('inquiry').textContent.includes(value), value);
  assert.match(section('level_test').textContent, /본관 2강/);
  assert.equal(section('level_test').querySelector('a')?.href, 'https://example.invalid/synthetic-result');
  for (const value of ['합성 책임자', '합성 영어 상담 내용', '별관', '대기']) assert.ok(section('consultation').textContent.includes(value), value);
  assert.match(section('waiting').textContent, /현재 학기 수강반 대기.*합성 영어반/s);
  for (const value of ['합성 영어반', '합성 교재 1', '합성 교재 2', '2026-11-02', '11월 1회차']) assert.ok(section('registration').textContent.includes(value), value);
  assert.equal(section('admission').querySelectorAll('input:checked').length, 2);
  assert.equal(document.querySelectorAll('form,input:not([disabled]),textarea,select,[contenteditable="true"]').length, 0);
  assert.equal([...document.querySelectorAll('button')].some(node => /저장|승인|발송 결과 확인|도착 여부 확인|예약 취소/.test(node.textContent)), false);
  await click(h, '자동 이력 보기');
  assert.match(document.body.textContent, /합성 책임자/);
  assert.equal(h.io.calls.length, 1, 'only scoped observation read starts');
});

test('subject switching discards late observations and shows only the selected subject facts', async t => {
  const h = await mount(t), old = h.io.calls[0];
  await click(h, '수학');
  assert.match(section('consultation').textContent, /합성 수학 상담 내용/);
  assert.doesNotMatch(section('consultation').textContent, /합성 영어 상담 내용/);
  assert.equal(old.signal.aborted, true);
  await h.act(() => old.resolve(manager(id(1), id(2), '늦은 영어 청강')));
  assert.doesNotMatch(document.body.textContent, /늦은 영어 청강/);
  const current = h.io.calls.at(-1);
  await h.act(() => current.resolve(manager(id(1), id(3), '현재 수학 청강')));
  assert.match(section('observation').textContent, /현재 수학 청강/);
});

test('observation and persisted feedback use scoped readers and render the shared pure feedback panel', async t => {
  const h = await mount(t);
  await h.act(() => h.io.calls[0].resolve(manager()));
  for (const value of ['합성 청강반', '합성 청강 교사', '합성 강의실', '합성 청강 교재', '합성 진도']) assert.ok(section('observation').textContent.includes(value), value);
  const read = h.io.calls.find(call => call.kind === 'feedback'); assert.ok(read);
  await h.act(() => read.resolve(feedback()));
  assert.match(section('observation').textContent, /합성 청강 피드백/);
  assert.match(section('observation').textContent, /대리 입력 · 합성 대리 입력자/);
  assert.deepEqual(read.input, { taskId: id(1), trackId: id(2), observationId: id(50) });
});

test('read failure retries explicitly and an access error is reported without exposing stale observations', async t => {
  const denied = [], h = await mount(t, { onPermissionDenied: error => denied.push(error) });
  await h.act(() => h.io.calls[0].reject(new Error('synthetic unavailable')));
  assert.match(section('observation').textContent, /불러오지 못했습니다/);
  await click(h, '청강 다시 불러오기');
  assert.equal(h.io.calls.length, 2);
  await h.act(() => h.io.calls[1].reject({ code: '42501' }));
  assert.equal(denied.length, 1);
  assert.doesNotMatch(document.body.textContent, /합성 청강반/);
});

test('case or viewer replacement and explicit access removal detach old responses', async t => {
  const h = await mount(t), old = h.io.calls[0];
  await h.update({ data: fixture(id(101), '다음 합성 학생'), viewerKey: 'teacher-b' });
  assert.equal(old.signal.aborted, true);
  await h.act(() => old.resolve(manager(id(1), id(2), '이전 민감 청강')));
  assert.doesNotMatch(document.body.textContent, /이전 민감 청강/);
  const current = h.io.calls.at(-1);
  await h.update({ enabled: false });
  assert.equal(current.signal.aborted, true);
  await h.act(() => current.resolve(manager(id(101), id(2), '권한 해제 뒤 청강')));
  assert.equal(document.querySelector('[data-registration-application-mode]'), null);
  assert.doesNotMatch(document.body.textContent, /다음 합성 학생|권한 해제 뒤 청강/);
});

test('persisted customer history is loaded only on opening and never checks a provider', async t => {
  const h = await mount(t); assert.equal(h.history.length, 0);
  await click(h, '알림톡 이력');
  assert.deepEqual(h.history, [{ taskId: id(1), page: 1, pageSize: 10 }]);
  assert.match(document.body.textContent, /발송 요청 이력이 없습니다/);
  assert.equal(button('발송 결과 확인'), undefined);
});

test('empty inquiry remains readable without tracks or fabricated activity and no observation reads', async t => {
  const data = fixture(); data.detail.tracks = []; data.detail.levelTests = []; data.detail.consultations = []; data.detail.enrollments = []; data.detail.events = [];
  const h = await mount(t, { data });
  assert.match(section('inquiry').textContent, /합성 학생/);
  assert.equal(document.querySelector('[role="tablist"]'), null);
  assert.match(section('level_test').textContent, /기록이 없습니다/);
  assert.equal(h.io.calls.length, 0);
});

test('legacy producer values survive the scoped service mapper and remain explicitly common history', async t => {
  const raw = bundle(); raw.levelTests = []; raw.consultations = [];
  raw.tracks[0].migration_review_required = true;
  Object.assign(raw.parent.ops_registration_details, { level_test_place: '기존 별관 시험실', level_test_material_link: 'https://example.invalid/legacy-result', level_test_result: '기존 합성 시험 결과', visit_consultation_place: '기존 상담 장소' });
  raw.events.push({ id: id(95), task_id: producerIds.task, event_type: 'legacy_registration_imported', actor_id: null, created_at: at,
    before_value: { classId: producerIds.class, textbookId: producerIds.textbook },
    after_value: { version: 1, timestamps: { levelTestAt: at, levelTestCompletedAt: at, phoneConsultationAt: at, visitConsultationAt: at, consultationAt: at, classStartDate: '2026-11-02', classStartSession: '기존 1회차' }, legacyBooleans: { admissionNoticeSent: true, makeeduRegistered: true, makeeduInvoiceSent: false, paymentChecked: false } } });
  const { createRegistrationTeacherDetailService } = loadNotificationComponent('src/features/tasks/registration-teacher-detail-service.ts');
  const requests = [];
  const client = { rpc(name, args) { requests.push({ name, args }); return Promise.resolve({ data: envelope('case', raw), error: null }); } };
  const data = await createRegistrationTeacherDetailService(client).loadCase({ taskId: producerIds.task });
  assert.equal(data.detail.task.registration.levelTestResult, undefined, 'the actual mapper does not put legacy fields in common inquiry');
  await mount(t, { data });
  for (const value of ['기존 이관 기록', '기존 별관 시험실', '기존 합성 시험 결과', '기존 상담 장소', '합성 수학반', '합성 교재', '기존 1회차']) assert.ok(section('inquiry').textContent.includes(value), value);
  assert.equal(section('inquiry').querySelector('a')?.href, 'https://example.invalid/legacy-result');
  assert.match(section('inquiry').textContent, /입학 안내.*완료.*수납 확인.*미완료/s);
  assert.doesNotMatch(section('level_test').textContent, /기존 합성 시험 결과/);
  assert.equal(requests.length, 1, 'one scoped mock read; no global catalogs');
});

test('a direct older observation uses the exact scoped attempt reader and rejects an unrelated result', async t => {
  const h = await mount(t, { initialObservationId: id(90), focusTrackId: id(2) });
  await h.act(() => h.io.calls[0].resolve(manager()));
  const request = h.io.calls.find(call => call.kind === 'attempt'); assert.ok(request);
  assert.deepEqual(request.input, { taskId: id(1), trackId: id(2), observationId: id(90) });
  await h.act(() => request.resolve({ taskId: id(1), trackId: id(3), observation: { ...attempt(id(1), id(3), '타 과목 청강'), observationId: id(90) } }));
  assert.doesNotMatch(document.body.textContent, /타 과목 청강/);
  assert.match(section('observation').textContent, /청강 이력 정보를 불러오지 못했습니다/);
  assert.equal(h.io.calls.some(call => call.kind === 'feedback'), false);
});

test('switching away from a direct observation does not reuse its target for another subject', async t => {
  const h = await mount(t, { initialObservationId: id(90), focusTrackId: id(2) });
  await click(h, '수학');
  await h.act(() => h.io.calls.at(-1).resolve(manager(id(1), id(3), '현재 수학 청강')));
  assert.equal(h.io.calls.some(call => call.kind === 'attempt' && call.input.trackId === id(3)), false);
  assert.match(section('observation').textContent, /현재 수학 청강/);
});

test('persisted customer history paginates scoped stored values without provider check controls', async t => {
  const requests = [];
  const forbidden = () => assert.fail('provider operations must remain absent');
  const h = await mount(t, { customerHistoryClient: { preview: forbidden, send: forbidden, check: forbidden, checkDelivery: forbidden, listCaseHistory: async input => { requests.push(input); return { ok: true, page: input.page, pageSize: input.pageSize, totalCount: 11, history: [{ messageId: id(80 + input.page), messageKind: 'level_test_booking', currentStatus: 'accepted', confirmedByName: `합성 발송자 ${input.page}`, confirmedAt: at, updatedAt: at, recipientLast4: '1234', canCheck: false, canCheckDelivery: false }] }; } } });
  await click(h, '알림톡 이력');
  assert.match(document.body.textContent, /합성 발송자 1/);
  assert.match(document.body.textContent, /수신 번호 끝 1234/);
  await h.act(() => document.querySelector('[aria-label="2 페이지"]').click());
  assert.match(document.body.textContent, /합성 발송자 2/);
  assert.equal(requests.length, 2); assert.deepEqual(requests[1], { taskId: id(1), page: 2, pageSize: 10 });
  assert.equal([...document.querySelectorAll('button')].some(node => /발송 결과 확인|도착 여부 확인/.test(node.textContent)), false);
});

test('a customer history response with actionable capabilities is rejected rather than exposed', async t => {
  const h = await mount(t, { customerHistoryClient: { listCaseHistory: async input => ({ ok: true, page: input.page, pageSize: input.pageSize, totalCount: 1, history: [{ messageId: id(80), messageKind: 'level_test_booking', currentStatus: 'unknown', confirmedByName: '노출 금지', confirmedAt: at, updatedAt: at, canCheck: true, canCheckDelivery: false }] }) } });
  await click(h, '알림톡 이력');
  assert.match(document.body.textContent, /알림톡 이력을 불러오지 못했습니다/);
  assert.doesNotMatch(document.body.textContent, /노출 금지/);
});

for (const width of [390, 1280]) test(`saved registration facts remain present at ${width}px with standard subject keyboard navigation`, async t => {
  const h = await mount(t);
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  await h.act(() => window.dispatchEvent(new window.Event('resize')));
  assert.match(section('inquiry').textContent, /합성 문의 메모/);
  assert.match(section('registration').textContent, /합성 교재 1/);
  const english = document.getElementById(`registration-subject-tab-${id(2)}`);
  await h.act(() => english.dispatchEvent(new window.KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' })));
  assert.equal(document.getElementById(`registration-subject-tab-${id(3)}`).getAttribute('aria-selected'), 'true');
  assert.match(section('consultation').textContent, /합성 수학 상담 내용/);
});

for (const state of ['sent', 'unknown', 'processing', 'failed_hold']) test(`stored ${state} reminder status matches the actual management label without provider checks`, async t => {
  const data = fixture(), reminder = { state, scheduledFor: at, sentAt: state === 'sent' ? at : null, updatedAt: at };
  data.detail.appointments.forEach(item => { item.customerReminder = reminder; });
  await mount(t, { data });
  const expected = managementReminderLabel(reminder);
  assert.ok(section('level_test').textContent.includes(expected));
  assert.ok(section('consultation').textContent.includes(expected));
  assert.equal([...document.querySelectorAll('button')].some(node => /발송 결과 확인|도착 여부 확인/.test(node.textContent)), false);
});

test('incomplete appointment and enrollment windows disclose both bounded reads', async t => {
  const data = fixture();
  data.detail.collectionWindows.scheduledAppointments = { loadedCount: 30, totalCount: 31, overflow: true };
  data.detail.collectionWindows.currentEnrollments = { loadedCount: 30, totalCount: 31, overflow: true };
  await mount(t, { data });
  assert.match(section('level_test').textContent, /예약.*일부만 조회/);
  assert.match(section('consultation').textContent, /예약.*일부만 조회/);
  assert.match(section('registration').textContent, /등록 실행 이력 일부만 조회/);
});

test('enrollment history keeps management labels for each stored lifecycle state', async t => {
  const data = fixture(), base = data.detail.enrollments[0];
  const variants = [{ status: 'canceled' }, { status: 'enrolled', rosterActive: false, rosterReleaseKind: 'transfer' }, { status: 'enrolled', rosterActive: false, rosterReleaseKind: 'withdrawal' }, { status: 'enrolled', rosterActive: false, rosterReleaseKind: null }, { status: 'enrolled', rosterActive: true }, { status: 'waitlisted' }, { status: 'planned', admissionBatchId: id(90) }, { status: 'planned', admissionBatchId: null }];
  data.detail.enrollments = variants.map((variant, index) => ({ ...base, ...variant, id: id(100 + index) }));
  await mount(t, { data });
  for (const row of data.detail.enrollments.filter(row => !managementMutableEnrollment(row))) assert.ok(section('registration').textContent.includes(managementEnrollmentLabel(row)), JSON.stringify(row));
});

for (const location of ['current', 'older']) test(`direct ${location} observation refuses an appointment mismatch before showing detail or feedback`, async t => {
  const observationId = location === 'current' ? id(50) : id(90);
  const h = await mount(t, { initialObservationId: observationId, initialAppointmentId: id(99), focusTrackId: id(2) });
  await h.act(() => h.io.calls[0].resolve(manager()));
  if (location === 'older') {
    const request = h.io.calls.find(call => call.kind === 'attempt'); assert.ok(request);
    await h.act(() => request.resolve({ taskId: id(1), trackId: id(2), observation: { ...attempt(), observationId } }));
  }
  assert.match(section('observation').textContent, /청강 대상 정보를 확인할 수 없습니다/);
  assert.doesNotMatch(section('observation').textContent, /합성 청강반/);
  assert.equal(h.io.calls.some(call => call.kind === 'feedback'), false);
});

test('saved registration fields prefer mutable rows over older saved detail, while completed enrollments stay history', async t => {
  const data = fixture(), active = data.detail.enrollments[0];
  data.detail.tracks[0].enrollmentDetailRows = [{ ...active, classStartSession: '이전 저장 스냅샷' }];
  data.detail.enrollments.push({ ...active, id: id(91), studentId: null, admissionBatchId: null, status: 'planned', rosterActive: false, classStartSession: '현재 저장된 초안' });
  assert.ok(managementMutableEnrollment(data.detail.enrollments[1]));
  await mount(t, { data });
  assert.match(section('registration').textContent, /현재 저장된 초안/);
  assert.doesNotMatch(section('registration').textContent, /이전 저장 스냅샷/);
  assert.match(section('registration').textContent, /합성 교재 1.*합성 교재 2/s);
  assert.match(section('registration').querySelector('details').textContent, /수강 이력 1건.*수강 중/s);
});

test('feedback failure retries and late feedback cannot cross subject or access boundaries', async t => {
  const denied = [], h = await mount(t, { onPermissionDenied: error => denied.push(error) });
  await h.act(() => h.io.calls[0].resolve(manager()));
  const failed = h.io.calls.find(call => call.kind === 'feedback');
  await h.act(() => failed.reject(new Error('synthetic failure')));
  assert.match(section('observation').textContent, /청강 피드백 정보를 불러오지 못했습니다/);
  await click(h, '청강 피드백 다시 불러오기');
  const late = h.io.calls.at(-1); assert.equal(late.kind, 'feedback');
  await click(h, '수학'); assert.equal(late.signal.aborted, true);
  await h.act(() => late.resolve({ ...feedback(), feedbackReason: '이전 과목 민감 피드백' }));
  assert.doesNotMatch(document.body.textContent, /이전 과목 민감 피드백/);
  const current = h.io.calls.at(-1);
  await h.act(() => current.resolve(manager(id(1), id(3))));
  await h.act(() => h.io.calls.at(-1).reject({ status: 403 }));
  assert.equal(denied.length, 1);
  await h.update({ enabled: false });
  assert.equal(document.querySelector('[data-registration-application-mode]'), null);
});

test('persisted history permission errors notify its owner and late close responses never reappear', async t => {
  const calls = [], denied = [];
  const h = await mount(t, { onPermissionDenied: error => denied.push(error), customerHistoryClient: { listCaseHistory: (input, signal) => { const read = Promise.withResolvers(); calls.push({ ...read, input, signal }); return read.promise; } } });
  await click(h, '알림톡 이력');
  await h.act(() => calls[0].reject({ status: 401 }));
  assert.equal(denied.length, 1);
  assert.match(document.body.textContent, /알림톡 이력을 불러오지 못했습니다/);
  await h.update({ enabled: false });
  await h.update({ enabled: true });
  await click(h, '알림톡 이력');
  const late = calls.at(-1);
  await h.update({ enabled: false });
  assert.equal(late.signal.aborted, true);
  await h.act(() => late.resolve({ ok: true, page: 1, pageSize: 10, totalCount: 1, history: [{ messageId: id(80), messageKind: 'level_test_booking', currentStatus: 'accepted', confirmedByName: '닫힌 화면 이력', confirmedAt: at, updatedAt: at, canCheck: false, canCheckDelivery: false }] }));
  assert.doesNotMatch(document.body.textContent, /닫힌 화면 이력/);
});

test('untrusted result text stays inert and empty fields are explicit', async t => {
  const data = fixture(); data.detail.levelTests[0].materialLink = 'javascript:synthetic()'; data.detail.task.registration.requestNote = '';
  await mount(t, { data });
  assert.equal(section('level_test').querySelector('a'), null);
  assert.match(section('level_test').textContent, /javascript:synthetic/);
  assert.match(section('inquiry').textContent, /요청 사항미입력/);
});

test('same-case route navigation updates subject and observation without remounting keyboard tabs', async t => {
  const h = await mount(t, { focusTrackId: id(2) }), old = h.io.calls[0];
  const mathTab = document.getElementById(`registration-subject-tab-${id(3)}`);
  await h.act(() => mathTab.focus());
  await h.update({ focusTrackId: id(3), initialObservationId: id(90), initialAppointmentId: id(51) });
  assert.equal(document.getElementById(`registration-subject-tab-${id(3)}`), mathTab);
  assert.equal(document.activeElement, mathTab);
  assert.equal(mathTab.getAttribute('aria-selected'), 'true');
  assert.equal(old.signal.aborted, true);
  await h.act(() => h.io.calls.at(-1).resolve(manager(id(1), id(3))));
  assert.deepEqual(h.io.calls.at(-1).input, { taskId: id(1), trackId: id(3), observationId: id(90) });
  const oldAttempt = h.io.calls.at(-1);
  await h.update({ focusTrackId: id(2), initialObservationId: null, initialAppointmentId: null });
  assert.equal(oldAttempt.signal.aborted, true);
  assert.equal(document.getElementById(`registration-subject-tab-${id(2)}`).getAttribute('aria-selected'), 'true');
  await h.act(() => oldAttempt.resolve({ taskId: id(1), trackId: id(3), observation: { ...attempt(id(1), id(3), '이전 URL 청강'), observationId: id(90) } }));
  assert.doesNotMatch(document.body.textContent, /이전 URL 청강/);
});

test('changing only the direct observation target discards the previous detail and selects the new scoped result', async t => {
  const h = await mount(t, { focusTrackId: id(2), initialObservationId: id(90), initialAppointmentId: id(51) });
  await h.act(() => h.io.calls[0].resolve(manager()));
  const old = h.io.calls.at(-1); assert.equal(old.kind, 'attempt');
  await h.update({ initialObservationId: id(91) });
  assert.equal(old.signal.aborted, true);
  await h.act(() => h.io.calls.at(-1).resolve(manager()));
  const next = h.io.calls.at(-1); assert.equal(next.input.observationId, id(91));
  await h.act(() => next.resolve({ taskId: id(1), trackId: id(2), observation: { ...attempt(id(1), id(2), '새 URL 청강'), observationId: id(91) } }));
  assert.match(section('observation').textContent, /새 URL 청강/);
  await h.act(() => old.resolve({ taskId: id(1), trackId: id(2), observation: { ...attempt(id(1), id(2), '이전 URL 청강'), observationId: id(90) } }));
  assert.doesNotMatch(section('observation').textContent, /이전 URL 청강/);
});
