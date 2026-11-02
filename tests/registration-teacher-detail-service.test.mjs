import assert from 'node:assert/strict';
import test from 'node:test';
import { createClient } from '@supabase/supabase-js';
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
  assert.deepEqual(detail.comments, []); assert.deepEqual(detail.attachments, []);
  assert.deepEqual(detail.task.comments, []); assert.deepEqual(detail.task.attachments, []);
  assert.equal(Object.hasOwn(raw.parent, 'ops_task_comments'), false); assert.equal(Object.hasOwn(raw.parent, 'ops_task_attachments'), false);
  assert.equal(detail.tracks[0].directorProfileId, null); assert.equal(detail.tracks[0].directorName, '');
  assert.equal(detail.levelTests[0].materialLink, 'https://example.invalid/result'); assert.equal(detail.consultations[0].note, '합성 상담 내용');
  assert.equal(detail.enrollments[0].classStartSession, '1회차'); assert.equal(detail.appointments[0].customerReminder.state, 'scheduled');
  assert.equal(detail.admissionApplicationAccepted, true); assert.equal(detail.events[0].legacyText, '합성 이력');
  assert.equal(detail.collectionWindows.scheduledAppointments.overflow, true); assert.equal(detail.collectionWindows.currentEnrollments.totalCount, 31);
  assert.deepEqual(result.classes, raw.classes); assert.deepEqual(result.textbooks, raw.textbooks); assert.deepEqual(result.profiles, raw.profiles);
  assert.deepEqual(raw, before); assert.equal(h.calls.length, 1);
  assert.deepEqual(h.calls[0].args, { p_task_id: ids.task, p_section: 'case', p_track_id: null, p_observation_id: null, p_page: 1, p_limit: 10 });
  assert.equal(h.calls[0].name, 'get_registration_teacher_detail_v1'); assert.equal(h.calls[0].retry, false);
});

