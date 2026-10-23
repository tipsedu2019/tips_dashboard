import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadNotificationComponent } from './helpers/notification-component-loader.mjs';
import { sanitizeOperationalCommonControls } from '../src/features/tasks/operational-task-access.ts';
const fixturePath = process.env.TEACHER_COMMON_SQL_FIXTURE || new URL('./fixtures/teacher-operational-common-response.json', import.meta.url);
const id = n => `af240000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const filters = type => ({ taskType:type,search:'',statuses:[],...(type==='registration'?{view:'inquiry',consultationOwnerId:null}:{view:'applicant',subject:null,teacher:null,period:'all',dateFrom:null,dateTo:null,filterColumn:null,sortColumn:null,sortDirection:null}) });
function services(payload) {
 const calls=[];
 const supabase={from(){throw new Error('common detail must never read raw relations')},rpc(name,args){calls.push({name,args});const promise=Promise.resolve({data:name==='get_operational_common_detail_v1'?payload.rows[0]:payload,error:null});return {then:promise.then.bind(promise),abortSignal(){return this},retry(){return this}}}};
 return {calls,service:loadNotificationComponent('src/features/tasks/ops-task-service.ts',new Map([['@/lib/supabase',{supabase}]])),numbered:loadNotificationComponent('src/features/tasks/ops-task-numbered-service.ts',new Map([['@/lib/supabase',{supabase}]])),supabase};
}
test('old private-column controls are normalized before the first teacher query while manager preferences remain unchanged',()=>{
 for(const type of ['withdrawal','transfer']){
 const old={filterColumn:type==='transfer'?'transferReason':'teacherOpinion',sortColumn:type==='transfer'?'transferReason':'customerReason',sortDirection:'desc',search:'private',subject:null};
 assert.deepEqual(sanitizeOperationalCommonControls(type,old,true),{...old,filterColumn:'student',sortColumn:null,sortDirection:null});
 assert.strictEqual(sanitizeOperationalCommonControls(type,old,false),old);
 const valid={...old,filterColumn:'student',sortColumn:'status'};assert.deepEqual(sanitizeOperationalCommonControls(type,valid,true),valid);
 }
});
{
 const captured=JSON.parse(readFileSync(fixturePath,'utf8'));
 for(const type of ['registration','withdrawal','transfer'])test(`actual SQL common ${type} page is accepted by the existing strict consumer and common detail mapper`,async()=>{
  const p=services(captured[type]);const result=await p.numbered.createOpsTaskNumberedReadService({supabase:p.supabase}).readPage({filters:filters(type),page:1,pageSize:15,viewerId:id(3)});
  assert.equal(result.rows.length,captured[type].rows.length);assert.equal(JSON.stringify(result).includes('PRIVATE_'),false);
  const selected=await p.service.loadOperationalCommonTaskById(captured[type].rows[0].id);assert.equal(selected.id,captured[type].rows[0].id);assert.equal(selected.type,type);
  assert.equal(selected.comments.length,0);assert.equal(selected.attachments.length,0);assert.equal(selected.events.length,0);
  assert.equal(p.calls.filter(call=>call.name==='get_operational_common_detail_v1').length,1);
 });
}

const bookFixture = JSON.parse(readFileSync(process.env.TEACHER_BOOK_SQL_FIXTURE || new URL('./fixtures/teacher-textbook-common-response.json', import.meta.url), 'utf8'));
const planFixture = JSON.parse(readFileSync(process.env.TEACHER_PLAN_SQL_FIXTURE || new URL('./fixtures/teacher-planning-common-response.json', import.meta.url), 'utf8'));
test('actual SQL common textbook page is accepted by the bounded common consumer', async () => {
 const calls=[]; const client={rpc(name,args){calls.push({name,args});const promise=Promise.resolve({data:bookFixture,error:null});return {then:promise.then.bind(promise),abortSignal(){return this},retry(){return this}}}};
 const reader=loadNotificationComponent('src/features/textbooks/teacher-textbook-request-read.ts');
 const result=await reader.readTeacherTextbookRequests({search:'',page:1,pageSize:15},{client});
 assert.equal(result.totalCount,16); assert.equal(result.rows.length,15); assert.equal(JSON.stringify(result).includes('PRIVATE_'),false);assert.equal(calls.length,1);
});
test('actual SQL teacher makeup page passes the existing strict consumer without any raw references',async()=>{
 const client={rpc(){const promise=Promise.resolve({data:planFixture.makeup,error:null});return{then:promise.then.bind(promise),abortSignal(){return this},retry(){return this}}},from(){throw new Error('raw private references forbidden')}};
 const reader=loadNotificationComponent('src/features/makeup-requests/makeup-numbered-service.ts',new Map([['@/lib/supabase',{supabase:client}]]));
 const filters={view:'approvalPending',subject:'all',teacher:'all',period:'all',dateFrom:'',dateTo:'',filterColumn:'className',search:'',sortColumn:null,sortDirection:null};
 const result=await reader.readMakeupNumberedPage({filters,page:1,pageSize:15});assert.equal(result.totalCount,1);assert.equal(result.rows[0].reason,'');assert.deepEqual(result.rows[0].events,[]);
 const privateFilters={...filters,filterColumn:'reason',sortColumn:'finalNote',sortDirection:'asc'};
 assert.deepEqual(reader.commonMakeupFilters(privateFilters,true),{...privateFilters,filterColumn:'className',sortColumn:null,sortDirection:null});assert.strictEqual(reader.commonMakeupFilters(privateFilters,false),privateFilters);
});

test('actual SQL plan projection keeps legacy makeup binding and effective schedule parity', async () => {
 const {effectiveInputForLesson,resolveEffectiveSchedule}=await import('../src/features/operations/legacy-effective-schedule.js');
 const source=planFixture.projection;
 assert.ok(source,'fresh SQL projection capture must exist');
 assert.equal(JSON.stringify(source.common).includes('PRIVATE_'),false);
 assert.equal(source.common.sessions[0],null);
 const original={...source.original,sessions:source.original.sessions.filter(Boolean)};
 const common={...source.common,sessions:source.common.sessions.filter(Boolean)};
 const row=original.sessions[0],commonRow=common.sessions[0];
 const bindingKeys=['id','date','scheduleState','state','originalDate','makeupDate','isForced','sourceSlotId','makeupRequestId','makeupRequestRole'];
 const binding=Object.fromEntries(bindingKeys.filter(key=>Object.hasOwn(row,key)).map(key=>[key,row[key]]));
 const context={version:1,basicSlots:[],catalogs:{teachers:[{id:'teacher-a',name:'공통 교사'}],rooms:[{id:'room-a',name:'별관 2강'}]},approvedByIdentity:{[row.id]:{binding,approvedOverride:{startTime:'11:00',endTime:'12:30',teacherCatalogId:'teacher-a',classroomCatalogId:'room-a'},approvedOverrideVerified:true}}};
 const before=effectiveInputForLesson(original,row,context),after=effectiveInputForLesson(common,commonRow,context);
 assert.deepEqual(after.approvedOverride,before.approvedOverride);assert.equal(after.approvedOverrideVerified,true);
 assert.deepEqual(resolveEffectiveSchedule(after),resolveEffectiveSchedule(before));
 assert.equal(common.sessionStates[row.date],'force_active');
 const mutant={...commonRow};delete mutant.isForced;
 assert.equal(effectiveInputForLesson({...common,sessions:[mutant]},mutant,context).approvedOverride,undefined,'the test detects the former binding-loss regression');
});
