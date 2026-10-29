import assert from 'node:assert/strict';
import test from 'node:test';
import { loadNotificationComponent } from './helpers/notification-component-loader.mjs';

const path = 'src/features/tasks/registration-teacher-detail-service.ts';
import { id, ids, time, clone, bundle, envelope, history, attempt, observationDetail, feedback, trackInput, observationInput } from './helpers/registration-teacher-detail-fixtures.mjs';
function harness() {
  const calls = [];
  let reply = { data: envelope('case', bundle()), error: null };
  const client = { rpc(name, args) { const request = { name, args, signal: null, retry: null }; const response = reply; calls.push(request); return { abortSignal(signal) { request.signal = signal; return this; }, retry(retry) { request.retry = retry; return this; }, then(resolve, reject) { return Promise.resolve(typeof response === 'function' ? response() : response).then(resolve, reject); } }; } };
  const api = loadNotificationComponent(path);
  return { api, service: api.createRegistrationTeacherDetailService(client), calls, respond(data) { reply = { data, error: null }; }, fail(error) { reply = { data: null, error }; }, deferred(promise) { reply = () => promise; } };
}

test('teacher case read maps non-empty producer fields through the existing management mappers', async () => {
  const h = harness(), raw = bundle(), before = clone(raw); h.respond(envelope('case', raw));
  const result = await h.service.loadCase({ taskId: ids.task });
  const { detail } = result;
  assert.equal(detail.task.studentName, '합성 학생');
  assert.deepEqual(detail.task.registration, { pipelineStatus: '1. 레벨테스트 예약', inquiryAt: time, schoolGrade: '중2', schoolName: '합성 학교', parentPhone: '01000000001', studentPhone: '01000000002', requestNote: '합성 요청 사항', admissionNoticeSent: false });
  assert.equal(detail.comments[0].body, '합성 댓글'); assert.equal(detail.comments[0].authorId, '');
  assert.equal(detail.attachments[0].driveLink, 'https://example.invalid/document');
  assert.equal(detail.tracks[0].directorProfileId, null); assert.equal(detail.tracks[0].directorName, '');
  assert.equal(detail.levelTests[0].materialLink, 'https://example.invalid/result'); assert.equal(detail.consultations[0].note, '합성 상담 내용');
  assert.equal(detail.enrollments[0].classStartSession, '1회차'); assert.equal(detail.appointments[0].customerReminder.state, 'scheduled');
  assert.equal(detail.admissionApplicationAccepted, true); assert.equal(detail.events[0].legacyText, '합성 이력');
  assert.equal(detail.collectionWindows.scheduledAppointments.overflow, true); assert.equal(detail.collectionWindows.currentEnrollments.totalCount, 31);
  assert.deepEqual(result.classes, raw.classes); assert.deepEqual(result.textbooks, raw.textbooks); assert.deepEqual(result.profiles, raw.profiles);
  assert.deepEqual(raw, before); assert.equal(h.calls.length, 1);
  assert.deepEqual(h.calls[0].args, { p_task_id: ids.task, p_section: 'case', p_track_id: null, p_observation_id: null, p_page: 1, p_page_size: 10 });
  assert.equal(h.calls[0].name, 'get_registration_teacher_detail_v1'); assert.equal(h.calls[0].retry, false);
});

test('teacher case accepts empty nullable data without inventing labels or current counts', async () => {
  const h = harness(), raw = bundle();
  for (const key of ['tracks','appointments','levelTests','consultations','admissionBatches','enrollments','events','reminderSummaries','profiles','classes','textbooks']) raw[key] = [];
  raw.parent.ops_task_comments = []; raw.parent.ops_task_attachments = []; raw.parent.ops_registration_details = {}; raw.activeAdmissionMessage = null; raw.scheduledAppointmentTotal = 0; raw.currentEnrollmentTotal = 0;
  h.respond(envelope('case', raw)); const result = await h.service.loadCase({ taskId: ids.task });
  assert.equal(result.detail.task.registration.parentPhone, ''); assert.equal(result.detail.admissionApplicationMessageId, null); assert.equal(result.detail.collectionWindows.scheduledAppointments.overflow, false);
  assert.deepEqual(result.detail.tracks, []); assert.deepEqual(result.profiles, []);
});

