import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadNotificationComponent } from './helpers/notification-component-loader.mjs';
import { modules } from './helpers/makeup-numbered-harness.mjs';

// Receives only the five synthetic payloads captured from the disposable DB
// probe. The production service and its strict Zod contract run unchanged.
assert.equal(process.argv.length,3,'supply the isolated producer capture path');
const captures=JSON.parse(await readFile(process.argv[2],'utf8'));assert.equal(captures.length,5);
const requests=[];let response;
const api=loadNotificationComponent('src/features/teacher-requests/teacher-request-service.ts',new Map([
 ['@/lib/supabase',{supabase:{rpc(name,args){
  requests.push({name,args});
  return {abortSignal(){return this;},retry(value){assert.equal(value,false);return Promise.resolve({data:response,error:null});}};
 }}}],
]));
let consumers=0;
for(const frame of captures){
 const {domain,detail,page,refs}=frame;assert.match(detail.requesterId,/^e7270000-/);
 response=detail;assert.deepEqual(await api.readOwnRequest(domain,detail.requesterId,detail.id,new AbortController().signal),detail);consumers++;
 response=page;assert.deepEqual(await api.readOwnRequests(domain,detail.requesterId,1,new AbortController().signal),page);consumers++;
 response=refs;assert.deepEqual(await api.readRequestReferences(domain,frame.referenceClassId,frame.referenceMonth,new AbortController().signal),refs);consumers++;
 response=frame.unselectedRefs;
 assert.deepEqual(await api.readRequestReferences(domain,null,'',new AbortController().signal),{classes:[],students:[],rooms:[],sessions:[],approver:null});consumers++;
 if(domain==='transfer'||domain==='withdrawal'){
  assert.equal(refs.classes.length,1);assert.equal(refs.classes[0].id,frame.referenceClassId);
  assert.deepEqual(Object.keys(refs.classes[0]).sort(),['id','name','scheduleStorageMode']);
  assert.equal(refs.students.length,7);
  assert.deepEqual(new Set(refs.students.map(student=>student.status)),new Set(['enrolled','waitlisted']));
  for(const student of refs.students)assert.deepEqual(Object.keys(student).sort(),['id','name','status']);
  assert.equal(JSON.stringify(refs).includes('CANARY'),false);
  assert.deepEqual(refs.rooms,[]);assert.deepEqual(refs.sessions,[]);assert.equal(refs.approver,null);
 }else if(domain==='makeup'){
  assert.deepEqual(refs.students,[]);assert.deepEqual(Object.keys(refs.approver).sort(),['label','status']);
 }
 response=detail;assert.deepEqual(await api.mutateOwnRequest(detail.requesterId,{domain,id:null,action:'create',input:frame.input,revision:null,requestId:'e7270000-0000-4000-8000-000000000999'}),detail);consumers++;
 if(frame.nullReferenceDetail){
  response=frame.nullReferenceDetail;
  assert.deepEqual(await api.readOwnRequest(domain,detail.requesterId,detail.id,new AbortController().signal),response);consumers++;
  assert.equal(response.input,null);assert.deepEqual(response.allowedActions,['change_request','cancel_request']);
 }
 assert.equal(JSON.stringify(refs).includes('PRIVATE_'),false);
 assert.equal('input' in page.rows[0],false);
}
assert.equal(requests.length,27);
const load=modules({}, {'@/providers/auth-provider':{useAuth:()=>({})}});
const {getMakeupRequestTableValue}=load('src/features/makeup-requests/makeup-request-workspace.tsx');
const managementPage=captures.find(frame=>frame.withdrawnManagerPage).withdrawnManagerPage;
assert.equal(managementPage.totalCount,1);
const managementRow=managementPage.rows[0];
assert.equal(getMakeupRequestTableValue(managementRow,'status'),'취소·철회');
assert.equal(getMakeupRequestTableValue(managementRow,'canceledNote'),'가상 본인 철회 검색 확인');
assert.notEqual(getMakeupRequestTableValue(managementRow,'canceledAt'),'-');
console.log(JSON.stringify({status:'passed',syntheticSqlPayloads:captures.length,actualProductionConsumerChecks:consumers,actualManagementUiCells:3,realNetworkCalls:0}));
