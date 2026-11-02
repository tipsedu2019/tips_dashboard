import { subjectCatalog, subjectScopeResponse } from './helpers/teacher-subject-fixtures.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, button, id } from './helpers/textbook-numbered-harness.mjs';
import { teacherAuth, inputs, ownDetail, ownSummary, page, references, makeupReferences } from './helpers/teacher-own-request-fixtures.mjs';
import { loadNotificationComponent } from './helpers/notification-component-loader.mjs';
const calls=(h,name)=>h.requests.filter(r=>r.name===name), latest=(h,name)=>calls(h,name).at(-1);
const rpc={list:'get_operations_class_schedule_numbered_page_v1',detail:'get_operations_class_lesson_design_detail_v1',schedule:'get_class_schedule_v1',write:'mutate_teacher_own_request_v1'};
const classRow=(n=20,mode='legacy')=>({id:id(n),name:n===20?'가상 원래 반':'가상 새 반',subject:'영어',grade:'중2',teacher:'가상 교사',schedule:'월수 19:30~21:30',room:'가상 교실',scheduleStorageMode:mode,schedulePlan:{sessions:[{id:id(31),date:'2026-11-02',scheduleState:'active',sessionNumber:1,startTime:'19:30',endTime:'21:30'},{id:id(32),date:'2026-11-04',scheduleState:'active',sessionNumber:2,startTime:'19:30',endTime:'21:30'}]}});
async function click(h,label){const node=button(label);assert.ok(node,label);await h.act(()=>node.click());}
async function change(h,node,value){assert.ok(node);await h.act(()=>node[Object.keys(node).find(k=>k.startsWith('__reactProps$'))].onChange({target:{value}}));}
async function submit(h){const form=document.querySelector('form');await h.act(()=>form[Object.keys(form).find(k=>k.startsWith('__reactProps$'))].onSubmit({preventDefault(){}}));}
async function mount(t,domain){
 const props={domain,onChanged(){}};
 const h=await setup(t,{auth:teacherAuth,component:{file:'src/features/teacher-requests/teacher-request-actions.tsx',name:'TeacherRequestActions'},props});
 props.Fields=domain==='makeup'?h.load('src/features/makeup-requests/makeup-request-workspace.tsx').TeacherMakeupRequestFields:h.load('src/features/tasks/ops-task-workspace.tsx').TeacherTransitionRequestFields;
 await h.render();return h;
}
async function edit(t,domain,patch={},currentApprover=makeupReferences.approver,classStatus='수강'){
 const h=await mount(t,domain),record=ownDetail(domain,patch);
 await click(h,'내 신청');await h.resolve(latest(h,'get_teacher_own_requests_v1'),page([ownSummary(record)]));await click(h,record.title);await h.resolve(latest(h,'get_teacher_own_request_v1'),record);await click(h,'신청 수정');
 if(domain==='makeup')await h.resolve(latest(h,'get_teacher_request_references_v1'),{...makeupReferences,approver:currentApprover,classes:[{...makeupReferences.classes[0],scheduleStorageMode:'legacy'}],sessions:[]});
 for(const request of calls(h,rpc.detail))await h.resolve(request,{classItem:{...classRow(request.args.p_class_id===id(21)?21:20),status:classStatus}});
 await subjectMetadata(h);
 return {h,record};
}
for(const domain of ['withdrawal','transfer','makeup'])test(`${domain}: production shared form preserves safe update, duplicate guard and failed draft`,async t=>{
 const {h}=await edit(t,domain);
 assert.equal(document.body.textContent.includes('메이크에듀'),false);assert.equal(document.body.textContent.includes('교재비 처리'),false);
 if(domain==='makeup'){
  assert.ok(document.getElementById('makeup-subject'));assert.ok(document.getElementById('makeup-teacher'));assert.ok(document.getElementById('cancel-date'));
  assert.ok(button('보강일시 1 시작시각'));assert.ok(button('보강일시 1 날짜'));
  await change(h,document.getElementById('makeup-reason'),'공통 양식 수정');
 }else{
  assert.ok(document.querySelector('[role="grid"]'),'actual management calendar');assert.ok(button('미배부 교재 추가')||button('전 미배부 교재 추가')||[...document.querySelectorAll('button')].some(el=>el.textContent.includes('교재 추가')),'textbook list controls');
  await change(h,[...document.querySelectorAll('textarea')].at(-1),'공통 양식 수정');
 }
 await submit(h);await submit(h);assert.equal(calls(h,rpc.write).length,1);
 const write=latest(h,rpc.write);assert.deepEqual(Object.keys(write.args.p_input).sort(),Object.keys(inputs[domain]).sort());assert.equal(write.args.p_input[domain==='makeup'?'class_id':'student_id'],inputs[domain][domain==='makeup'?'class_id':'student_id']);
 await h.reject(write,{code:'23514',message:'teacher_request_stale'});assert.match(document.body.textContent,/최신/);
 assert.ok([...document.querySelectorAll('textarea')].some(node=>node.value==='공통 양식 수정'));
 await click(h,'닫기');assert.ok(button('계속 편집'));await click(h,'계속 편집');assert.equal(calls(h,rpc.write).length,1);
 assert.equal(h.requests.some(r=>r.table),false);assert.equal(h.requests.some(r=>/create_makeup|complete_ops|transition_makeup/.test(r.name)),false);
});
test('normalized display keeps same-day identities/billing and refuses incomplete reads',()=>{
 const api=loadNotificationComponent('src/features/teacher-requests/teacher-form-context.tsx',new Map([['@/providers/auth-provider',{useAuth(){return teacherAuth;}}]]));
 const row=classRow(20,'normalized');const before=structuredClone(row);
 const sessions=[{id:id(32),session_key:'b',session_date:'2026-11-02',schedule_state:'makeup',start_time:'20:30:00',end_time:'21:30:00',legacy_billing_id:'cycle',legacy_billing_label:'11월',legacy_billing_color:'#abc'},{id:id(31),session_key:'a',session_date:'2026-11-02',schedule_state:'active',start_time:'19:30:00',end_time:'20:30:00'}];
 const mapped=api.teacherFormClass(row,{sessions},'2026-11');assert.equal(mapped.schedulePlan.sessions.length,2);assert.deepEqual(mapped.schedulePlan.sessions.map(s=>s.sessionNumber),[2,1]);assert.equal(mapped.schedulePlan.sessions[0].billingId,'cycle');assert.deepEqual(row,before);
 assert.throws(()=>api.teacherFormClass(row),/schedule_missing/);
 assert.deepEqual(api.teacherFormMonthRange('2028-02'),{dateFrom:'2028-02-01',dateTo:'2028-02-29'});
});
test('management form owners actually call the same shared bodies',()=>{
 // Structural wiring supplements the rendered interaction cases above.
 const {readFileSync}=awaitImportFs();
 for(const [path,component,teacher] of [['tasks/ops-task-workspace.tsx','TransitionRequestFormFields','TeacherTransitionRequestFields'],['makeup-requests/makeup-request-workspace.tsx','MakeupRequestFormFields','TeacherMakeupRequestFields']]){
  const source=readFileSync(`src/features/${path}`,'utf8');assert.ok(source.includes(`Fields={${teacher}}`));assert.equal((source.match(new RegExp(`<${component}\\b`,'g'))||[]).length,2);
 }
});
import * as fs from 'node:fs';
function awaitImportFs(){return fs;}
function catalog(request, {total=2, rows=[20,21]}={}) { return {page:request.args.p_page,pageSize:15,totalCount:total,rows:rows.map(n=>({id:id(n),name:classRow(n).name,subject:'영어',grade:'중2',schedule:'월수',status:'수강',teacherName:'가상 교사',termId:null,termName:null,syncGroupId:null,syncGroupName:null,updatedAt:null})),stats:{total,active:total,draft:0},filterOptions:{terms:[],subjects:['영어'],grades:['중2'],teachers:['가상 교사'],syncGroups:[]},syncGroupCounts:[]}; }
async function catalogs(h){ h.finished ||= new Set();for(const r of calls(h,rpc.list).filter(r=>!h.finished.has(r))){h.finished.add(r);await h.resolve(r,catalog(r));}await subjectMetadata(h);}
async function mixedStatusCatalogs(h) {
 h.finished ||= new Set();
 for (const r of calls(h,rpc.list).filter(r=>!h.finished.has(r))) {
  h.finished.add(r);const data=catalog(r);
  data.rows=data.rows.map(row=>({...row,status:row.id===id(21)?'종강':'수강'}));
  data.filterOptions.teachers=['가상 교사','가상 수학 교사','가상 과학 교사'];
  await h.resolve(r,data);
 }
 await subjectMetadata(h);
}
for(const domain of ['withdrawal','transfer','makeup'])test(`${domain}: subject narrowing and ended-class exclusion coexist in new teacher request choices`,async t=>{
 const h=await mount(t,domain);await click(h,'추가');await mixedStatusCatalogs(h);
 await pick(h,domain==='makeup'?'subject':'과목','영어');await mixedStatusCatalogs(h);
 const teacherLabel=domain==='makeup'?'teacher':domain==='transfer'?'전 선생님':'선생님';
 const teacherControl=document.getElementById('makeup-'+teacherLabel)||labelled(teacherLabel);
 await h.act(()=>teacherControl.id.startsWith('makeup-')?teacherControl.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',bubbles:true})):teacherControl.click());
 const teachers=[...document.querySelectorAll('[role="option"]')].map(node=>node.textContent.trim());
 assert.ok(teachers.includes('가상 교사'));assert.equal(teachers.includes('가상 수학 교사'),false);assert.equal(teachers.includes('가상 과학 교사'),false);
 await h.act(()=>document.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
 await pick(h,domain==='makeup'?'teacher':domain==='transfer'?'전 선생님':'선생님','가상 교사');await mixedStatusCatalogs(h);
 const select=document.getElementById('makeup-class')||labelled('수업')||labelled('전 수업');assert.ok(select);
 await h.act(()=>select.id==='makeup-class'?select.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',bubbles:true})):select.click());
 const options=[...document.querySelectorAll('[role="option"]')].map(node=>node.textContent.trim());
 assert.ok(options.includes('가상 원래 반'));
 assert.equal(options.includes('가상 새 반'),false,'ended class cannot be newly selected');
 assert.equal(calls(h,rpc.write).length,0);
});
for(const domain of ['withdrawal','transfer','makeup'])test(`${domain}: an existing ended class remains visible and unchanged on edit`,async t=>{
 const {h}=await edit(t,domain,{},makeupReferences.approver,'종강');
 assert.ok(document.body.textContent.includes('가상 원래 반'));
 if(domain==='makeup')await change(h,document.getElementById('makeup-reason'),'기존 종강 수업 보존');
 else await change(h,[...document.querySelectorAll('textarea')].at(-1),'기존 종강 수업 보존');
 await submit(h);const write=latest(h,rpc.write);assert.ok(write);
 const key=domain==='transfer'?'from_class_id':'class_id';assert.equal(write.args.p_input[key],inputs[domain][key]);
 if(domain==='transfer')assert.equal(write.args.p_input.to_class_id,inputs.transfer.to_class_id);
});
function labelled(label){return [...document.querySelectorAll('button[aria-labelledby]')].find(el=>document.getElementById(el.getAttribute('aria-labelledby'))?.textContent.replace(/필수 입력|필수입력|\*/g,'').trim()===label);}
async function pick(h,label,option){const node=document.getElementById(`makeup-${label}`)||labelled(label);assert.ok(node,label);await h.act(()=>node.id.startsWith('makeup-')?node.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',bubbles:true})):node.click());const opt=[...document.querySelectorAll('[role="option"]')].find(el=>el.textContent.trim()===option);assert.ok(opt,option);await h.act(()=>opt.click());}
for(const domain of ['withdrawal','transfer','makeup'])test(`${domain}: existing subject/teacher/class sequence creates with the owner API only`,async t=>{
 const h=await mount(t,domain);await click(h,'추가');await catalogs(h);
 await pick(h,domain==='makeup'?'subject':'과목','영어');await catalogs(h);
 await pick(h,domain==='makeup'?'teacher':domain==='transfer'?'전 선생님':'선생님','가상 교사');await catalogs(h);
 await pick(h,domain==='makeup'?'class':domain==='transfer'?'전 수업':'수업','가상 원래 반');await h.resolve(latest(h,rpc.detail),{classItem:classRow()});
 await h.resolve(latest(h,'get_teacher_request_references_v1'),domain==='makeup'?{...makeupReferences,classes:[{...makeupReferences.classes[0],scheduleStorageMode:'legacy'}],sessions:[]}:references);
 if(domain!=='makeup'){
  await pick(h,'학생','가상 학생');
  if(domain==='transfer'){await pick(h,'후 선생님','가상 교사');await catalogs(h);await pick(h,'후 수업','가상 새 반');await h.resolve(latest(h,rpc.detail),{classItem:classRow(21)});
   await submit(h);assert.equal(calls(h,rpc.write).length,0,'management required-date gate also applies to teachers');
   for(let index=0;index<2;index++){const grid=document.querySelectorAll('[role="grid"]')[index];const day=[...grid.querySelectorAll('[role="gridcell"]')].find(el=>!el.disabled);assert.ok(day);await h.act(()=>day.click());const read=latest(h,rpc.detail);await h.resolve(read,{classItem:classRow(read.args.p_class_id===id(21)?21:20)});}
  }
  await change(h,[...document.querySelectorAll('textarea')].at(-1),'신규 합성 신청');
 }else{await change(h,document.getElementById('makeup-reason'),'신규 합성 휴강');await h.act(()=>document.getElementById('cancel-date').click());const day=[...document.querySelectorAll('button')].find(el=>el.getAttribute('data-day')==='2026-11-02');
  // Navigate through the real picker to its linked date, independent of today's month.
  const linked=[...document.querySelectorAll('button')].find(el=>el.textContent.includes('11-02')&&el.textContent.includes('회차'));assert.ok(day||linked);await h.act(()=>(day||linked).click());}
 await submit(h);const write=latest(h,rpc.write);assert.ok(write);assert.equal(write.args.p_action,'create');assert.equal(write.args.p_expected_revision,null);assert.deepEqual(Object.keys(write.args.p_input).sort(),Object.keys(inputs[domain]).sort());
 assert.equal(h.requests.some(r=>r.table),false);
});
test('reason-only makeup edit preserves overnight timestamps and precision exactly',async t=>{
 const slots=[{startAt:'2026-11-02T14:00:12.345Z',endAt:'2026-11-02T16:30:23.456Z',classroom:'가상 교실'}];
 const {h}=await edit(t,'makeup',{input:{...inputs.makeup,request_kind:'cancel_makeup',makeup_slots:slots}});
 await change(h,document.getElementById('makeup-reason'),'사유만 수정');await submit(h);assert.deepEqual(latest(h,rpc.write).args.p_input.makeup_slots,slots);
});
async function selectMakeupEndTime(h, row, label) {
 const trigger = [...document.querySelectorAll('button')].find(node => node.getAttribute('aria-label')?.match(new RegExp(`^보강일시 ${row} 종료시각(?::|$)`)));
 assert.ok(trigger);
 await h.act(() => trigger.click());
 const option = [...document.querySelectorAll('[role="option"]')].find(node => node.textContent.trim() === label);
 assert.ok(option, label);
 await h.act(() => option.click());
}
const overnightSlot = {startAt:'2026-11-02T14:00:00.000Z',endAt:'2026-11-02T15:00:00.000Z',classroom:'가상 교실'};
for (const [label, expectedEnd] of [['오전 12:00','2026-11-02T15:00:00.000Z'],['오전 09:00','2026-11-03T00:00:00.000Z']]) test(`overnight end-time selection retains the next day: ${label}`, async t => {
 const {h} = await edit(t, 'makeup', {input:{...inputs.makeup,makeup_slots:[overnightSlot]}});
 await selectMakeupEndTime(h, 1, label);
 assert.match(document.body.textContent, /종료시각 · 2026-11-03/);
 await submit(h);
 assert.deepEqual(latest(h,rpc.write).args.p_input.makeup_slots, [{...overnightSlot,endAt:expectedEnd}]);
});
test('same-day end-time selection keeps its original date', async t => {
 const slot = {...overnightSlot,startAt:'2026-11-02T01:00:00.000Z',endAt:'2026-11-02T02:00:00.000Z'};
 const {h} = await edit(t, 'makeup', {input:{...inputs.makeup,makeup_slots:[slot]}});
 await selectMakeupEndTime(h, 1, '오후 12:00');
 await submit(h);
 assert.deepEqual(latest(h,rpc.write).args.p_input.makeup_slots, [{...slot,endAt:'2026-11-02T03:00:00.000Z'}]);
});
test('overnight end-time edits remain isolated across rows and repeated selections', async t => {
 const second = {...overnightSlot,startAt:'2026-11-04T01:00:12.345Z',endAt:'2026-11-04T02:00:23.456Z'};
 const {h} = await edit(t, 'makeup', {input:{...inputs.makeup,makeup_slots:[overnightSlot,second]}});
 await selectMakeupEndTime(h, 1, '오전 09:00');
 await selectMakeupEndTime(h, 1, '오전 10:00');
 await submit(h);
 assert.deepEqual(latest(h,rpc.write).args.p_input.makeup_slots, [{...overnightSlot,endAt:'2026-11-03T01:00:00.000Z'},second]);
});
test('clearing and reselecting an overnight end time preserves the end date across a month boundary', async t => {
 const slot = {...overnightSlot,startAt:'2026-10-31T14:00:00.000Z',endAt:'2026-10-31T15:00:00.000Z'};
 const {h} = await edit(t, 'makeup', {input:{...inputs.makeup,makeup_slots:[slot]}});
 await click(h, '보강일시 1 종료시각 초기화');
 await submit(h);
 assert.equal(calls(h,rpc.write).length,0,'an incomplete slot cannot be submitted');
 await selectMakeupEndTime(h, 1, '오전 09:00');
 await submit(h);
 assert.deepEqual(latest(h,rpc.write).args.p_input.makeup_slots, [{...slot,endAt:'2026-11-01T00:00:00.000Z'}]);
});
test('discarding an overnight end-time edit performs no write and reopening restores the original', async t => {
 const {h,record} = await edit(t, 'makeup', {input:{...inputs.makeup,makeup_slots:[overnightSlot]}});
 await selectMakeupEndTime(h, 1, '오전 09:00');
 await click(h,'닫기');await click(h,'변경사항 버리기');
 assert.equal(calls(h,rpc.write).length,0);
 await click(h,'내 신청');await h.resolve(latest(h,'get_teacher_own_requests_v1'),page([ownSummary(record)]));
 await click(h,record.title);await h.resolve(latest(h,'get_teacher_own_request_v1'),record);await click(h,'신청 수정');
 await h.resolve(latest(h,'get_teacher_request_references_v1'),{...makeupReferences,classes:[{...makeupReferences.classes[0],scheduleStorageMode:'legacy'}],sessions:[]});
 await h.resolve(latest(h,rpc.detail),{classItem:classRow()});
 assert.match(document.body.textContent,/종료시각 · 2026-11-03/);
 await submit(h);
 assert.deepEqual(latest(h,rpc.write).args.p_input.makeup_slots,[overnightSlot]);
});
test('legacy empty schedule permits a real date without inventing sessions',async t=>{
 const h=await mount(t,'makeup');const record=ownDetail('makeup');await click(h,'내 신청');await h.resolve(latest(h,'get_teacher_own_requests_v1'),page([ownSummary(record)]));await click(h,record.title);await h.resolve(latest(h,'get_teacher_own_request_v1'),record);await click(h,'신청 수정');
 await h.resolve(latest(h,'get_teacher_request_references_v1'),{...makeupReferences,classes:[{...makeupReferences.classes[0],scheduleStorageMode:'legacy'}],sessions:[]});await h.resolve(latest(h,rpc.detail),{classItem:{...classRow(),schedulePlan:{sessions:[]}}});
 await h.act(()=>document.getElementById('cancel-date').click());assert.ok([...document.querySelectorAll('[role="gridcell"] button,button[data-day]')].some(el=>!el.disabled));assert.equal(calls(h,rpc.write).length,0);
});
test('same-day normalized sessions retain time labels, makeup state and exact UUID selection',async t=>{
 const h=await mount(t,'makeup'), record=ownDetail('makeup');await click(h,'내 신청');await h.resolve(latest(h,'get_teacher_own_requests_v1'),page([ownSummary(record)]));await click(h,record.title);await h.resolve(latest(h,'get_teacher_own_request_v1'),record);await click(h,'신청 수정');
 await h.resolve(latest(h,'get_teacher_request_references_v1'),{...makeupReferences,sessions:[...makeupReferences.sessions,{id:id(32),date:'2026-11-02',startTime:'21:30:00',endTime:'22:30:00',revision:1}]});await h.resolve(latest(h,rpc.detail),{classItem:classRow(20,'normalized')});
 await h.resolve(latest(h,rpc.schedule),{authoritativeSource:'normalized',sessions:[{id:id(31),session_key:'regular',session_date:'2026-11-02',schedule_state:'active',start_time:'19:30:00',end_time:'21:30:00'},{id:id(32),session_key:'makeup',session_date:'2026-11-02',schedule_state:'makeup',start_time:'21:30:00',end_time:'22:30:00'}]});
 await h.act(()=>document.getElementById('original-lesson-session').dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',bubbles:true})));
 const option=[...document.querySelectorAll('[role="option"]')].find(el=>el.textContent==='21:30–22:30 · 보강 수업');assert.ok(option);await h.act(()=>option.click());await submit(h);assert.equal(latest(h,rpc.write).args.p_input.original_lesson_session_id,id(32));
});
test('failed schedule and permission loss do not synthesize dates or retain the old form',async t=>{
 const h=await mount(t,'withdrawal'),record=ownDetail('withdrawal');await click(h,'내 신청');await h.resolve(latest(h,'get_teacher_own_requests_v1'),page([ownSummary(record)]));await click(h,record.title);await h.resolve(latest(h,'get_teacher_own_request_v1'),record);await click(h,'신청 수정');
 await h.reject(latest(h,rpc.detail),{code:'57014',message:'PRIVATE_SCHEDULE_ERROR'});assert.equal(document.querySelector('[role="grid"]'),null);assert.ok(button('일정 다시 조회'));assert.equal(document.body.textContent.includes('PRIVATE_SCHEDULE_ERROR'),false);
 await click(h,'일정 다시 조회');await h.reject(latest(h,rpc.detail),{code:'42501',message:'PRIVATE_DENIAL'});assert.equal(document.querySelector('form'),null);assert.equal(document.body.textContent.includes('가상 원문 메모'),false);assert.equal(calls(h,rpc.write).length,0);
});
test('actual SQL captured legacy projection is preserved by the new display adapter',()=>{
 const payload=JSON.parse(fs.readFileSync('tests/fixtures/teacher-planning-common-response.json','utf8'));
 const api=loadNotificationComponent('src/features/teacher-requests/teacher-form-context.tsx',new Map([['@/providers/auth-provider',{useAuth(){return teacherAuth;}}]]));
 const result=api.teacherFormClass(payload.detail.classItem);assert.equal(result.id,payload.detail.classItem.id);assert.deepEqual(result.schedulePlan,payload.detail.classItem.schedulePlan);assert.equal(JSON.stringify(result).includes('PRIVATE_'),false);
});
import { useState, useLayoutEffect } from 'react';
test('class context is paged and ignores a superseded selected-class response',async t=>{
 const h=await mount(t,'withdrawal');const {useTeacherFormClass}=h.load('src/features/teacher-requests/teacher-form-context.tsx');let current,select;const denied=()=>assert.fail('unexpected denial');
 function Probe(){const [selected,setSelected]=useState(id(20));const result=useTeacherFormClass({id:selected,month:'2026-11',subject:'영어',teacher:'가상 교사',onPermissionDenied:denied});useLayoutEffect(()=>{current=result;select=setSelected;});return null;}
 await h.mountTestComponent(Probe,{});const old=latest(h,rpc.detail);await h.act(()=>select(id(21)));const fresh=latest(h,rpc.detail);await h.resolve(fresh,{classItem:classRow(21)});await h.resolve(old,{classItem:classRow(20)});assert.equal(current.selected.id,id(21));
 await h.resolve(latest(h,rpc.list),catalog(latest(h,rpc.list),{total:20}));await h.act(()=>current.setPage(2));const next=latest(h,rpc.list);assert.equal(next.args.p_page,2);assert.equal(next.args.p_page_size,15);assert.equal(current.options.some(row=>row.id===id(20)),false,'old page is not the current page');await h.resolve(next,catalog(next,{total:20,rows:[22]}));assert.equal(current.totalCount,20);assert.equal(current.page,2);assert.ok(current.options.some(row=>row.id===id(22)));assert.equal(h.requests.some(r=>r.table),false);
});

for (const currentApprover of [{label:null,status:'unresolved'},{label:'새 기본 승인자',status:'resolved'}]) test(`existing makeup keeps its visible assigned approver when current default is ${currentApprover.status}`,async t=>{
 const {h}=await edit(t,'makeup',{},currentApprover);
 const selector=document.getElementById('makeup-approver');assert.ok(selector);assert.match(selector.textContent,/가상 지정 승인자/);assert.equal(selector.disabled,true);
 await change(h,document.getElementById('makeup-reason'),'기존 승인자 보존');await submit(h);const write=latest(h,rpc.write);assert.ok(write);assert.equal(write.args.p_action,'update');assert.equal(Object.keys(write.args.p_input).some(key=>/approver/.test(key)),false);
});
test('new makeup remains blocked when no current subject approver resolves',async t=>{
 const h=await mount(t,'makeup');await click(h,'추가');await catalogs(h);
 await pick(h,'subject','영어');await catalogs(h);await pick(h,'teacher','가상 교사');await catalogs(h);await pick(h,'class','가상 원래 반');
 await h.resolve(latest(h,rpc.detail),{classItem:classRow()});await h.resolve(latest(h,'get_teacher_request_references_v1'),{...makeupReferences,approver:{label:null,status:'unresolved'},classes:[{...makeupReferences.classes[0],scheduleStorageMode:'legacy'}],sessions:[]});
 await change(h,document.getElementById('makeup-reason'),'미배정 생성 차단');await h.act(()=>document.getElementById('cancel-date').click());const linked=[...document.querySelectorAll('button')].find(el=>el.textContent.includes('11-02')&&el.textContent.includes('회차'));assert.ok(linked);await h.act(()=>linked.click());
 await submit(h);assert.equal(calls(h,rpc.write).length,0);assert.equal(document.querySelector('button[type="submit"]').disabled,true);
});

test('teacher class choices resolve only unknown status dates and reject stale or failed status reads', async t => {
 const h=await mount(t,'withdrawal');await click(h,'추가');
 const first=latest(h,rpc.list), response=catalog(first);
 response.rows[0].status='';response.rows[1].status='수강';
 await h.resolve(first,response);const oldDetail=latest(h,rpc.detail);
 assert.equal(calls(h,rpc.detail).length,1,'recognized status needs no detail read');
 await click(h,'닫기');await click(h,'추가');
 const current=latest(h,rpc.list);assert.notEqual(current,first);
 await h.resolve(oldDetail,{classItem:{...classRow(),status:'',endDate:'2000-01-01'}});
 await h.resolve(current,{...catalog(current),rows:[{...catalog(current).rows[0],status:''}]});
 const detail=latest(h,rpc.detail);assert.notEqual(detail,oldDetail);
 await h.reject(detail,new Error('synthetic unavailable'));
 assert.match(document.body.textContent,/조회에 실패했습니다/);
 assert.equal(calls(h,rpc.write).length,0);
 await click(h,'일정 다시 조회');const retried=latest(h,rpc.list);
 await h.resolve(retried,{...catalog(retried),rows:[{...catalog(retried).rows[0],status:''}]});
 await h.resolve(latest(h,rpc.detail),{classItem:{...classRow(),status:'',endDate:'2000-01-01'}});
 await pick(h,'과목','영어');const subjectRead=latest(h,rpc.list);await h.resolve(subjectRead,catalog(subjectRead));await subjectMetadata(h);
 await pick(h,'선생님','가상 교사');const filtered=latest(h,rpc.list);
 await h.resolve(filtered,{...catalog(filtered),rows:[{...catalog(filtered).rows[0],status:''},catalog(filtered).rows[1]]});
 await h.resolve(latest(h,rpc.detail),{classItem:{...classRow(),status:'',endDate:'2000-01-01'}});
 await h.act(()=>labelled('수업').click());
 const options=[...document.querySelectorAll('[role="option"]')].map(node=>node.textContent.trim());
 assert.equal(options.includes('가상 원래 반'),false);assert.ok(options.includes('가상 새 반'));
 assert.equal(h.requests.some(r=>r.table),false);
});

test('transfer target class choices also exclude ended classes and retain another active target', async t => {
 const h=await mount(t,'transfer');
 async function choices() {
  h.finished ||= new Set();
  for(const r of calls(h,rpc.list).filter(r=>!h.finished.has(r))) {
   h.finished.add(r);const data=catalog(r,{total:3,rows:[20,21,22]});
   data.rows=data.rows.map(item=>({...item,name:item.id===id(22)?'가상 진행 후 수업':item.name,status:item.id===id(21)?'종강':'수강'}));
   await h.resolve(r,data);
  }
  await subjectMetadata(h);
 }
 await click(h,'추가');await choices();await pick(h,'과목','영어');await choices();
 await pick(h,'전 선생님','가상 교사');await choices();await pick(h,'전 수업','가상 원래 반');
 await h.resolve(latest(h,rpc.detail),{classItem:classRow()});await h.resolve(latest(h,'get_teacher_request_references_v1'),references);
 await pick(h,'후 선생님','가상 교사');await choices();await h.act(()=>labelled('후 수업').click());
 const options=[...document.querySelectorAll('[role="option"]')].map(node=>node.textContent.trim());
 assert.ok(options.includes('가상 진행 후 수업'));assert.equal(options.includes('가상 새 반'),false);
 assert.equal(options.includes('가상 원래 반'),false,'source cannot also be the target');assert.equal(calls(h,rpc.write).length,0);
});

async function subjectMetadata(h) {
 h.metadataFinished ||= new Set();
 for(const r of h.requests.filter(r=>['list_operations_catalogs_v1','get_academic_curriculum_numbered_page_v2'].includes(r.name)&&!h.metadataFinished.has(r))) {
  h.metadataFinished.add(r);await h.resolve(r,r.name==='list_operations_catalogs_v1'?subjectCatalog:subjectScopeResponse(r));
 }
}
async function globalTeacherCatalogs(h) {
 h.finished ||= new Set();
 for(const r of calls(h,rpc.list).filter(r=>!h.finished.has(r))) {
  h.finished.add(r);const data=catalog(r);data.filterOptions.subjects=['영어','수학','과학'];data.filterOptions.teachers=['가상 교사','가상 수학 교사','가상 과학 교사','가상 복수 교사'];
  await h.resolve(r,data);
 }
 await subjectMetadata(h);
}
for(const domain of ['withdrawal','transfer','makeup'])test(`${domain}: subject selection narrows teacher choices independently of the current class page`,async t=>{
 const h=await mount(t,domain);await click(h,'추가');await globalTeacherCatalogs(h);
 for(const [subject,expected,absent] of [['수학',['가상 수학 교사','가상 복수 교사'],['가상 교사','가상 과학 교사']],['영어',['가상 교사','가상 복수 교사','가상 카탈로그 외 교사'],['가상 수학 교사','가상 과학 교사']],['과학',['가상 과학 교사'],['가상 교사','가상 수학 교사','가상 복수 교사']]]) {
  await pick(h,domain==='makeup'?'subject':'과목',subject);await globalTeacherCatalogs(h);
  for(const label of domain==='transfer'?['전 선생님','후 선생님']:[domain==='makeup'?'teacher':'선생님']) {
   const trigger=document.getElementById('makeup-'+label)||labelled(label);assert.ok(trigger);
   await h.act(()=>trigger.id.startsWith('makeup-')?trigger.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',bubbles:true})):trigger.click());
   const names=[...document.querySelectorAll('[role="option"]')].map(node=>node.textContent.trim());
   for(const name of absent)assert.equal(names.includes(name),false,`${subject} excludes ${name}`);
   for(const name of expected)assert.ok(names.includes(name),`${subject} includes ${name}`);
   await h.act(()=>document.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
  }
 }
 assert.equal(h.requests.some(r=>r.table),false);assert.equal(calls(h,rpc.write).length,0);
});

test('teacher subject changes discard stale facets and failure retries without a global-list fallback',async t=>{
 const h=await mount(t,'withdrawal');await click(h,'추가');await globalTeacherCatalogs(h);
 await pick(h,'과목','수학');const stale=latest(h,'get_academic_curriculum_numbered_page_v2');assert.ok(stale);
 // Resolve only the class page so the next subject control remains usable.
 for(const r of calls(h,rpc.list).filter(r=>!h.finished.has(r))){h.finished.add(r);const d=catalog(r);d.filterOptions.subjects=['영어','수학','과학'];await h.resolve(r,d);}
 await pick(h,'과목','영어');const current=latest(h,'get_academic_curriculum_numbered_page_v2');assert.notEqual(current,stale);assert.equal(stale.signal.aborted,true);
 for(const r of calls(h,'list_operations_catalogs_v1'))await h.resolve(r,subjectCatalog);
 await h.resolve(stale,subjectScopeResponse(stale));await h.reject(current,new Error('synthetic unavailable'));
 assert.match(document.body.textContent,/조회에 실패했습니다/);assert.equal(calls(h,rpc.write).length,0);
 await h.act(()=>labelled('선생님').click());const failedNames=[...document.querySelectorAll('[role="option"]')].map(node=>node.textContent.trim());
 assert.equal(failedNames.includes('가상 수학 교사'),false);assert.equal(failedNames.includes('가상 교사'),false);
 await h.act(()=>document.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
 await click(h,'일정 다시 조회');await globalTeacherCatalogs(h);await h.act(()=>labelled('선생님').click());
 const names=[...document.querySelectorAll('[role="option"]')].map(node=>node.textContent.trim());assert.ok(names.includes('가상 교사'));assert.equal(names.includes('가상 수학 교사'),false);
 const scopeReads=calls(h,'get_academic_curriculum_numbered_page_v2');assert.ok(scopeReads.every(r=>r.args.p_page===1&&r.args.p_page_size===15&&r.args.p_filters.search===''&&r.args.p_filters.teacher===null&&r.args.p_include_scope_metadata===true));
 assert.equal(h.requests.some(r=>r.table),false);
});
