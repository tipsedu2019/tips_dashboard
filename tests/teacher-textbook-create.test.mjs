import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, button, id } from './helpers/textbook-numbered-harness.mjs';
import { ownDetail } from './helpers/teacher-own-request-fixtures.mjs';

const teacher = n => ({ user:{id:id(n)}, role:'teacher', isTeacher:true, isAdmin:false, isStaff:false, canManageAll:false });
const calls = (h,name) => h.requests.filter(r=>r.name===name);
async function change(h,label,value) {
 const el=document.querySelector(`[aria-label="${label}"]`);assert.ok(el,label);
 await h.act(()=>el[Object.keys(el).find(k=>k.startsWith('__reactProps$'))].onChange({target:{value}}));
}
async function form(t) {
 const h=await setup(t,{mode:'requests',auth:teacher(1804)});
 const r=calls(h,'read_operational_common_v1')[0];
 await h.resolve(r,{rows:[],page:1,pageSize:15,totalCount:0});
 await h.act(()=>button('요청 추가').click());
 await change(h,'요청 교재명','한글 📘 <script> 제목');
 await change(h,'학생용 요청 수량','2');await change(h,'교사용 요청 수량','1');
 await change(h,'요청 메모','입력한 메모');
 return h;
}
async function submit(h) {
 const el=document.querySelector('form');assert.ok(el);
 await h.act(()=>{ void el[Object.keys(el).find(k=>k.startsWith('__reactProps$'))].onSubmit({preventDefault(){}}) });
}
test('teacher submits a new own request once while pending, without raw rows or financial inputs',async t=>{
 const h=await form(t);await submit(h);await submit(h);
 const writes=calls(h,'mutate_teacher_own_request_v1');assert.equal(writes.length,1);
 assert.match(writes[0].args.p_request_id,/^[a-f0-9-]{36}$/i);
 assert.deepEqual(writes[0].args.p_input,{title:'한글 📘 <script> 제목',textbookId:null,classId:null,locationId:null,studentQuantity:2,teacherQuantity:1,memo:'입력한 메모'});
 assert.equal(writes[0].retry,false);
 assert.equal(h.requests.some(r=>r.table),false);
 assert.equal(document.querySelector('[aria-label="요청 교재명"]').disabled,true);
 assert.deepEqual({domain:writes[0].args.p_domain,action:writes[0].args.p_action,id:writes[0].args.p_id,revision:writes[0].args.p_expected_revision},{domain:'textbook',action:'create',id:null,revision:null});
 await h.resolve(writes[0],ownDetail('textbook',{id:id(999),input:writes[0].args.p_input}));
 assert.equal(document.querySelector('form'),null);
 assert.match(document.body.textContent,/교재 요청을 등록했습니다/);
 assert.equal(calls(h,'read_operational_common_v1').length,2,'successful write refreshes only the common page');
 assert.equal([...document.querySelectorAll('button')].some(b=>/수정|삭제|승인|구매|입고/.test(b.textContent)),false);
});
test('uncertain save retains immutable draft and explicit result check reuses the same request id and input',async t=>{
 const h=await form(t);await submit(h);const first=calls(h,'mutate_teacher_own_request_v1')[0];
 await h.reject(first,{code:'57014',message:'PRIVATE_ERROR_CANARY'});
 assert.equal(document.querySelector('[aria-label="요청 교재명"]').value,'한글 📘 <script> 제목');
 assert.equal(document.querySelector('[aria-label="요청 교재명"]').disabled,true);
 assert.equal(document.body.textContent.includes('PRIVATE_ERROR_CANARY'),false);
 assert.equal(calls(h,'mutate_teacher_own_request_v1').length,1);
 await h.act(()=>button('저장 결과 확인').click());
 const retry=calls(h,'mutate_teacher_own_request_v1')[1];assert.deepEqual(retry.args,first.args);
 await h.resolve(retry,ownDetail('textbook',{id:id(999),input:retry.args.p_input}));assert.equal(document.querySelector('form'),null);
});
test('role or user change removes the former draft and ignores its pending completion',async t=>{
 const h=await form(t);await submit(h);const first=calls(h,'mutate_teacher_own_request_v1')[0];
 await h.auth(teacher(1805));await h.resolve(first,ownDetail('textbook',{id:id(999),input:first.args.p_input}));
 assert.equal(document.querySelector('form'),null);
 assert.equal(document.body.textContent.includes('교재 요청을 등록했습니다'),false);
 assert.equal(document.body.textContent.includes('입력한 메모'),false);
 assert.equal(calls(h,'read_operational_common_v1').length,2);
});

test('minimal selectors are loaded only on demand, keep the selected UUID, and reject private fields',async t=>{
 const h=await form(t);
 assert.equal(calls(h,'read_operational_common_v1').length,1);
 await h.act(()=>document.querySelector('[aria-label="요청 수업 선택"]').click());
 const options=calls(h,'read_operational_common_v1').at(-1);
 assert.deepEqual(options.args,{p_operation:'book_request_options',p_args:{scope:'classes',search:'',page:1,pageSize:15}});
 await h.resolve(options,{rows:[{id:id(800),label:'안전한 수업'}],page:1,pageSize:15,totalCount:1});
 await h.act(()=>document.querySelector('[cmdk-item]').click());
 await submit(h);
 assert.equal(calls(h,'mutate_teacher_own_request_v1')[0].args.p_input.classId,id(800));
 assert.equal(h.requests.some(r=>r.table),false);
 const write=calls(h,'mutate_teacher_own_request_v1')[0];await h.resolve(write,ownDetail('textbook',{id:id(999),input:write.args.p_input}));
});

test('minimal option consumer rejects financial fields and invalid pages without any writes',async t=>{
 const h=await setup(t,{mode:'requests',auth:teacher(1804)});
 const api=h.load('src/features/textbooks/teacher-textbook-request-submit.ts');
 let promise;await h.act(()=>{promise=api.readTeacherTextbookRequestOptions({scope:'textbooks',search:'교재',page:1},new AbortController().signal)});
 const options=calls(h,'read_operational_common_v1').at(-1);
 const rejected=assert.rejects(promise,/형식/);
 await h.resolve(options,{rows:[{id:id(101),label:'교재',unitCost:100}],page:1,pageSize:15,totalCount:1});await rejected;
 await assert.rejects(api.readTeacherTextbookRequestOptions({scope:'classes',search:'',page:0},new AbortController().signal),/형식/);
 assert.equal(calls(h,'mutate_teacher_own_request_v1').length,0);
});

for(const label of ['등록 교재 선택','요청 수업 선택','요청 위치 선택'])test(`${label}: permission loss clears an existing create draft without any write`,async t=>{
 const h=await form(t);await h.act(()=>document.querySelector(`[aria-label="${label}"]`).click());const request=calls(h,'read_operational_common_v1').at(-1);await h.reject(request,{code:'42501',message:'PRIVATE_ROLE_CANARY'});
 assert.equal(document.querySelector('form'),null);assert.equal(document.body.textContent.includes('입력한 메모'),false);assert.equal(document.body.textContent.includes('PRIVATE_ROLE_CANARY'),false);assert.match(document.body.textContent,/권한 또는 로그인/);assert.equal(calls(h,'mutate_teacher_own_request_v1').length,0);
});
