import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { act } from 'react';
import { modules, id, stamp, filters, row, counts, facets, response, transport, servicePath, setup, button, tab } from './helpers/makeup-numbered-harness.mjs';
test('page11 uses one full-filter RPC, preserves server order and independent facets', async () => {
  assert.ok(existsSync(servicePath), 'makeup numbered adapter is missing');
  const io = transport(), service = modules(io.supabase)(servicePath);
  const combined = { ...filters, subject: '영어', teacher: 'name:교사', period: 'custom', dateFrom: '2026-08-01', dateTo: '2026-08-31', filterColumn: 'finalNote', search: '승인', sortColumn: 'revisionRequestedAt', sortDirection: 'desc' };
  const pending = service.readMakeupNumberedPage({ filters: combined, page: 11, pageSize: 10 });
  assert.equal(io.requests.length, 1); assert.equal(io.requests[0].name, 'list_makeup_numbered_page_v1');
  assert.deepEqual(io.requests[0].args, { p_filters: combined, p_page: 11, p_page_size: 10 }); assert.equal(io.requests[0].retry, false);
  io.requests[0].resolve({ data: response(io.requests[0]), error: null });
  const result = await pending; assert.equal(result.rows[0].id, id(101)); assert.deepEqual(result.viewCounts, counts); assert.deepEqual(result.teacherOptions, facets.teacherOptions);
});
test('independent reservation context retains off-page rooms and active event IDs', async () => {
  assert.ok(existsSync(servicePath), 'makeup numbered adapter is missing');
  const io = transport(), service = modules(io.supabase)(servicePath), signal = new AbortController();
  const slots = [{ startAt: stamp, endAt: '2026-08-31T01:00:00+00:00' }];
  const pending = service.readMakeupReservationContext({ slots, eventRequestIds: [id(999).toUpperCase()], signal: signal.signal });
  assert.equal(io.requests[0].name, 'get_makeup_reservation_context_v1'); assert.equal(io.requests[0].retry, false);
  io.requests[0].resolve({ data: { reservations: [{ id: id(111), status: 'completed', className: '오프페이지', makeupStartAt: stamp, makeupEndAt: slots[0].endAt, makeupClassroom: 'B', makeupSlots: [] }], activeEventRequestIds: [id(999)] }, error: null });
  const result = await pending; assert.equal(result.reservations[0].id, id(111)); assert.deepEqual(result.activeEventRequestIds, [id(999)]);
});
test('latest equal-time events use idDESC in actual display and raw timestamp/fallback text remains intact', () => {
  const { getMakeupRequestTableValue: value } = modules(null, { '@/providers/auth-provider': {} })('src/features/makeup-requests/makeup-request-workspace.tsx');
  const request = row(1, { events: [{ id: id(500), createdAt: stamp, eventType: 'approved', note: '옛 메모' }, { id: id(501), createdAt: stamp, eventType: 'approved', note: '새 메모' }] });
  assert.equal(value(request, 'finalNote'), '새 메모');
  assert.equal(value(row(1, { makeupSlots: [{ startAt: '2026-08-31T09:00:00+09:00', endAt: 'raw end' }] }), 'makeupAt'), '2026-08-31 09:00 - raw end');
  assert.equal(value(row(1, { makeupStartAt: '', makeupEndAt: 'raw end' }), 'makeupAt'), '- - raw end');
});

test('all nineteen actual display keys match the SQL parity fixture and model date-only fallback semantics',()=>{
 const {getMakeupRequestTableValue:value}=modules(null,{'@/providers/auth-provider':{}})('src/features/makeup-requests/makeup-request-workspace.tsx');
 const {MAKEUP_NUMBERED_COLUMNS}=modules(null)(servicePath);
 const fixture=row(10,{teacherLabel:'교사 801',requesterLabel:'교사 801',approverLabel:'교사 804',reason:'사유 10',cancelDate:'2026-08-01',createdAt:'2026-08-01T00:00:00Z'});
 assert.deepEqual(Object.fromEntries(MAKEUP_NUMBERED_COLUMNS.map(key=>[key,value(fixture,key)])),{status:'결재자 승인 대기',className:'수업 10',subject:'영어',teacher:'교사 801',requester:'교사 801',reason:'사유 10',cancelDate:'2026-08-01',makeupAt:'2026-08-31 00:00 - 2026-08-31 01:00',makeupRoom:'A',approver:'교사 804',submittedAt:'2026-08-01 00:00',revisionRequestedAt:'-',approvedAt:'-',rejectedAt:'-',canceledAt:'-',returnedReason:'-',rejectedReason:'-',finalNote:'-',canceledNote:'-'});
 const {normalizeMakeupSlots}=modules(null)('src/features/makeup-requests/makeup-request-model.js');
 assert.deepEqual(normalizeMakeupSlots({makeupSlots:[{date:'2026-09-01T16:00:00Z',startTime:'9:00',endTime:'10:00'},{date:'2026-09-01 16:00:00',startTime:'9:00',endTime:'10:00'}]}).map(slot=>slot.startAt),['2026-09-02T09:00:00+09:00','2026-09-01T09:00:00+09:00']);
});
test('actual system-note suppression uses the complete JavaScript whitespace set, not U0085',()=>{
 const {getMakeupRequestTableValue:value}=modules(null,{'@/providers/auth-provider':{}})('src/features/makeup-requests/makeup-request-workspace.tsx');
 const whitespace='\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff';
 for(const gap of whitespace) assert.equal(value(row(1,{finalNote:`보강${gap}2026-08-31${gap}09:00-10:00 시스템`}), 'finalNote'),'-',`U${gap.codePointAt(0).toString(16)}`);
 const note='보강\u00852026-08-31\u008509:00-10:00 일반';
 assert.equal(value(row(1,{finalNote:note}), 'finalNote'),note);
 for(const nonAscii of ['보강 ٢٠٢٦-08-31 09:00-10:00 일반','보강 2026-08-31 ٠٩:00-10:00 일반']) assert.equal(value(row(1,{finalNote:nonAscii}), 'finalNote'),nonAscii);
});
test('actual collision model recognizes active tagged events independently of overlapping request rows', () => {
  const { buildRoomAvailability } = modules(null)('src/features/makeup-requests/makeup-request-model.js');
  const result = buildRoomAvailability({ classrooms: [{ name: 'A' }], requests: [], slots: [{ startAt: stamp, endAt: '2026-08-31T01:00:00+00:00', classroom: 'A' }], ignoreOrphanedMakeupEvents: true, activeEventRequestIds: [id(999)], academicEvents: [{ id: 'calendar', title: '보강', start_at: stamp, end_at: '2026-08-31T01:00:00+00:00', note: '[[TIPS_MAKEUP]] '+JSON.stringify({ requestId: id(999), kind: 'makeup', classroom: 'A' }) }] });
  assert.equal(result.find((room) => room.name === 'A').available, false);
});