test('teacher case accepts empty nullable data without inventing labels or current counts', async () => {
  const h = harness(), raw = bundle();
  for (const key of ['tracks','appointments','levelTests','consultations','admissionBatches','enrollments','events','reminderSummaries','profiles','classes','textbooks']) raw[key] = [];
  raw.eventWindow = { recentLimit: 30, totalCount: 0, returnedCount: 0, anchorCount: 0, hasEarlierEvents: false }; raw.parent.ops_registration_details = {}; raw.activeAdmissionMessage = null; raw.scheduledAppointmentTotal = 0; raw.currentEnrollmentTotal = 0;
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
  ['unexpected comment collection', value => { value.data.parent.ops_task_comments = [{ id: id(12), task_id: id(90), body: 'synthetic hidden comment' }]; }],
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

test('scoped display rows retain management mappings while unused literal metadata stays excluded', async () => {
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
  assert.deepEqual(managerDetail.events[0].metadata, { fieldName: '', beforeValue: null, afterValue: '합성 이력' }, 'management mapping keeps its original behavior');
  assert.deepEqual((await h.service.loadCase({ taskId: ids.task })).detail, { ...managerDetail, events: managerDetail.events.map(event => ({ ...event, metadata: {} })) }, 'teacher boundary excludes only the unused raw literal metadata');
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


for (const pageSize of [10, 15, 20]) {
  for (const [label, page, count] of [['second full page', 2, pageSize], ['last partial page', 3, 3], ['empty later page', 4, 0]]) {
    test(`history size ${pageSize} sends the actual server limit on ${label}`, async () => {
      const h = harness();
      const data = { ...history(), page, pageSize, totalCount: pageSize * 2 + 3,
        history: Array.from({ length: count }, (_, index) => ({ ...history().history[0], messageId: id(300 + pageSize * page + index) })),
      };
      h.respond(envelope('customer_history', data));
      assert.deepEqual(await h.service.listCaseHistory({ taskId: ids.task, page, pageSize }), data);
      assert.deepEqual(h.calls[0].args, { p_task_id: ids.task, p_section: 'customer_history', p_track_id: null, p_observation_id: null, p_page: page, p_limit: pageSize });
      assert.equal(Object.hasOwn(h.calls[0].args, 'p_page_size'), false);
      assert.equal(h.calls[0].retry, false); assert.ok(h.calls[0].signal instanceof AbortSignal);
      assert.equal(h.calls.length, 1);
    });
  }
  test(`history size ${pageSize} aborts its branch and discards a late response`, async () => {
    const h = harness(), controller = new AbortController(); let resolve;
    const data = { ...history(), page: 2, pageSize, totalCount: pageSize + 1 };
    h.deferred(new Promise(done => { resolve = done; }));
    const pending = h.service.listCaseHistory({ taskId: ids.task, page: 2, pageSize }, controller.signal);
    controller.abort(); resolve({ data: envelope('customer_history', data), error: null });
    await assert.rejects(pending, error => error.name === 'AbortError');
    assert.equal(h.calls[0].signal.aborted, true); assert.equal(h.calls[0].args.p_limit, pageSize);
    assert.equal(Object.hasOwn(h.calls[0].args, 'p_page_size'), false); assert.equal(h.calls[0].retry, false);
    const before = h.calls.length;
    await assert.rejects(h.service.listCaseHistory({ taskId: ids.task, page: 2, pageSize }, controller.signal), error => error.name === 'AbortError');
    assert.equal(h.calls.length, before, 'already-aborted branch never creates a second request');
  });
}
for (const pageSize of [0, 11, 21, 31, 10.5, '10', null]) {
  test(`history rejects invalid limit ${JSON.stringify(pageSize)} before RPC`, async () => {
    const h = harness();
    await assert.rejects(h.service.listCaseHistory({ taskId: ids.task, page: 1, pageSize }), /registration_teacher_detail_invalid/);
    assert.equal(h.calls.length, 0);
  });
}


function canonicalEventPayload() {
  return { version: 1, eventType: 'enrollment_rows_saved', trackId: ids.track, subject: '수학', actorId: null,
    source: 'consultation_completed', destination: 'enrollment_pending', occurredAt: time,
    reason: '원문 이유 {수정 없음}', metadata: {
      classId: ids.class, place: '원문 장소', scheduledAt: '알 수 없는 시각',
      activeTrackIds: [ids.track, ids.track], rowIds: [],
      rows: [{ classId: ids.class, textbookIds: [], classStartSession: '원문 회차' }],
      enrollmentSnapshot: { classId: ids.class, textbook_id: ids.textbook, textbook_ids: [], admissionBatchId: ids.batch },
      subjectTransitions: [{ subject: '수학', source: 'waiting', destination: 'enrolled', reason: null }],
      appointmentChanges: [{ eventType: 'appointment_updated', reasonLabel: '원문 변경', reason: null, metadata: { oldPlace: '기존', place: '변경', scheduledAt: '원문 시각' } }],
    } };
}
function canonicalEvent(payload = canonicalEventPayload()) {
  return { id: id(400), task_id: ids.task, actor_id: null, event_type: 'registration_track_event', field_name: null, before_value: null, after_value: JSON.stringify(payload), created_at: time };
}
for (const [label, mutate] of [
  ['envelope', p => { p.providerToken = 'synthetic-canary'; }],
  ['metadata', p => { p.metadata.providerToken = 'synthetic-canary'; }],
  ['rows', p => { p.metadata.rows[0].providerToken = 'synthetic-canary'; }],
  ['enrollment snapshot', p => { p.metadata.enrollmentSnapshot.providerToken = 'synthetic-canary'; }],
  ['subject transition', p => { p.metadata.subjectTransitions[0].providerToken = 'synthetic-canary'; }],
  ['appointment change', p => { p.metadata.appointmentChanges[0].providerToken = 'synthetic-canary'; }],
  ['appointment change metadata', p => { p.metadata.appointmentChanges[0].metadata.providerToken = 'synthetic-canary'; }],
  ['nested primitive ID array', p => { p.metadata.activeTrackIds.push({ providerToken: 'synthetic-canary' }); }],
  ['nested plural textbook ID array', p => { p.metadata.rows[0].textbookIds.push(['synthetic-canary']); }],
  ['scalar object', p => { p.metadata.place = { providerToken: 'synthetic-canary' }; }],
]) test(`teacher event rejects hidden ${label} before the management mapper`, async () => {
  const h = harness(), raw = bundle(), payload = canonicalEventPayload(); mutate(payload); raw.events = [canonicalEvent(payload)];
  h.respond(envelope('case', raw)); await assert.rejects(h.service.loadCase({ taskId: ids.task }), /registration_teacher_detail_invalid/);
});
test('teacher canonical display preserves scalar text, old aliases, duplicates and explicit empty arrays', async () => {
  const h = harness(), raw = bundle(), payload = canonicalEventPayload(); raw.events = [canonicalEvent(payload)];
  h.respond(envelope('case', raw)); const result = await h.service.loadCase({ taskId: ids.task });
  assert.deepEqual(result.detail.events[0].metadata, payload.metadata); assert.equal(result.detail.events[0].reason, payload.reason);
});
for (const status of [401, 403]) test(`installed SDK preserves HTTP ${status} outside the RPC error for role invalidation`, async () => {
  const calls = [], errorBody = { code: status === 401 ? 'PGRST301' : 'PGRST302', message: 'synthetic authorization error', details: null, hint: null };
  const client = createClient('https://teacher-detail.example.invalid', 'synthetic-anon', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (url, options) => {
      calls.push({ url: String(url), body: JSON.parse(options.body) });
      return new Response(JSON.stringify(errorBody), { status, headers: { 'Content-Type': 'application/json' } });
    } },
  });
  const api = loadNotificationComponent(path), service = api.createRegistrationTeacherDetailService(client);
  const { isRegistrationTeacherPermissionError } = loadNotificationComponent('src/features/tasks/registration-teacher-detail-fields.tsx');
  await assert.rejects(service.loadCase({ taskId: ids.task }), error => {
    assert.equal(error.code, errorBody.code); assert.equal(error.message, errorBody.message);
    assert.equal(error.status, status); assert.equal(isRegistrationTeacherPermissionError(error), true); return true;
  });
  assert.equal(calls.length, 1); assert.match(calls[0].url, /\/rest\/v1\/rpc\/get_registration_teacher_detail_v1$/);
  assert.equal(calls[0].body.p_task_id, ids.task);
});

for (const [label, mutate] of [
  ['empty comments', raw => { raw.parent.ops_task_comments = []; }],
  ['nonempty attachments', raw => { raw.parent.ops_task_attachments = [{ drive_link: 'https://example.invalid/private-canary' }]; }],
  ['empty attachments', raw => { raw.parent.ops_task_attachments = []; }],
  ['parent provider field', raw => { raw.parent.providerToken = 'synthetic-canary'; }],
  ['detail provider field', raw => { raw.parent.ops_registration_details.providerToken = 'synthetic-canary'; }],
  ['track provider field', raw => { raw.tracks[0].providerToken = 'synthetic-canary'; }],
  ['nested enrollment provider field', raw => { raw.tracks[0].enrollment_detail_rows = [{ classId: ids.class, providerToken: 'synthetic-canary' }]; }],
  ['appointment provider field', raw => { raw.appointments[0].providerToken = 'synthetic-canary'; }],
  ['message request key', raw => { raw.activeAdmissionMessage.request_key = 'synthetic-canary'; }],
  ['event provider field', raw => { raw.events[0].providerToken = 'synthetic-canary'; }],
]) test(`teacher case rejects ${label} instead of retaining hidden response data`, async () => {
  const h = harness(), raw = bundle(); mutate(raw); h.respond(envelope('case', raw));
  await assert.rejects(h.service.loadCase({ taskId: ids.task }), /registration_teacher_detail_invalid/);
});
for (const [label, mutate] of [
  ['wrong limit', w => { w.recentLimit = 31; }], ['negative total', w => { w.totalCount = -1; }],
  ['fractional total', w => { w.totalCount = 1.5; }], ['wrong returned count', w => { w.returnedCount = 0; }],
  ['unknown flag', w => { w.hasEarlierEvents = true; }], ['extra anchor', w => { w.anchorCount = 1; }],
  ['too many anchors', w => { w.anchorCount = 3; }], ['hidden window key', w => { w.providerToken = 'synthetic-canary'; }],
]) test(`teacher event window rejects ${label}`, async () => {
  const h = harness(), raw = bundle(); mutate(raw.eventWindow); h.respond(envelope('case', raw));
  await assert.rejects(h.service.loadCase({ taskId: ids.task }), /registration_teacher_detail_invalid/);
});
test('bounded event window retains newest 30 plus two anchors without changing order or count', async () => {
  const h = harness(), raw = bundle(); raw.events = Array.from({ length: 32 }, (_, i) => ({ ...raw.events[0], id: id(500 + i) }));
  raw.eventWindow = { recentLimit: 30, totalCount: 50, returnedCount: 32, anchorCount: 2, hasEarlierEvents: true };
  h.respond(envelope('case', raw)); const result = await h.service.loadCase({ taskId: ids.task });
  assert.deepEqual(result.eventWindow, raw.eventWindow); assert.deepEqual(result.detail.events.map(e => e.id), raw.events.map(e => e.id));
});
for (const [label, before, after] of [
  ['legacy before', { classId: ids.class, providerToken: 'synthetic-canary' }, { version: 1, timestamps: {}, legacyBooleans: {} }],
  ['legacy timestamps', {}, { version: 1, timestamps: { providerToken: 'synthetic-canary' }, legacyBooleans: {} }],
  ['legacy booleans', {}, { version: 1, timestamps: {}, legacyBooleans: { providerToken: 'synthetic-canary' } }],
  ['legacy outer', {}, { version: 1, timestamps: {}, legacyBooleans: {}, providerToken: 'synthetic-canary' }],
]) test(`teacher event rejects hidden ${label}`, async () => {
  const h = harness(), raw = bundle(); raw.events = [{ ...raw.events[0], event_type: 'legacy_registration_imported', before_value: JSON.stringify(before), after_value: JSON.stringify(after) }];
  h.respond(envelope('case', raw)); await assert.rejects(h.service.loadCase({ taskId: ids.task }), /registration_teacher_detail_invalid/);
});
for (const [label, change] of [
  ['provider event', { event_type: 'registration_provider_saved' }],
  ['unknown canonical version', { event_type: 'registration_track_event', after_value: JSON.stringify({ version: 99, metadata: { providerToken: 'synthetic' } }) }],
  ['structured noncanonical object', { after_value: JSON.stringify({ providerToken: 'synthetic' }) }],
  ['structured noncanonical array', { after_value: JSON.stringify([{ providerToken: 'synthetic' }]) }],
]) test(`teacher event rejects ${label}`, async () => {
  const h = harness(), raw = bundle(); raw.events[0] = { ...raw.events[0], ...change };
  h.respond(envelope('case', raw)); await assert.rejects(h.service.loadCase({ taskId: ids.task }), /registration_teacher_detail_invalid/);
});

for (const key of ['memo', 'requested_by', 'requested_by_label', 'assignee_id', 'completed_by', 'student_id', 'class_id', 'textbook_id', 'created_at']) {
  test(`teacher parent rejects offscreen ${key}`, async () => {
    const h = harness(), raw = bundle(); raw.parent[key] = 'synthetic-hidden-value'; h.respond(envelope('case', raw));
    await assert.rejects(h.service.loadCase({ taskId: ids.task }), /registration_teacher_detail_invalid/);
  });
}
test('teacher legacy snapshot preserves only display fields and unknown time text', async () => {
  const h = harness(), raw = bundle(); raw.tracks[0].migration_review_required = true;
  const before = { studentId: '', classId: ids.class, textbookId: ids.textbook, pipelineStatus: '기존 상태' };
  const after = { version: 1, timestamps: { levelTestAt: '시간 미상', levelTestCompletedAt: '', phoneConsultationAt: time, visitConsultationAt: null, consultationAt: null, classStartDate: '2026-11-02', classStartSession: '기존 1회차' }, legacyBooleans: { admissionNoticeSent: false, makeeduRegistered: true, makeeduInvoiceSent: false, paymentChecked: false } };
  raw.events = [{ ...raw.events[0], event_type: 'legacy_registration_imported', before_value: JSON.stringify(before), after_value: JSON.stringify(after) }];
  h.respond(envelope('case', raw)); const result = await h.service.loadCase({ taskId: ids.task });
  assert.equal(result.detail.migrationLegacy.classId, ids.class); assert.equal(result.detail.migrationLegacy.levelTestAt, '시간 미상');
  assert.equal(result.detail.migrationLegacy.makeeduRegistered, true); assert.equal(result.detail.migrationLegacy.snapshotMissing, false);
});
test('version-two history retains archived-track identity and display aliases without active-track inference', async () => {
  const h = harness(), raw = bundle(), base = canonicalEventPayload();
  const payload = { version: 2, event_type: 'enrollment_rows_saved', track_id: id(999), subject: '과학', actor_profile_id: null, actor_kind: 'migration', system_source: 'legacy_import', reason_code: '이관 원문', occurred_at: '', metadata: base.metadata };
  raw.events = [canonicalEvent(payload)]; h.respond(envelope('case', raw));
  const result = await h.service.loadCase({ taskId: ids.task });
  assert.equal(result.detail.events[0].trackId, id(999)); assert.equal(result.detail.events[0].subject, '과학'); assert.equal(result.detail.events[0].actorKind, 'migration');
  assert.deepEqual(result.detail.events[0].metadata, payload.metadata);
});
test('recognized plain history text is retained without interpreting human identifiers or date-like prose', async () => {
  const h = harness(), raw = bundle(); raw.events[0].before_value = null; raw.events[0].after_value = '기록 2026-99-99T09:00:00Z / ID:synthetic-providerToken';
  h.respond(envelope('case', raw)); const result = await h.service.loadCase({ taskId: ids.task });
  assert.equal(result.detail.events[0].legacyText, raw.events[0].after_value); assert.deepEqual(result.detail.events[0].metadata, {});
});
test('installed SDK nonpermission errors remain unchanged', async () => {
  const errorBody = { code: 'XX000', message: 'synthetic nonpermission error', details: 'synthetic detail', hint: null };
  let calls = 0;
  const client = createClient('https://teacher-detail.example.invalid', 'synthetic-anon', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async () => { calls++; return new Response(JSON.stringify(errorBody), { status: 500, headers: { 'Content-Type': 'application/json' } }); } },
  });
  const api = loadNotificationComponent(path);
  await assert.rejects(api.createRegistrationTeacherDetailService(client).loadCase({ taskId: ids.task }), error => { assert.deepEqual(error, errorBody); return true; });
  assert.equal(calls, 1);
});