for (const [label, mutate] of [
  ['wrong version', value => { value.contractVersion = 2; }],
  ['wrong task', value => { value.taskId = id(90); }],
  ['wrong section', value => { value.section = 'feedback'; }],
  ['extra envelope key', value => { value.canManage = true; }],
  ['extra data key', value => { value.data.providerToken = 'synthetic-reject'; }],
  ['foreign parent', value => { value.data.parent.id = id(90); }],
  ['other task type', value => { value.data.parent.type = 'withdrawal'; }],
  ['foreign track', value => { value.data.tracks[0].task_id = id(90); }],
  ['foreign appointment', value => { value.data.appointments[0].task_id = id(90); }],
  ['foreign enrollment', value => { value.data.enrollments[0].track_id = id(90); }],
  ['foreign comment', value => { value.data.parent.ops_task_comments[0].task_id = id(90); }],
  ['foreign event', value => { value.data.events[0].task_id = id(90); }],
  ['duplicate track id', value => { value.data.tracks.push(clone(value.data.tracks[0])); }],
  ['missing reminder', value => { value.data.reminderSummaries = []; }],
  ['invalid count', value => { value.data.scheduledAppointmentTotal = -1; }],
  ['count smaller than current rows', value => { value.data.currentEnrollmentTotal = 0; }],
  ['extra profile field', value => { value.data.profiles[0].email = 'synthetic@example.invalid'; }],
]) test(`teacher case fails closed for ${label}`, async () => {
  const h = harness(), value = envelope('case', bundle()); mutate(value); h.respond(value);
  await assert.rejects(h.service.loadCase({ taskId: ids.task }));
});

test('teacher read has no cache, propagates permission revocation, and does not retry', async () => {
  const h = harness(); await h.service.loadCase({ taskId: ids.task });
  const denied = { code: '42501', message: 'registration_teacher_detail_forbidden' }; h.fail(denied);
  await assert.rejects(h.service.loadCase({ taskId: ids.task }), error => error === denied);
  assert.equal(h.calls.length, 2); assert.ok(h.calls.every(call => call.retry === false));
});

test('aborted and stale reads never publish a late response', async () => {
  const h = harness(), controller = new AbortController(); let resolve;
  h.deferred(new Promise(done => { resolve = done; }));
  const read = h.service.loadCase({ taskId: ids.task }, controller.signal); controller.abort(); resolve({ data: envelope('case', bundle()), error: null });
  await assert.rejects(read, error => error.name === 'AbortError');
  const already = new AbortController(); already.abort();
  const count = h.calls.length; await assert.rejects(h.service.loadCase({ taskId: ids.task }, already.signal)); assert.equal(h.calls.length, count);
});

test('history read reuses the strict public history contract with provider checks disabled', async () => {
  const h = harness(); h.respond(envelope('customer_history', history()));
  const client = h.service.customerHistoryClient(ids.task); const result = await client.listCaseHistory({ taskId: ids.task, page: 1, pageSize: 10 });
  assert.deepEqual(result, history()); assert.equal(h.calls[0].args.p_section, 'customer_history');
  for (const method of ['preview','send','list','check','checkDelivery','reconcile','releasePreSend']) await assert.rejects(client[method]({}), /read_only/);
  assert.equal(h.calls.length, 1, 'unsupported actions fail locally without RPC/provider calls');
  await assert.rejects(client.listCaseHistory({ taskId: id(99), page: 1, pageSize: 10 })); assert.equal(h.calls.length, 1);
});
for (const flag of ['canCheck','canCheckDelivery']) test(`teacher history rejects enabled ${flag} instead of exposing an action`, async () => {
  const h = harness(), value = history(); value.history[0][flag] = true;
  if (flag === 'canCheck') value.history[0].currentStatus = 'unknown';
  h.respond(envelope('customer_history', value)); await assert.rejects(h.service.listCaseHistory({ taskId: ids.task, page: 1, pageSize: 10 }));
});
test('history page mismatch and invalid inputs fail closed', async () => {
  const h = harness(); h.respond(envelope('customer_history', history()));
  await assert.rejects(h.service.listCaseHistory({ taskId: ids.task, page: 2, pageSize: 10 }));
  const count = h.calls.length;
  for (const input of [{ taskId: 'bad' },{ taskId: ids.task, extra: true }]) await assert.rejects(h.service.loadCase(input));
  for (const page of [0,100001,1.5]) await assert.rejects(h.service.listCaseHistory({ taskId: ids.task, page, pageSize: 10 }));
  assert.equal(h.calls.length, count);
});

