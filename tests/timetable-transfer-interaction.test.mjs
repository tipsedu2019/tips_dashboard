import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTimetableTransferSession, transferEffect, transferWasRejected } from '../src/features/academic/timetable-transfer-session.ts';
const request={source:{kind:'plan',planId:'source'},target:{kind:'operational'},mode:'copy',itemIds:['one','two','three'],onConflict:'reject'};
const preview={request,fingerprint:'fp',shadowFingerprint:'shadow',mappings:[],blockers:[]};
const result={transferId:'receipt'};
function harness(overrides={}) {const calls=[],applied=[];const store=new Map();let reads=0;const service={actorScope:'actor',previewTransfer:async r=>({...preview,request:r}),commitTransfer:async c=>{calls.push(c);return result;},...overrides};const options={service,planId:'source',apply:r=>applied.push(r),refresh:async()=>{reads++;},afterCommit:async()=>{},storage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)}};return {calls,applied,store,options,get reads(){return reads;},session:createTimetableTransferSession(options)};}
test('selected item IDs and final copy/move effects are explicit',()=>{assert.match(transferEffect(request),/새 수업 3개.*반영 완료/);assert.match(transferEffect({...request,mode:'move'}),/프리셋에서 이동/);assert.match(transferEffect({...request,target:{kind:'plan',planId:'target'}}),/새 초안 3개.*원안 유지/);});
test('unknown response retains byte-equivalent immutable command through new preview attempts and remount',async()=>{const h=harness();let fail=true;h.options.service.commitTransfer=async c=>{h.calls.push(c);if(fail)throw Error('response lost');return result;};await h.session.preview(request);await h.session.commit();assert.equal(h.session.snapshot().status,'uncertain');const original=h.calls[0];await h.session.preview({...request,itemIds:['two']});assert.equal(h.session.snapshot().command.request.itemIds.length,3);h.session.pause();const recovered=createTimetableTransferSession(h.options);fail=false;await recovered.commit();assert.deepEqual(h.calls[1],original);assert.equal(recovered.snapshot().status,'completed');assert.equal(h.store.size,0);});
test('committed refresh failure retries only reads and never repeats promotion',async()=>{const h=harness();let fail=true;h.options.refresh=async()=>{if(fail)throw Error('read unavailable');};const session=createTimetableTransferSession(h.options);await session.preview(request);await session.commit();assert.equal(session.snapshot().status,'refresh_failed');assert.equal(h.calls.length,1);fail=false;await session.commit();assert.equal(session.snapshot().status,'completed');assert.equal(h.calls.length,1);});
test('exact stale rejection permits explicit new selection preview and new key',async()=>{const h=harness();let fail=true;h.options.service.commitTransfer=async c=>{h.calls.push(c);if(fail)throw {code:'P0001',message:'timetable_stale'};return result;};await h.session.preview(request);await h.session.commit();assert.equal(h.session.snapshot().command,null);fail=false;await h.session.preview({...request,itemIds:['two']});await h.session.commit();assert.notEqual(h.calls[0].requestKey,h.calls[1].requestKey);assert.deepEqual(h.calls[1].request.itemIds,['two']);});
test('preview blockers prevent commit and exact rejection pairs exclude unrelated SQL failures',async()=>{const h=harness({previewTransfer:async()=>({...preview,blockers:[{sourceId:'one',code:'unplaced',label:'pending',relatedIds:[]}]})});await h.session.preview(request);await h.session.commit();assert.equal(h.calls.length,0);assert.equal(transferWasRejected({code:'P0001',message:'unexpected'}),false);});
test('late commit response from retired actor neither merges data nor invokes caches',async()=>{let resolve;const h=harness({commitTransfer:c=>{h.calls.push(c);return new Promise(r=>resolve=r);}});await h.session.preview(request);const pending=h.session.commit();h.session.retire();resolve(result);await pending;assert.equal(h.applied.length,0);assert.equal(h.reads,0);assert.equal(h.store.size,0);});

test('permission revocation immediately clears caller canonical data on preview and commit',async()=>{
 for(const phase of ['preview','commit']){
  let cleared=0;const h=harness();h.options.onForbidden=()=>{cleared++;};
  h.options.service[phase==='preview'?'previewTransfer':'commitTransfer']=async()=>{throw {code:'42501',message:'timetable_forbidden'};};
  const session=createTimetableTransferSession(h.options);await session.preview(request);if(phase==='commit')await session.commit();
  assert.equal(cleared,1);assert.equal(session.snapshot().command,null);assert.equal(h.store.size,0);
 }
});