test('title-only legacy milestone retains its title identity without actor, payload or invented time', async () => {
  const h = harness(), raw = bundle();
  raw.events[0] = { ...raw.events[0], actor_id: null, before_value: null, after_value: null, display_title_only: true };
  delete raw.events[0].field_name;
  h.respond(envelope('case', raw)); const event = (await h.service.loadCase({ taskId: ids.task })).detail.events[0];
  assert.equal(event.eventType, 'inquiry_routed'); assert.equal(event.legacyTitleOnly, true);
  assert.equal(event.actorId, null); assert.equal(event.actorKind, null); assert.equal(event.systemSource, null);
  assert.equal(event.occurredAt, ''); assert.equal(event.legacyText, null); assert.deepEqual(event.metadata, {});
});
for (const [label, changes] of [
  ['false flag', { display_title_only: false }],
  ['hidden after payload', { after_value: JSON.stringify({ providerToken: 'synthetic' }) }],
  ['hidden before payload', { before_value: JSON.stringify({ providerToken: 'synthetic' }) }],
  ['canonical kind', { event_type: 'registration_track_event' }],
  ['creation kind', { event_type: 'registration_case_created' }],
  ['import kind', { event_type: 'legacy_registration_imported' }],
  ['unknown literal kind', { event_type: 'provider_event' }],
]) test(`title-only flag rejects ${label}`, async () => {
  const h = harness(), raw = bundle(); raw.events[0] = { ...raw.events[0], before_value: null, after_value: null, display_title_only: true, ...changes };
  delete raw.events[0].field_name;
  h.respond(envelope('case', raw)); await assert.rejects(h.service.loadCase({ taskId: ids.task }), /registration_teacher_detail_invalid/);
});
for (const version of [1, 2]) for (const [label, occurred, expected] of [
  ['missing', undefined, ''], ['empty', '', ''], ['invalid text', '시각 미상', ''],
  ['invalid calendar date', '2026-02-30T09:00:00Z', ''], ['recorded offset', '2026-10-29T10:00:00+09:00', '2026-10-29T10:00:00+09:00'],
]) test(`teacher canonical v${version} ${label} time never substitutes insertion time`, async () => {
  const h = harness(), raw = bundle();
  const payload = version === 1 ? { version: 1, eventType: 'inquiry_routed', metadata: {} } : { version: 2, event_type: 'inquiry_routed', metadata: {} };
  if (occurred !== undefined) payload[version === 1 ? 'occurredAt' : 'occurred_at'] = occurred;
  raw.events = [canonicalEvent(payload)]; h.respond(envelope('case', raw));
  assert.equal((await h.service.loadCase({ taskId: ids.task })).detail.events[0].occurredAt, expected);
});