test('observation reads return saved display fields without source hashes or booking capabilities', async () => {
  const h = harness(); h.respond(envelope('observation_detail', observationDetail()));
  assert.deepEqual(await h.service.loadObservationDetail(trackInput()), observationDetail());
  assert.equal(h.calls[0].args.p_track_id, ids.track);
  const old = { taskId: ids.task, trackId: ids.track, observation: attempt() }; h.respond(envelope('observation_attempt', old));
  assert.deepEqual(await h.service.loadObservationAttempt(observationInput()), old);
  h.respond(envelope('feedback', feedback())); assert.deepEqual(await h.service.loadFeedback(observationInput()), feedback());
  assert.deepEqual(h.calls.map(call => call.args.p_section), ['observation_detail','observation_attempt','feedback']);
  assert.ok(h.calls.every(call => call.name === 'get_registration_teacher_detail_v1'));
});
test('observation empty current and nullable feedback are retained honestly', async () => {
  const h = harness(), data = { ...observationDetail(), currentObservation: null, attempts: [] }; h.respond(envelope('observation_detail', data));
  assert.deepEqual(await h.service.loadObservationDetail(trackInput()), data);
  const saved = { ...feedback(), status: 'scheduled', attendance: null, decisionKind: null, suitabilityResult: null, feedbackReason: null, proxySubmitted: false, feedbackSubmittedByName: null, feedbackSubmittedAt: null };
  h.respond(envelope('feedback', saved)); assert.deepEqual(await h.service.loadFeedback(observationInput()), saved);
});
for (const [label, mutate] of [
  ['foreign track', x => { x.track.trackId = id(99); }],
  ['foreign task', x => { x.track.taskId = id(99); }],
  ['foreign attempt', x => { x.attempts[0].trackId = id(99); }],
  ['same-ID conflicting current display', x => { x.currentObservation.className = '다른 합성 반'; }],
  ['foreign current task', x => { x.currentObservation.taskId = id(99); }],
  ['foreign current track', x => { x.currentObservation.trackId = id(99); }],
  ['foreign current subject outside window', x => { x.currentObservation.observationId = id(99); x.currentObservation.subject = '영어'; }],
  ['duplicate attempts', x => { x.attempts.push(attempt()); }],
  ['attempt window overflow', x => { x.attempts = Array.from({ length: 21 }, (_, i) => ({ ...attempt(), observationId: id(100 + i) })); x.currentObservation = null; }],
  ['booking hash', x => { x.attempts[0].bookingFactHash = 'synthetic'; }],
  ['catalog metadata', x => { x.attempts[0].textbooks[0].textbookId = id(99); }],
  ['invalid timestamp', x => { x.attempts[0].startsAt = 'not-time'; }],
  ['invalid lifecycle enum', x => { x.attempts[0].status = 'sent'; }],
]) test(`observation detail rejects ${label}`, async () => {
  const h = harness(), data = observationDetail(); mutate(data); h.respond(envelope('observation_detail', data)); await assert.rejects(h.service.loadObservationDetail(trackInput()));
});
test('observation attempt and feedback each validate requested identifiers', async () => {
  const h = harness(); h.respond(envelope('observation_attempt', { taskId: ids.task, trackId: ids.track, observation: { ...attempt(), observationId: id(99) } }));
  await assert.rejects(h.service.loadObservationAttempt(observationInput()));
  for (const field of ['taskId','trackId','observationId']) { h.respond(envelope('feedback', { ...feedback(), [field]: id(99) })); await assert.rejects(h.service.loadFeedback(observationInput())); }
});
test('feedback rejects forged submitter tuples and hidden mutation metadata', async () => {
  const h = harness();
  for (const change of [{ feedbackSubmittedByName: null },{ feedbackSubmittedAt: null },{ revision: 42 },{ sourceRevision: {} },{ proxySubmitted: 'yes' }]) {
    h.respond(envelope('feedback', { ...feedback(), ...change })); await assert.rejects(h.service.loadFeedback(observationInput()));
  }
});