test('actual makeup workspace direct page11, failed view retention and coherent retained-view pager', async (t) => {
  const p = await setup(t, { search: '?view=approvalPending&page=11&other=keep' });
  assert.equal(p.numbered().length, 1, 'workspace must use numbered reads');
  assert.equal(p.numbered()[0].args.p_page, 11);
  await act(async () => p.finish(p.numbered()[0])); await p.catalogs();
  assert.match(document.body.textContent, /수업 101/); assert.match(document.body.textContent, /112건/);
  await act(async () => tab('승인/반려').click());
  assert.equal(p.numbered()[1].args.p_filters.view, 'closed');
  assert.equal(button('12 페이지').disabled, true);
  await act(async () => p.numbered()[1].reject(new Error('VIEW FAILURE')));
  assert.equal(tab('결재대기').getAttribute('aria-selected'), 'true');
  assert.match(document.body.textContent, /수업 101/);
  await act(async () => button('12 페이지').click());
  assert.equal(p.numbered()[2].args.p_filters.view, 'approvalPending');
  assert.equal(p.numbered()[2].args.p_page, 12);
  await act(async () => p.finish(p.numbered()[2]));
  assert.match(document.body.textContent, /111–112번째/);
});
test('actual page1 approval waits for independent context and detects page11 conflict; failed catalogs/context never enable approval', async (t) => {
  const p = await setup(t, { search: '?view=approvalPending' });
  assert.equal(p.numbered().length, 1, 'workspace must use numbered reads');
  await act(async () => p.finish(p.numbered()[0], 112, { rows: Array.from({ length: 10 }, (_, i) => row(i + 1, { makeupSlots: [{ startAt: '2026-08-31T09:00:00+09:00', endAt: '2026-08-31T10:00:00+09:00', classroom: 'A' }] })) }));
  assert.ok([...document.querySelectorAll('button')].filter((b) => b.textContent.trim()==='승인').every((b) => b.disabled));
  await p.catalogs();
  assert.ok(p.context().length);
  const context = p.context().at(-1);
  await act(async () => context.resolve({ data: { reservations: [{ id: id(111), status: 'completed', className: '충돌 수업', makeupStartAt: stamp, makeupEndAt: '2026-08-31T01:00:00+00:00', makeupClassroom: 'A', makeupSlots: [] }], activeEventRequestIds: [] }, error: null }));
  assert.match(document.body.textContent, /충돌 있음/);
  assert.ok([...document.querySelectorAll('button')].filter((b) => b.textContent.trim()==='승인').every((b) => b.disabled));
  assert.equal(p.requests.filter((r) => ['makeup_requests','makeup_request_events'].includes(r.table)).length, 0);
});
test('unresolved auth and same-ID assistant role revoke page detail catalogs and draft authority', async (t) => {
  const p = await setup(t, { search: `?requestId=${id(999)}`, auth: { loading: true, role: null } });
  assert.equal(p.requests.length, 0);
  await p.auth({ loading: false, role: 'admin' });
  assert.equal(p.numbered().length, 1);
  const old = p.numbered()[0], detail = p.requests.find((r) => r.name === 'get_makeup_detail_v1'); assert.ok(detail);
  await p.auth({ role: 'assistant' });
  assert.equal(old.signal.aborted, true); assert.equal(detail.signal.aborted, true);
  await act(async () => { p.finish(old); detail.resolve({ data: row(999, { className: 'OLD DETAIL' }), error: null }); }); await p.catalogs();
  assert.doesNotMatch(document.body.textContent, /수업 1|OLD DETAIL/); assert.equal(button('휴보강 신청'), undefined);
  await p.auth({ user: null, role: null }); assert.doesNotMatch(document.body.textContent, /112건/);
});

