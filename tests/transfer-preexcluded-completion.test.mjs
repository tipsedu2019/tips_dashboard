import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
const source=await readFile(new URL('../src/features/tasks/ops-task-service.ts',import.meta.url),'utf8');
const start=source.indexOf('async function assertManagementSyncRecordsReady');
const end=source.indexOf('function assertCompletedOperationStatusTransition',start);
function guard(records) {
  const sandboxModule={exports:{}};
  vm.runInNewContext(ts.transpileModule(source.slice(start,end)+'\nmodule.exports=assertManagementSyncRecordsReady;',
    {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{
    module:sandboxModule,
    selectOpsRowById:async(table,id)=>records[table]?.[id]||null,
    assertDifferentOpsClass:(from,to,message)=>{if(from.id===to.id)throw new Error(message)},
    assertOpsStudentInClass:()=>{throw new Error('source-roster client guard invoked')},
  });
  return sandboxModule.exports;
}
const input={type:'transfer',status:'done',studentId:'s',classId:'to',transfer:{fromClassId:'from',toClassId:'to',
  fromClassName:'최초 전반',toClassName:'최초 후반',fromClassEndDate:'2026-09-01',fromClassEndSession:'3회차',toClassStartDate:'2026-09-02',toClassStartSession:'4회차'}};
for(const [name,classes] of [['normal',['from']],['pre-excluded',[]],['destination already enrolled',['to']],['both rosters present',['from','to']]]) {
 test(`transfer completion preflight accepts ${name} and preserves request facts`,async()=>{
   const snapshot=structuredClone(input);
   await guard({students:{s:{id:'s',class_ids:classes}},classes:{from:{id:'from'},to:{id:'to',name:'renamed current class'}}})(input);
   assert.deepEqual(input,snapshot);
 });
}
for (const [missing,record] of [['student',{students:{},classes:{from:{id:'from'},to:{id:'to'}}}],['source',{students:{s:{id:'s'}},classes:{to:{id:'to'}}}],['destination',{students:{s:{id:'s'}},classes:{from:{id:'from'}}}]]) {
 test(`transfer completion preflight rejects missing ${missing}`,async()=>{
   await assert.rejects(guard(record)(input),/다시 선택/);
 });
}
test('transfer completion still rejects identical source and destination',async()=>{
 await assert.rejects(guard({students:{s:{id:'s'}},classes:{from:{id:'same'},to:{id:'same'}}})(input),/다르게 선택/);
});

const workspaceSource=await readFile(new URL('../src/features/tasks/ops-task-workspace.tsx',import.meta.url),'utf8');
function rosterBlockers(input) {
  const sandboxModule={exports:{}};
  const start=workspaceSource.indexOf('function getRosterCompletionBlockers(');
  const end=workspaceSource.indexOf('function getOperationCompletionBlockers(',start);
  vm.runInNewContext(ts.transpileModule(workspaceSource.slice(start,end)+'\nmodule.exports=getRosterCompletionBlockers;',
    {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{
    module:sandboxModule,EMPTY_OPS_TASK_OPTION_INDEXES:{},hasLinkedRecord:Boolean,
    findStudentOptionByReference:()=>({id:'s'}),findClassOptionByReference:()=>({id:'from'}),hasRosterLink:()=>false,
  });
  return [...sandboxModule.exports(input,[],[])];
}
test('the actual completion button allows a pre-excluded transfer roster',()=>{
 assert.deepEqual(rosterBlockers(input),[]);
});
test('word retest still requires current roster membership',()=>{
 assert.deepEqual(rosterBlockers({...input,type:'word_retest'}),['수업 명단']);
});