// The current row is fetched independently of the existing newest-20 window.
test('current observation outside the newest 20 preserves the original window and order', async () => {
  const h = harness(), data = observationDetail();
  data.attempts = Array.from({ length: 20 }, (_, i) => ({ ...attempt(), observationId: id(100 + i) }));
  const before = clone(data); h.respond(envelope('observation_detail', data));
  const result = await h.service.loadObservationDetail(trackInput());
  assert.deepEqual(result, before); assert.deepEqual(data, before);
  assert.equal(result.attempts.length, 20);
  assert.ok(result.attempts.every(row => row.observationId !== result.currentObservation.observationId));
});
test('request identifiers and history pagination are copied before awaiting the response', async () => {
  const h = harness(), input = observationInput(); let resolve;
  h.deferred(new Promise(done => { resolve = done; }));
  const read = h.service.loadObservationAttempt(input);
  Object.assign(input, { taskId: id(90), trackId: id(91), observationId: id(92) });
  resolve({ data: envelope('observation_attempt', { taskId: ids.task, trackId: ids.track, observation: attempt() }), error: null });
  assert.equal((await read).observation.observationId, id(30));
  const page = { taskId: ids.task, page: 1, pageSize: 10 }; let resolvePage;
  h.deferred(new Promise(done => { resolvePage = done; }));
  const historyRead = h.service.listCaseHistory(page); page.page = 2;
  resolvePage({ data: envelope('customer_history', history()), error: null });
  assert.equal((await historyRead).page, 1);
});
test('UUID inputs are canonicalized consistently for request and response ownership', async () => {
  const h = harness(), taskId = 'abcdefab-abcd-4abc-8abc-abcdefabcdef', trackId = 'bcdefabc-abcd-4abc-8abc-abcdefabcdef', observationId = 'cdefabcd-abcd-4abc-8abc-abcdefabcdef';
  const saved = { ...feedback(), taskId, trackId, observationId };
  h.respond(envelope('feedback', saved, taskId));
  assert.deepEqual(await h.service.loadFeedback({ taskId: taskId.toUpperCase(), trackId: trackId.toUpperCase(), observationId: observationId.toUpperCase() }), saved);
  assert.equal(h.calls[0].args.p_task_id, taskId); assert.equal(h.calls[0].args.p_track_id, trackId);
});
test('target switches keep parallel responses scoped and abort only the superseded read', async () => {
  const h = harness(), abandoned = new AbortController(); let resolveFirst, resolveSecond;
  h.deferred(new Promise(done => { resolveFirst = done; }));
  const first = h.service.loadObservationDetail(trackInput(), abandoned.signal);
  const nextTrack = id(99), next = observationDetail();
  next.track.trackId = nextTrack; next.currentObservation.trackId = nextTrack; next.attempts[0].trackId = nextTrack;
  h.deferred(new Promise(done => { resolveSecond = done; }));
  const second = h.service.loadObservationDetail({ taskId: ids.task, trackId: nextTrack });
  abandoned.abort(); resolveSecond({ data: envelope('observation_detail', next), error: null });
  resolveFirst({ data: envelope('observation_detail', observationDetail()), error: null });
  await assert.rejects(first, error => error.name === 'AbortError');
  assert.deepEqual(await second, next); assert.equal(h.calls.length, 2);
});