const createInput = { requestKind: 'cancel_only', classId: id(600), reason: '휴강 사유', cancelDate: '2026-09-01', originalLessonSessionId: id(601), makeupSlots: [], makeupClassroom: '', approverTeacherCatalogId: id(702) };
function createCatalogRows({ role = 'teacher', approver = '강부희', session = true } = {}) {
  return { profiles: [{ id: id(801), role, name: '담당' }], teacher_catalogs: [{ id: id(701), name: '담당', subjects: '영어', profile_id: id(801) }, { id: id(702), name: approver, subjects: '영어', profile_id: id(804) }], classes: [{ id: id(600), name: '고1 영어', subject: '영어', grade: '고1', teacher: '담당', schedule_storage_mode: 'normalized' }], class_lesson_sessions: session ? [{ id: id(601), class_id: id(600), session_date: '2026-09-01', schedule_state: 'active' }] : [] };
}
test('actual create fresh context reads only four required catalogs and retains uncertain same-actor request identity', async () => {
  const io = transport(), service = modules(io.supabase)('src/features/makeup-requests/makeup-request-service.ts');
  const catalogRows = createCatalogRows({ role: 'admin', approver: '관리자 임의 결재자' });
  const pending = service.createMakeupRequest(createInput, id(801));
  assert.deepEqual(io.requests.map((r) => r.table).sort(), ['class_lesson_sessions','classes','profiles','teacher_catalogs']);
  for (const request of io.requests) request.resolve({ data: catalogRows[request.table], error: null });
  const mutation = await io.waitFor('create_makeup_request_v2');
  assert.equal(mutation.args.p_input.original_lesson_session_id, id(601)); assert.equal(mutation.args.p_input.approver_teacher_catalog_id, id(702));
  mutation.reject(new Error('uncertain network')); await assert.rejects(pending, /uncertain network/);
  const retry = service.createMakeupRequest(createInput, id(801));
  const fresh = io.requests.filter((r) => r.table).slice(4); assert.equal(fresh.length, 4);
  for (const request of fresh) request.resolve({ data: catalogRows[request.table], error: null });
  const second = await io.waitFor('create_makeup_request_v2',2); assert.equal(second.args.p_request_id, mutation.args.p_request_id);
  second.resolve({ data: { request: { id: id(900), ...second.args.p_input }, sourceEventId: id(901) }, error: null });
  assert.equal((await retry).id, id(900));
});
test('actual create missing normalized session, invalid teacher approver and failed catalog never issue a mutation', async () => {
  for (const scenario of [{ session: false,reason:/휴강할 실제 수업 회차/ }, { approver: '허용되지 않는 교사',reason:/선택할 수 없는 결재자/ }, { failure: true,reason:/catalog failure/ }]) {
    const io = transport(), service = modules(io.supabase,{'@test/date':class extends Date { constructor(...args){super(...(args.length?args:['2026-08-31T00:00:00Z']));} }})('src/features/makeup-requests/makeup-request-service.ts');
    const pending = service.createMakeupRequest(createInput, id(801));
    const rejected = assert.rejects(pending,scenario.reason);
    const rows = createCatalogRows(scenario);
    for (const request of io.requests) request.resolve({ data: rows[request.table] || [], error: scenario.failure && request.table === 'classes' ? { code: 'XX000', message: 'catalog failure' } : null });
    await rejected; assert.equal(io.requests.filter((r) => r.name).length, 0);
  }
});

test('fresh teacher create honors effective-year director rotation and preserves payload/optional catalogs', async()=>{
  for(const [year,approver] of [[2026,'강부희'],[2027,'김민경']]) {
    const io=transport(),service=modules(io.supabase,{'@test/date':class extends Date{constructor(...args){super(...(args.length?args:[`${year}-08-31T00:00:00Z`]));}}})('src/features/makeup-requests/makeup-request-service.ts');
    const pending=service.createMakeupRequest({...createInput,reason:'  teacher payload  '},id(801)),rows=createCatalogRows({approver});
    for(const request of io.requests) request.resolve({data:rows[request.table],error:null});
    const mutation=await io.waitFor('create_makeup_request_v2');
    assert.deepEqual({...mutation.args.p_input},{request_kind:'cancel_only',subject:'영어',approval_group:'english',requester_id:id(801),teacher_catalog_id:id(701),teacher_profile_id:id(801),class_id:id(600),class_name:'고1 영어',reason:'teacher payload',cancel_date:'2026-09-01',original_lesson_session_id:id(601),makeup_start_at:null,makeup_end_at:null,makeup_classroom:null,makeup_slots:[],approver_teacher_catalog_id:id(702),approver_profile_id:id(804)});
    mutation.resolve({data:{request:{id:id(900),...mutation.args.p_input},sourceEventId:id(901)},error:null}); await pending;
    assert.equal(io.requests.filter((r)=>r.table).length,4); assert.equal(io.requests.filter((r)=>r.name).length,1);
  }
  const io=transport(),service=modules(io.supabase)('src/features/makeup-requests/makeup-request-service.ts'),pending=service.createMakeupRequest(createInput,id(801));
  const rejected=assert.rejects(pending,/신청할 수업을 선택/);
  for(const request of io.requests) request.resolve({data:null,error:{code:'42P01',message:'optional absent'}});
  await rejected;assert.equal(io.requests.filter((r)=>r.name).length,0);
});

