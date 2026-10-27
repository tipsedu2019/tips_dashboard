import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, button, id } from './helpers/textbook-numbered-harness.mjs';
import { loadNotificationComponent } from './helpers/notification-component-loader.mjs';
import { inputs, references, makeupReferences, classOptions, ownDetail, ownSummary, page, changeRow, teacherAuth, teacherActor } from './helpers/teacher-own-request-fixtures.mjs';
const calls=(h,name)=>h.requests.filter(request=>request.name===name);
const latest=(h,name)=>calls(h,name).at(-1);

test('new student request reads no bulk references before a class is selected', async t => {
 const h=await mount(t,'transfer');await click(h,'추가');
 assert.equal(calls(h,'get_teacher_request_references_v1').length,0);
 assert.equal(calls(h,'read_operational_common_v1').length,0);
 assert.equal(document.querySelector('[aria-label="신청 학생"]').disabled,true);
 assert.equal(document.querySelector('[aria-label="전 수업"]').disabled,false);
});
test('historical own source and student stay editable without fetching a current roster', async t => {
 const {h}=await detail(t,'withdrawal');await click(h,'신청 수정');
 assert.equal(calls(h,'get_teacher_request_references_v1').length,0);
 assert.match(document.querySelector('[aria-label="신청 학생"]').textContent,/가상 학생/);
 await change(h,'신청 메모','현재 명단과 독립인 원문 수정');await submit(h);
 assert.equal(latest(h,'mutate_teacher_own_request_v1').args.p_input.student_id,id(30));
});

for (const [status, expectedTab, expectedMode] of [['requested', 'requests', 'request'], ['received', 'purchase', 'order'], ['cancelled', 'purchase', 'order']]) {
 test(`management original textbook link opens ${status} in its compatible detail reader`, async t => {
  const { originalRequestHref } = loadNotificationComponent('src/features/teacher-requests/teacher-request-service.ts', new Map([['@/lib/supabase', { supabase: null }]]));
  const { parseTextbookNavigation } = loadNotificationComponent('src/features/textbooks/textbook-navigation.ts');
  const record = changeRow('textbook', { requestStatus: status });
  const url = new URL(originalRequestHref(record), 'https://test.invalid');
  const navigation = parseTextbookNavigation(url.searchParams);
  assert.equal(navigation.tab, expectedTab);
  assert.deepEqual(navigation.detail, { kind: 'purchase', id: record.anchorId });
  const h = await setup(t, { search: url.search });
  const read = h.requests.find(request => request.name === 'get_textbook_purchase_detail_v1');
  assert.ok(read, 'the actual workspace must start the original detail reader');
  assert.deepEqual(read.args, { p_anchor_line_id: record.anchorId, p_mode: expectedMode });
 });
}
async function mount(t,domain='textbook',auth=teacherAuth) { let changed=0;const h=await setup(t,{auth,component:{file:'src/features/teacher-requests/teacher-request-actions.tsx',name:'TeacherRequestActions'},props:{domain,onChanged:()=>changed++}});return {...h,changed:()=>changed}; }
async function click(h,label) { const el=button(label);assert.ok(el,label);await h.act(()=>el.click()); }
async function change(h,label,value) { const el=document.querySelector(`[aria-label="${label}"]`);assert.ok(el,label);await h.act(()=>el[Object.keys(el).find(key=>key.startsWith('__reactProps$'))].onChange({target:{value}})); }
async function submit(h) { const form=document.querySelector('form');assert.ok(form);await h.act(()=>form[Object.keys(form).find(key=>key.startsWith('__reactProps$'))].onSubmit({preventDefault(){}})); }
async function detail(t,domain='textbook',patch={}) { const h=await mount(t,domain);const record=ownDetail(domain,patch);await click(h,'내 신청');await h.resolve(latest(h,'get_teacher_own_requests_v1'),page([ownSummary(record)]));await click(h,record.title);await h.resolve(latest(h,'get_teacher_own_request_v1'),record);return {h,record}; }
async function edit(h,domain) { await click(h,'신청 수정');if(domain==='makeup') await h.resolve(latest(h,'get_teacher_request_references_v1'),makeupReferences); }

