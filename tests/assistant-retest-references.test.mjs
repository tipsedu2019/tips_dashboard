import test from 'node:test';
import assert from 'node:assert/strict';
import { loadNotificationComponent } from './helpers/notification-component-loader.mjs';
const id = n => `af230000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function fixture({ allowRaw = false, refError = null, valid = true } = {}) {
  const calls = [];
  const refs = { profiles:[{id:id(1),name:'관리 담당',role:'staff'}], students:[{id:id(2),name:'학생',school:'학교',grade:'중3',class_ids:[id(3)]}], classes:[{id:id(3),name:'영어',subject:'영어',teacher:'교사',student_ids:[id(2)],textbook_ids:[id(4)]}], textbooks:[{id:id(4),title:'단어',subject:'영어'}], teachers:[{id:id(5),name:'교사',subjects:['영어'],profile_id:id(6),is_visible:true}] };
  let failure = refError;
  const supabase = { from(table) { calls.push({table}); if (!allowRaw) throw new Error(`unexpected raw reference ${table}`); return {select:async()=>({data:table==='students'?[{id:id(2),name:'학생',contact:'PRIVATE_CONTACT'}]:[],error:null})}; }, rpc(name,args) { calls.push({name,args}); const result = name==='get_word_retest_reference_data_v1' ? {data:refs,error:failure} : name==='validate_word_retest_references_v1' ? {data:valid,error:null} : {data:{task:{id:id(7)},sourceEventIds:[]},error:null}; const promise = Promise.resolve(result); return {then:promise.then.bind(promise), abortSignal(){return this;},retry(){return this;}}; } };
  return { calls, refs, setFailure(value){failure=value;}, service:loadNotificationComponent('src/features/tasks/ops-task-service.ts', new Map([['@/lib/supabase',{supabase}]])) };
}
test('assistant option load uses only minimal retest RPC and retains roster/teacher selection links', async()=>{
 const p=fixture(); const result=await p.service.loadOpsTaskWorkspaceOptionData({taskType:'word_retest',viewerId:id(8),viewerRole:'assistant'});
 assert.equal(result.error,null); assert.equal(result.schemaReady,true);
 assert.deepEqual(p.calls.map(c=>c.name||c.table),['get_word_retest_reference_data_v1']);
 assert.deepEqual(result.students[0].classIds,[id(3)]); assert.deepEqual(result.classes[0].studentIds,[id(2)]);assert.deepEqual(result.classes[0].textbookIds,[id(4)]);assert.equal(result.teachers[0].profileId,id(6));
 for(const value of [result.students[0].contact,result.students[0].parentContact,result.teachers[0].accountEmail,result.profiles[0].email,result.profiles[0].loginId])assert.equal(value,'');
});
test('same user role change cannot reuse staff private option cache', async()=>{
 const p=fixture({allowRaw:true}); const input={taskType:'word_retest',viewerId:id(8)};
 const staff=await p.service.loadOpsTaskWorkspaceOptionData({...input,viewerRole:'staff'});assert.equal(staff.students[0].contact,'PRIVATE_CONTACT');
 const assistant=await p.service.loadOpsTaskWorkspaceOptionData({...input,viewerRole:'assistant'});assert.equal(assistant.students[0].contact,'');
 assert.equal(p.calls.filter(c=>c.name==='get_word_retest_reference_data_v1').length,1);
 assert.equal(JSON.stringify(assistant).includes('PRIVATE_CONTACT'),false);
});
test('retest reference permission failure is not cached or replaced with raw fallback', async()=>{
 const p=fixture({refError:{code:'42501',message:'denied'}});const input={taskType:'word_retest',viewerId:id(8),viewerRole:'assistant'};
 const denied=await p.service.loadOpsTaskWorkspaceOptionData(input);assert.equal(denied.schemaReady,false);
 p.setFailure(null);const accepted=await p.service.loadOpsTaskWorkspaceOptionData(input);assert.equal(accepted.schemaReady,true);assert.equal(accepted.students.length,1);
 assert.deepEqual(p.calls.map(c=>c.name||c.table),['get_word_retest_reference_data_v1','get_word_retest_reference_data_v1']);
});
const completed={type:'word_retest',title:'재시험',status:'done',priority:'normal',studentId:id(2),classId:id(3),textbookId:id(4),wordRetest:{teacherId:id(5),branch:'본관',testAt:'2026-10-23T09:00:00+09:00',unit:'1',firstScore:'28',totalQuestionCount:'30',cutoffQuestionCount:'25',retestStatus:'passed'}};
for(const valid of [true,false])test(`completed retest checks safe references before producer: ${valid}`,async()=>{
 const p=fixture({valid});
 if(valid){const receipt=await p.service.createOpsTask(completed);assert.equal(receipt.taskId,id(7));}
 else await assert.rejects(p.service.createOpsTask(completed),/단어 재시험.*다시 선택/);
 assert.equal(p.calls[0].name,'validate_word_retest_references_v1');
 assert.deepEqual(p.calls[0].args,{p_student_id:id(2),p_class_id:id(3),p_textbook_id:id(4),p_teacher_id:id(5)});
 assert.deepEqual(p.calls.map(c=>c.name||c.table),valid?['validate_word_retest_references_v1','create_ops_task_v2']:['validate_word_retest_references_v1']);
});