test('presets use mount-local day across UTC and month boundaries and preserve custom open bounds', async (t) => {
  const oldTimezone = process.env.TZ; process.env.TZ = 'Asia/Seoul'; t.after(() => { if (oldTimezone === undefined) delete process.env.TZ; else process.env.TZ = oldTimezone; });
  const p = await setup(t, { clock: '2026-08-31T16:30:00Z', search: '?view=approvalPending&page=11' });
  await act(async () => p.finish(p.numbered()[0]));
  await act(async () => button('오늘 휴보강 보기').click());
  assert.equal(p.numbered().at(-1).args.p_filters.dateFrom, '2026-09-01'); assert.equal(p.numbered().at(-1).args.p_page, 1);
  await act(async () => button('이번주 휴보강 보기').click());
  assert.deepEqual([p.numbered().at(-1).args.p_filters.dateFrom,p.numbered().at(-1).args.p_filters.dateTo], ['2026-08-31','2026-09-06']);
  await act(async () => button('이번달 휴보강 보기').click());
  assert.deepEqual([p.numbered().at(-1).args.p_filters.dateFrom,p.numbered().at(-1).args.p_filters.dateTo], ['2026-09-01','2026-09-30']);
  await act(async () => p.observed.changeFilters({ period: 'custom', dateFrom: '2026-08-15', dateTo: '' }));
  await act(async () => button('전체 기간 휴보강 보기').click());
  assert.equal(p.numbered().at(-1).args.p_filters.dateFrom, '');
  await act(async () => button('직접입력 휴보강 보기').click());
  assert.equal(p.numbered().at(-1).args.p_filters.dateFrom, '2026-08-15'); assert.equal(p.numbered().at(-1).args.p_filters.dateTo, '');
});
test('off-page exact detail preserves editor identity and draft through page back navigation', async (t) => {
  const p = await setup(t, { search: `?view=approvalPending&requestId=${id(999)}` });
  await act(async () => p.finish(p.numbered()[0])); await p.catalogs();
  const detail = p.requests.find((r) => r.name === 'get_makeup_detail_v1');
  await act(async () => detail.resolve({ data: row(999, { requesterId: id(804), status: 'revision_requested', createdAt: '2025-01-01T00:00:00Z', classId: id(600), reason: '원문' }), error: null }));
  await act(async () => button('보완').click());
  assert.equal(p.observed.editingRequest.id, id(999)); assert.equal(p.observed.editingRequest.createdAt, '2025-01-01T00:00:00Z');
  await act(async () => p.observed.patch((input) => ({ ...input, reason: '미저장 초안' })));
  await act(async () => { window.history.replaceState(null,'','?view=approvalPending&page=11'); window.dispatchEvent(new window.PopStateEvent('popstate')); });
  await act(async () => p.finish(p.numbered().at(-1)));
  assert.equal(p.observed.editingRequestId, id(999)); assert.equal(p.observed.input.reason, '미저장 초안');
  assert.equal(p.observed.editingRequest.createdAt, '2025-01-01T00:00:00Z');
  const pendingForm = p.requests.filter((r) => r.table === 'profiles').at(-1); assert.ok(pendingForm);
  await p.auth({ role: 'teacher' }); assert.equal(pendingForm.signal.aborted, true);
  await act(async () => pendingForm.resolve({ data: [{ id: id(804), name: 'OLD PROFILE' }], error: null }));
  assert.equal(p.observed.editingRequestId, ''); assert.equal(p.observed.input.reason, '');
});
test('context errors retain approval safety, explicit retry succeeds and old context cannot replace a new scope', async (t) => {
  const p = await setup(t, { search: '?view=approvalPending' }); await act(async () => p.finish(p.numbered()[0])); await p.catalogs();
  const failed = p.context().at(-1); await act(async () => failed.reject(new Error('CONTEXT FAILURE')));
  assert.match(document.body.textContent, /CONTEXT FAILURE/);
  assert.ok([...document.querySelectorAll('button')].filter((b) => b.textContent.trim()==='승인').every((b) => b.disabled));
  await act(async () => button('예약 다시 확인').click()); await p.catalogs();
  const retry = p.context().at(-1); assert.notEqual(retry, failed);
  await act(async () => retry.resolve({ data: { reservations: [], activeEventRequestIds: [] }, error: null }));
  assert.ok([...document.querySelectorAll('button')].some((b) => b.textContent.trim()==='승인' && !b.disabled));
  await act(async () => button('2 페이지').click());
  await act(async () => p.finish(p.numbered().at(-1), 112, { rows: Array.from({length:10}, (_,i) => row(i+11,{ makeupStartAt:'2026-09-02T00:00:00Z',makeupEndAt:'2026-09-02T01:00:00Z' })) }));
  assert.ok([...document.querySelectorAll('button')].filter((b) => b.textContent.trim()==='승인').every((b) => b.disabled));
});
test('required collision catalog failure cannot become empty confirmed availability', async (t) => {
  const p = await setup(t, { search:'?view=approvalPending' }); await act(async () => p.finish(p.numbered()[0]));
  const catalog = p.requests.find((r) => r.table==='academic_events'); await act(async () => catalog.resolve({data:null,error:{code:'42501',message:'CATALOG DENIED'}}));
  assert.equal(p.context().length,0); assert.match(document.body.textContent,/CATALOG DENIED/);
  assert.ok([...document.querySelectorAll('button')].filter((b) => b.textContent.trim()==='승인').every((b) => b.disabled));
});
test('service rejects invalid filters, malformed page/detail/context, caller cancellation and missing RPC without fallback', async () => {
  for (const patch of [{period:'today'}, {period:'custom',dateFrom:'2026-02-30'}, {sortColumn:'className',sortDirection:null}, {filterColumn:'action'}, {role:'admin'}]) {
    const io=transport(), service=modules(io.supabase)(servicePath); await assert.rejects(service.readMakeupNumberedPage({filters:{...filters,...patch},page:1,pageSize:10})); assert.equal(io.requests.length,0);
  }
  for (const patch of [{totalCount:-1},{rows:[]},{viewCounts:{mine:0}},{subjectOptions:[]},{rows:[row(1,{events:[{id:id(100),requestId:id(2)}]})]}]) {
    const io=transport(), service=modules(io.supabase)(servicePath), pending=service.readMakeupNumberedPage({filters,page:1,pageSize:10});
    io.requests[0].resolve({data:response(io.requests[0],1,patch),error:null}); await assert.rejects(pending,/response_invalid/);
  }
  const io=transport(), service=modules(io.supabase)(servicePath), abort=new AbortController();
  const pending=service.readMakeupDetail({id:id(999),signal:abort.signal}); abort.abort(); io.requests[0].resolve({data:row(999),error:null}); await assert.rejects(pending,{name:'AbortError'});
  const missing=service.readMakeupNumberedPage({filters,page:1,pageSize:10}); io.requests[1].resolve({data:null,error:{code:'PGRST202'}}); await assert.rejects(missing,/rpc_unavailable/); assert.equal(io.requests.length,2);
});
test('conservative raw reservation projection and full legacy model agree for ambiguous and nonfinite source slots', () => {
  const oldTimezone=process.env.TZ; process.env.TZ='Asia/Seoul';
  try {
    const {buildRoomAvailability}=modules(null)('src/features/makeup-requests/makeup-request-model.js');
    const requests=[row(1,{makeupStartAt:'2026-08-31T09:00:00',makeupEndAt:'2026-08-31T10:00:00'}),row(2,{makeupStartAt:'August 31, 2026 09:00:00 GMT+0900',makeupEndAt:'August 31, 2026 10:00:00 GMT+0900',makeupClassroom:'B'}),row(3,{makeupStartAt:'bad',makeupEndAt:'invalid'}),row(4,{makeupStartAt:'2026-08-31T01:00:00Z',makeupEndAt:'2026-08-31T02:00:00Z'})];
    const base={classrooms:[{name:'A'},{name:'B'}],slots:[{startAt:stamp,endAt:'2026-08-31T01:00:00Z'}],ignoreOrphanedMakeupEvents:true};
    const legacy=buildRoomAvailability({...base,requests});
    const context=buildRoomAvailability({...base,requests:requests.slice(0,3).map(({id,status,className,makeupStartAt,makeupEndAt,makeupClassroom,makeupSlots})=>({id,status,className,makeupStartAt,makeupEndAt,makeupClassroom,makeupSlots})),activeEventRequestIds:[]});
    assert.deepEqual(context,legacy); assert.deepEqual(context.map((room)=>[room.name,room.available,room.collisions.length]),[['A',false,1],['B',false,1]]);
  } finally { if(oldTimezone===undefined) delete process.env.TZ; else process.env.TZ=oldTimezone; }
});