for (const [label, changes] of [
  ['unused outer actor', { actor_id: ids.profile }], ['unused field name', { field_name: 'synthetic-private-field' }],
  ['unused before text', { before_value: 'synthetic-private-before' }],
  ['noncanonical fine event', { event_type: 'appointment_updated' }],
  ['fine event title flag', { event_type: 'appointment_updated', display_title_only: true, after_value: null }],
]) test(`teacher literal history rejects ${label}`, async () => {
  const h = harness(), raw = bundle(); raw.events[0] = { ...raw.events[0], ...changes }; h.respond(envelope('case', raw));
  await assert.rejects(h.service.loadCase({ taskId: ids.task }), /registration_teacher_detail_invalid/);
});

for (const literal of ['123', 'true', 'null', '"synthetic hidden string"', '{"providerToken":', '[{"providerToken":', '"synthetic truncated', '[object Object]']) {
  test(`literal hidden structure ${JSON.stringify(literal)} requires a title-only projection`, async () => {
    const h = harness(), raw = bundle(); raw.events[0].after_value = literal; h.respond(envelope('case', raw));
    await assert.rejects(h.service.loadCase({ taskId: ids.task }), /registration_teacher_detail_invalid/);
  });
}
test('literal bracketed and quoted human prose remains unchanged', async () => {
  const h = harness();
  for (const literal of ['[전화상담] 합성 안내', '"담당자"와 상담한 원문']) {
    const raw = bundle(); raw.events[0].after_value = literal; h.respond(envelope('case', raw));
    assert.equal((await h.service.loadCase({ taskId: ids.task })).detail.events[0].legacyText, literal);
  }
});