test('the same synthetic rows produce identical teacher and existing management case detail', async () => {
  const raw = bundle(), queries = [], rpcNames = [];
  const { createRegistrationTrackService } = loadNotificationComponent('src/features/tasks/registration-track-service.ts');
  const client = {
    from(table) {
      const query = { table, filters: [], counted: false };
      const builder = {};
      for (const method of ['select','eq','neq','in','is','or','order','limit','abortSignal','retry','single']) {
        builder[method] = (...args) => {
          if (method === 'select') query.counted = args[1]?.count === 'exact';
          if (['eq','neq','in','is','or'].includes(method)) query.filters.push([method, ...args]);
          return builder;
        };
      }
      builder.then = (resolve, reject) => Promise.resolve().then(() => {
        queries.push(query);
        let data, count;
        switch (table) {
          case 'ops_tasks': data = raw.parent; break;
          case 'ops_task_events': data = raw.events; break;
          case 'ops_registration_messages': data = [raw.activeAdmissionMessage]; break;
          case 'ops_registration_subject_tracks':
            data = raw.tracks.map(track => ({ ...track,
              active_level_tests: raw.levelTests.filter(row => row.track_id === track.id && ['scheduled','in_progress'].includes(row.status)),
              level_test_history: raw.levelTests.filter(row => row.track_id === track.id && ['completed','absent','canceled'].includes(row.status)),
              active_consultations: raw.consultations.filter(row => row.track_id === track.id && ['waiting','scheduled'].includes(row.status)),
              consultation_history: raw.consultations.filter(row => row.track_id === track.id && ['completed','canceled'].includes(row.status)),
            })); break;
          case 'ops_registration_appointments': {
            const statuses = query.filters.find(([method, field]) => method === 'in' && field === 'status')[2];
            data = raw.appointments.filter(row => statuses.includes(row.status)); count = raw.scheduledAppointmentTotal; break;
          }
          case 'ops_registration_admission_batches': {
            const statuses = query.filters.find(([method, field]) => method === 'in' && field === 'status')[2];
            data = raw.admissionBatches.filter(row => statuses.includes(row.status)); break;
          }
          case 'ops_registration_enrollments':
            data = raw.enrollments.filter(row => query.counted
              ? ['planned','waitlisted'].includes(row.status) || (row.status === 'enrolled' && row.roster_active)
              : row.status === 'canceled' || (row.status === 'enrolled' && !row.roster_active));
            count = raw.currentEnrollmentTotal; break;
          default: assert.fail(`unexpected management table ${table}`);
        }
        return { data: clone(data), count: query.counted ? count : null, error: null };
      }).then(resolve, reject);
      return builder;
    },
    async rpc(name) {
      rpcNames.push(name); assert.equal(name, 'get_registration_customer_reminder_summaries_v1');
      return { data: clone(raw.reminderSummaries), error: null };
    },
  };
  const management = createRegistrationTrackService(client, {
    probeRuntime: async () => ({ mode: 'ready', version: 1 }),
    probeIntakeRuntime: async () => ({ available: true, version: 1 }),
    probeObservationRuntime: async () => ({ available: true, runtimeVersion: 1 }),
  });
  const managerDetail = await management.loadCaseDetail(ids.task, ids.profile, { observationAware: true });
  const h = harness(); h.respond(envelope('case', raw));
  assert.deepEqual((await h.service.loadCase({ taskId: ids.task })).detail, managerDetail);
  assert.ok(queries.length > 0); assert.deepEqual(rpcNames, ['get_registration_customer_reminder_summaries_v1']);
});

test('transport failures and missing targets remain visible without cached data or fallback reads', async () => {
  const h = harness(); await h.service.loadCase({ taskId: ids.task });
  const transport = new Error('synthetic transport failure');
  h.deferred(Promise.reject(transport));
  await assert.rejects(h.service.loadCase({ taskId: ids.task }), error => error === transport);
  const missing = { code: 'P0002', message: 'registration_teacher_detail_not_found' }; h.fail(missing);
  await assert.rejects(h.service.loadCase({ taskId: ids.task }), error => error === missing);
  assert.equal(h.calls.length, 3); assert.ok(h.calls.every(call => call.retry === false));
});