test('strict wire DTOs reject nested corruption and duplicate identities but preserve raw source timestamps', async () => {
  const event = {id:id(500),requestId:id(1),actorId:'',actorLabel:'시스템',eventType:'approved',fieldName:'',beforeValue:'',afterValue:'',note:'',createdAt:stamp};
  for (const patch of [{makeupSlots:[null]}, {makeupSlots:[{startAt:5,endAt:'raw'}]}, {requesterId:'not-an-id'}, {events:[event,event]}, {makeupAcademicEventIds:[id(800),id(800)]}]) {
    const io=transport(), service=modules(io.supabase)(servicePath), pending=service.readMakeupDetail({id:id(1)});
    io.requests[0].resolve({data:row(1,patch),error:null}); await assert.rejects(pending,/response_invalid/);
  }
  for (const patch of [{activeEventRequestIds:[id(800),id(800)]},{reservations:[{id:id(1),status:'completed',className:'수업',makeupStartAt:'',makeupEndAt:'',makeupClassroom:'',makeupSlots:[{startAt:'raw',endAt:12}]}]}]) {
    const io=transport(), service=modules(io.supabase)(servicePath), pending=service.readMakeupReservationContext({slots:[],eventRequestIds:[id(800)]});
    io.requests[0].resolve({data:{reservations:[],activeEventRequestIds:[],...patch},error:null}); await assert.rejects(pending,/response_invalid/);
  }
  const io=transport(), service=modules(io.supabase)(servicePath), pending=service.readMakeupDetail({id:id(1)});
  io.requests[0].resolve({data:row(1,{makeupSlots:[{id:'legacy',startAt:'loose date',endAt:'invalid date',classroom:'A'}]}),error:null});
  assert.equal((await pending).makeupSlots[0].startAt,'loose date');
});

test('StrictMode remount keeps one live page owner and accepts its completion', async (t) => {
  const p=await setup(t,{strict:true,search:'?view=approvalPending'});
  const live=p.numbered().filter((request)=>!request.signal.aborted);
  assert.equal(live.length,1);
  await act(async()=>p.finish(live[0])); assert.match(document.body.textContent,/수업 1/);
});