test('teacher entry is on demand; assistant gets no new request or management access',async t=>{
 const h=await mount(t,'transfer');assert.ok(button('내 신청'));assert.ok(button('추가'));assert.equal(h.requests.length,0);
 await h.auth({role:'assistant',isTeacher:false,isAssistant:true});assert.equal(button('내 신청'),undefined);assert.equal(button('추가'),undefined);assert.equal(button('변경·취소 요청'),undefined);assert.equal(h.requests.length,0);
});
for(const domain of ['transfer','withdrawal','makeup','textbook'])test(`${domain}: own detail restores complete application input and sends only the safe DTO`,async t=>{
 const {h,record}=await detail(t,domain);await edit(h,domain);
 const label=domain==='makeup'?'휴보강 사유':domain==='textbook'?'요청 메모':'신청 메모';
 await change(h,label,'수정한 가상 입력');await submit(h);await submit(h);
 const writes=calls(h,'mutate_teacher_own_request_v1');assert.equal(writes.length,1);
 const expected={...inputs[domain],[domain==='makeup'?'reason':'memo']:'수정한 가상 입력'};
 assert.deepEqual(writes[0].args.p_input,expected);assert.equal(writes[0].args.p_id,record.id);assert.equal(writes[0].args.p_expected_revision,'revision-a');assert.equal(writes[0].args.p_action,'update');assert.equal(writes[0].retry,false);
 assert.equal(h.requests.some(request=>request.table),false);
 await h.resolve(writes[0],ownDetail(domain,{input:expected,revision:'revision-b'}));
 assert.equal(h.changed(),1);assert.equal(calls(h,'get_teacher_own_request_v1').length,2,'success must re-read the source');
 await h.resolve(latest(h,'get_teacher_own_request_v1'),ownDetail(domain,{input:expected,revision:'revision-b'}));assert.match(document.body.textContent,/수정 저장 결과를 확인/);
});
test('unknown historical original cannot become a blank editor and exposes request-only actions',async t=>{
 const {h}=await detail(t,'textbook',{input:null,allowedActions:['change_request','cancel_request'],effectState:'unknown',blockedReason:'처리 이력 확인 필요'});
 assert.equal(button('신청 수정'),undefined);assert.equal(button('신청 철회'),undefined);assert.match(document.body.textContent,/원문을 확인할 수 없습니다/);
 await click(h,'변경 요청');await change(h,'요청 사유','가상 요청 변경');await submit(h);assert.deepEqual(latest(h,'mutate_teacher_own_request_v1').args.p_input,{note:'가상 요청 변경'});assert.equal(latest(h,'mutate_teacher_own_request_v1').args.p_action,'change_request');
});
test('uncertain save freezes its input and retries the identical request without a second effect',async t=>{
 const {h}=await detail(t);await edit(h,'textbook');await change(h,'요청 메모','불확실 입력');await submit(h);const first=latest(h,'mutate_teacher_own_request_v1');
 await h.reject(first,{code:'57014',message:'PRIVATE_ERROR_CANARY'});assert.ok(button('저장 결과 확인'));assert.equal(document.querySelector('[aria-label="요청 메모"]').disabled,true);assert.equal(document.body.textContent.includes('PRIVATE_ERROR_CANARY'),false);
 assert.equal(button('닫기').disabled,true);await click(h,'저장 결과 확인');assert.deepEqual(latest(h,'mutate_teacher_own_request_v1').args,first.args);assert.equal(calls(h,'mutate_teacher_own_request_v1').length,2);
});
test('stale revision retains draft and does not silently adopt a new revision or resubmit',async t=>{
 const {h}=await detail(t);await edit(h,'textbook');await change(h,'요청 메모','아직 저장 안 된 입력');await submit(h);await h.reject(latest(h,'mutate_teacher_own_request_v1'),{code:'23514',message:'teacher_request_stale'});
 assert.equal(document.querySelector('[aria-label="요청 메모"]').value,'아직 저장 안 된 입력');assert.equal(document.querySelector('[aria-label="요청 메모"]').disabled,false);assert.equal(calls(h,'get_teacher_own_request_v1').length,1);assert.equal(calls(h,'mutate_teacher_own_request_v1').length,1);assert.match(document.body.textContent,/최신 신청/);
});
test('permission loss removes exact detail, input and actions; old actor completion is ignored',async t=>{
 const {h}=await detail(t);await edit(h,'textbook');await submit(h);const write=latest(h,'mutate_teacher_own_request_v1');await h.reject(write,{code:'42501',message:'PRIVATE_ACCESS_CANARY'});
 assert.equal(document.querySelector('form'),null);assert.equal(document.body.textContent.includes('가상 본인 신청'),false);assert.equal(button('내 신청').disabled,true);assert.equal(h.changed(),0);
});
test('changing account unmounts the old editor and ignores its successful delayed write',async t=>{
 const {h}=await detail(t);await edit(h,'textbook');await submit(h);const write=latest(h,'mutate_teacher_own_request_v1');await h.auth({...teacherAuth,user:{id:id(1805)}});await h.resolve(write,ownDetail());assert.equal(h.changed(),0);assert.equal(document.querySelector('form'),null);assert.equal(document.body.textContent.includes('결과를 확인했습니다'),false);
});
test('list rejects a row whose current owner changed, and never displays the foreign title',async t=>{
 const h=await mount(t);await click(h,'내 신청');await h.resolve(latest(h,'get_teacher_own_requests_v1'),page([ownSummary(ownDetail('textbook',{requesterId:id(1805),title:'FOREIGN_PRIVATE_CANARY'}))]));assert.match(document.body.textContent,/목록을 불러오지 못했습니다/);assert.equal(document.body.textContent.includes('FOREIGN_PRIVATE_CANARY'),false);
});
test('selected month references are not allowed to overwrite another class or month',async t=>{
 const {h}=await detail(t,'makeup');await click(h,'신청 수정');const old=latest(h,'get_teacher_request_references_v1');await h.resolve(old,makeupReferences);await change(h,'휴강 회차 조회 월','2026-12');const next=latest(h,'get_teacher_request_references_v1');assert.equal(next.args.p_month,'2026-12');assert.equal(next.args.p_class_id,id(20));assert.equal(document.querySelector('[aria-label="휴보강 사유"]').value,'가상 휴강 사유');await h.resolve(next,{...makeupReferences,sessions:[]});assert.equal(button('수정 저장').disabled,false);
});
test('empty, read failure and permission failure are distinct; retry never writes',async t=>{
 const h=await mount(t);await click(h,'내 신청');await h.reject(latest(h,'get_teacher_own_requests_v1'),{code:'57014'});assert.equal(document.body.textContent.includes('등록한 신청이 없습니다'),false);await click(h,'다시 조회');await h.resolve(latest(h,'get_teacher_own_requests_v1'),page([]));assert.match(document.body.textContent,/등록한 신청이 없습니다/);assert.equal(calls(h,'mutate_teacher_own_request_v1').length,0);
});
test('dirty edit uses the existing discard guard; cancellation retains the same full draft',async t=>{
 const {h}=await detail(t);await edit(h,'textbook');await change(h,'요청 메모','보존할 입력');await click(h,'닫기');assert.ok(button('계속 편집'));await click(h,'계속 편집');assert.equal(document.querySelector('[aria-label="요청 메모"]').value,'보존할 입력');assert.equal(calls(h,'mutate_teacher_own_request_v1').length,0);
});
test('manager records a result separately from the underlying schedule or inventory operation',async t=>{
 const h=await mount(t,'makeup',{...teacherAuth,role:'staff',isTeacher:false,isStaff:true});assert.equal(button('내 신청'),undefined);await click(h,'변경·취소 요청');const row=changeRow();await h.resolve(latest(h,'get_teacher_request_changes_v1'),page([row]));await click(h,'가상 변경 대상 · 취소 요청');assert.match(document.body.textContent,/경과 기록은 요청을 종결하지 않습니다/);await change(h,'처리 결과 또는 반려 사유','가상 처리 확인');const save=button('처리 경과 기록');assert.ok(save);await h.act(()=>{save.click();save.click()});const writes=calls(h,'resolve_teacher_request_change_v1');assert.equal(writes.length,1);assert.equal(writes[0].args.p_resolution,'noted');assert.equal(writes[0].args.p_expected_revision,'change-a');assert.equal(h.requests.some(request=>request.table||/transition_makeup|complete_ops|lifecycle|notifications/.test(request.name)),false);
});
test('viewer can only ask for its server-scoped makeup inbox; teacher never gains approval',async t=>{
 const h=await mount(t,'makeup',{...teacherAuth,role:'viewer',isTeacher:false});await h.resolve(latest(h,'get_my_makeup_director_subjects_v1'),[]);assert.equal(button('추가'),undefined);assert.equal(button('변경·취소 요청'),undefined);assert.equal(button('승인'),undefined);
});
test('service rejects injected fields before mutation and private fields in reference responses',async t=>{
 const h=await mount(t);const api=h.load('src/features/teacher-requests/teacher-request-service.ts');await assert.rejects(api.mutateOwnRequest(teacherActor,{domain:'textbook',id:null,action:'create',input:{...inputs.textbook,status:'received'},revision:null,requestId:id(998)}),error=>error.code==='22023');assert.equal(h.requests.length,0);
 let promise;await h.act(()=>{promise=api.readRequestReferences('transfer',null,'2026-11',new AbortController().signal)});const rejection=assert.rejects(promise,/형식/);await h.resolve(latest(h,'get_teacher_request_references_v1'),{...references,students:[{...references.students[0],contact:'PRIVATE'}]});await rejection;
});