test('legacy import is rejected when no returned active track needs migration review', async () => {
  const h = harness(), raw = bundle(); raw.tracks[0].migration_review_required = false;
  raw.events[0] = { ...raw.events[0], event_type: 'legacy_registration_imported',
    before_value: JSON.stringify({ classId: ids.class, textbookId: ids.textbook }),
    after_value: JSON.stringify({ version: 1, timestamps: {}, legacyBooleans: {} }),
  };
  h.respond(envelope('case', raw));
  await assert.rejects(h.service.loadCase({ taskId: ids.task }), /registration_teacher_detail_invalid/);
});

function legacyImportBundle(version = 1) {
  const raw = bundle(); raw.tracks[0].migration_review_required = true;
  raw.events = [{ ...raw.events[0], event_type: 'legacy_registration_imported',
    before_value: JSON.stringify({ classId: ids.class }),
    after_value: JSON.stringify({ version, timestamps: {}, legacyBooleans: {} }),
  }];
  return raw;
}
test('teacher response rejects more than one legacy import snapshot', async () => {
  const h = harness(), raw = legacyImportBundle();
  raw.events.push({ ...raw.events[0], id: id(998) });
  raw.eventWindow = { recentLimit: 30, totalCount: 2, returnedCount: 2, anchorCount: 0, hasEarlierEvents: false };
  h.respond(envelope('case', raw));
  await assert.rejects(h.service.loadCase({ taskId: ids.task }), /registration_teacher_detail_invalid/);
});
for (const version of [2, '2', true, '1e0', null]) test(`teacher legacy import rejects unsupported version ${JSON.stringify(version)}`, async () => {
  const h = harness(); h.respond(envelope('case', legacyImportBundle(version)));
  await assert.rejects(h.service.loadCase({ taskId: ids.task }), /registration_teacher_detail_invalid/);
});
test('teacher legacy import retains the documented string-one version', async () => {
  const h = harness(); h.respond(envelope('case', legacyImportBundle('1')));
  const result = await h.service.loadCase({ taskId: ids.task });
  assert.equal(result.detail.migrationLegacy.snapshotMissing, false);
  assert.equal(result.detail.migrationLegacy.classId, ids.class);
});