test('late collision catalogs cannot overwrite fresh normalized form sessions', async(t)=>{
  const p=await setup(t,{search:'?view=approvalPending'});
  await act(async()=>p.finish(p.numbered()[0]));
  await act(async()=>button('휴보강 신청').click());
  const formRows=createCatalogRows({role:'admin'});
  await act(async()=>{for(const request of p.requests.filter((r)=>r.table).slice(3)) request.resolve({data:formRows[request.table]||[],error:null});});
  assert.equal(p.observed.catalogs.classes[0].lessonSessions[0].id,id(601));
  await act(async()=>{for(const request of p.requests.filter((r)=>r.table).slice(0,3)) request.resolve({data:request.table==='classes'?formRows.classes:[],error:null});});
  assert.equal(p.observed.catalogs.classes[0].lessonSessions[0]?.id,id(601));
});

test('Back restores retained custom input independently of effective preset bounds and removes obsolete detail',async(t)=>{
  const p=await setup(t,{search:'?view=approvalPending&requestId='+id(999)});
  await act(async()=>p.finish(p.numbered()[0]));
  await act(async()=>p.requests.find(r=>r.name==='get_makeup_detail_v1').resolve({data:row(999,{className:'OLD DETAIL'}),error:null}));
  const custom={dateFrom:'2026-07-15',dateTo:''};
  await act(async()=>{window.history.replaceState(null,'','?view=approvalPending&makeupFilters='+encodeURIComponent(JSON.stringify({...filters,period:'today',dateFrom:'2026-08-31',dateTo:'2026-08-31'}))+'&makeupCustomDates='+encodeURIComponent(JSON.stringify(custom)));window.dispatchEvent(new window.PopStateEvent('popstate'));});
  assert.doesNotMatch(document.body.textContent,/OLD DETAIL/);
  await act(async()=>p.finish(p.numbered().at(-1)));
  await act(async()=>button('직접입력 휴보강 보기').click());
  assert.equal(p.numbered().at(-1).args.p_filters.dateFrom,custom.dateFrom);assert.equal(p.numbered().at(-1).args.p_filters.dateTo,'');
});

for(const authority of ['logout','user','role']) test('delayed actual create completion cannot reset next '+authority+' draft or start stale refresh',async(t)=>{
  const p=await setup(t,{search:'?view=approvalPending',clock:'2026-08-31T00:00:00Z'});
  await act(async()=>p.finish(p.numbered()[0]));await p.catalogs();
  await act(async()=>button('휴보강 신청').click());
  const rows=createCatalogRows({role:'admin'});
  await act(async()=>{for(const r of p.requests.filter(r=>r.table).slice(3))r.resolve({data:rows[r.table]||[],error:null});});
  await act(async()=>p.observed.patch(()=>({...createInput})));
  assert.equal(button('상신').disabled,false);const before=p.requests.length;
  await act(async()=>button('상신').click());
  await act(async()=>{for(const r of p.requests.slice(before).filter(r=>r.table))r.resolve({data:rows[r.table]||[],error:null});});
  const mutation=await p.waitFor('create_makeup_request_v2');
  await p.auth(authority==='logout'?{user:null,role:null}:authority==='role'?{role:'teacher'}:{user:{id:id(803)},role:'admin'});
  if(authority==='logout')await p.auth({user:{id:id(803)},role:'admin'});
  await act(async()=>p.finish(p.numbered().at(-1)));
  await act(async()=>button('휴보강 신청').click());
  await act(async()=>p.observed.patch(input=>({...input,reason:'NEXT ACTOR DRAFT'})));
  const count=p.numbered().length;
  await act(async()=>mutation.resolve({data:{request:{id:id(900),...mutation.args.p_input},sourceEventId:id(901)},error:null}));
  assert.equal(p.observed.input.reason,'NEXT ACTOR DRAFT');assert.equal(p.numbered().length,count);assert.doesNotMatch(document.body.textContent,/신청서를 상신했습니다/);
});

test('private loose-date wire uses the original slot normalizer and never leaks private fields',async()=>{
 const raw=[{date:'September 1, 2026 16:00:00 GMT',startTime:'9:00',endTime:'10:00'},{startAt:'2026-09-03T00:00:00Z',endAt:'2026-09-03T01:00:00Z',classroom:'B'}];
 const io=transport(),service=modules(io.supabase)(servicePath),model=modules(null)('src/features/makeup-requests/makeup-request-model.js');
 const expected=model.normalizeMakeupSlots({makeupSlots:raw},'A');
 for(const format of [raw,JSON.stringify(raw)]) {
  const pending=service.readMakeupDetail({id:id(1)});io.requests.at(-1).resolve({data:row(1,{rawMakeupSlots:format}),error:null});const detail=await pending;
  assert.deepEqual(detail.makeupSlots,expected);assert.equal('rawMakeupSlots' in detail,false);
  const context=service.readMakeupReservationContext({slots:[{startAt:'2026-09-02T00:00:00Z',endAt:'2026-09-02T01:00:00Z'}],eventRequestIds:[]});
  const {id:requestId,status,className,makeupStartAt,makeupEndAt,makeupClassroom,makeupSlots}=row(1);
  io.requests.at(-1).resolve({data:{reservations:[{id:requestId,status,className,makeupStartAt,makeupEndAt,makeupClassroom,makeupSlots,rawMakeupSlots:format}],activeEventRequestIds:[]},error:null});const value=await context;
  assert.deepEqual(value.reservations[0].makeupSlots,expected);assert.equal(Object.keys(value.reservations[0]).length,7);
  assert.equal(model.buildRoomAvailability({classrooms:[{name:'A'}],requests:value.reservations,slots:[{startAt:'2026-09-02T00:00:00Z',endAt:'2026-09-02T01:00:00Z'}]})[0].available,false);
 }
 for(const rawMakeupSlots of ['not JSON','{}',{},null]) {
  const pending=service.readMakeupDetail({id:id(1)});io.requests.at(-1).resolve({data:row(1,{rawMakeupSlots}),error:null});await assert.rejects(pending,/response_invalid/);
 }
});