test('pending original JSON stays intact while labels show day time and resource names',async()=>{
 const {formatPendingSlot}=await import('../src/features/academic/timetable-plan-interaction.ts');
 const sourceText=JSON.stringify({id:'private-slot-id',itemId:'private-item-id',planId:'private-plan-id',teacherName:'김선생',classroomName:'1강'});
 const pending={id:'pending',sourceText,reason:'conflict',weekday:1,startMinute:1033,endMinute:1093,teacherId:'teacher',classroomId:'room'};
 assert.equal(typeof formatPendingSlot,'function');
 const text=formatPendingSlot(pending,{teachers:[{id:'teacher',name:'김선생'}],classrooms:[{id:'room',name:'1강'}]});
 assert.match(text,/월.*17:13–18:13.*김선생.*1강/);assert.doesNotMatch(text,/private-|itemId|planId/);assert.equal(pending.sourceText,sourceText);
});

test('resolving one pending placement atomically adds a new slot and preserves siblings and remaining originals',async()=>{
 const {buildPlacementFormEdit,placementFormDefaults}=await import('../src/features/academic/timetable-plan-interaction.ts');
 const pending={id:'pending1',sourceText:'월 17:13–18:13',reason:'conflict',weekday:1,startMinute:1033,endMinute:1093,teacherId:'t',classroomId:'r'};
 const item={id:'item',planId:'plan',name:'Class',subject:'영어',subjectAreaKey:null,grade:'중2',capacity:12,tuition:100000,defaultTeacherId:'t',defaultClassroomId:'r',durationMinutes:60,pendingSlots:[pending,{...pending,id:'pending2',weekday:3}]};
 const sibling={id:'sibling',itemId:'item',planId:'plan',weekday:5,startMinute:600,endMinute:660,teacherId:'t',classroomId:'r',sourceSlotId:'origin'};
 const draft={item,slots:[sibling],scope:'add',pendingResolutionId:'pending1',target:{weekday:1,startMinute:1033,teacherId:'t',classroomId:'r'},endMinute:1093};
 const values=placementFormDefaults(draft),before=structuredClone(draft);const edit=buildPlacementFormEdit(draft,{...values,weekdays:[2],start:'17:13',end:'18:13'});
 assert.deepEqual(edit.item.pendingSlots,[item.pendingSlots[1]]);assert.deepEqual(edit.slots[0],sibling);assert.equal(edit.slots[1].weekday,2);assert.equal(edit.slots[1].startMinute,1033);assert.equal(edit.slots[1].endMinute,1093);assert.notEqual(edit.slots[1].id,sibling.id);assert.deepEqual(draft,before);
 assert.throws(()=>buildPlacementFormEdit(draft,{...values,weekdays:[]}),/요일/);assert.deepEqual(draft,before);
});


test('pending without a weekday retains original resources and duration until a day is chosen',async()=>{
 const {pendingPlacementDraft,placementFormDefaults,buildPlacementFormEdit}=await import('../src/features/academic/timetable-plan-interaction.ts');
 const pending={id:'pending',sourceText:'17:13–17:43',reason:'invalid_time',weekday:null,startMinute:1033,endMinute:1063,teacherId:'original-teacher',classroomId:'original-room'};
 const item={id:'item',planId:'plan',name:'Class',subject:'영어',subjectAreaKey:null,grade:'중2',capacity:null,tuition:null,defaultTeacherId:'default-teacher',defaultClassroomId:'default-room',durationMinutes:60,pendingSlots:[pending]};
 const draft=pendingPlacementDraft(item,[],'pending'),values=placementFormDefaults(draft);
 assert.equal(values.teacher,'original-teacher');assert.equal(values.room,'original-room');assert.equal(values.duration,'30');assert.equal(values.start,'17:13');assert.equal(values.end,'17:43');assert.deepEqual(values.weekdays,[]);
 assert.throws(()=>buildPlacementFormEdit(draft,values),/요일/);assert.throws(()=>buildPlacementFormEdit({...draft,scope:'item'},values),/추가 배치/);assert.deepEqual(item.pendingSlots,[pending]);
});