async function pick(h,label,text) {
 await h.act(()=>document.querySelector(`[aria-label="${label}"]`).click());
 const option=[...document.querySelectorAll('[cmdk-item]')].find(node=>node.textContent.includes(text));assert.ok(option,text);await h.act(()=>option.click());
}
async function pickClass(h,label,text) {
 await h.act(()=>document.querySelector(`[aria-label="${label}"]`).click());
 const read=latest(h,'read_operational_common_v1');assert.deepEqual(read.args,{p_operation:'book_request_options',p_args:{scope:'classes',search:'',page:1,pageSize:15}});
 await h.resolve(read,{rows:classOptions,totalCount:classOptions.length,page:1,pageSize:15});
 const option=[...document.querySelectorAll('[cmdk-item]')].find(node=>node.textContent===text);assert.ok(option,text);await h.act(()=>option.click());
}
for(const domain of ['transfer','withdrawal'])test(`${domain}: new request uses selected identities and never sends manager fields`,async t=>{
 const h=await mount(t,domain);await click(h,'추가');await pickClass(h,domain==='transfer'?'전 수업':'퇴원 수업','가상 원래 반');
 assert.equal(latest(h,'get_teacher_request_references_v1').args.p_class_id,id(20));await h.resolve(latest(h,'get_teacher_request_references_v1'),references);await pick(h,'신청 학생','가상 학생');
 if(domain==='transfer') { const count=calls(h,'get_teacher_request_references_v1').length;await pickClass(h,'후 수업','가상 새 반');assert.equal(calls(h,'get_teacher_request_references_v1').length,count,'destination does not load students'); }
 await change(h,'신청 메모','가상 새 신청');await submit(h);
 const write=latest(h,'mutate_teacher_own_request_v1');assert.ok(write);assert.equal(write.args.p_action,'create');assert.equal(write.args.p_id,null);assert.equal(write.args.p_expected_revision,null);assert.equal(write.args.p_input.student_id,id(30));assert.equal(write.args.p_input[domain==='transfer'?'from_class_id':'class_id'],id(20));assert.deepEqual(Object.keys(write.args.p_input).sort(),Object.keys(inputs[domain]).sort());assert.equal(h.requests.some(request=>request.table),false);
});
test('makeup creation selects a normalized source session and preserves designated approver without sending it',async t=>{
 const h=await mount(t,'makeup');await click(h,'추가');await pickClass(h,'신청 수업','가상 원래 반');
 const scoped=latest(h,'get_teacher_request_references_v1');assert.equal(scoped.args.p_class_id,id(20));const month=makeupReferences.sessions[0].date.slice(0,7);assert.equal(scoped.args.p_month,new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit'}).format(new Date()));await h.resolve(scoped,{...makeupReferences,sessions:scoped.args.p_month===month?makeupReferences.sessions:[]});if(scoped.args.p_month!==month){await change(h,'휴강 회차 조회 월',month);await h.resolve(latest(h,'get_teacher_request_references_v1'),makeupReferences);}
 const select=document.querySelector('[role="combobox"][id$="-kind"]');assert.ok(select);await h.act(()=>select.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',bubbles:true})));
 const option=[...document.querySelectorAll('[role="option"]')].find(el=>el.textContent==='휴강');assert.ok(option);await h.act(()=>option.click());
 await pick(h,'휴강 수업 회차','2026-11-02');await change(h,'휴보강 사유','가상 휴강 신청');await submit(h);
 const write=latest(h,'mutate_teacher_own_request_v1');assert.deepEqual(write.args.p_input,{...inputs.makeup,reason:'가상 휴강 신청'});assert.match(document.body.textContent,/가상 지정 승인자/);assert.equal(write.args.p_input.approver_profile_id,undefined);
});
test('manual textbook title replacement detaches the previously selected textbook identity',async t=>{
 const {h}=await detail(t,'textbook',{input:{...inputs.textbook,textbookId:id(101),title:'기존 등록 교재'},referenceLabels:{textbook:'기존 등록 교재',class:'가상 원래 반'}});await edit(h,'textbook');await change(h,'교재명','다른 직접 입력 교재');await submit(h);assert.equal(latest(h,'mutate_teacher_own_request_v1').args.p_input.textbookId,null);
});
test('source changes clear student selection and ignore old scoped responses while retaining other draft fields',async t=>{
 const h=await mount(t,'transfer');await click(h,'추가');await pickClass(h,'전 수업','가상 원래 반');await h.resolve(latest(h,'get_teacher_request_references_v1'),references);await pick(h,'신청 학생','가상 학생');await change(h,'신청 메모','수업 변경에도 보존할 초안');
 await pickClass(h,'전 수업','가상 새 반');const old=latest(h,'get_teacher_request_references_v1');assert.equal(old.args.p_class_id,id(21));
 assert.equal(document.querySelector('[aria-label="신청 학생"]').disabled,true);assert.equal(document.querySelector('[aria-label="신청 학생"]').textContent.includes('가상 학생'),false);
 await pickClass(h,'전 수업','가상 원래 반');const current=latest(h,'get_teacher_request_references_v1');assert.equal(old.signal.aborted,true);
 await h.resolve(current,{...references,students:[{id:id(35),name:'가상 대기 학생',status:'waitlisted'}]});
 await h.resolve(old,{...references,classes:[{id:id(21),name:'가상 새 반',scheduleStorageMode:'legacy'}],students:[{id:id(99),name:'STALE_STUDENT_CANARY',status:'enrolled'}]});
 await pick(h,'신청 학생','가상 대기 학생 · 대기');assert.equal(document.body.textContent.includes('STALE_STUDENT_CANARY'),false);await pickClass(h,'후 수업','가상 새 반');await submit(h);
 assert.equal(latest(h,'mutate_teacher_own_request_v1').args.p_input.student_id,id(35));assert.equal(latest(h,'mutate_teacher_own_request_v1').args.p_input.memo,'수업 변경에도 보존할 초안');
});
test('scoped empty roster, failed query and retry stay distinct and never fall back to global students',async t=>{
 const h=await mount(t,'withdrawal');await click(h,'추가');await pickClass(h,'퇴원 수업','가상 원래 반');await h.reject(latest(h,'get_teacher_request_references_v1'),{code:'57014'});
 assert.match(document.body.textContent,/선택 항목을 불러오지 못했습니다/);assert.equal(document.querySelector('[aria-label="신청 학생"]').disabled,true);
 await click(h,'선택 항목 다시 조회');assert.equal(latest(h,'get_teacher_request_references_v1').args.p_class_id,id(20));await h.resolve(latest(h,'get_teacher_request_references_v1'),{...references,students:[]});
 await h.act(()=>document.querySelector('[aria-label="신청 학생"]').click());assert.match(document.body.textContent,/선택할 항목이 없습니다/);assert.equal(document.body.textContent.includes('가상 학생'),false);
 assert.equal(calls(h,'mutate_teacher_own_request_v1').length,0);assert.ok(calls(h,'read_operational_common_v1').every(request=>request.args.p_operation==='book_request_options'));
});
test('closing a pending scoped read prevents its data from entering a newly opened form',async t=>{
 const {h}=await detail(t,'makeup');await click(h,'신청 수정');const old=latest(h,'get_teacher_request_references_v1');await click(h,'닫기');assert.equal(old.signal.aborted,true);
 await click(h,'추가');await h.resolve(old,makeupReferences);assert.equal(document.body.textContent.includes('가상 지정 승인자'),false);assert.equal(document.querySelector('[aria-label="휴강 수업 회차"]'),null);
 assert.equal(document.querySelector('[aria-label="신청 수업"]').textContent.includes('가상 원래 반'),false);assert.equal(calls(h,'get_teacher_request_references_v1').length,1);assert.equal(calls(h,'mutate_teacher_own_request_v1').length,0);
});
test('account transition discards a pending roster response and starts with no student choice',async t=>{
 const h=await mount(t,'transfer');await click(h,'추가');await pickClass(h,'전 수업','가상 원래 반');const old=latest(h,'get_teacher_request_references_v1');await h.auth({...teacherAuth,user:{id:id(1805)}});assert.equal(old.signal.aborted,true);assert.equal(document.querySelector('form'),null);
 await h.resolve(old,{...references,students:[{id:id(30),name:'OLD_ACCOUNT_STUDENT_CANARY',status:'enrolled'}]});await click(h,'추가');assert.equal(document.querySelector('[aria-label="신청 학생"]').disabled,true);assert.equal(document.body.textContent.includes('OLD_ACCOUNT_STUDENT_CANARY'),false);assert.equal(calls(h,'get_teacher_request_references_v1').length,1);assert.equal(calls(h,'mutate_teacher_own_request_v1').length,0);
});
test('reference consumer rejects a foreign class, wrong-month sessions and unused identity fields',async t=>{
 const h=await mount(t);const api=h.load('src/features/teacher-requests/teacher-request-service.ts');
 for(const [domain,body] of [['transfer',{...references,classes:[{...references.classes[0],id:id(21)}]}],['makeup',{...makeupReferences,sessions:[{...makeupReferences.sessions[0],date:'2026-12-02'}]}],['makeup',{...makeupReferences,approver:{...makeupReferences.approver,profileId:id(1)}}],['transfer',{...references,students:[{...references.students[0],classIds:[id(20),id(21)]}]}]]) {
  let promise;await h.act(()=>{promise=api.readRequestReferences(domain,id(20),'2026-11',new AbortController().signal)});const rejected=assert.rejects(promise,/형식/);await h.resolve(latest(h,'get_teacher_request_references_v1'),body);await rejected;
 }
 assert.equal(calls(h,'mutate_teacher_own_request_v1').length,0);
});
test('late detail after returning to the list cannot replace the next selected request',async t=>{
 const h=await mount(t);await click(h,'내 신청');const first=ownDetail(),second=ownDetail('textbook',{id:id(601),title:'다음 가상 신청'});await h.resolve(latest(h,'get_teacher_own_requests_v1'),page([ownSummary(first),ownSummary(second)]));await click(h,first.title);const old=latest(h,'get_teacher_own_request_v1');await click(h,'목록·상세로 돌아가기');await h.resolve(latest(h,'get_teacher_own_requests_v1'),page([ownSummary(first),ownSummary(second)]));await click(h,second.title);const current=latest(h,'get_teacher_own_request_v1');await h.resolve(current,second);await h.resolve(old,first);assert.match(document.body.textContent,/다음 가상 신청/);assert.equal(document.body.textContent.includes('가상 본인 신청'),false);
});
test('manager uncertain result checking reuses its exact immutable resolution and ignores role-loss completion',async t=>{
 const h=await mount(t,'makeup',{...teacherAuth,role:'staff',isTeacher:false,isStaff:true});await click(h,'변경·취소 요청');await h.resolve(latest(h,'get_teacher_request_changes_v1'),page([changeRow()]));await click(h,'가상 변경 대상 · 취소 요청');await change(h,'처리 결과 또는 반려 사유','가상 처리 기록');await click(h,'처리 경과 기록');const first=latest(h,'resolve_teacher_request_change_v1');await h.reject(first,{code:'57014'});assert.equal(button('닫기').disabled,true);await click(h,'저장 결과 확인');const retry=latest(h,'resolve_teacher_request_change_v1');assert.deepEqual(retry.args,first.args);await h.auth({role:'assistant',isStaff:false,isAssistant:true});const response=changeRow();for(const key of ['requesterId','title','requestStatus','anchorId','canResolve','canRecordProgress','progressNotes'])delete response[key];await h.resolve(retry,{...response,status:'confirmed'});assert.equal(button('변경·취소 요청'),undefined);assert.equal(document.body.textContent.includes('가상 처리 기록'),false);
});

test('manager detail and list return place focus within the active view',async t=>{
 const h=await mount(t,'makeup',{...teacherAuth,role:'staff',isTeacher:false,isStaff:true});await click(h,'변경·취소 요청');await h.resolve(latest(h,'get_teacher_request_changes_v1'),page([changeRow()]));await click(h,'가상 변경 대상 · 취소 요청');await h.act(()=>new Promise(resolve=>setTimeout(resolve,10)));assert.equal(document.activeElement?.getAttribute('aria-label'),'변경 요청 상세');
 await click(h,'목록으로');await h.resolve(latest(h,'get_teacher_request_changes_v1'),page([changeRow()]));await h.act(()=>new Promise(resolve=>setTimeout(resolve,10)));assert.equal(document.activeElement?.getAttribute('data-change-id'),id(700));
});

for (const [domain, status, label] of [['transfer', 'confirmed', '확인'], ['withdrawal', 'on_hold', '보류']]) {
 test(`${domain}: effect-free ${status} shows the current stage and edits no management fields`, async t => {
  const { h, record } = await detail(t, domain, { status });
  assert.ok([...document.querySelectorAll('[role="dialog"] p')].some(node => node.textContent === `${label} · ${record.createdAt.slice(0, 10)}`), "the exact current stage is shown beside its date");
  await edit(h, domain); await change(h, '신청 메모', '단계를 유지하는 가상 수정'); await submit(h);
  const write = latest(h, 'mutate_teacher_own_request_v1');
  assert.equal(write.args.p_expected_revision, record.revision);
  assert.equal(write.args.p_input.status, undefined);
  assert.deepEqual(Object.keys(write.args.p_input).sort(), Object.keys(inputs[domain]).sort());
  await h.resolve(write, ownDetail(domain, { status, input: { ...inputs[domain], memo: '단계를 유지하는 가상 수정' }, revision: 'revision-b' }));
  await h.resolve(latest(h, 'get_teacher_own_request_v1'), ownDetail(domain, { status, revision: 'revision-b' }));
  assert.ok([...document.querySelectorAll('[role="dialog"] p')].some(node => node.textContent === `${label} · ${record.createdAt.slice(0, 10)}`), "the exact current stage is shown beside its date");
  assert.ok(button('신청 수정')); assert.ok(button('신청 철회'));
 });
}

test('science teacher director gains only scoped makeup inbox and loses it immediately on identity change',async t=>{
 const h=await mount(t,'makeup');const first=latest(h,'get_my_makeup_director_subjects_v1');
 assert.equal(button('변경·취소 요청'),undefined);
 await h.resolve(first,['과학']);assert.ok(button('변경·취소 요청'));assert.ok(button('내 신청'));
 await click(h,'변경·취소 요청');const inbox=latest(h,'get_teacher_request_changes_v1');
 const record=changeRow('makeup',{canResolve:true,canRecordProgress:false});
 await h.resolve(inbox,page([record]));await click(h,'가상 변경 대상 · 취소 요청');
 assert.ok(button('원장 결정 기록'));assert.equal(button('처리 경과 기록'),undefined);
 await change(h,'처리 결과 또는 반려 사유','과학 원장 가상 결정');await click(h,'원장 결정 기록');
 const write=latest(h,'resolve_teacher_request_change_v1');assert.equal(write.args.p_resolution,'confirmed');
 await h.auth({...teacherAuth,user:{id:id(1805)}});assert.equal(button('변경·취소 요청'),undefined);assert.equal(document.querySelector('[aria-label="처리 결과 또는 반려 사유"]'),null);
 await h.resolve(write,{...record,status:'confirmed'});assert.equal(document.body.textContent.includes('과학 원장 가상 결정'),false);
 await h.resolve(latest(h,'get_my_makeup_director_subjects_v1'),[]);assert.equal(button('변경·취소 요청'),undefined);
});
test('late old-account director subject response cannot expose the inbox to a new ordinary teacher',async t=>{
 const h=await mount(t,'makeup');const old=latest(h,'get_my_makeup_director_subjects_v1');
 await h.auth({...teacherAuth,user:{id:id(1805)}});const next=latest(h,'get_my_makeup_director_subjects_v1');
 assert.equal(old.signal.aborted,true);await h.resolve(next,[]);await h.resolve(old,['과학']);assert.equal(button('변경·취소 요청'),undefined);
});