test('unmaterializable accepted request target is an explicit disabled state, never empty confirmed availability',async(t)=>{
 const p=await setup(t,{search:'?view=approvalPending'});
 await act(async()=>p.finish(p.numbered()[0],1,{rows:[row(1,{makeupStartAt:'bad',makeupEndAt:'also bad'})]}));await p.catalogs();
 assert.equal(p.context().length,0);assert.match(document.body.textContent,/예약 대상 일시/);
 assert.ok([...document.querySelectorAll('button')].filter(b=>b.textContent.trim()==='승인').every(b=>b.disabled));
});

test('draft time change aborts old context while room changes reuse complete all-room evidence',async(t)=>{
 const p=await setup(t,{search:'?view=approvalPending'});await act(async()=>p.finish(p.numbered()[0],0));await p.catalogs();
 await act(async()=>button('휴보강 신청').click());const rows=createCatalogRows({role:'admin'});
 await act(async()=>{for(const r of p.requests.filter(r=>r.table).slice(3))r.resolve({data:rows[r.table]||[],error:null});});
 const input={...createInput,cancelDate:'',makeupSlots:[{id:'draft',date:'2026-09-01',startTime:'09:00',endTime:'10:00',classroom:'A'}]};
 await act(async()=>p.observed.patch(()=>input));const old=p.context().at(-1);assert.equal(button('상신').disabled,true);
 await act(async()=>p.observed.patch(v=>({...v,makeupSlots:[{...v.makeupSlots[0],date:'2026-09-02'}]})));const current=p.context().at(-1);assert.notEqual(old,current);assert.equal(old.signal.aborted,true);
 await act(async()=>old.resolve({data:{reservations:[],activeEventRequestIds:[]},error:null}));assert.equal(button('상신').disabled,true);
 await act(async()=>current.resolve({data:{reservations:[{id:id(777),status:'completed',className:'다른 방',makeupStartAt:'2026-09-02T00:00:00Z',makeupEndAt:'2026-09-02T01:00:00Z',makeupClassroom:'B',makeupSlots:[]}],activeEventRequestIds:[]},error:null}));
 assert.equal(button('상신').disabled,false);const count=p.context().length;
 await act(async()=>p.observed.patch(v=>({...v,makeupSlots:[{...v.makeupSlots[0],classroom:'B'}]})));assert.equal(p.context().length,count);assert.equal(button('상신').disabled,true);
});

test('actual refund mutation retains complete-purpose reads then refreshes and clamps accepted page',async(t)=>{
 const p=await setup(t,{search:'?view=refundPending&page=12'});
 await act(async()=>p.finish(p.numbered()[0],111,{rows:[row(111,{status:'refund_pending'})]}));await p.catalogs();
 await act(async()=>button('환불완료').click());await act(async()=>p.observed.patchActionNote('완료 메모'));
 const before=p.requests.length;
 await act(async()=>[...document.querySelectorAll('[role="dialog"] button')].find(b=>b.textContent.trim()==='환불완료').click());
 const raw={id:id(111),status:'refund_pending',request_kind:'cancel_only',requester_id:id(801),approver_profile_id:id(804),class_name:'수업 111',created_at:stamp,updated_at:stamp};
 const reads=p.requests.slice(before).filter(r=>r.table);
 assert.ok(reads.some(r=>r.table==='academic_events'));assert.ok(reads.some(r=>r.table==='classroom_catalogs'));assert.ok(reads.some(r=>r.table==='makeup_requests'));
 await act(async()=>{for(const r of reads)r.resolve({data:r.table==='makeup_requests'?[raw]:r.table==='profiles'?[{id:id(804),role:'admin'}]:[],error:null});});
 const events=await p.waitFor('makeup_request_events');await act(async()=>events.resolve({data:[],error:null}));
 const single=await p.waitFor('makeup_requests',2);await act(async()=>single.resolve({data:raw,error:null}));
 const mutation=await p.waitFor('transition_makeup_request_v2');assert.equal(mutation.args.p_command,'refund_completed');assert.equal(mutation.args.p_expected_status,'refund_pending');
 await act(async()=>mutation.resolve({data:{request:{...raw,status:'completed'},sourceEventId:id(901)},error:null}));
 const refresh=p.numbered().at(-1);assert.equal(refresh.args.p_page,12);assert.equal(refresh.args.p_filters.view,'refundPending');
 await act(async()=>p.finish(refresh,110));const clamp=p.numbered().at(-1);assert.equal(clamp.args.p_page,11);
 await act(async()=>p.finish(clamp,110,{rows:Array.from({length:10},(_,i)=>row(101+i,{status:'refund_pending'}))}));
 assert.match(document.body.textContent,/101–110번째/);assert.equal(new URLSearchParams(window.location.search).get('page'),'11');assert.equal(document.querySelector('[role="dialog"]'),null);
});

test('calendar context trims valid tagged IDs and ignores impossible IDs without blocking unrelated availability',async(t)=>{
 const p=await setup(t,{search:'?view=approvalPending'});await act(async()=>p.finish(p.numbered()[0],1));
 await act(async()=>{for(const r of p.requests.filter(r=>r.table))r.resolve({data:r.table==='academic_events'?[{note:'[[TIPS_MAKEUP]] '+JSON.stringify({kind:'makeup',requestId:' '+id(777)+' '})},{note:'[[TIPS_MAKEUP]] '+JSON.stringify({kind:'makeup',requestId:'not-a-request'})}]:[],error:null});});
 const context=p.context().at(-1);assert.ok(context);assert.deepEqual(context.args.p_event_request_ids,[id(777)]);
});

for(const authority of ['logout','user','role']) test('unsent create waits for fresh catalogs but cannot dispatch after '+authority,async(t)=>{
 const originalDigest=crypto.subtle.digest.bind(crypto.subtle),digests=[];
 crypto.subtle.digest=(...args)=>{const pending=originalDigest(...args);digests.push(pending);return pending;};t.after(()=>{crypto.subtle.digest=originalDigest;});
 const p=await setup(t,{search:'?view=approvalPending',clock:'2026-08-31T00:00:00Z'});await act(async()=>p.finish(p.numbered()[0]));await p.catalogs();
 await act(async()=>button('휴보강 신청').click());const rows=createCatalogRows({role:'admin'});
 await act(async()=>{for(const r of p.requests.filter(r=>r.table).slice(3))r.resolve({data:rows[r.table]||[],error:null});});
 await act(async()=>p.observed.patch(()=>({...createInput})));const before=p.requests.length;
 await act(async()=>button('상신').click());const pending=p.requests.slice(before).filter(r=>r.table);assert.equal(pending.length,4);
 await p.auth(authority==='logout'?{user:null,role:null}:authority==='role'?{role:'teacher'}:{user:{id:id(803)},role:'admin'});
 await act(async()=>{for(const r of pending)r.resolve({data:rows[r.table]||[],error:null});});
 await act(async()=>Promise.all(digests));
 assert.equal(digests.length,0,'revoked catalog completion must stop before idempotency work');
 assert.equal(p.requests.filter(r=>r.name==='create_makeup_request_v2').length,0);
});

test('actual idempotency digest completion rechecks caller lifetime immediately before unsent RPC',async(t)=>{
 const io=transport(),service=modules(io.supabase)('src/features/makeup-requests/makeup-request-service.ts');
 const originalDigest=crypto.subtle.digest.bind(crypto.subtle),entered=Promise.withResolvers(),release=Promise.withResolvers();
 crypto.subtle.digest=async(...args)=>{const hash=await originalDigest(...args);entered.resolve();await release.promise;return hash;};t.after(()=>{crypto.subtle.digest=originalDigest;});
 let notificationReads=0;io.supabase.auth.getSession=async()=>{notificationReads++;return{data:{session:null},error:null};};
 const abort=new AbortController(),pending=service.createMakeupRequest(createInput,id(801),{signal:abort.signal}),rejected=assert.rejects(pending,{name:'AbortError'}),rows=createCatalogRows({role:'admin'});
 for(const request of io.requests)request.resolve({data:rows[request.table],error:null});
 await entered.promise;abort.abort();await act(async()=>release.resolve());
 const unexpected=io.requests.find(request=>request.name);
 if(unexpected)unexpected.resolve({data:{request:{id:id(900),...unexpected.args.p_input},sourceEventId:id(901)},error:null});
 await rejected;
 assert.equal(io.requests.filter(r=>r.name).length,0);assert.equal(notificationReads,0);
});

test('already-issued create retains postcommit notification follow-up despite caller abort or follow-up failure',async(t)=>{
 const io=transport(),service=modules(io.supabase)('src/features/makeup-requests/makeup-request-service.ts');
 io.supabase.auth.getSession=async()=>({data:{session:{access_token:'synthetic-local-test-token'}},error:null});
 const originalFetch=globalThis.fetch,originalWarn=console.warn,arrival=Promise.withResolvers(),delivery=Promise.withResolvers(),warnings=[];
 globalThis.fetch=(url,options)=>{arrival.resolve({url,options});return delivery.promise;};console.warn=(...args)=>warnings.push(args);
 t.after(()=>{globalThis.fetch=originalFetch;console.warn=originalWarn;});
 const abort=new AbortController(),pending=service.createMakeupRequest(createInput,id(801),{signal:abort.signal}),rows=createCatalogRows({role:'admin'});
 for(const request of io.requests)request.resolve({data:rows[request.table],error:null});
 const mutation=await io.waitFor('create_makeup_request_v2');abort.abort();
 mutation.resolve({data:{request:{id:id(900),...mutation.args.p_input},sourceEventId:id(901)},error:null});
 const followUp=await arrival.promise;
 assert.equal(followUp.url,'/api/notifications/legacy/makeup');assert.equal(followUp.options.keepalive,true);assert.equal(followUp.options.signal,undefined);
 assert.deepEqual(JSON.parse(followUp.options.body),{sourceEventId:id(901)});
 delivery.resolve({ok:false,status:503});assert.equal((await pending).id,id(900));assert.equal(warnings.length,1);
 assert.equal(io.requests.filter(r=>r.table).length,4);assert.equal(io.requests.filter(r=>r.name).length,1);
});
